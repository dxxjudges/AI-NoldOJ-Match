'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { config, ROOT } = require('../config');
const db = require('../db/database');
const { signAccessToken, signRefreshToken, revokeRefreshToken, revokeAllForUser, requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const captcha = require('../services/captcha');
const { isNonEmptyString, int, str } = require('../utils/validate');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id, username: u.username, role: u.role, rating: u.rating,
    preferred_language: u.preferred_language, signature: u.signature || '',
  };
}

function issueTokens(res, user) {
  const access = signAccessToken(user);
  const refresh = signRefreshToken(user);
  res.cookie('refresh_token', refresh, {
    httpOnly: true, sameSite: 'strict', path: '/api/auth',
    secure: false, maxAge: config.server.refreshTtlSec * 1000,
  });
  return access;
}

// POST /api/auth/login
router.post('/login', rateLimit('login', config.security.loginRateLimit.windowSec, config.security.loginRateLimit.max), (req, res) => {
  if (config.security.captchaEnabled) {
    if (!captcha.verify(req.body.captchaId, req.body.captcha)) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }
  }
  const username = str(req.body.username, '', 64);
  const password = str(req.body.password, '', 128);
  if (!username || !password) return res.status(400).json({ error: '用户名或密码不能为空' });

  const user = db.get('SELECT * FROM users WHERE username = ?', username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (user.banned) return res.status(403).json({ error: '账号已被封禁：' + (user.ban_reason || '') });

  const token = issueTokens(res, user);
  db.run('UPDATE users SET updated_at = ? WHERE id = ?', db.now(), user.id);
  res.json({ token, user: publicUser(user) });
});

// POST /api/auth/register
router.post('/register', rateLimit('register', 3600, config.security.registrationPerIpPerHour), (req, res) => {
  if (!config.security.registrationEnabled) {
    return res.status(403).json({ error: '当前不允许自助注册' });
  }
  if (config.security.captchaEnabled) {
    if (!captcha.verify(req.body.captchaId, req.body.captcha)) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }
  }
  const username = str(req.body.username, '', 24);
  const password = str(req.body.password, '', 128);
  if (!/^[a-zA-Z0-9_一-龥]{2,24}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 2-24 位字母/数字/下划线/中文' });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: '密码长度需为 6-128 位' });
  }
  if (db.get('SELECT id FROM users WHERE username = ?', username)) {
    return res.status(409).json({ error: '用户名已被占用' });
  }

  const t = db.now();
  const hash = bcrypt.hashSync(password, 10);
  const id = db.tx(() => {
    const uid = db.allocId('user_id_pool', 1, 'users');
    db.run(
      'INSERT INTO users (id, username, password_hash, email, role, registration_ip, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      uid, username, hash, str(req.body.email, '', 128) || null, 'user', req.ip, t, t
    );
    db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (1, ?)', uid);
    return uid;
  });

  const user = db.get('SELECT * FROM users WHERE id = ?', id);
  const token = issueTokens(res, user);
  res.status(201).json({ token, user: publicUser(user) });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const raw = req.cookies?.refresh_token || req.body?.refreshToken;
  if (!raw) return res.status(401).json({ error: '缺少刷新令牌' });
  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(raw, config.server.jwtSecret);
    if (payload.typ !== 'refresh') throw new Error('bad typ');
    const hash = require('crypto').createHash('sha256').update(raw).digest('hex');
    const row = db.get('SELECT * FROM refresh_tokens WHERE token_hash = ?', hash);
    if (!row || row.revoked_at || db.now() > Number(row.expires_at)) {
      return res.status(401).json({ error: '刷新令牌无效' });
    }
    const user = db.get('SELECT * FROM users WHERE id = ?', Number(payload.sub));
    if (!user || user.banned) return res.status(401).json({ error: '用户不可用' });
    revokeRefreshToken(raw);
    const token = issueTokens(res, user);
    res.json({ token, user: publicUser(user) });
  } catch (_) {
    return res.status(401).json({ error: '刷新令牌无效' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const raw = req.cookies?.refresh_token || req.body?.refreshToken;
  if (raw) revokeRefreshToken(raw);
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const u = db.get(
    'SELECT id, username, role, rating, preferred_language, signature, bio, banned, created_at, single_file_limit_mb, storage_quota_mb FROM users WHERE id = ?',
    req.user.id
  );
  res.json({ user: u ? publicUser(u) : null, full: u });
});

// POST /api/auth/password  (change own password)
router.post('/password', requireAuth, (req, res) => {
  const oldP = str(req.body.oldPassword, '', 128);
  const newP = str(req.body.newPassword, '', 128);
  const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!u || !bcrypt.compareSync(oldP, u.password_hash)) {
    return res.status(400).json({ error: '原密码错误' });
  }
  if (newP.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', bcrypt.hashSync(newP, 10), db.now(), u.id);
  revokeAllForUser(u.id);
  res.json({ ok: true });
});

module.exports = router;
