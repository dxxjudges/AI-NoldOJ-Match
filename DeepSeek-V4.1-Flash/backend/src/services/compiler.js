import config from '../config.js';
import { runInSandbox } from './sandbox-runner.js';
import { createLogger } from '../logger.js';

const log = createLogger('compiler');

export function splitArgs(command) {
  const args = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

export function expand(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? String(vars[key]) : ''));
}

/**
 * Compile source inside the sandbox. Returns { ok, output, exe, argv }.
 */
export async function compile({
  language,
  workDir,
  mainFile,
  exeName = 'main',
  timeLimitMs = 20000,
  memoryLimitKb = 1048576,
}) {
  const vars = {
    source: mainFile,
    main: mainFile,
    exe: exeName,
    dir: workDir,
    exePath: `${workDir}\\${exeName}`,
  };

  let argv;
  if (!language.compile_cmd || !language.compile_cmd.trim()) {
    const runArgs = splitArgs(expand(language.run_cmd, vars));
    return { ok: true, output: '', exe: runArgs[0], argv: runArgs.slice(1), vars };
  }

  argv = splitArgs(expand(language.compile_cmd, vars));
  const exe = argv[0];
  const args = argv.slice(1);

  log.debug('compiling', { exe, args, workDir });
  const result = await runInSandbox({
    exe,
    args,
    cwd: workDir,
    timeLimitMs,
    memoryLimitKb,
    processLimit: 32,
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (!result.ok || result.exitCode !== 0) {
    return { ok: false, output: output || result.error || '编译失败', vars };
  }
  return { ok: true, output, vars };
}

/**
 * Resolve the run command for a language (after compilation).
 */
export function resolveRunCommand(language, vars) {
  const argv = splitArgs(expand(language.run_cmd, vars));
  return { exe: argv[0], args: argv.slice(1) };
}

export function defaultLimits() {
  return {
    compileTimeMs: 20000,
    compileMemoryKb: 1048576,
    processLimit: Math.max(8, config.judge?.concurrency * 4 || 16),
  };
}
