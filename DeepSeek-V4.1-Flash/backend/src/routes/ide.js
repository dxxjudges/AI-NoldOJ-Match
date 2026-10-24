import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { get, run } from '../db.js';
import { forbidden, badRequest, notFound, tooMany } from '../utils/errors.js';
import { ok } from '../http/context.js';
import { toInt } from './helpers.js';
import { rateLimit } from '../utils/rateLimit.js';
import config from '../config.js';
import { createWorkDir, removeWorkDir, runInSandbox } from '../services/sandbox-runner.js';
import { compile, resolveRunCommand } from '../services/compiler.js';
import { broadcast, sendToUser } from '../services/websocket.js';

function defaultMainName(language) {
  if (language.key === 'java') return 'Main.java';
  return `main.${language.ext || 'txt'}`;
}

function setStatus(runId, status, extra = {}) {
  const fields = ['status = ?'];
  const params = [status];
  for (const [key, value] of Object.entries(extra)) { fields.push(`${key} = ?`); params.push(value); }
  params.push(runId);
  run(`UPDATE ide_runs SET ${fields.join(', ')} WHERE id = ?`, ...params);
  const row = get('SELECT user_id FROM ide_runs WHERE id = ?', runId);
  broadcast('ide_status', { id: runId, status });
  if (row) sendToUser(row.user_id, 'ide_status', { id: runId, status });
}

async function processRun(runId, { timeLimitMs, memoryLimitKb }) {
  const ide = get('SELECT * FROM ide_runs WHERE id = ?', runId);
  if (!ide) return;
  const language = get('SELECT * FROM languages WHERE id = ?', ide.language_id);
  if (!language) { setStatus(runId, 'system_error', { stderr: '语言不存在' }); return; }

  const workDir = createWorkDir(`ide-${runId}`);
  try {
    setStatus(runId, 'compiling');
    let files = [];
    try { files = JSON.parse(ide.files || '[]'); } catch { files = []; }
    if (!files.length) files = [{ name: defaultMainName(language), content: ide.source_code }];
    for (const file of files) writeFileSync(join(workDir, String(file.name).replace(/[\\/]/g, '_')), file.content ?? '');
    const mainFile = (files.find((f) => f.main)?.name || files[0].name).replace(/[\\/]/g, '_');

    const compileResult = await compile({ language, workDir, mainFile, exeName: 'main', timeLimitMs: 15000, memoryLimitKb: 1048576 });
    if (!compileResult.ok) {
      setStatus(runId, 'compile_error', { stderr: compileResult.output, exit_code: 1 });
      return;
    }
    setStatus(runId, 'running');
    const vars = { source: mainFile, exe: 'main', dir: workDir, main: mainFile };
    const cmd = resolveRunCommand(language, vars);
    const exec = await runInSandbox({
      exe: cmd.exe, args: cmd.args, cwd: workDir, stdin: ide.stdin,
      timeLimitMs, memoryLimitKb, processLimit: 16,
    });
    let status = 'done';
    if (exec.timedOut) status = 'time_limit';
    else if (exec.memoryExceeded) status = 'memory_limit';
    else if (exec.exitCode !== 0) status = 'runtime_error';
    setStatus(runId, status, {
      stdout: exec.stdout || '',
      stderr: exec.stderr || '',
      exit_code: exec.exitCode,
      time_ms: exec.wallMs || 0,
      memory_kb: exec.memoryKb || 0,
    });
  } catch (err) {
    setStatus(runId, 'system_error', { stderr: err.message });
  } finally {
    removeWorkDir(workDir);
  }
}

export default function registerIde(router) {
  router.post('/api/ide/run', (ctx) => {
    if (!ctx.user) throw forbidden('请先登录');
    const limit = rateLimit(`ide:${ctx.user.id}`, config.rateLimit.ide);
    if (!limit.ok) throw tooMany(`运行过于频繁，请 ${limit.retryAfter} 秒后再试`);

    const { language, language_id, source_code = '', files = [], stdin = '' } = ctx.body;
    const langId = language_id ?? language;
    const lang = get('SELECT * FROM languages WHERE (id = ? OR key = ?) AND enabled = 1', langId, langId);
    if (!lang) throw badRequest('语言不存在或已被禁用');
    if (Buffer.byteLength(String(source_code), 'utf8') > config.core.codeMaxBytes) throw badRequest('代码长度超过限制');

    const timeLimitMs = Math.min(10000, Math.max(500, toInt(ctx.body.time_limit_ms ?? 3000, '时间限制')));
    const memoryLimitKb = Math.min(1048576, Math.max(16384, toInt(ctx.body.memory_limit_kb ?? 262144, '内存限制')));

    const info = run(
      'INSERT INTO ide_runs (user_id, language_id, source_code, files, stdin, status) VALUES (?,?,?,?,?, ?)',
      ctx.user.id, lang.id, String(source_code), JSON.stringify(Array.isArray(files) ? files : []), String(stdin), 'pending',
    );
    const id = Number(info.lastInsertRowid);
    setImmediate(() => {
      processRun(id, { timeLimitMs, memoryLimitKb }).catch((err) => {
        run("UPDATE ide_runs SET status = 'system_error', stderr = ? WHERE id = ?", err.message || '运行失败', id);
      });
    });
    return ok({ id, status: 'pending' });
  });

  router.get('/api/ide/run/:id', (ctx) => {
    if (!ctx.user) throw forbidden('请先登录');
    const ide = get('SELECT * FROM ide_runs WHERE id = ?', toInt(ctx.params.id, '运行ID'));
    if (!ide) throw notFound('运行记录不存在');
    if (ide.user_id !== ctx.user.id && ctx.user.role === 'user') throw forbidden();
    return ok({
      id: ide.id,
      status: ide.status,
      stdout: ide.stdout,
      stderr: ide.stderr,
      exit_code: ide.exit_code,
      time_ms: ide.time_ms,
      memory_kb: ide.memory_kb,
      created_at: ide.created_at,
    });
  });

  router.get('/api/ide/runs', (ctx) => {
    if (!ctx.user) throw forbidden();
    return ok([]);
  });
}
