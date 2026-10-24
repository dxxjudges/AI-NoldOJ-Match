'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { config } = require('../config');

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.paths.dbPath), { recursive: true });
  db = new DatabaseSync(config.paths.dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function migrate() {
  const d = open();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  d.exec(schema);
  seedLanguages(d);
  seedAdmin(d);
}

function now() {
  return Date.now();
}

// --- ID recycling pools ---
// Freed ids are stored in <x>_id_pool and reused first.
// Fresh ids come from MAX(id)+1 on the main table (min floor enforced).

let inTx = false;

function allocId(poolTable, minId, mainTable) {
  const d = open();
  const nested = inTx;
  if (!nested) d.exec('BEGIN IMMEDIATE');
  try {
    const row = d.prepare(`SELECT id FROM ${poolTable} ORDER BY id LIMIT 1`).get();
    if (row) {
      d.prepare(`DELETE FROM ${poolTable} WHERE id = ?`).run(row.id);
      if (!nested) d.exec('COMMIT');
      return row.id;
    }
    let next = minId;
    if (mainTable) {
      const mx = d.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${mainTable}`).get();
      next = Math.max(minId, Number(mx.m) + 1);
    }
    if (!nested) d.exec('COMMIT');
    return next;
  } catch (e) {
    if (!nested) { try { d.exec('ROLLBACK'); } catch (_) {} }
    throw e;
  }
}

function freeId(poolTable, id) {
  const d = open();
  try {
    d.prepare(`INSERT OR IGNORE INTO ${poolTable} (id) VALUES (?)`).run(id);
  } catch (_) { /* pool table may not exist for synthetic ids */ }
}

// --- helpers ---

function get(sql, ...params) {
  return open().prepare(sql).get(...params);
}

function all(sql, ...params) {
  return open().prepare(sql).all(...params);
}

function run(sql, ...params) {
  return open().prepare(sql).run(...params);
}

function tx(fn) {
  const d = open();
  if (inTx) return fn(d); // already inside a transaction — just run
  d.exec('BEGIN IMMEDIATE');
  inTx = true;
  try {
    const r = fn(d);
    d.exec('COMMIT');
    return r;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    inTx = false;
  }
}

// --- seeds ---

function seedLanguages(d) {
  const c = d.prepare('SELECT COUNT(*) AS n FROM languages').get();
  if (Number(c.n) > 0) return;
  const t = now();
  const langs = [
    { id: 'c', name: 'C (GCC)', version: '', compile_cmd: 'gcc -O2 -std=c17 -o {bin} {src} -lm', run_cmd: '{bin}', source_ext: '.c', is_compiled: 1, time_factor: 1.0 },
    { id: 'cpp', name: 'C++ (G++17)', version: '', compile_cmd: 'g++ -O2 -std=c++17 -o {bin} {src} -lm', run_cmd: '{bin}', source_ext: '.cpp', is_compiled: 1, time_factor: 1.0 },
    { id: 'python3', name: 'Python 3', version: '', compile_cmd: '', run_cmd: 'python {src}', source_ext: '.py', is_compiled: 0, time_factor: 3.0 },
    { id: 'java', name: 'Java', version: '', compile_cmd: 'javac -encoding UTF-8 -d {dir} {src}', run_cmd: 'java -Xss{stack}m -cp {dir} Main', source_ext: '.java', is_compiled: 1, time_factor: 4.0 },
    { id: 'javascript', name: 'JavaScript (Node)', version: '', compile_cmd: '', run_cmd: 'node {src}', source_ext: '.js', is_compiled: 0, time_factor: 3.0 },
  ];
  const ins = d.prepare(`INSERT INTO languages (id,name,version,compile_cmd,run_cmd,source_ext,enabled,is_compiled,time_factor,order_index,created_at)
    VALUES (?,?,?,?,?,?,1,?,?,?,?)`);
  langs.forEach((l, i) => ins.run(l.id, l.name, l.version, l.compile_cmd, l.run_cmd, l.source_ext, l.is_compiled, l.time_factor, i, t));
}

function seedAdmin(d) {
  const c = d.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'super'").get();
  if (Number(c.n) > 0) return;
  const bcrypt = require('bcryptjs');
  const t = now();
  const id = allocId('user_id_pool', 1, 'users');
  const hash = bcrypt.hashSync('admin123', 10);
  d.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
    VALUES (?,?,?,'super',?,?)`).run(id, 'admin', hash, t, t);
  d.prepare('INSERT INTO group_members (group_id, user_id) VALUES (1, ?)').run(id);
  d.prepare('INSERT INTO group_members (group_id, user_id) VALUES (2, ?)').run(id);
  console.log('[db] Seeded default super admin: admin / admin123 (change it!)');
}

function close() {
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
}

module.exports = { open, migrate, get, all, run, tx, allocId, freeId, now, close };
