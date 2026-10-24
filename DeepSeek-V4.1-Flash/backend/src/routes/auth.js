import config from '../config.js';
import { get, run } from '../db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { issueAccessToken, issueRefreshToken, verifyToken } from '../utils/jwt.js';
import { createCaptcha, verifyCaptcha, captchaEnabled } from '../services/captcha.js';
import { publicUser } from '../http/auth.js';
import { badRequest, unauthorized, forbidden } from '../utils/errors.js';
import { rateLimit } from '../utils/rateLimit.js';
import { requireFields } from './helpers.js';
import { addUserToAllGroup } from '../seed.js';
import { broadcast } from '../services/websocket.js';

const REFRESH_COOKIE = 'noldoj_refresh';
const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/;

function setRefreshCookie(ctx, token) {
  ctx.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/api/auth',
    maxAge: config.core.refreshTokenTtlSeconds,
  });
}

export default function registerAuth(router) {
  router.get('/api/auth/captcha', () => {
    const cap = createCaptcha();
    return { ok: true, data: { id: cap.id, svg: cap.svg, enabled: !cap.disabled } };
  });

  router.post('/api/auth/register', (ctx) => {
    if (!config.core.allowRegistration) throw forbidden('当前未开放注册');
    const { username, password, captchaId, captcha } = ctx.body;
    requireFields(ctx.body, ['username', 'password']);
    if (!USERNAME_RE.test(username)) throw badRequest('用户名需为 3-20 位字母、数字或中文');
    if (String(password).length < 6) throw badRequest('密码长度至少 6 位');
    if (!verifyCaptcha(captchaId, captcha)) throw badRequest('验证码错误或已过期');

    const limit = rateLimit(`register:${ctx.ip}`, {
      windowMs: 3_600_000,
      max: config.core.registrationPerIpPerHour,
    });
    if (!limit.ok) throw forbidden(`注册过于频繁，请 ${limit.retryAfter} 秒后再试`);

    if (get('SELECT id FROM users WHERE username = ?', username)) throw badRequest('用户名已存在');

    const info = run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      username, hashPassword(password),
    );
    const userId = Number(info.lastInsertRowid);
    addUserToAllGroup(userId);
    return { ok: true, data: { id: userId } };
  });

  router.post('/api/auth/login', (ctx) => {
    const { username, password, captchaId, captcha, force } = ctx.body;
    requireFields(ctx.body, ['username', 'password']);
    const limit = rateLimit(`login:${ctx.ip}`, config.rateLimit.login);
    if (!limit.ok) throw forbidden(`登录尝试过于频繁，请 ${limit.retryAfter} 秒后再试`);
    if (!verifyCaptcha(captchaId, captcha)) throw badRequest('验证码错误或已过期');

    const user = get('SELECT * FROM users WHERE username = ?', username);
    if (!user || !verifyPassword(password, user.password_hash)) throw unauthorized('用户名或密码错误');
    if (user.banned) throw forbidden('账号已被封禁');

    // Force logout only if explicitly requested (password change etc.)
    if (force) run("UPDATE users SET force_logout_at = datetime('now') WHERE id = ?", user.id);

    const accessToken = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user);
    setRefreshCookie(ctx, refreshToken);
    return { ok: true, data: { accessToken, user: publicUser(user) } };
  });

  router.post('/api/auth/refresh', (ctx) => {
    const token = ctx.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized();
    const payload = verifyToken(token);
    if (!payload || payload.typ !== 'refresh') throw unauthorized();
    const user = get('SELECT * FROM users WHERE id = ?', payload.sub);
    if (!user || user.banned) throw unauthorized();
    if (user.force_logout_at) {
      const logoutAt = Date.parse(user.force_logout_at.replace(' ', 'T') + 'Z');
      if (!Number.isNaN(logoutAt) && payload.iat * 1000 < logoutAt) throw unauthorized('登录已失效，请重新登录');
    }
    const accessToken = issueAccessToken(user);
    return { ok: true, data: { accessToken, user: publicUser(user) } };
  });

  router.post('/api/auth/logout', (ctx) => {
    ctx.setCookie(REFRESH_COOKIE, '', { httpOnly: true, path: '/api/auth', maxAge: 0 });
    return { ok: true, data: null };
  });

  router.get('/api/auth/me', (ctx) => {
    if (!ctx.user) throw unauthorized();
    return { ok: true, data: publicUser(ctx.user) };
  });

  router.get('/api/auth/config', () => ({
    ok: true,
    data: {
      captchaEnabled: captchaEnabled(),
      allowRegistration: config.core.allowRegistration,
      ai: {
        security: Boolean(config.ai.security.enabled),
        hint: Boolean(config.ai.hint.enabled),
      },
    },
  }));

  router.post('/api/auth/heartbeat', (ctx) => {
    if (ctx.user) broadcast('online', { userId: ctx.user.id });
    return { ok: true, data: { t: Date.now() } };
  });
}
