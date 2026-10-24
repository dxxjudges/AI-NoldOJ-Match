'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../config');
const db = require('../db/database');

const ROLE_RANK = { user: 0, teacher: 1, admin: 2, super: 3 };

function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role, fl: user.force_logout_at },
    config.server.jwtSecret,
    { expiresIn: config.server.accessTtlSec }
  );
}

function signRefreshToken(user) {
  const raw = jwt.sign(
    { sub: String(user.id), typ: 'refresh', jti: require('crypto').randomBytes(16).toString('hex') },
    config.server.jwtSecret,
    { expiresIn: config.server.refreshTtlSec }
  );
  const payload = jwt.decode(raw);
  const hash = require('crypto').createHash('sha256').update(raw).digest('hex');
  db.run(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?)',
    user.id, hash, payload.exp * 1000, db.now()
  );
  return raw;
}

function revokeRefreshToken(raw) {
  try {
    const hash = require('crypto').createHash('sha256').update(raw).digest('hex');
    db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', db.now(), hash);
  } catch (_) {}
}

function revokeAllForUser(userId) {
  db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', db.now(), userId);
}

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

function getUserFromRequest(req) {
  const raw = extractToken(req);
  if (!raw) return null;
  try {
    const payload = jwt.verify(raw, config.server.jwtSecret);
    if (payload.typ === 'refresh') return null;
    const uid = Number(payload.sub);
    const user = db.get('SELECT id, username, role, banned, force_logout_at, rating, preferred_language FROM users WHERE id = ?', uid);
    if (!user) return null;
    if (user.banned) return null;
    // forced logout: token issued before force_logout_at is dead
    if (payload.fl != null && Number(payload.fl) > Number(payload.iat) * 1000) return null;
    return user;
  } catch (_) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: '未登录或登录已失效' });
  req.user = user;
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const a = ROLE_RANK[req.user.role] ?? 0;
    const b = ROLE_RANK[minRole] ?? 99;
    if (a < b) return res.status(403).json({ error: '权限不足' });
    next();
  };
}

function canSee(user, entityPublic) {
  if (entityPublic) return true;
  if (!user) return false;
  return (ROLE_RANK[user.role] ?? 0) >= ROLE_RANK.teacher;
}

function visibleToGroup(user, entityType, entityId) {
  const row = db.get(
    'SELECT group_id FROM visibility_bindings WHERE entity_type = ? AND entity_id = ?',
    entityType, entityId
  );
  if (!row) return true; // no binding => follows is_public
  if (!user) return false;
  if ((ROLE_RANK[user.role] ?? 0) >= ROLE_RANK.admin) return true;
  const m = db.get('SELECT 1 AS x FROM group_members WHERE group_id = ? AND user_id = ?', row.group_id, user.id);
  return !!m;
}

module.exports = {
  ROLE_RANK, signAccessToken, signRefreshToken, revokeRefreshToken, revokeAllForUser,
  getUserFromRequest, requireAuth, requireRole, canSee, visibleToGroup,
};
