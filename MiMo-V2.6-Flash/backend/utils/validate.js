'use strict';

/** Basic input validation helpers. SQL injection is prevented by prepared statements. */

function isNonEmptyString(v, max = 10000) {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function str(v, def = '', max = 1000000) {
  if (typeof v !== 'string') return def;
  return v.length > max ? v.slice(0, max) : v;
}

function int(v, def = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Strip control chars that can break terminal output / logs. */
function stripControl(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function parseJson(s, def) {
  try { return JSON.parse(s); } catch (_) { return def; }
}

module.exports = { isNonEmptyString, str, int, bool, clamp, escapeHtml, stripControl, parseJson };
