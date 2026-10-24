'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { runScript, aggregate } = require('../services/judge/scoring');
const { compare, compareLoose, compareFloat } = require('../services/judge/comparator');

test('scoring: simple assignment and arithmetic', () => {
  assert.strictEqual(runScript('score = 40 + 60', { full: 100 }), 100);
  assert.strictEqual(runScript('x = 10; y = 20; score = x * y', {}), 200);
});

test('scoring: if/else/fi with parentheses', () => {
  const s = 'x = 80; if (x >= 60 && x < 100) score = 100 else score = 0 fi';
  assert.strictEqual(runScript(s, {}), 100);
  const s2 = 'if (1 + 1 == 2) score = 7 fi';
  assert.strictEqual(runScript(s2, {}), 7);
});

test('scoring: min/max/abs and bitwise', () => {
  assert.strictEqual(runScript('score = min(30, 70)', {}), 30);
  assert.strictEqual(runScript('score = max(30, 70)', {}), 70);
  assert.strictEqual(runScript('score = abs(-5)', {}), 5);
  assert.strictEqual(runScript('score = (1 << 4) | 1', {}), 17);
});

test('scoring: test variables', () => {
  const s = 'if (s0 + s1 + s2 == 3) score = full fi';
  assert.strictEqual(runScript(s, { full: 100, s0: 1, s1: 1, s2: 1 }), 100);
});

test('scoring: invalid script throws', () => {
  assert.throws(() => runScript('score = ', {}));
  assert.throws(() => runScript('foo bar', {}));
});

test('aggregate: sum/min/max/avg/count_pass', () => {
  assert.strictEqual(aggregate('sum', [30, 30, 40]), 100);
  assert.strictEqual(aggregate('min', [30, 50]), 30);
  assert.strictEqual(aggregate('max', [30, 50]), 50);
  assert.strictEqual(aggregate('avg', [40, 60]), 50);
  assert.strictEqual(aggregate('count_pass', [1, 0, 1]), 2);
});

test('comparator: strict and loose', () => {
  assert.ok(compare('strict', '1 2\n', '1 2\n'));
  assert.ok(!compare('strict', '1 2\n', '1  2\n'));
  // loose: ignore trailing whitespace and trailing newlines
  assert.ok(compareLoose('1 2\n', '1 2  '));
  assert.ok(compareLoose('a\n\n\n', 'a'));
  // token mode: collapse internal whitespace differences
  assert.ok(compare('token', '1 2\n', '1  2'));
});

test('comparator: float tolerance', () => {
  assert.ok(compareFloat('3.14159', '3.14160', 1e-4));
  assert.ok(!compareFloat('3.14', '3.15', 1e-6));
  assert.ok(compareFloat('1.0 2.0', '1.0000001 2.0000001'));
});
