const { verifyAccess } = require('./jwt');
const { getDb } = require('../db/db');

const ROLE_LEVEL = { user: 0, teacher: 1, admin: 2, super: 3 };

function getUserFromReq(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  const payload = verifyAccess(auth.slice(7).trim());
  if (!payload) return null;
  const user = getDb().prepare('SELECT * FROM users WHERE id=?').get(payload.uid);
  if (!user || user.banned) return null;
  // Forced logout / ban: tokens issued before force_logout_at are invalid
  if (payload.iat < (user.force_logout_at || 0)) return null;
  return user;
}

function attachUser(req, _res, next) {
  req.user = getUserFromReq(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: '登录状态无效或已过期' });
  next();
}

function requireMin(level) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
    if (ROLE_LEVEL[req.user.role] < ROLE_LEVEL[level]) {
      return res.status(403).json({ ok: false, error: '权限不足' });
    }
    next();
  };
}

function canManage(req, targetUser) {
  if (!req.user) return false;
  return ROLE_LEVEL[req.user.role] >= ROLE_LEVEL[targetUser.role];
}

function safeUser(u) {
  if (!u) return null;
  const {
    id, username, role, rating, signature, bio, preferred_lang,
    banned, created_at, used_bytes, quota_gb, max_file_mb
  } = u;
  return { id, username, role, rating, signature, bio,
    preferredLang: preferred_lang, banned, createdAt: created_at,
    usedBytes: used_bytes, quotaGb: quota_gb, maxFileMb: max_file_mb };
}

module.exports = { attachUser, requireAuth, requireMin, canManage, safeUser, ROLE_LEVEL, getUserFromReq };
