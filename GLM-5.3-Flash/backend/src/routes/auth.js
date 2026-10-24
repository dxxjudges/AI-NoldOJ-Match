const express = require('express');
const config = require('../config');
const { one, run } = require('../db/db');
const { hashPassword, verifyPassword, randomToken, sha256 } = require('../utils/password');
const { signAccess, verifyAccess, REFRESH_TTL_MS } = require('../utils/jwt');
const captcha = require('../utils/captcha');
const rateLimit = require('../utils/rateLimit');
const { safeUser } = require('../utils/middleware');

const router = express.Router();

function parseCookies(req) {
  const jar = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) jar[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return jar;
}

function setRefreshCookie(res, token, maxAgeMs) {
  res.setHeader('Set-Cookie',
    `refresh_token=${encodeURIComponent(token)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
}

function ipOf(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

// registration committee open/closed toggle read live from config file
function registrationOpen() {
  try {
    const live = JSON.parse(require('fs').readFileSync(require('path').join(config.ROOT, 'config', 'config.json'), 'utf8'));
    return live.core ? live.core.registrationOpen !== false : true;
  } catch { return config.core.registrationOpen !== false; }
}

router.get('/captcha', (req, res) => {
  if (!config.captcha.enabled) return res.json({ ok: true, enabled: false });
  const { id, svg, expires } = captcha.generate();
  res.json({ ok: true, enabled: true, id, svg, expires });
});

router.post('/auth/register', async (req, res) => {
  try {
    const { username, password, captchaId, captchaCode } = req.body || {};
    if (!registrationOpen()) return res.status(403).json({ ok: false, error: 'Registration is temporarily closed by administrators' });
    if (!rateLimit.hit('reg:' + ipOf(req), config.core.registerRateLimit, 3600 * 1000)) {
      return res.status(429).json({ ok: false, error: 'Registration too frequent, only 1 per hour' });
    }
    if (config.captcha.enabled && !captcha.verify(captchaId, captchaCode)) {
      return res.status(400).json({ ok: false, error: 'Captcha verification failed' });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return res.status(400).json({ ok: false, error: 'Username must be 3-20 alphanumeric characters or underscore' });
    if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
    if (one(`SELECT id FROM users WHERE username=?`, username)) return res.status(400).json({ ok: false, error: 'Username already exists' });

    // Join system group "All Users"
    const sysGroup = one(`SELECT id FROM groups WHERE is_system=1 LIMIT 1`);
    const info = run(
      `INSERT INTO users (username, password_hash, role, rating, created_at) VALUES (?,?, 'user', 1500, ?)`,
      username, hashPassword(password), Date.now());
    if (sysGroup) run(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)`, sysGroup.id, info.lastInsertRowid);
    res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/auth/login', (req, res) => {
  try {
    const { username, password, captchaId, captchaCode } = req.body || {};
    if (!rateLimit.hit('login:' + ipOf(req), config.core.loginRateLimit, 60 * 1000)) {
      return res.status(429).json({ ok: false, error: 'Too many login attempts, please wait one minute' });
    }
    if (config.captcha.enabled && !captcha.verify(captchaId, captchaCode)) {
      return res.status(400).json({ ok: false, error: 'Captcha verification failed' });
    }
    const user = one(`SELECT * FROM users WHERE username=?`, username);
    if (!user || !verifyPassword(password || '', user.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Incorrect username or password' });
    }
    if (user.banned) {
      // Ban intercepts both tokens
      run(`DELETE FROM refresh_tokens WHERE user_id=?`, user.id);
      return res.status(403).json({ ok: false, error: 'Account banned: ' + (user.ban_reason || 'no reason provided') });
    }
    const access = signAccess({ uid: user.id, role: user.role });
    const refresh = randomToken();
    run(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?)`,
      user.id, sha256(refresh), Date.now() + REFRESH_TTL_MS, Date.now());
    setRefreshCookie(res, refresh, REFRESH_TTL_MS);
    res.json({ ok: true, data: { accessToken: access, user: safeUser(user) } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/auth/refresh', (req, res) => {
  const token = parseCookies(req)['refresh_token'];
  if (!token) return res.status(401).json({ ok: false, error: 'No refresh token (please log in again)' });
  const rec = one(`SELECT * FROM refresh_tokens WHERE token_hash=?`, sha256(token));
  if (!rec || rec.expires_at < Date.now()) {
    setRefreshCookie(res, '', -1);
    return res.status(401).json({ ok: false, error: 'Refresh token invalid or expired' });
  }
  const user = one(`SELECT * FROM users WHERE id=?`, rec.user_id);
  if (!user || user.banned) {
    run(`DELETE FROM refresh_tokens WHERE user_id=?`, rec.user_id);
    setRefreshCookie(res, '', -1);
    return res.status(403).json({ ok: false, error: 'Account status abnormal' });
  }
  const access = signAccess({ uid: user.id, role: user.role });
  res.json({ ok: true, data: { accessToken: access, user: safeUser(user) } });
});

router.post('/auth/logout', (req, res) => {
  const token = parseCookies(req)['refresh_token'];
  if (token) run(`DELETE FROM refresh_tokens WHERE token_hash=?`, sha256(token));
  setRefreshCookie(res, '', -1);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Not logged in' });
  res.json({ ok: true, data: safeUser(req.user) });
});

router.get('/auth/verify-token', (req, res) => {
  const auth = req.headers['authorization'] || '';
  const payload = auth.startsWith('Bearer ') ? verifyAccess(auth.slice(7)) : null;
  res.json({ ok: true, data: { valid: !!payload, payload: payload && { uid: payload.uid, role: payload.role } } });
});

module.exports = router;
