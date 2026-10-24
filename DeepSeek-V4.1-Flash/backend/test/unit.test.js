import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword, generatePassword } from '../src/utils/password.js';
import { signToken, verifyToken, issueAccessToken } from '../src/utils/jwt.js';
import { strictEqual, looseEqual, floatEqual } from '../src/services/comparator.js';
import { evaluateScript, aggregate } from '../src/services/scorer.js';
import { tokenize, similarity, tierOf } from '../src/services/plagiarism.js';
import { createCaptcha, verifyCaptcha, captchaEnabled } from '../src/services/captcha.js';
import config from '../src/config.js';
import { rateLimit, resetRateLimit } from '../src/utils/rateLimit.js';
import { HttpError, notFound, badRequest } from '../src/utils/errors.js';
import { stripBom } from '../src/config.js';

test('password hashing round-trips and rejects wrong input', () => {
  const hash = hashPassword('S3cret-pass');
  assert.notEqual(hash, 'S3cret-pass');
  assert.ok(hash.length > 20);
  assert.equal(verifyPassword('S3cret-pass', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.equal(verifyPassword('S3cret-pass', 'garbage'), false);
});

test('generatePassword honors length', () => {
  assert.equal(generatePassword(12).length, 12);
  assert.notEqual(generatePassword(12), generatePassword(12));
});

test('jwt sign/verify round-trip and tamper detection', () => {
  const token = signToken({ sub: 7, role: 'admin', typ: 'access' }, 60);
  const payload = verifyToken(token);
  assert.equal(payload.sub, 7);
  assert.equal(payload.role, 'admin');
  assert.equal(verifyToken(`${token}x`), null);
  assert.equal(verifyToken('not-a-token'), null);
});

test('access token carries user identity', () => {
  const token = issueAccessToken({ id: 3, username: 'alice', role: 'teacher' });
  const payload = verifyToken(token);
  assert.equal(payload.sub, 3);
  assert.equal(payload.username, 'alice');
  assert.equal(payload.role, 'teacher');
  assert.equal(payload.typ, 'access');
});

test('comparator strict mode ignores trailing whitespace and CRLF', () => {
  assert.equal(strictEqual('1 2 3\r\n', '1 2 3'), true);
  assert.equal(strictEqual('1  2', '1 2'), false);
  assert.equal(strictEqual('a\n', 'b\n'), false);
});

test('comparator loose mode ignores all whitespace', () => {
  assert.equal(looseEqual('1   2\n3', '1 2 3'), true);
  assert.equal(looseEqual('abc', 'abd'), false);
});

test('comparator float mode respects epsilon', () => {
  assert.equal(floatEqual('1.0000001', '1', 1e-5), true);
  assert.equal(floatEqual('1.1', '1', 1e-5), false);
  assert.equal(floatEqual('0.1 0.2', '0.1 0.3', 1e-9), false);
});

test('scoring script evaluates expressions and context', () => {
  assert.equal(evaluateScript('sum(1, 2, 3)'), 6);
  assert.equal(evaluateScript('score / 2', { score: 100 }), 50);
  assert.equal(evaluateScript('score >= 60 ? 100 : 0', { score: 100 }), 100);
  assert.equal(evaluateScript('score >= 60 ? 100 : 0', { score: 10 }), 0);
  assert.equal(evaluateScript(''), null);
  assert.equal(evaluateScript('   '), null);
  assert.throws(() => evaluateScript('unknownVar + 1'));
});

test('aggregate strategies', () => {
  assert.equal(aggregate('sum', [10, 20, 30]), 60);
  assert.equal(aggregate('min', [10, 20, 30]), 10);
  assert.equal(aggregate('max', [10, 20, 30]), 30);
  assert.equal(aggregate('avg', [10, 20, 30]), 20);
  assert.equal(aggregate('sum', []), 0);
});

test('plagiarism detects identical and unrelated code', () => {
  const a = 'int main(){ int a, b; cin >> a >> b; cout << a + b; return 0; }';
  const same = 'int main(){ int a, b; cin >> a >> b; cout << a + b; return 0; }';
  const other = 'function solve(){ const s = new Set(); for (const c of input) s.add(c); return s.size; }';
  assert.ok(tokenize(a).length >= 10);
  assert.ok(similarity(a, same) > 0.95);
  assert.ok(similarity(a, other) < 0.5);
});

test('plagiarism tier thresholds', () => {
  assert.equal(tierOf(0.9), 'high');
  assert.equal(tierOf(0.75), 'suspect');
  assert.equal(tierOf(0.1), 'none');
});

test('captcha is disabled under test config', () => {
  assert.equal(captchaEnabled(), false);
  const cap = createCaptcha();
  assert.equal(cap.disabled, true);
  assert.equal(verifyCaptcha('disabled', 'anything'), true);
});

test('rate limiter blocks after max within window', () => {
  resetRateLimit('unit-test');
  for (let i = 0; i < 3; i += 1) assert.equal(rateLimit('unit-test', { windowMs: 10000, max: 3 }).ok, true);
  const blocked = rateLimit('unit-test', { windowMs: 10000, max: 3 });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 0);
});

test('HttpError helpers expose status and code', () => {
  const err = new HttpError(418, 'TEAPOT', 'teapot!');
  assert.equal(err.status, 418);
  assert.equal(err.code, 'TEAPOT');
  assert.equal(err.message, 'teapot!');
  assert.equal(notFound().status, 404);
  assert.equal(badRequest('x').status, 400);
  assert.ok(err instanceof Error);
});

test('config JSON tolerates a UTF-8 BOM', () => {
  assert.equal(stripBom('\uFEFF{"a":1}'), '{"a":1}');
  assert.equal(stripBom('{"a":1}'), '{"a":1}');
  assert.deepEqual(JSON.parse(stripBom('\uFEFF{"a":1}')), { a: 1 });
});

test('captcha svg renders every glyph inside the viewBox', () => {
  const wasEnabled = config.captcha.enabled;
  config.captcha.enabled = true;
  try {
    for (let i = 0; i < 50; i += 1) {
      const { id, svg } = createCaptcha();
      assert.ok(id && id !== 'disabled');
      const glyphs = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
      assert.equal(glyphs.length, 4);
      assert.equal(verifyCaptcha(id, glyphs.join('')), true);

      const [w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).slice(1).map(Number);
      const nodes = svg.match(/<text[^>]*>[^<]+<\/text>/g) || [];
      for (const node of nodes) {
        const cx = Number(node.match(/x="(\d+)"/)[1]);
        const baseline = Number(node.match(/y="(\d+)"/)[1]);
        const size = Number(node.match(/font-size="(\d+)"/)[1]);
        const r = size * 0.6;
        assert.ok(cx - r >= 0 && cx + r <= w, `glyph clipped horizontally: ${node}`);
        assert.ok(baseline - size >= 0 && baseline <= h, `glyph clipped vertically: ${node}`);
      }
    }
  } finally {
    config.captcha.enabled = wasEnabled;
  }
});
