import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInSandbox } from './sandbox-runner.js';

function normalizeLines(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));
}

function trimTrailingEmpty(lines) {
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function strictEqual(output, expected) {
  const a = trimTrailingEmpty(normalizeLines(output));
  const b = trimTrailingEmpty(normalizeLines(expected));
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function tokens(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean);
}

export function looseEqual(output, expected) {
  const a = tokens(output);
  const b = tokens(expected);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
  }
  return true;
}

export function floatEqual(output, expected, epsilon = 1e-6) {
  const a = tokens(output);
  const b = tokens(expected);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      if (a[i] !== b[i]) return false;
    } else if (Math.abs(x - y) > epsilon) {
      return false;
    }
  }
  return true;
}

/**
 * Compare program output against the expected answer.
 * @returns {Promise<{ok:boolean, mode:string, message?:string}>}
 */
export async function compare({ mode, epsilon, output, expected, input, testdataDir, workDir }) {
  switch (mode) {
    case 'loose':
      return { ok: looseEqual(output, expected), mode };
    case 'float':
      return { ok: floatEqual(output, expected, epsilon), mode };
    case 'special':
      return specialJudge({ input, output, expected, testdataDir, workDir });
    case 'strict':
    default:
      return { ok: strictEqual(output, expected), mode: 'strict' };
  }
}

async function specialJudge({ input, output, expected, testdataDir, workDir }) {
  const candidates = [
    { file: join(testdataDir || '', 'checker.py'), exe: 'python', args: [] },
    { file: join(testdataDir || '', 'checker.exe'), exe: join(testdataDir || '', 'checker.exe'), args: [] },
    { file: join(testdataDir || '', 'checker.js'), exe: 'node', args: [] },
  ];
  const checker = candidates.find((c) => c.file && existsSync(c.file));
  if (!checker) {
    return { ok: strictEqual(output, expected), mode: 'special', message: '未找到 Special Judge 校验程序，回退为严格比较' };
  }

  const inFile = join(workDir, 'sp_input.txt');
  const outFile = join(workDir, 'sp_output.txt');
  const ansFile = join(workDir, 'sp_answer.txt');
  writeFileSync(inFile, input ?? '');
  writeFileSync(outFile, output ?? '');
  writeFileSync(ansFile, expected ?? '');

  const result = await runInSandbox({
    exe: checker.exe,
    args: [...checker.args, checker.file, inFile, outFile, ansFile],
    cwd: workDir,
    timeLimitMs: 10000,
    memoryLimitKb: 524288,
    processLimit: 8,
  });

  const ok = result.exitCode === 0;
  return { ok, mode: 'special', message: ok ? '' : (result.stderr || result.stdout || 'Special Judge 判定未通过').trim() };
}
