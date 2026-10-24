const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const config = require('../config');

const SANDBOX_PS1 = path.join(__dirname, 'sandbox-runner.ps1');
// All temporary judge/compile workspaces live under <project>/tmp/ (gitignored)
const TMP_ROOT = path.join(config.ROOT, 'tmp');

function now() { return Date.now(); }

// Tokenize a command template respecting double quotes: `g++ "{src}" -o "{exe}"` -> [g++, <src>, -o, <exe>]
function splitCmd(cmd) {
  const parts = [];
  let cur = '', inQ = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ' ' && !inQ) { if (cur) { parts.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) parts.push(cur);
  return parts;
}

function fillPlaceholders(cmdStr, ctx) {
  return cmdStr
    .replace(/\{src\}/g, ctx.src)
    .replace(/\{exe\}/g, ctx.exe)
    .replace(/\{dir\}/g, ctx.dir)
    .replace(/\{entry\}/g, ctx.entry)
    .replace(/\{files\}/g, ctx.files);
}

function createWorkspace() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dir = path.join(TMP_ROOT, 'run-' + crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupWorkspace(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function runCmd(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, shell: false, windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e), timeMs: 0 });
    }
    let done = false;
    const t0 = now();
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ code: -2, stdout, stderr: stderr + '\n[TIMEOUT] compilation exceeded limit', timeMs: now() - t0 });
    }, timeoutMs);
    child.stdout && child.stdout.on('data', d => { stdout += d; if (stdout.length > 65536) stdout = stdout.slice(0, 65536); });
    child.stderr && child.stderr.on('data', d => { stderr += d; if (stderr.length > 65536) stderr = stderr.slice(0, 65536); });
    child.on('error', e => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e), timeMs: now() - t0 }); } });
    child.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timeMs: now() - t0 });
    });
  });
}

// Run a raw OS process (used for trusted compile steps)
function compile(lang, workdir, entryName, files) {
  // files: [{name, content}]
  for (const f of files) {
    const safe = path.basename(f.name || 'source.code').replace(/[<>:"|?*\x00-\x1f]/g, '_') || 'source.code';
    fs.writeFileSync(path.join(workdir, safe), f.content || '', 'utf8');
  }
  const ctx = {
    src: entryName,
    exe: 'run.exe',
    dir: workdir.replace(/[\\/]+$/, '') + path.sep,
    entry: entryName,
    files: ''
  };
  const compileCmd = (lang.compile_cmd || '').trim();
  if (!compileCmd) return { ok: true, output: '', exe: null, runParts: null };
  const filled = fillPlaceholders(compileCmd, ctx);
  const parts = splitCmd(filled);
  return runCmd(parts[0], parts.slice(1), workdir, 60000).then(r => ({
    ok: r.code === 0,
    output: (r.stdout + r.stderr).slice(0, 32000),
    exe: 'run.exe'
  }));
}

function parseRunCmd(runCmdStr, workdir, entryName) {
  const ctx = { src: path.join(workdir, entryName), exe: path.join(workdir, 'run.exe'), dir: workdir, entry: entryName, files: '' };
  const filled = fillPlaceholders(runCmdStr, ctx);
  const parts = splitCmd(filled);
  return { program: parts[0], args: parts.slice(1) };
}

// Sandboxed single run of the target program.
function sandboxRun(program, args, workdir, inputFile, timeoutMs, memMB) {
  if (config.judge && config.judge.useSandbox === false) {
    return unsandboxedRun(program, args, workdir, inputFile, timeoutMs);
  }
  return powershellSandboxRun(program, args, workdir, inputFile, timeoutMs, memMB);
}

// Direct CreateProcess fallback (only when sandbox is explicitly disabled in config).
function unsandboxedRun(program, args, workdir, inputFile, timeoutMs) {
  return new Promise((resolve) => {
    const outPath = path.join(workdir, '__out.txt');
    let inFd = null, outFd = null;
    try { outFd = fs.openSync(outPath, 'w'); if (inputFile) { try { inFd = fs.openSync(inputFile, 'r'); } catch { inFd = null; } } } catch { outFd = null; }
    if (outFd == null) return resolve({ error: 'stdio_open_failed', exitCode: -1, timeMs: 0, memoryKb: 0, mode: 'direct' });
    const started = Date.now();
    let child;
    try {
      child = spawn(program, args || [], { cwd: workdir, windowsHide: true, stdio: [inFd == null ? 'ignore' : inFd, outFd, 'pipe'] });
    } catch (e) {
      fs.closeSync(outFd); if (inFd != null) try { fs.closeSync(inFd); } catch { /* ignore */ }
      return resolve({ error: 'spawn_failed: ' + e.message, exitCode: -1, timeMs: 0, memoryKb: 0, mode: 'direct' });
    }
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch { /* ignore */ }
      try { fs.closeSync(outFd); if (inFd != null) fs.closeSync(inFd); } catch { /* ignore */ }
      resolve({ error: '', exitCode: 153, timedOut: true, timeMs: Date.now() - started, memoryKb: 0, mode: 'direct' });
    }, timeoutMs);
    child.on('error', (e) => {
      if (done) return; done = true; clearTimeout(timer);
      try { fs.closeSync(outFd); if (inFd != null) fs.closeSync(inFd); } catch { /* ignore */ }
      resolve({ error: String(e), exitCode: -1, timeMs: 0, memoryKb: 0, mode: 'direct' });
    });
    child.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { fs.closeSync(outFd); if (inFd != null) fs.closeSync(inFd); } catch { /* ignore */ }
      let exitCode = child.exitCode;
      if (child.signalCode) exitCode = 153; // killed
      let output = '';
      try { output = fs.readFileSync(outPath, 'utf8'); } catch { /* no output */ }
      resolve({ error: '', exitCode: exitCode == null ? -1 : exitCode, timeMs: Date.now() - started, memoryKb: 0, mode: 'direct', timedOut: false, output: validation_output_slice(output), stderr: stderr.slice(0, 8000) });
    });
  });
}

