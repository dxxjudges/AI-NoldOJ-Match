'use strict';

const db = require('../../db/database');

function all() {
  return db.all('SELECT * FROM languages ORDER BY order_index, id');
}

function get(id) {
  return db.get('SELECT * FROM languages WHERE id = ?', id);
}

function getEnabled(id) {
  const l = get(id);
  if (!l) return null;
  return Number(l.enabled) ? l : null;
}

/**
 * Expand compile/run command placeholders.
 * {src} absolute source path, {bin} binary path (no ext), {dir} session dir,
 * {stack} stack MB
 */
function expand(cmd, { src, bin, dir, stack }) {
  return String(cmd)
    .replaceAll('{src}', src)
    .replaceAll('{bin}', bin)
    .replaceAll('{dir}', dir)
    .replaceAll('{stack}', String(stack || 64));
}

/** Split an expanded command line into exe + args (Windows-friendly quoting). */
function splitCmd(line) {
  const parts = [];
  let cur = '', quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (/\s/.test(c)) {
      if (cur) { parts.push(cur); cur = ''; }
    } else {
      cur += c;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

module.exports = { all, get, getEnabled, expand, splitCmd };
