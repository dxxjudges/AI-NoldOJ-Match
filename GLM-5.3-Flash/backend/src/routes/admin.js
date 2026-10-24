const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { one, all, run } = require('../db/db');
const { requireMin, canManage, safeUser, ROLE_LEVEL } = require('../utils/middleware');
const { hashPassword, randomStrongPassword } = require('../utils/password');
const { parseXlsx } = require('../utils/xlsx');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Only manage accounts with permission level <= own (except super, who can also modify their own level)
function assertCanManageUser(req, target) {
  if (!canManage(req, target)) {
    throw Object.assign(new Error('You can only manage users with a permission level lower than or equal to your own'), { status: 403 });
  }
}

// ---------- user management ----------
router.get('/admin/users', requireMin('admin'), (req, res) => {
  const q = (req.query.search || '').toLowerCase();
  let rows = all(`SELECT * FROM users ORDER BY id LIMIT 500`);
  if (q) rows = rows.filter(u => u.username.toLowerCase().includes(q.replace(/\s+/g, '')) || String(u.id) === q);
  const myLevel = ROLE_LEVEL[req.user.role];
  rows = rows.filter(u => ROLE_LEVEL[u.role] <= myLevel);
  res.json({
    ok: true,
    data: {
      items: rows.map(u => ({ ...safeUser(u), banned: !!u.banned, banReason: u.ban_reason })),
      me: { id: req.user.id, role: req.user.role }
    }
  });
});

