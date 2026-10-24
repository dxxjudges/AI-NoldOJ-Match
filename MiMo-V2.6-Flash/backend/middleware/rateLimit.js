'use strict';

const db = require('../db/database');

/**
 * Fixed-window rate limiter persisted in SQLite so it survives restarts.
 * bucket key format: "<name>:<subject>"
 */
function rateLimit(name, windowSec, max) {
  return (req, res, next) => {
    const subject = req.user ? `u${req.user.id}` : `ip:${clientIp(req)}`;
    const bucket = `${name}:${subject}`;
    const now = Date.now();
    try {
      const row = db.get('SELECT window_start, count FROM rate_limits WHERE bucket = ?', bucket);
      if (!row || now - Number(row.window_start) > windowSec * 1000) {
        db.run(
          `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
           ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, count = 1`,
          bucket, now
        );
        return next();
      }
      if (Number(row.count) >= max) {
        const retry = Math.ceil((Number(row.window_start) + windowSec * 1000 - now) / 1000);
        return res.status(429).json({ error: `请求过于频繁，请 ${retry} 秒后再试`, retryAfter: retry });
      }
      db.run('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?', bucket);
      next();
    } catch (e) {
      console.error('[rateLimit]', e.message);
      next();
    }
  };
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = { rateLimit, clientIp };
