'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../db/database');
const sandbox = require('../sandbox/runner');
const languages = require('./languages');
const { bus } = require('./queue');

async function runIde(runId) {
  const run = db.get('SELECT * FROM ide_runs WHERE id = ?', runId);
  if (!run) return;
  db.run("UPDATE ide_runs SET status='compiling' WHERE id=?", runId);
  bus.emit('ide', { id: runId, status: 'compiling' });

  const lang = languages.getEnabled(run.language);
  if (!lang) {
    db.run("UPDATE ide_runs SET status='system_error', stderr=? WHERE id=?", '语言不可用', runId);
    return;
  }

  const dir = sandbox.makeSessionDir(`ide${runId}`);
  try {
    const srcName = 'main' + lang.source_ext;
    const srcPath = path.join(dir, srcName);
    const binPath = path.join(dir, 'main');
    fs.writeFileSync(srcPath, run.code, 'utf8');

    if (Number(lang.is_compiled)) {
      const cmd = languages.expand(lang.compile_cmd, { src: srcPath, bin: binPath, dir, stack: 64 });
      const [exe, ...args] = languages.splitCmd(cmd);
      const c = await sandbox.run({ cmd: exe, args, cwd: dir, timeLimitMs: 30000, memoryLimitMb: 1024 });
      if (c.exitCode !== 0) {
        db.run("UPDATE ide_runs SET status='compile_error', stderr=?, exit_code=?, judged_at=? WHERE id=?".replace(', judged_at=?', ''),
          (c.stderr || c.stdout).slice(0, 65536), c.exitCode, runId);
        bus.emit('ide', { id: runId, status: 'compile_error' });
        return;
      }
    }

    db.run("UPDATE ide_runs SET status='running' WHERE id=?", runId);
    bus.emit('ide', { id: runId, status: 'running' });

    const cmd = languages.expand(lang.run_cmd, { src: srcPath, bin: binPath, dir, stack: 64 });
    const [exe, ...args] = languages.splitCmd(cmd);
    const r = await sandbox.run({
      cmd: exe, args, cwd: dir,
      input: run.stdin || '',
      timeLimitMs: 10000,
      memoryLimitMb: 256,
      outputLimitKb: 2048,
    });

    let status = 'done';
    if (r.timedOut) status = 'time_limit';
    else if (r.memoryKilled) status = 'memory_limit';
    else if (r.exitCode !== 0) status = 'runtime_error';

    db.run(
      'UPDATE ide_runs SET status=?, exit_code=?, stdout=?, stderr=?, time_ms=?, memory_kb=? WHERE id=?',
      status, r.exitCode, r.stdout.slice(0, 262144), (r.stderr || '').slice(0, 65536),
      r.timeMs, r.memoryKb, runId
    );
    bus.emit('ide', { id: runId, status, exit_code: r.exitCode, time_ms: r.timeMs, memory_kb: r.memoryKb });
  } catch (e) {
    db.run("UPDATE ide_runs SET status='internal_error', stderr=? WHERE id=?", String(e.message), runId);
    bus.emit('ide', { id: runId, status: 'internal_error' });
  } finally {
    sandbox.cleanupDir(dir);
  }
}

module.exports = { runIde };
