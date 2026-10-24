// NoldOJ unit test runner - zero-dep, no framework.
// Usage: node test/run-all.js   (from backend/)
'use strict';
const assert = require('assert');

const tests = [];
function t(name, fn) { tests.push([name, fn]); }

// ---------- score.js: scoring script interpreter ----------
{
  const { evalScoreScript } = require('../src/judge/score');
  t('score: if/else branch picks larger value', () => {
    const r = evalScoreScript('A = 1; B = 2; if (A > B) { score = A; } else { score = B; }', {});
    assert.strictEqual(r, 2);
  });
  t('score: env variables in arithmetic', () => {
    const r = evalScoreScript('score = SCORE * PASSED / CASES;', { SCORE: 100, CASES: 4, PASSED: 3 });
    assert.strictEqual(r, 75);
  });
  t('score: min/max/abs and unary minus', () => {
    assert.strictEqual(evalScoreScript('score = min(abs(-5), 10);', {}), 5);
    assert.strictEqual(evalScoreScript('score = max(3, 9);', {}), 9);
  });
  t('score: full pass condition', () => {
    const r = evalScoreScript('score = SCORE; if (PASSED == CASES) { score = SCORE; } else { score = SCORE * PASSED / CASES; }',
      { SCORE: 100, CASES: 4, PASSED: 3 });
    assert.strictEqual(r, 75);
  });
  t('score: plain expression mode', () => {
    const r = evalScoreScript('SCORE * PASSED / CASES', { SCORE: 80, CASES: 10, PASSED: 5 });
    assert.strictEqual(r, 40);
  });
  t('score: shell-style if/fi', () => {
    const r = evalScoreScript('if (PASSED > 0) score = SCORE fi', { SCORE: 50, PASSED: 1 });
    assert.strictEqual(r, 50);
  });
  t('score: bitwise operations', () => {
    const r = evalScoreScript('x = 6; y = 3; score = x & y;', {});
    assert.strictEqual(r, 2);
  });
  t('score: division by zero rejected', () => {
    assert.throws(() => evalScoreScript('score = 1 / 0;', {}), /division by zero/);
  });
  t('score: missing final score rejected', () => {
    assert.throws(() => evalScoreScript('x = 1;', {}), /score not set/);
  });
  t('score: unknown variable rejected', () => {
    assert.throws(() => evalScoreScript('score = NOPE + 1;', {}), /unknown variable/);
  });
  t('score: case-insensitive final variable', () => {
    const r = evalScoreScript('Score = 42;', {});
    assert.strictEqual(r, 42);
  });
}

// ---------- compare.js ----------
{
  const { compare } = require('../src/judge/compare');
  t('compare: strict ignores trailing blank lines, rejects mid blank line', () => {
    assert.strictEqual(compare('hello\n', 'hello\n\n', 'strict'), true);       // trailing tolerated
    assert.strictEqual(compare('hello\nworld\n', 'hello\n\nworld\n', 'strict'), false); // mid not
    assert.strictEqual(compare('hello\r\n', 'hello\n', 'strict'), true, 'CRLF normalized');
  });
  t('compare: loose ignores whitespace', () => {
    assert.strictEqual(compare('1  2   3\n\n', '1 2 3', 'loose'), true);
    assert.strictEqual(compare('abc', 'abd', 'loose'), false);
  });
  t('compare: float within tolerance', () => {
    assert.strictEqual(compare('0.1 2.0', '0.1000001 2.0000001', 'float', 0.000001), true);
    assert.strictEqual(compare('0.1', '0.2', 'float', 0.000001), false);
  });
  t('compare: float rejects non-numeric mismatch', () => {
    assert.strictEqual(compare('1.0 x', '1.0 y', 'float'), false);
  });
}

// ---------- plagiarism.js ----------
{
  const plag = require('../src/services/plagiarism');
  const REP = 'int main() { if (a > 1) { b = c + 2; } while (x < 10) { x = x + 1; } }';
  const LONG = (s) => Array(6).fill(s).join(' f() { return k; } ');
  t('plagiarism: identical code => high similarity', () => {
    const a = plag.tokenize(LONG(REP));
    const b = plag.tokenize(LONG('int   main()  { if (a>1) { b=c+2; } while (x<10) { x=x+1; } } f() { return k; } '));
    const s = plag.lcsSimilarity(a, b);
    assert.ok(s > 0.85, 'similarity: ' + s);
  });
  t('plagiarism: different code => low similarity', () => {
    const a = plag.tokenize(LONG('int main(){for(int i=0;i<10;i++)printf("%d",i);return 0;}'));
    const b = plag.tokenize(LONG('import java.util.*; class Q { Map<Integer,Integer> m = new HashMap<>(); void go(){ m.put(1,2); } }'));
    const s = plag.lcsSimilarity(a, b);
    assert.ok(s < 0.5, 'similarity: ' + s);
  });
  t('plagiarism: too-short code yields 0 (MIN_TOKENS guard)', () => {
    const s = plag.lcsSimilarity(plag.tokenize('a=1;'), plag.tokenize('a=1;'));
    assert.strictEqual(s, 0);
  });
  t('plagiarism: comments and strings stripped before tokenizing', () => {
    const a = plag.tokenize('int a = 1; // comment\n');
    const b = plag.tokenize('int a = 1;\n');
    assert.deepStrictEqual(a, b);
  });
  t('plagiarism: thresholds are consts', () => {
    assert.ok(plag.HIGH > plag.SUSPECT);
  });
}

