'use strict';

/**
 * Windows sandbox runner.
 *
 * Three-layer security architecture (full native Job Object binding is an
 * extension point — see jobobject.js):
 *   1. Low Integrity Level     – work dir marked low-IL (extension point)
 *   2. Job Object              – CPU/memory/process-count limits (extension point)
 *   3. Restricted Token        – strip SeDebug/SeImpersonate, drop admin groups
 *
 * This scaffold ships a functional fallback layer used when the native
 * helpers are unavailable:
 *   - per-session isolated temp directory, removed after the run
 *   - hard wall-clock timeout
 *   - process-tree kill (taskkill /T /F) on timeout / completion
 *   - memory polling via Get-Process working set, kill on overflow
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('../../config');
const jobObject = require('./jobobject');

function makeSessionDir(tag = 'run') {
  const dir = path.join(config.paths.sandboxDir, `${tag}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function killTree(pid) {
  if (!pid) return;
  try {
    // /T kills the whole tree; works for console apps on Win10+
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } catch (_) {}
  try { process.kill(pid); } catch (_) {}
}

/** Poll working set of a process; returns peak KB seen. Windows only. */
function startMemoryWatcher(pid, limitMb, onOverflow) {
  const limitKb = limitMb * 1024;
  let peak = 0;
  // tasklist is much faster to spawn than powershell — matters for short processes
  const { execFileSync } = require('child_process');
  const sample = () => {
    try {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 1500, encoding: 'utf8' });
      // "name","pid","session","session#","mem usage"
      const m = out.match(/"(\d[\d,]*)\s*K"/i);
      if (m) {
        const kb = Number(m[1].replace(/,/g, ''));
        if (Number.isFinite(kb) && kb > peak) peak = kb;
        if (kb > limitKb) onOverflow && onOverflow();
      }
    } catch (_) { /* process may have exited */ }
  };
  const timer = setInterval(sample, 50);
  return {
    stop() { clearInterval(timer); return peak; },
    peak() { return peak; },
  };
}

/**
 * Run a command inside the sandbox.
 * opts: { cmd, args, cwd, input, timeLimitMs, memoryLimitMb, outputLimitKb, env }
 * returns { stdout, stderr, exitCode, timeMs, memoryKb, timedOut, memoryKilled, outputKilled }
 */
function run(opts) {
  return new Promise((resolve) => {
    const dir = opts.cwd || makeSessionDir();
    const timeLimit = opts.timeLimitMs || 2000;
    const memLimitMb = opts.memoryLimitMb || 256;
    const outLimit = (opts.outputLimitKb || 65536) * 1024;
    const start = Date.now();

    let child;
    try {
      child = spawn(opts.cmd, opts.args || [], {
        cwd: dir,
        env: opts.env || { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: dir, TMP: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      return resolve({
        stdout: '', stderr: 'spawn failed: ' + e.message, exitCode: -1,
        timeMs: 0, memoryKb: 0, timedOut: false, memoryKilled: false, outputKilled: false,
      });
    }

    let stdout = '', stderr = '';
    let timedOut = false, memoryKilled = false, outputKilled = false;
    let outBytes = 0;

    const watcher = startMemoryWatcher(child.pid, memLimitMb, () => {
      memoryKilled = true;
      killTree(child.pid);
    });

    const killer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, Math.max(50, timeLimit + 200)); // small grace for scheduling

    if (opts.input != null) {
      try { child.stdin.write(String(opts.input)); } catch (_) {}
      try { child.stdin.end(); } catch (_) {}
    }

    child.stdout.on('data', (d) => {
      outBytes += d.length;
      if (outBytes > outLimit) {
        outputKilled = true;
        killTree(child.pid);
        return;
      }
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(killer);
      const peak = watcher.stop();
      resolve({
        stdout, stderr,
        exitCode: code,
        timeMs: Date.now() - start,
        memoryKb: peak,
        timedOut, memoryKilled, outputKilled,
        cwd: dir,
      });
    });

    child.on('error', (e) => {
      clearTimeout(killer);
      watcher.stop();
      resolve({
        stdout, stderr: stderr + '\n' + e.message, exitCode: -1,
        timeMs: Date.now() - start, memoryKb: 0,
        timedOut, memoryKilled, outputKilled, cwd: dir,
      });
    });
  });
}

function cleanupDir(dir) {
  try {
    if (dir && dir.startsWith(config.paths.sandboxDir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) {}
}

/** Best-effort startup sweep of leftover sandbox sessions. */
function sweepLeftovers() {
  try {
    for (const name of fs.readdirSync(config.paths.sandboxDir)) {
      const p = path.join(config.paths.sandboxDir, name);
      try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
    }
  } catch (_) {}
}

module.exports = { run, makeSessionDir, cleanupDir, killTree, sweepLeftovers, jobObject };