function powershellSandboxRun(program, args, workdir, inputFile, timeoutMs, memMB) {
  return new Promise((resolve) => {
    const outPath = path.join(workdir, '__out.txt');
    const argsJson = JSON.stringify(args || []);
    const pwshArgs = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SANDBOX_PS1,
      '-Target', program,
      '-TargetArgs', argsJson,
      '-InputPath', inputFile || '',
      '-OutputPath', outPath,
      '-TimeLimitMs', String(timeoutMs),
      '-MemoryLimitMB', String(memMB)
    ];
    let stdout = '';
    let child;
    try {
      child = spawn('powershell.exe', pwshArgs, { cwd: workdir, windowsHide: true });
    } catch (e) {
      return resolve({ error: 'spawn_powershell_failed: ' + e.message, exitCode: -1, timeMs: 0, memoryKb: 0, mode: 'fallback' });
    }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ error: 'sandbox_runner_timeout', exitCode: -1, timeMs: timeoutMs, memoryKb: 0, mode: 'fallback' });
    }, Math.max(timeoutMs * 3 + 20000, 40000));
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', () => { /* collect but ignore */ });
    child.on('error', e => { if (!done) { done = true; clearTimeout(timer); resolve({ error: String(e), exitCode: -1, timeMs: 0, memoryKb: 0, mode: 'fallback' }); } });
    child.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      let parsed = null;
      try {
        const line = stdout.split('\n').map(l => l.trim()).filter(l => l.startsWith('{')).pop();
        parsed = JSON.parse(line);
      } catch { /* not json */ }
      let output = '', stderr = '';
      try {
        output = fs.readFileSync(outPath, 'utf8');
        stderr = fs.existsSync(outPath + '.err') ? fs.readFileSync(outPath + '.err', 'utf8') : '';
      } catch { /* no output file */ }
      if (!parsed) parsed = { error: 'runner_bad_output', exitCode: -1, timeMs: 0, memoryKb: 0, mode: 'fallback' };
      if (parsed.exitCode === 0x99 || parsed.exitCode === 153) parsed.timedOut = true; // killed by wall timeout
      parsed.output = validation_output_slice(output);
      parsed.stderr = stderr.slice(0, 8000);
      resolve(parsed);
    });
  });
}

function validation_output_slice(s) { return s.length > 131072 ? s.slice(0, 131072) : s; }

module.exports = { splitCmd, fillPlaceholders, createWorkspace, cleanupWorkspace, compile, parseRunCmd, sandboxRun, runCmd };
