// Hand-rolled JWT (HS256) to avoid external dependencies.
const crypto = require('crypto');
const config = require('../config');

const ACCESS_TTL_MS = 30 * 60 * 1000;          // 30 min access token
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;  // 30 day refresh token

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signAccess(payload, issuedAt = Date.now()) {
  payload = { ...payload, typ: 'access', iat: issuedAt, exp: issuedAt + ACCESS_TTL_MS };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', config.core.jwtSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function verifyAccess(token) {
  try {
    const [head, body, sig] = token.split('.');
    const expect = crypto.createHmac('sha256', config.core.jwtSecret).update(`${head}.${body}`).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { signAccess, verifyAccess, ACCESS_TTL_MS, REFRESH_TTL_MS };
