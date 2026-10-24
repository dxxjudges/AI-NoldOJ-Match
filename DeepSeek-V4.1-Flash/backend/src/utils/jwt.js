import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import config from '../config.js';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(data) {
  return createHmac('sha256', config.core.jwtSecret).update(data).digest('base64url');
}

export function signToken(payload, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds, jti: randomBytes(8).toString('hex') };
  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  return `${encoded}.${sign(encoded)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = sign(`${h}.${p}`);
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(fromBase64url(p));
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function issueAccessToken(user) {
  return signToken(
    { sub: user.id, username: user.username, role: user.role, typ: 'access' },
    config.core.accessTokenTtlSeconds,
  );
}

export function issueRefreshToken(user) {
  return signToken({ sub: user.id, typ: 'refresh' }, config.core.refreshTokenTtlSeconds);
}
