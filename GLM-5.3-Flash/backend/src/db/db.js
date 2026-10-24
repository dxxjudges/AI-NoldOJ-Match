const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('../config');

let db = null;

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.abs.databasePath), { recursive: true });
  db = new DatabaseSync(config.abs.databasePath);
  // WAL mode: concurrent readers, no locking issues
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function one(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}

function all(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}

function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}

function exec(sql) {
  return getDb().exec(sql);
}

// Note: entities needing ID recycling (users/problems/submissions) use plain
// INTEGER PRIMARY KEY without AUTOINCREMENT, so SQLite reuses freed max ids.

module.exports = { getDb, one, all, run, exec };
