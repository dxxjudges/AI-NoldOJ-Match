const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb, run, one, all } = require('./db');
const schema = require('./schema');
const { hashPassword } = require('../utils/password');

function initDb() {
  const db = getDb();
  db.exec(schema);

  // ---- Seed: super admin ----
  const hasAdmin = one(`SELECT id FROM users WHERE role='super' LIMIT 1`);
  if (!hasAdmin) {
    const pass = 'admin123';
    run(
      `INSERT INTO users (username, password_hash, role, rating, created_at) VALUES (?,?,?,?,?)`,
      'admin', hashPassword(pass), 'super', 1500, Date.now()
    );
    console.log('==========================================================');
    console.log('[INIT] Super admin created ->  username: admin   password: admin123');
    console.log('       !! Change this password immediately after first login !!');
    console.log('==========================================================');
  }

  // ---- Seed: languages ----
  const hasLang = one(`SELECT id FROM languages LIMIT 1`);
  if (!hasLang) {
    const langs = [
      ["g++",  "C++",       'g++ "{src}" -o "{exe}" -O2 -std=c++17 -static', 'run.exe',                                  0],
      ["gcc",  "C",         'gcc "{src}" -o "{exe}" -O2 -static',             'run.exe',                                  1],
      ["py3",  "Python 3",  '',                                               'py "{src}"',                                2],
      ["java", "Java",      'javac "{dir}*"',                                 'java -cp "{dir}" Main',                     3],
      ["js",   "JavaScript",'',                                               'node "{src}"',                              4]
    ];
    for (const [code, name, cc, rc, ord] of langs) {
      run(`INSERT INTO languages (code, name, compile_cmd, run_cmd, enabled, ord) VALUES (?,?,?,?,1,?)`, code, name, cc, rc, ord);
    }
    console.log('[INIT] Default languages seeded.');
  }

  // ---- Seed: common algorithm tags ----
  const hasTag = one(`SELECT id FROM tags LIMIT 1`);
  if (!hasTag) {
    const tags = [
      ['模拟', '#8899aa'], ['贪心', '#f0a020'], ['动态规划', '#c050d0'], ['图论', '#40b070'],
      ['搜索', '#f06060'], ['数学', '#5090f0'], ['数据结构', '#20b8b8'], ['字符串', '#e0a060'],
      ['二分', '#8060e0'], ['排序', '#60a860'], ['递归', '#d08050'], ['前缀和', '#5078b8']
    ];
    for (const [name, color] of tags) {
      run(`INSERT INTO tags (name, color) VALUES (?,?)`, name, color);
    }
    console.log('[INIT] Default tags seeded.');
  }

  // ---- Seed: system group "All Users" ----
  const hasGroup = one(`SELECT id FROM groups WHERE is_system=1 LIMIT 1`);
  if (!hasGroup) {
    run(`INSERT INTO groups (name, description, is_system, created_at) VALUES ('All Users','All registered users. Cannot be left.',1,?)`, Date.now());
  }

  // ---- Ensure directories ----
  for (const dir of [config.abs.sandboxWorkDir, config.abs.testdataDir, config.abs.uploadsDir, path.join(config.ROOT, 'logs'), path.join(config.ROOT, 'tmp')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { initDb };
