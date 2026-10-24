import { get } from '../db.js';
import { verifyToken } from '../utils/jwt.js';
import { unauthorized, forbidden } from '../utils/errors.js';

export const ROLE_LEVEL = { user: 0, teacher: 1, admin: 2, su: 3 };

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    rating: row.rating,
    preferred_language: row.preferred_language,
    signature: row.signature,
    bio: row.bio,
    created_at: row.created_at,
    quota_bytes: row.quota_bytes,
    quota_used_bytes: row.quota_used_bytes,
    privacy: {
      achievements: Boolean(row.privacy_achievements),
      dashboard: Boolean(row.privacy_dashboard),
      favorites: Boolean(row.privacy_favorites),
    },
  };
}

export function extractToken(ctx) {
  const header = ctx.get('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export function resolveUser(ctx) {
  const token = extractToken(ctx);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.typ !== 'access') return null;
  const user = get('SELECT * FROM users WHERE id = ?', payload.sub);
  if (!user) return null;
  if (user.banned) return null;
  if (user.force_logout_at) {
    const logoutAt = Date.parse(user.force_logout_at.replace(' ', 'T') + 'Z');
    if (!Number.isNaN(logoutAt) && payload.iat * 1000 < logoutAt) return null;
  }
  return user;
}

export function authOptional(ctx, next) {
  ctx.user = resolveUser(ctx);
  return next();
}

export function authRequired(ctx, next) {
  const user = resolveUser(ctx);
  if (!user) throw unauthorized();
  ctx.user = user;
  return next();
}

export function requireRole(minRole) {
  return (ctx, next) => {
    const user = resolveUser(ctx);
    if (!user) throw unauthorized();
    if (ROLE_LEVEL[user.role] < ROLE_LEVEL[minRole]) throw forbidden();
    ctx.user = user;
    return next();
  };
}

export function isAtLeast(user, role) {
  return user && ROLE_LEVEL[user.role] >= ROLE_LEVEL[role];
}

export function clientIp(ctx) {
  return ctx.ip || 'unknown';
}

export default { authOptional, authRequired, requireRole, publicUser, resolveUser, ROLE_LEVEL, isAtLeast };
