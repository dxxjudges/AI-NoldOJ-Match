'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAuth, requireRole, ROLE_RANK } = require('../middleware/auth');
const { str, int, bool } = require('../utils/validate');

const router = express.Router();

// All routes here require admin+
router.use(requireAuth, requireRole('admin'));

// ---- users management ----

// GET /api/admin/users?keyword=
router.get('/users', (req, res) => {
  const kw = str(req.query.keyword, '', 64);
  const rows = kw
    ? db.all('SELECT id, username, email, role, banned, rating, ban_reason, created_at, single_file_limit_mb, storage_quota_mb FROM users WHERE username LIKE ? ORDER BY id LIMIT 100', `%${kw}%`)
    : db.all('SELECT id, username, email, role, banned, rating, ban_reason, created_at, single_file_limit_mb, storage_quota_mb FROM users ORDER BY id LIMIT 100');
  res.json({ items: rows });
});

// POST /api/admin/users  (create; super only for role changes beyond admin)
router.post('/users', requireRole('super'), (req, res) => {
  const username = str(req.body.username, '', 24);
  const password = str(req.body.password, '', 128);
  if (!/^[a-zA-Z0-9_一-龥]{2,24}$/.test(username)) return res.status(400).json({ error: '用户名不合法' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (db.get('SELECT id FROM users WHERE username = ?', username)) return res.status(409).json({ error: '用户名已存在' });
  const role = ['user', 'teacher', 'admin'].includes(req.body.role) ? req.body.role : 'user';
  const t = db.now();
  const id = db.tx(() => {
    const uid = db.allocId('user_id_pool', 1, 'users');
    db.run('INSERT INTO users (id, username, password_hash, email, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      uid, username, bcrypt.hashSync(password, 10), str(req.body.email, '', 128) || null, role, t, t);
    db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (1, ?)', uid);
    if (role !== 'user') db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (2, ?)', uid);
    return uid;
  });
  res.status(201).json({ id });
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req, res) => {
  const id = int(req.params.id, 0);
  const u = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const targetRank = ROLE_RANK[u.role];
  const myRank = ROLE_RANK[req.user.role];
  if (targetRank > myRank) return res.status(403).json({ error: '不能管理更高权限的账号' });
  if (req.body.role !== undefined) {
    if (req.user.role !== 'super') return res.status(403).json({ error: '仅超级管理员可修改角色' });
    if (!['user', 'teacher', 'admin', 'super'].includes(req.body.role)) return res.status(400).json({ error: '角色不合法' });
    if (u.role === 'super' && req.user.id === u.id && req.body.role !== 'super') {
      const supers = Number(db.get("SELECT COUNT(*) AS n FROM users WHERE role='super'").n);
      if (supers <= 1) return res.status(400).json({ error: '不能取消最后一个超级管理员' });
    }
    db.run('UPDATE users SET role=? WHERE id=?', req.body.role, id);
  }
  if (req.body.password && req.user.role === 'super') {
    db.run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(str(req.body.password, '', 128), 10), id);
  }
  if (req.body.single_file_limit_mb !== undefined) {
    db.run('UPDATE users SET single_file_limit_mb=? WHERE id=?', int(req.body.single_file_limit_mb, 10), id);
  }
  if (req.body.storage_quota_mb !== undefined) {
    db.run('UPDATE users SET storage_quota_mb=? WHERE id=?', int(req.body.storage_quota_mb, 2048), id);
  }
  if (req.body.rating !== undefined && req.user.role === 'super') {
    db.run('UPDATE users SET rating=? WHERE id=?', int(req.body.rating, 0), id);
  }
  if (req.body.banned !== undefined) {
    if (targetRank >= myRank && req.user.id === u.id) return res.status(400).json({ error: '不能封禁自己' });
    db.run('UPDATE users SET banned=?, ban_reason=?, updated_at=? WHERE id=?',
      bool(req.body.banned) ? 1 : 0, str(req.body.ban_reason, '', 500), db.now(), id);
    if (bool(req.body.banned)) {
      db.run('UPDATE users SET force_logout_at=? WHERE id=?', db.now(), id);
      db.run('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', db.now(), id);
    }
  }
  res.json({ ok: true });
});

// POST /api/admin/users/:id/force-logout
router.post('/users/:id/force-logout', (req, res) => {
  const id = int(req.params.id, 0);
  db.run('UPDATE users SET force_logout_at=? WHERE id=?', db.now(), id);
  db.run('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', db.now(), id);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/login-as  (passwordless, super only)
router.post('/users/:id/login-as', requireRole('super'), (req, res) => {
  const u = db.get('SELECT * FROM users WHERE id = ?', int(req.params.id, 0));
  if (!u || u.banned) return res.status(404).json({ error: '用户不可用' });
  const { signAccessToken, signRefreshToken } = require('../middleware/auth');
  res.json({ token: signAccessToken(u), user: { id: u.id, username: u.username, role: u.role } });
});

// ---- groups ----

router.get('/groups', (req, res) => {
  const groups = db.all('SELECT * FROM groups ORDER BY id');
  for (const g of groups) {
    g.members = db.all('SELECT u.id, u.username, u.role FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?', g.id);
  }
  res.json({ items: groups });
});

router.post('/groups', requireRole('super'), (req, res) => {
  const name = str(req.body.name, '', 64);
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  if (db.get('SELECT id FROM groups WHERE name = ?', name)) return res.status(409).json({ error: '组名已存在' });
  const info = db.run('INSERT INTO groups (name, description, is_system, created_by, created_at) VALUES (?,?,0,?,?)',
    name, str(req.body.description, '', 500), req.user.id, db.now());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/groups/:id', requireRole('super'), (req, res) => {
  const id = int(req.params.id, 0);
  const g = db.get('SELECT * FROM groups WHERE id = ?', id);
  if (!g) return res.status(404).json({ error: '组不存在' });
  if (g.is_system) return res.status(400).json({ error: '系统组不可修改' });
  db.run('UPDATE groups SET name=?, description=? WHERE id=?',
    str(req.body.name, g.name, 64), str(req.body.description, g.description, 500), id);
  res.json({ ok: true });
});

router.delete('/groups/:id', requireRole('super'), (req, res) => {
  const id = int(req.params.id, 0);
  const g = db.get('SELECT * FROM groups WHERE id = ?', id);
  if (!g) return res.status(404).json({ error: '组不存在' });
  if (g.is_system) return res.status(400).json({ error: '系统组不可删除' });
  db.run('DELETE FROM groups WHERE id = ?', id);
  res.json({ ok: true });
});

router.post('/groups/:id/members', requireRole('super'), (req, res) => {
  const id = int(req.params.id, 0);
  const u = db.get('SELECT id FROM users WHERE username = ?', str(req.body.username, '', 64));
  if (!u) return res.status(404).json({ error: '用户不存在' });
  db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)', id, u.id);
  res.json({ ok: true });
});

router.delete('/groups/:id/members/:uid', requireRole('super'), (req, res) => {
  const id = int(req.params.id, 0);
  const g = db.get('SELECT * FROM groups WHERE id = ?', id);
  if (g && g.is_system) return res.status(400).json({ error: '系统组成员不可移除' });
  db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', id, int(req.params.uid, 0));
  res.json({ ok: true });
});

// visibility binding: set which group can see an entity
router.post('/visibility', (req, res) => {
  const type = str(req.body.entity_type, '', 20);
  const entityId = int(req.body.entity_id, 0);
  const groupId = int(req.body.group_id, 0);
  if (!['problem', 'contest', 'exam', 'problem_set'].includes(type)) return res.status(400).json({ error: '类型不合法' });
  if (groupId === 0) {
    db.run('DELETE FROM visibility_bindings WHERE entity_type=? AND entity_id=?', type, entityId);
  } else {
    db.run('INSERT OR REPLACE INTO visibility_bindings (entity_type, entity_id, group_id) VALUES (?,?,?)', type, entityId, groupId);
  }
  res.json({ ok: true });
});

// ---- languages (super) ----

router.get('/languages', (req, res) => {
  res.json({ items: db.all('SELECT * FROM languages ORDER BY order_index, id') });
});

router.post('/languages', requireRole('super'), (req, res) => {
  const id = str(req.body.id, '', 32);
  if (!/^[a-z0-9_+-]+$/i.test(id)) return res.status(400).json({ error: '语言 id 不合法' });
  if (db.get('SELECT id FROM languages WHERE id = ?', id)) return res.status(409).json({ error: '语言已存在' });
  db.run(
    'INSERT INTO languages (id,name,version,compile_cmd,run_cmd,source_ext,enabled,is_compiled,time_factor,order_index,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, str(req.body.name, id, 64), str(req.body.version, '', 64),
    str(req.body.compile_cmd, '', 500), str(req.body.run_cmd, '', 500),
    str(req.body.source_ext, '.txt', 16),
    bool(req.body.enabled) ? 1 : 0, bool(req.body.is_compiled) ? 1 : 0,
    Number(req.body.time_factor) || 1.0, int(req.body.order_index, 99), db.now()
  );
  res.status(201).json({ id });
});

router.put('/languages/:id', requireRole('super'), (req, res) => {
  const id = str(req.params.id, '', 32);
  const l = db.get('SELECT * FROM languages WHERE id = ?', id);
  if (!l) return res.status(404).json({ error: '语言不存在' });
  db.run(
    'UPDATE languages SET name=?, version=?, compile_cmd=?, run_cmd=?, source_ext=?, enabled=?, is_compiled=?, time_factor=?, order_index=? WHERE id=?',
    str(req.body.name, l.name, 64), str(req.body.version, l.version, 64),
    str(req.body.compile_cmd, l.compile_cmd, 500), str(req.body.run_cmd, l.run_cmd, 500),
    str(req.body.source_ext, l.source_ext, 16),
    req.body.enabled !== undefined ? (bool(req.body.enabled) ? 1 : 0) : l.enabled,
    req.body.is_compiled !== undefined ? (bool(req.body.is_compiled) ? 1 : 0) : l.is_compiled,
    Number(req.body.time_factor) || l.time_factor, int(req.body.order_index, l.order_index), id
  );
  res.json({ ok: true });
});

router.delete('/languages/:id', requireRole('super'), (req, res) => {
  const id = str(req.params.id, '', 32);
  db.run('DELETE FROM languages WHERE id = ?', id);
  res.json({ ok: true });
});

// ---- toggles (super) ----

router.get('/settings', (req, res) => {
  res.json(require('../services/settings').snapshot());
});

router.put('/settings', requireRole('super'), (req, res) => {
  const { config } = require('../config');
  const settings = require('../services/settings');
  if (req.body.registrationEnabled !== undefined) config.security.registrationEnabled = bool(req.body.registrationEnabled);
  if (req.body.captchaEnabled !== undefined) config.security.captchaEnabled = bool(req.body.captchaEnabled);
  if (req.body.aiReviewEnabled !== undefined) config.ai.reviewEnabled = bool(req.body.aiReviewEnabled);
  if (req.body.aiHintEnabled !== undefined) config.ai.hintEnabled = bool(req.body.aiHintEnabled);
  if (req.body.aiTestdataEnabled !== undefined) config.ai.testdataEnabled = bool(req.body.aiTestdataEnabled);
  if (req.body.aiBaseUrl) config.ai.baseUrl = str(req.body.aiBaseUrl, config.ai.baseUrl, 300);
  if (req.body.aiModel) config.ai.model = str(req.body.aiModel, config.ai.model, 100);
  if (req.body.aiApiKey !== undefined && req.body.aiApiKey !== null) config.ai.apiKey = str(req.body.aiApiKey, '', 300);
  if (req.body.defaultUserQuotaMb !== undefined) config.files.defaultUserQuotaMb = int(req.body.defaultUserQuotaMb, 2048);
  if (req.body.maxSingleFileMb !== undefined) config.files.maxSingleFileMb = int(req.body.maxSingleFileMb, 10);
  if (req.body.queueConcurrency !== undefined) config.judge.queueConcurrency = Math.max(1, int(req.body.queueConcurrency, 2));
  try { settings.persist(); } catch (e) { console.error('[settings] persist failed:', e.message); }
  res.json({ ok: true, settings: settings.snapshot() });
});

// ---- group Excel batch import (super, custom groups only) ----
// Body: { groupId, defaultPassword, rows: [{username, password?}] }
// Rows already in file are added; unknown accounts are auto-registered as role=user.
router.post('/groups/:id/import', requireRole('super'), (req, res) => {
  const id = int(req.params.id, 0);
  const g = db.get('SELECT * FROM groups WHERE id = ?', id);
  if (!g) return res.status(404).json({ error: '组不存在' });
  if (g.is_system) return res.status(400).json({ error: '仅支持自定义组批量导入' });
  const defaultPassword = str(req.body.defaultPassword, '', 128);
  if (defaultPassword.length < 6) return res.status(400).json({ error: '默认密码至少 6 位' });
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: '无导入数据' });

  const t = db.now();
  const summary = { added: 0, registered: 0, skipped: 0, errors: [] };
  db.tx(() => {
    for (const raw of rows.slice(0, 5000)) {
      const username = String(raw.username || raw['用户名'] || '').trim();
      if (!username) { summary.skipped++; continue; }
      if (!/^[a-zA-Z0-9_一-龥]{2,24}$/.test(username)) {
        summary.errors.push(`用户名不合法: ${username}`); summary.skipped++; continue;
      }
      let u = db.get('SELECT id FROM users WHERE username = ?', username);
      if (!u) {
        const pw = String(raw.password || raw['密码'] || defaultPassword);
        const uid = db.allocId('user_id_pool', 1, 'users');
        db.run(
          'INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?,?,?,?,?,?)',
          uid, username, bcrypt.hashSync(pw, 10), 'user', t, t
        );
        db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (1, ?)', uid);
        u = { id: uid };
        summary.registered++;
      } else {
        summary.added++;
      }
      db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)', id, u.id);
    }
    db.run('INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?,?,?,?)',
      req.user.id, 'group_import', `group=${id} added=${summary.added} registered=${summary.registered}`, t);
  });
  res.json(summary);
});

// ---- stats ----

router.get('/stats', (req, res) => {
  res.json({
    users: Number(db.get('SELECT COUNT(*) AS n FROM users').n),
    problems: Number(db.get('SELECT COUNT(*) AS n FROM problems').n),
    submissions: Number(db.get('SELECT COUNT(*) AS n FROM submissions').n),
    contests: Number(db.get('SELECT COUNT(*) AS n FROM contests').n),
    pending: Number(db.get("SELECT COUNT(*) AS n FROM submissions WHERE status IN ('pending','queued','compiling','judging','ai_reviewing')").n),
  });
});

module.exports = router;
