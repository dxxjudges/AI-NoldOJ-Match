'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { config, ROOT } = require('./config');
const db = require('./db/database');

console.log('==============================================');
console.log('  NoldOJ v' + require('../package.json').version);
console.log('==============================================');

// high-risk state alerts
if (config.server.host === '0.0.0.0') {
  console.warn('[alert] 服务器绑定 0.0.0.0 — 请确认部署在虚拟机/专用测试机，切勿在存有敏感数据的个人主机上公网暴露！');
}
if (process.platform !== 'win32') {
  console.warn('[alert] 当前非 Windows 平台，沙箱回退层将使用通用超时/进程树终止，隔离强度降低。');
}
if (!config.security.captchaEnabled) {
  console.warn('[alert] 验证码已关闭，登录/注册接口暴露于自动化攻击风险。');
}

// ---- database ----
db.migrate();
console.log('[db] ready:', config.paths.dbPath);

// ---- express ----
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// cookies (minimal parser for refresh token)
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  next();
});

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.server.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// static
app.use('/uploads', express.static(config.paths.uploadDir, { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'frontend')));

// API
app.use('/api', require('./routes'));

// SPA-ish fallback for pages
app.get(/^\/(?!api|ws|uploads).*/, (req, res) => {
  const p = path.join(ROOT, 'frontend', 'index.html');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).send('NoldOJ');
});

// error handler
app.use((err, req, res, next) => {
  console.error('[http]', err && err.stack || err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : String(err.message || err) });
});

// ---- startup convergence: clean IDE residual states ----
try {
  db.run("UPDATE ide_runs SET status='internal_error', stderr='服务重启中断' WHERE status IN ('pending','compiling','running')");
  db.run("UPDATE submissions SET status='internal_error' WHERE status IN ('compiling','judging')");
} catch (_) {}

// sandbox leftover sweep
try { require('./services/sandbox/runner').sweepLeftovers(); } catch (_) {}
try { fs.rmSync(config.paths.workDir, { recursive: true, force: true }); fs.mkdirSync(config.paths.workDir, { recursive: true }); } catch (_) {}

// captcha cleanup timer
try { require('./services/captcha').cleanup(); setInterval(() => require('./services/captcha').cleanup(), 60000); } catch (_) {}

const server = http.createServer(app);
require('./ws/hub').init(server);

server.listen(config.server.port, config.server.host, () => {
  console.log(`[server] listening on http://${config.server.host}:${config.server.port}`);
  console.log(`[server] frontend: http://127.0.0.1:${config.server.port}/`);
  console.log('[server] default admin: admin / admin123 — 登录后请立即修改密码');
});

function shutdown() {
  console.log('\n[server] shutting down...');
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (e) => {
  console.error('[fatal] uncaughtException:', e);
});
process.on('unhandledRejection', (e) => {
  console.error('[fatal] unhandledRejection:', e);
});
