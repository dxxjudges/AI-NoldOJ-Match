'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spec } = require('../utils/openapi');
const { colToIndex } = (() => {
  // re-export via read: test colToIndex indirectly through readXlsx on crafted zip is heavy;
  // just validate openapi structure here.
  return {};
})();

test('openapi: valid 3.0 structure with core paths', () => {
  const s = spec();
  assert.strictEqual(s.openapi, '3.0.3');
  assert.ok(s.info.title.includes('NoldOJ'));
  assert.ok(s.paths['/api/auth/login']);
  assert.ok(s.paths['/api/submissions']);
  assert.ok(s.paths['/api/admin/groups/{id}/import']);
  assert.ok(s.paths['/api/exams/{id}/import']);
  assert.ok(s.components.schemas.Submission);
});

test('settings snapshot shape', () => {
  const { snapshot } = require('../services/settings');
  const s = snapshot();
  assert.strictEqual(typeof s.captchaEnabled, 'boolean');
  assert.strictEqual(typeof s.registrationEnabled, 'boolean');
  assert.strictEqual(typeof s.queueConcurrency, 'number');
});