// Create user (super admin, random strong password generation supported)
router.post('/admin/users', requireMin('super'), (req, res) => {
  const b = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(b.username || '')) return res.status(400).json({ ok: false, error: 'Invalid username format' });
  if (one(`SELECT id FROM users WHERE username=?`, b.username)) return res.status(400).json({ ok: false, error: 'Username already exists' });
  const role = ['user', 'teacher', 'admin', 'super'].includes(b.role) ? b.role : 'user';
  const password = b.password || randomStrongPassword();
  const info = run(`INSERT INTO users (username, password_hash, role, rating, created_at) VALUES (?,?,?,?,?)`,
    b.username, hashPassword(password), role, 1500, Date.now());
  const sysGroup = one(`SELECT id FROM groups WHERE is_system=1 LIMIT 1`);
  if (sysGroup) run(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)`, sysGroup.id, info.lastInsertRowid);
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid), password } });
});

function assertTarget(req, id) {
  const t = one(`SELECT * FROM users WHERE id=?`, id);
  if (!t) throw Object.assign(new Error('User does not exist'), { status: 404 });
  if (id !== req.user.id) assertCanManageUser(req, t);
  return t;
}

router.post('/admin/users/:id/ban', requireMin('admin'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  if (t.role === 'super') return res.status(403).json({ ok: false, error: 'Cannot ban a super admin' });
  run(`UPDATE users SET banned=1, ban_reason=?, force_logout_at=? WHERE id=?`,
    req.body.reason || 'Banned by administrator', Date.now(), t.id);
  run(`DELETE FROM refresh_tokens WHERE user_id=?`, t.id); // Refresh token also rejected immediately
  res.json({ ok: true });
});

router.post('/admin/users/:id/unban', requireMin('admin'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  run(`UPDATE users SET banned=0, ban_reason='' WHERE id=?`, t.id);
  res.json({ ok: true });
});

router.post('/admin/users/:id/force-logout', requireMin('admin'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  // Access Token invalidated immediately via timestamp comparison; refresh removed
  run(`UPDATE users SET force_logout_at=? WHERE id=?`, Date.now(), t.id);
  run(`DELETE FROM refresh_tokens WHERE user_id=?`, t.id);
  res.json({ ok: true });
});

router.post('/admin/users/:id/role', requireMin('super'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  const role = req.body.role;
  if (!['user', 'teacher', 'admin', 'super'].includes(role)) return res.status(400).json({ ok: false, error: 'Invalid role' });
  if (t.role === 'super' && role !== 'super' && one(`SELECT COUNT(*) c FROM users WHERE role='super'`).c <= 1) {
    return res.status(400).json({ ok: false, error: 'There must be at least one super admin' });
  }
  run(`UPDATE users SET role=? WHERE id=?`, role, t.id);
  run(`UPDATE users SET force_logout_at=? WHERE id=?`, Date.now(), t.id); // carry new privileges
  res.json({ ok: true });
});

router.post('/admin/users/:id/reset-password', requireMin('super'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  const password = req.body.password || randomStrongPassword();
  run(`UPDATE users SET password_hash=?, force_logout_at=? WHERE id=?`, hashPassword(password), Date.now(), t.id);
  run(`DELETE FROM refresh_tokens WHERE user_id=?`, t.id);
  res.json({ ok: true, data: { password } });
});

router.post('/admin/users/:id/passwordless-login', requireMin('super'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  const { signAccess } = require('../utils/jwt');
  const access = signAccess({ uid: t.id, role: t.role });
  res.json({ ok: true, data: { accessToken: access, user: safeUser(t) } });
});

router.post('/admin/users/:id/rating', requireMin('super'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  const r = Math.max(0, Number(req.body.rating) || 0);
  run(`UPDATE users SET rating=? WHERE id=?`, r, t.id);
  run(`INSERT INTO rating_history (user_id, delta, before, after, reason, created_at) VALUES (?,?,?,?,?,?)`,
    t.id, r - t.rating, t.rating, r, 'Set by administrator', Date.now());
  res.json({ ok: true });
});

router.post('/admin/users/:id/regenerate-ids', (req, res) => res.status(404).json({ ok: false, error: 'unsupported' }));

router.put('/admin/users/:id', requireMin('admin'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  const b = req.body || {};
  if (b.quotaGb !== undefined) run(`UPDATE users SET quota_gb=? WHERE id=?`, Math.max(0.1, Number(b.quotaGb) || 2), t.id);
  if (b.maxFileMb !== undefined) run(`UPDATE users SET max_file_mb=? WHERE id=?`, Math.max(0.5, Number(b.maxFileMb) || 10), t.id);
  res.json({ ok: true });
});

router.delete('/admin/users/:id', requireMin('super'), (req, res) => {
  const t = assertTarget(req, req.params.id);
  if (t.username === 'admin') return res.status(403).json({ ok: false, error: 'Initial admin account cannot be deleted' });
  run(`DELETE FROM users WHERE id=?`, t.id); // freed id reused by new users
  run(`DELETE FROM refresh_tokens WHERE user_id=?`, t.id);
  run(`DELETE FROM group_members WHERE user_id=?`, t.id);
  run(`DELETE FROM favorites WHERE user_id=?`, t.id);
  run(`DELETE FROM achievements WHERE user_id=?`, t.id);
  run(`DELETE FROM contest_participants WHERE user_id=?`, t.id);
  res.json({ ok: true });
});

// ---------- Excel batch import (super admin, custom groups only) ----------
router.post('/admin/groups/:gid/import-excel', requireMin('super'), upload.single('file'), (req, res) => {
  const g = one(`SELECT * FROM groups WHERE id=?`, req.params.gid);
  if (!g) return res.status(404).json({ ok: false, error: 'Group does not exist' });
  if (g.is_system) return res.status(400).json({ ok: false, error: 'System groups do not support batch import' });
  const password = req.body.password;
  if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'Please enter a default password (at least 6 characters)' });
  let rows;
  try { rows = parseXlsx(req.file.buffer); } catch (e) {
    return res.status(400).json({ ok: false, error: 'Excel parsing failed: ' + e.message });
  }
  if (!rows.length) return res.status(400).json({ ok: false, error: 'Excel content is empty' });
  // support header row with 用户名/学号 etc; treat first column as username
  const start = /^[a-z\u4e00-\u9fa5]/i.test(String(rows[0][0] || '')) && /用户名|username|姓名/i.test(rows[0][0]) ? 1 : 0;
  let created = 0, added = 0, failed = 0;
  for (const r of rows.slice(start)) {
    const username = String(r[0] || '').trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { failed++; continue; }
    let u = one(`SELECT id FROM users WHERE username=?`, username);
    if (!u) {
      const info = run(`INSERT INTO users (username, password_hash, role, rating, created_at) VALUES (?,?, 'user', 1500, ?)`,
        username, hashPassword(password), Date.now());
      u = { id: Number(info.lastInsertRowid) };
      created++;
    }
    run(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)`, g.id, u.id);
    added++;
  }
  res.json({ ok: true, data: { created, added, failed, total: rows.length - start } });
});

