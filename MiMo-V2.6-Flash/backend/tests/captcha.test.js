'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { generate, verify } = require('../services/captcha');
const db = require('../db/database');
const { config } = require('../config');

// open + migrate for captcha table
db.migrate();

test('captcha: generate returns svg without answer text', () => {
  const { id, svg } = generate(4);
  assert.ok(id);
  assert.ok(svg.includes('<svg'));
  // answer chars must not appear as <text> content
  assert.ok(!svg.includes('<text'));
  const row = db.get('SELECT answer FROM captchas WHERE id = ?', id);
  assert.ok(row.answer.length === 4);
});

test('captcha: one-time verify, case-insensitive', () => {
  const { id } = generate(4);
  const row = db.get('SELECT answer FROM captchas WHERE id = ?', id);
  assert.ok(verify(id, row.answer.toLowerCase()));
  // second use fails
  assert.ok(!verify(id, row.answer));
});

test('captcha: wrong answer fails and destroys', () => {
  const { id } = generate(4);
  assert.ok(!verify(id, 'XXXX'));
  assert.ok(!verify(id, 'XXXX')); // destroyed
});

test('captcha: expired fails', () => {
  const { id } = generate(4);
  const row = db.get('SELECT answer FROM captchas WHERE id = ?', id);
  db.run('UPDATE captchas SET expires_at = ? WHERE id = ?', Date.now() - 1000, id);
  assert.ok(!verify(id, row.answer));
});
