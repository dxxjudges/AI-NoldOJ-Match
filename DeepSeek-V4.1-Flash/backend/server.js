import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import config, { ensureDirs, ROOT_DIR } from './src/config.js';
import { closeDb, run, all } from './src/db.js';
import { logger } from './src/logger.js';
import { createRouter } from './src/http/router.js';
import { createContext } from './src/http/context.js';
import { authOptional } from './src/http/auth.js';
import { HttpError } from './src/utils/errors.js';
import { broadcast } from './src/services/websocket.js';
import { attachWebSocket, connectionCount } from './src/services/websocket.js';
import { ensureSeed } from './src/seed.js';
import { sandboxBackend } from './src/services/sandbox-runner.js';
import { enqueue, queueLength } from './src/services/judge.js';
import registerRoutes from './src/routes/index.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
};

const MAX_BODY = 20 * 1024 * 1024;

function readBody(ctx) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    ctx.req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体过大'));
        ctx.req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => {
      const raw = Buffer.concat(chunks);
      ctx.rawBody = raw;
      const type = ctx.get('content-type') || '';
      if (type.includes('application/json')) {
        try {
          ctx.body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        } catch {
          reject(new HttpError(400, 'BAD_JSON', 'JSON 格式错误'));
          return;
        }
      } else if (type.includes('application/x-www-form-urlencoded')) {
        ctx.body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
      }
      resolvePromise();
    });
    ctx.req.on('error', reject);
  });
}

function applyCors(ctx) {
  if (!config.cors.enabled) return;
  const origin = ctx.get('origin');
  if (origin && (config.cors.origins.includes('*') || config.cors.origins.includes(origin))) {
    ctx.header('Access-Control-Allow-Origin', origin);
    ctx.header('Access-Control-Allow-Credentials', 'true');
  }
  ctx.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  ctx.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

async function serveStatic(ctx) {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    ctx.json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' }, 404);
    return;
  }

  if (ctx.pathname.startsWith('/uploads/')) {
    const rel = ctx.pathname.replace(/^\/uploads\//, '');
    await sendFile(ctx, join(config.core.uploadsDir, rel));
    return;
  }

  if (ctx.pathname === '/api' || ctx.pathname.startsWith('/api/')) {
    ctx.json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' }, 404);
    return;
  }

  let rel = ctx.pathname === '/' ? '/index.html' : ctx.pathname;
  const target = normalize(join(config.core.frontendDir, rel));
  if (!target.startsWith(resolve(config.core.frontendDir))) {
    ctx.json({ ok: false, code: 'FORBIDDEN', message: '非法路径' }, 403);
    return;
  }
  if (existsSync(target)) {
    await sendFile(ctx, target);
    return;
  }
  // SPA fallback
  await sendFile(ctx, join(config.core.frontendDir, 'index.html'));
}

async function sendFile(ctx, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const ext = extname(filePath).toLowerCase();
    ctx.header('Content-Type', MIME[ext] || 'application/octet-stream');
    ctx.header('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=3600');
    ctx.res.statusCode = 200;
    if (ctx.method === 'HEAD') { ctx.res.end(); return; }
    createReadStream(filePath).pipe(ctx.res);
  } catch {
    ctx.json({ ok: false, code: 'NOT_FOUND', message: '文件不存在' }, 404);
  }
}

function startupConvergence() {
  const staleRuns = all("SELECT id FROM ide_runs WHERE status IN ('pending','reviewing','compiling','running')");
  for (const row of staleRuns) {
    run("UPDATE ide_runs SET status = 'system_error', stderr = '服务重启，运行被中断' WHERE id = ?", row.id);
  }
  const staleSubs = all("SELECT id FROM submissions WHERE judged = 0 AND status IN ('reviewing','compiling','running','queued')");
  for (const row of staleSubs) {
    run("UPDATE submissions SET status = 'pending' WHERE id = ?", row.id);
  }
  if (staleRuns.length || staleSubs.length) {
    logger.warn(`启动收敛：重置 ${staleRuns.length} 个 IDE 运行、重新排队 ${staleSubs.length} 个提交`);
  }
  for (const row of staleSubs) enqueue(row.id);
  return { staleRuns: staleRuns.length, staleSubs: staleSubs.length };
}

async function main() {
  ensureDirs();
  ensureSeed();
  startupConvergence();

  const router = createRouter();
  router.use(authOptional);
  registerRoutes(router);

  const server = http.createServer(async (ctxReq, ctxRes) => {
    const ctx = createContext(ctxReq, ctxRes);
    try {
      applyCors(ctx);
      if (ctx.method === 'OPTIONS') { ctxRes.statusCode = 204; ctxRes.end(); return; }
      await readBody(ctx);
      logger.debug(`${ctx.method} ${ctx.pathname}`);
      const handled = await router.dispatch(ctx);
      if (!handled) await serveStatic(ctx);
    } catch (err) {
      handleError(ctx, err);
    }
  });

  attachWebSocket(server);

  server.listen(config.core.port, config.core.host, () => {
    const addr = `http://localhost:${config.core.port}`;
    logger.info('====================================================');
    logger.info(`  NoldOJ 已启动: ${addr}`);
    logger.info(`  沙箱后端: ${sandboxBackend()}   Node: ${process.version}`);
    logger.info('====================================================');
    if (sandboxBackend() === 'fallback') {
      logger.warn('未检测到原生沙箱宿主，正在使用回退模式，资源限制较弱。');
    }
    if (config.ai.security.enabled && !config.core.jwtSecret) {
      logger.warn('AI 代码审查已启用但 JWT 密钥未持久化，请检查配置。');
    }
  });

  const shutdown = (signal) => {
    logger.info(`收到 ${signal}，正在关闭...`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => { logger.error('uncaughtException', err); });
  process.on('unhandledRejection', (err) => { logger.error('unhandledRejection', err); });

  return server;
}

function handleError(ctx, err) {
  if (err instanceof HttpError) {
    ctx.json({ ok: false, code: err.code, message: err.message, detail: err.detail }, err.status);
    return;
  }
  logger.error('request error', err);
  if (!ctx.res.writableEnded) {
    ctx.json({ ok: false, code: 'INTERNAL', message: '服务器内部错误' }, 500);
  }
}

export { main };

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    logger.error('启动失败', err);
    process.exit(1);
  });
}

export { broadcast, connectionCount, queueLength, ROOT_DIR };
