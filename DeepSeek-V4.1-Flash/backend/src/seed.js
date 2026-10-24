import { get, run } from './db.js';
import { hashPassword, generatePassword } from './utils/password.js';
import { createLogger } from './logger.js';

const log = createLogger('seed');

export const DEFAULT_LANGUAGES = [
  {
    name: 'C', key: 'c', ext: 'c', is_builtin: 1, sort: 1,
    compile_cmd: 'gcc -O2 -std=c11 -o {exe} {source}',
    run_cmd: '{exe}.exe',
  },
  {
    name: 'C++', key: 'cpp', ext: 'cpp', is_builtin: 1, sort: 2,
    compile_cmd: 'g++ -O2 -std=c++17 -o {exe} {source}',
    run_cmd: '{exe}.exe',
  },
  {
    name: 'Python 3', key: 'python', ext: 'py', is_builtin: 1, sort: 3,
    compile_cmd: '',
    run_cmd: 'python {source}',
  },
  {
    name: 'Java', key: 'java', ext: 'java', is_builtin: 1, sort: 4,
    compile_cmd: 'javac {source}',
    run_cmd: 'java -cp {dir} Main',
  },
  {
    name: 'JavaScript', key: 'javascript', ext: 'js', is_builtin: 1, sort: 5,
    compile_cmd: '',
    run_cmd: 'node {source}',
  },
];

export const DEFAULT_TAGS = [
  ['模拟', '#6b7280'], ['贪心', '#0891b2'], ['动态规划', '#7c3aed'],
  ['图论', '#2563eb'], ['数论', '#db2777'], ['数据结构', '#059669'],
  ['字符串', '#d97706'], ['搜索', '#dc2626'], ['二分', '#0d9488'],
  ['几何', '#9333ea'],
];

export function seedLanguages() {
  for (const lang of DEFAULT_LANGUAGES) {
    const existing = get('SELECT id FROM languages WHERE key = ?', lang.key);
    if (!existing) run(
      `INSERT INTO languages (name, key, ext, compile_cmd, run_cmd, enabled, is_builtin, sort)
       VALUES (?,?,?,?,?,1,?,?)`,
      lang.name, lang.key, lang.ext, lang.compile_cmd, lang.run_cmd, lang.is_builtin, lang.sort,
    );
  }
}

export function seedTags() {
  for (const [name, color] of DEFAULT_TAGS) {
    if (!get('SELECT id FROM tags WHERE name = ?', name)) {
      run('INSERT INTO tags (name, color) VALUES (?, ?)', name, color);
    }
  }
}

export function seedGroups() {
  let allUsers = get("SELECT id FROM user_groups WHERE name = '所有用户'");
  if (!allUsers) {
    const id = run("INSERT INTO user_groups (name, description, is_system) VALUES ('所有用户', '系统内置：全部注册用户', 1)").lastInsertRowid;
    allUsers = { id };
  }
  return allUsers.id;
}

export function seedSuperAdmin() {
  const existing = get("SELECT id FROM users WHERE role = 'su'");
  if (existing) return null;
  const username = process.env.NOLDOJ_SU_USERNAME || 'su';
  const password = process.env.NOLDOJ_SU_PASSWORD || process.env.NOLDOJ__CORE__INITIALSUPERADMINPASSWORD || generatePassword(12);
  const id = run(
    'INSERT INTO users (username, password_hash, role, rating) VALUES (?, ?, ?, ?)',
    username, hashPassword(password), 'su', 2600,
  ).lastInsertRowid;
  const allGroup = seedGroups();
  run('INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)', allGroup, id);
  return { id, username, password };
}

export function ensureSeed() {
  seedLanguages();
  seedTags();
  const groupId = seedGroups();
  const su = seedSuperAdmin();
  if (su) {
    log.warn('====================================================');
    log.warn(`  已创建超级管理员账号: ${su.username}`);
    log.warn(`  初始密码: ${su.password}`);
    log.warn('  请登录后尽快修改密码。');
    log.warn('====================================================');
  }
  return { groupId, su };
}

export function addUserToAllGroup(userId) {
  const group = get("SELECT id FROM user_groups WHERE name = '所有用户'");
  if (group) run('INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)', group.id, userId);
}

export default { ensureSeed, DEFAULT_LANGUAGES, DEFAULT_TAGS, addUserToAllGroup };