// ---------- captcha.js ----------
{
  const captcha = require('../src/utils/captcha');
  t('captcha: generate returns id/svg/expires, no <text> glyphs', () => {
    const g = captcha.generate();
    assert.ok(g.id && g.svg.includes('<svg') && g.svg.includes('<path'), 'svg paths present');
    assert.strictEqual(g.svg.includes('<text'), false, 'no plain text glyphs');
    assert.ok(g.svg.includes('feDisplacementMap') || g.svg.includes('filter'), 'distortion filter');
  });
  t('captcha: wrong answer fails, and consumes the one-time record', () => {
    const g = captcha.generate();
    assert.strictEqual(captcha.verify(g.id, 'XXXX'), false);
    assert.strictEqual(captcha.verify(g.id, 'XXXX'), false, 'record destroyed after first attempt');
    assert.strictEqual(captcha.verify('nonsense-id', 'XXXX'), false);
  });
}

// ---------- jwt.js ----------
{
  const jwt = require('../src/utils/jwt');
  t('jwt: sign + verify roundtrip', () => {
    const p = jwt.verifyAccess(jwt.signAccess({ uid: 42, role: 'user' }));
    assert.strictEqual(p.uid, 42);
    assert.strictEqual(p.role, 'user');
  });
  t('jwt: tampered / garbage token => null', () => {
    const t1 = jwt.signAccess({ uid: 1, role: 'user' });
    assert.strictEqual(jwt.verifyAccess(t1.slice(0, -2) + 'xx'), null);
    assert.strictEqual(jwt.verifyAccess('not-a-token'), null);
  });
  t('jwt: access ttl 30min, refresh 30d', () => {
    assert.strictEqual(jwt.ACCESS_TTL_MS, 30 * 60 * 1000);
    assert.strictEqual(jwt.REFRESH_TTL_MS, 30 * 24 * 3600 * 1000);
  });
}

// ---------- password.js ----------
{
  const pw = require('../src/utils/password');
  t('password: hash + verify + reject wrong', () => {
    const h = pw.hashPassword('secret123');
    assert.notStrictEqual(h, 'secret123');
    assert.ok(pw.verifyPassword('secret123', h));
    assert.strictEqual(pw.verifyPassword('wrong', h), false);
    assert.strictEqual(pw.verifyPassword('secret123', 'garbage'), false);
  });
  t('password: random strong password length >= 10', () => {
    assert.ok(pw.randomStrongPassword().length >= 10);
  });
}

// ---------- rateLimit.js ----------
{
  const rl = require('../src/utils/rateLimit');
  t('rateLimit: window blocks after limit', () => {
    const key = 't' + Math.random().toString(36).slice(2);
    assert.strictEqual(rl.hit(key, 2, 60000), true);
    assert.strictEqual(rl.hit(key, 2, 60000), true);
    assert.strictEqual(rl.hit(key, 2, 60000), false);
  });
  t('rateLimit: distinct keys independent', () => {
    const a = 'a' + Math.random().toString(36).slice(2);
    const b = 'b' + Math.random().toString(36).slice(2);
    assert.strictEqual(rl.hit(a, 1, 60000), true);
    assert.strictEqual(rl.hit(b, 1, 60000), true);
  });
}

// ---------- rating.js ----------
{
  const rating = require('../src/services/rating');
  t('rating: difficulty names cover 0-5', () => {
    assert.strictEqual(rating.DIFF_NAMES.length, 6);
    assert.ok(rating.DIFF_NAMES.every(n => n && n.length > 0), DIFF_NAMES_text(rating.DIFF_NAMES));
    assert.ok(rating.applyRatingAfterJudge, 'calculation entry exported');
  });
}
function DIFF_NAMES_text(arr) {
  return (arr || []).join(',');
}

// ---------- runner ----------
(async function main() {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log('PASS  ' + name);
      pass++;
    } catch (e) {
      console.error('FAIL  ' + name + ' :: ' + e.message);
      fail++;
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