// ---------- groups ----------
router.get('/admin/groups', requireMin('admin'), (req, res) => {
  const rows = all(`SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id) member_count FROM groups g ORDER BY g.id`);
  res.json({ ok: true, data: { items: rows } });
});
router.post('/admin/groups', requireMin('admin'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ ok: false, error: 'Group name cannot be empty' });
  const info = run(`INSERT INTO groups (name, description, is_system, created_by, created_at) VALUES (?,?,0,?,?)`,
    b.name, b.description || '', req.user.id, Date.now());
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});
router.put('/admin/groups/:id', requireMin('admin'), (req, res) => {
  const g = one(`SELECT * FROM groups WHERE id=?`, req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: 'Group does not exist' });
  run(`UPDATE groups SET name=?, description=? WHERE id=?`, req.body.name || g.name, req.body.description !== undefined ? req.body.description : g.description, g.id);
  res.json({ ok: true });
});
router.delete('/admin/groups/:id', requireMin('admin'), (req, res) => {
  const g = one(`SELECT * FROM groups WHERE id=?`, req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: 'Group does not exist' });
  if (g.is_system) return res.status(400).json({ ok: false, error: 'System groups cannot be deleted' });
  run(`DELETE FROM group_members WHERE group_id=?`, g.id);
  run(`DELETE FROM group_visibility WHERE group_id=?`, g.id);
  run(`DELETE FROM groups WHERE id=?`, g.id);
  res.json({ ok: true });
});
router.get('/admin/groups/:id/members', requireMin('admin'), (req, res) => {
  const items = all(`SELECT u.id, u.username, u.role FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=? ORDER BY u.id`, req.params.id);
  res.json({ ok: true, data: { items } });
});
router.post('/admin/groups/:id/members', requireMin('admin'), (req, res) => {
  const g = one(`SELECT * FROM groups WHERE id=?`, req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: 'Group does not exist' });
  const b = req.body || {};
  const targets = Array.isArray(b.userIds) ? b.userIds : (b.userId ? [b.userId] : []);
  for (const id of targets) {
    if (b.remove) run(`DELETE FROM group_members WHERE group_id=? AND user_id=?`, g.id, id);
    else run(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)`, g.id, id);
  }
  res.json({ ok: true });
});
// visibility binding (admin/super only as per spec)
router.post('/admin/groups/:id/visibility', requireMin('admin'), (req, res) => {
  const g = one(`SELECT * FROM groups WHERE id=?`, req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: 'Group does not exist' });
  const { entityType, entityIds = [] } = req.body || {};
  if (!['problem', 'contest', 'exam', 'problemset'].includes(entityType)) return res.status(400).json({ ok: false, error: 'Invalid entity type' });
  if (req.body.remove) {
    for (const eid of entityIds) run(`DELETE FROM group_visibility WHERE group_id=? AND entity_type=? AND entity_id=?`, g.id, entityType, eid);
  } else {
    for (const eid of entityIds) {
      run(`INSERT OR IGNORE INTO group_visibility (group_id, entity_type, entity_id) VALUES (?,?,?)`, g.id, entityType, eid);
    }
  }
  res.json({ ok: true });
});
router.post('/admin/visibility', requireMin('admin'), (req, res) => {
  // Set visibility for a specific entity directly
  const { entityType, entityId, groupIds = [] } = req.body || {};
  if (!['problem', 'contest', 'exam', 'problemset'].includes(entityType)) return res.status(400).json({ ok: false, error: 'Invalid entity type' });
  run(`DELETE FROM group_visibility WHERE entity_type=? AND entity_id=?`, entityType, entityId);
  for (const gid of groupIds) run(`INSERT OR IGNORE INTO group_visibility (group_id, entity_type, entity_id) VALUES (?,?,?)`, gid, entityType, entityId);
  res.json({ ok: true });
});
router.get('/admin/visibility/:type/:id', requireMin('admin'), (req, res) => {
  const items = all(`SELECT group_id FROM group_visibility WHERE entity_type=? AND entity_id=?`, req.params.type, req.params.id);
  res.json({ ok: true, data: { groupIds: items.map(r => r.group_id) } });
});

// ---------- config (super admin) ----------
router.get('/admin/config', requireMin('super'), (req, res) => {
  const live = JSON.parse(fs.readFileSync(path.join(config.ROOT, 'config', 'config.json'), 'utf8'));
  delete live.core.jwtSecret;
  res.json({ ok: true, data: live });
});

const CONFIG_WRITE_ALLOW = new Set([
  ['core', 'registrationOpen'], ['ai', 'securityReview'], ['ai', 'hint'],
  ['ai', 'testdata'], ['ai', 'examGrade'], ['captcha', 'enabled'],
  ['email', 'enabled'], ['cors', 'enabled'], ['core', 'loginRateLimit'],
  ['core', 'registerRateLimit'], ['core', 'submissionRateLimit'], ['core', 'ideRateLimit']
]);

router.post('/admin/config', requireMin('super'), (req, res) => {
  const cfgPath = path.join(config.ROOT, 'config', 'config.json');
  const live = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const b = req.body || {};
  // form: {values: {"registrationOpen":true,"aiHintEnabled":true,...}}
  const setIf = (block, key, value) => { if (value !== undefined) live[block][key] = value; };
  setIf('core', 'registrationOpen', b.registrationOpen);
  setIf('captcha', 'enabled', b.captchaEnabled);
  setIf('email', 'enabled', b.emailEnabled);
  setIf('cors', 'enabled', b.corsEnabled);
  if (b.securityReview !== undefined) live.ai.securityReview.enabled = !!b.securityReview;
  if (b.hintEnabled !== undefined) live.ai.hint.enabled = !!b.hintEnabled;
  if (b.testdataEnabled !== undefined) live.ai.testdata.enabled = !!b.testdataEnabled;
  if (b.aiBaseUrl) live.ai.securityReview.baseUrl = live.ai.hint.baseUrl = live.ai.testdata.baseUrl = live.ai.examGrade.baseUrl = b.aiBaseUrl;
  if (b.aiModel) live.ai.securityReview.model = live.ai.hint.model = live.ai.testdata.model = live.ai.examGrade.model = b.aiModel;
  if (b.aiApiKey !== undefined) { live.ai.securityReview.apiKey = b.aiApiKey; }
  if (b.loginRateLimit) live.core.loginRateLimit = Number(b.loginRateLimit);
  if (b.registerRateLimit) live.core.registerRateLimit = Number(b.registerRateLimit);
  if (b.submissionRateLimit) live.core.submissionRateLimit = Number(b.submissionRateLimit);
  if (b.ideRateLimit) live.core.ideRateLimit = Number(b.ideRateLimit);
  // CORS origins
  if (b.corsOrigins) live.cors.origins = Array.isArray(b.corsOrigins) ? b.corsOrigins : String(b.corsOrigins).split(',').map(s => s.trim()).filter(Boolean);
  if (b.emailFrom !== undefined) live.email.from = b.emailFrom;
  fs.writeFileSync(cfgPath, JSON.stringify(live, null, 2));
  // hot reload key toggles (targets static config object)
  config.core.registrationOpen = live.core.registrationOpen;
  config.captcha.enabled = live.captcha.enabled;
  config.ai.securityReview.enabled = live.ai.securityReview.enabled;
  config.ai.hint.enabled = live.ai.hint.enabled;
  res.json({ ok: true });
});

module.exports = router;
