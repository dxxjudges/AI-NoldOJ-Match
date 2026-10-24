import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import config, { ROOT_DIR } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('sandbox');
const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_SCRIPT = resolve(__dirname, 'sandbox-host.ps1');
const IS_WINDOWS = process.platform === 'win32';
const HAS_HOST = IS_WINDOWS && existsSync(HOST_SCRIPT);

export function createWorkDir(prefix = 'run') {
  return mkdtempSync(join(config.core.sandboxWorkDir, `${prefix}-`));
}

export function removeWorkDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    log.warn('failed to remove work dir', dir, err.message);
  }
}

export function createTempDir(prefix = 'tmp') {
  const base = join(ROOT_DIR, 'tmp');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${prefix}-`));
}

export async function cleanup(dir) {
  if (dir && dir.includes('sandbox-work')) removeWorkDir(dir);
}

function runHost(jobFile, resultFile, timeoutMs) {
  return new Promise((resolvePromise) => {
    const ps = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HOST_SCRIPT, jobFile, resultFile],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { ps.kill(); } catch { /* ignored */ }
    }, timeoutMs + 15000);
    ps.on('error', resolvePromise);
    ps.on('close', () => {
      clearTimeout(timer);
      resolvePromise(null);
    });
    ps.stderr.on('end', () => { /* noop */ });
    if (stderr) { /* reserved */ }
  });
}

function runFallback({ exe, args, cwd, stdinFile, stdoutFile, stderrFile, timeLimitMs }) {
  return new Promise((resolvePromise) => {
    const start = Date.now();
    let killed = false;
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const outChunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => outChunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    const timer = setTimeout(() => {
      killed = true;
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        child.kill('SIGKILL');
      }
    }, timeLimitMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, error: err.message, exitCode: 0, timedOut: false, memoryExceeded: false, wallMs: Date.now() - start, cpuMs: 0, memoryKb: 0, tokenMode: 'fallback' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(outChunks);
      const stderr = Buffer.concat(errChunks);
      if (stdoutFile) writeFileSync(stdoutFile, stdout);
      if (stderrFile) writeFileSync(stderrFile, stderr);
      resolvePromise({
        ok: true,
        error: '',
        exitCode: code === null ? -1 : code,
        timedOut: killed,
        memoryExceeded: false,
        wallMs: Date.now() - start,
        cpuMs: 0,
        memoryKb: 0,
        tokenMode: 'fallback',
      });
    });
    if (stdinFile && existsSync(stdinFile)) {
      try { child.stdin.write(readFileSync(stdinFile)); } catch { /* ignored */ }
    }
    try { child.stdin.end(); } catch { /* ignored */ }
  });
}

/**
 * Run an untrusted executable in the sandbox.
 * @returns {Promise<object>} judging metrics and captured output
 */
export async function runInSandbox(options) {
  const {
    exe, args = [], cwd,
    stdin = '', stdoutFile, stderrFile,
    timeLimitMs = 1000, memoryLimitKb = 262144,
    processLimit = 16, restrictedToken = false,
  } = options;

  const work = cwd;
  const stdinFile = join(work, `.stdin-${randomBytes(4).toString('hex')}`);
  const outFile = stdoutFile || join(work, `.stdout-${randomBytes(4).toString('hex')}`);
  const errFile = stderrFile || join(work, `.stderr-${randomBytes(4).toString('hex')}`);
  const resultFile = join(work, `.result-${randomBytes(4).toString('hex')}.json`);
  const jobFile = join(work, `.job-${randomBytes(4).toString('hex')}.json`);

  writeFileSync(stdinFile, stdin ?? '');

  let result;
  if (HAS_HOST) {
    const job = {
      exe, args, cwd: work,
      stdinFile, stdoutFile: outFile, stderrFile: errFile,
      timeLimitMs, memoryLimitKb, processLimit, restrictedToken,
    };
    writeFileSync(jobFile, JSON.stringify(job));
    await runHost(jobFile, resultFile, timeLimitMs);
    if (existsSync(resultFile)) {
      try {
        result = JSON.parse(readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, ''));
      } catch (err) {
        log.warn('failed to parse sandbox result', err.message);
      }
    }
    if (!result) {
      result = { ok: false, error: 'sandbox host produced no result', exitCode: 0, timedOut: false, memoryExceeded: false, wallMs: 0, cpuMs: 0, memoryKb: 0, tokenMode: 'host' };
    }
  } else {
    result = await runFallback({ exe, args, cwd: work, stdinFile, stdoutFile: outFile, stderrFile: errFile, timeLimitMs });
  }

  const stdout = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
  const stderr = existsSync(errFile) ? readFileSync(errFile, 'utf8') : '';

  for (const f of [stdinFile, jobFile, resultFile]) {
    try { rmSync(f, { force: true }); } catch { /* ignored */ }
  }

  return { ...result, stdout, stderr, stdoutFile: outFile, stderrFile: errFile };
}

export function sandboxBackend() {
  return HAS_HOST ? 'native-jobobject' : 'fallback';
}

export default { runInSandbox, createWorkDir, removeWorkDir, createTempDir, sandboxBackend };
