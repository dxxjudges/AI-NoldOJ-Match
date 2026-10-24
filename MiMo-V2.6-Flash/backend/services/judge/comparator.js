'use strict';

/** Output comparison modes. */

function normalizeStrict(s) {
  return s.replace(/\r\n/g, '\n');
}

function normalizeLoose(s) {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, '').trimEnd())
    .join('\n')
    .replace(/\n+$/, '');
}

function tokens(s) {
  return s.replace(/\r\n/g, '\n').trim().split(/\s+/).filter(Boolean);
}

function compareStrict(expected, actual) {
  return normalizeStrict(expected) === normalizeStrict(actual);
}

function compareLoose(expected, actual) {
  return normalizeLoose(expected) === normalizeLoose(actual);
}

function compareToken(expected, actual) {
  const a = tokens(expected), b = tokens(actual);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function compareFloat(expected, actual, eps = 1e-6) {
  const a = tokens(expected), b = tokens(actual);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const na = Number(a[i]), nb = Number(b[i]);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      const diff = Math.abs(na - nb);
      const rel = diff / Math.max(1e-12, Math.max(Math.abs(na), Math.abs(nb)));
      if (diff > eps && rel > eps) return false;
    } else if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Special judge: invokes a checker script.
 * checker receives via argv: <input> <expected> <actual> and exits 0 = OK,
 * non-zero = WA. Checker path stored on problem.
 */
async function compareSpecial(checkerPath, inPath, expPath, actPath) {
  const sandbox = require('./sandbox/runner');
  const r = await sandbox.run({
    cmd: 'python',
    args: [checkerPath, inPath, expPath, actPath],
    timeLimitMs: 10000,
    memoryLimitMb: 256,
  });
  return r.exitCode === 0;
}

function compare(mode, expected, actual, opts = {}) {
  switch (mode) {
    case 'loose': return compareLoose(expected, actual);
    case 'token': return compareToken(expected, actual);
    case 'float': return compareFloat(expected, actual, opts.eps ?? 1e-6);
    case 'strict':
    default: return compareStrict(expected, actual);
  }
}

module.exports = { compare, compareStrict, compareLoose, compareToken, compareFloat, compareSpecial };
