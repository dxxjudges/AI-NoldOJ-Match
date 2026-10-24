import { URL } from 'node:url';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function createContext(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const ctx = {
    req,
    res,
    method: req.method,
    url,
    pathname,
    query: url.searchParams,
    params: {},
    headers: req.headers,
    cookies: parseCookies(req.headers.cookie),
    body: {},
    rawBody: Buffer.alloc(0),
    user: null,
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '',
    get(name) { return req.headers[String(name).toLowerCase()]; },
    query1(name, fallback = null) { return url.searchParams.has(name) ? url.searchParams.get(name) : fallback; },
    queryInt(name, fallback = 0) {
      const v = url.searchParams.get(name);
      if (v === null || v === '') return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : fallback;
    },
    status(code) { res.statusCode = code; return ctx; },
    header(name, value) { res.setHeader(name, value); return ctx; },
    setCookie(name, value, options) {
      const existing = res.getHeader('Set-Cookie');
      const cookie = serializeCookie(name, value, options);
      res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
      return ctx;
    },
    json(data, status = res.statusCode || 200) {
      return ctx.send(data, status);
    },
    send(data, status = res.statusCode || 200) {
      if (res.writableEnded) return ctx;
      res.statusCode = status;
      const payload = JSON.stringify(data === undefined ? null : data);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(payload);
      return ctx;
    },
    text(data, status = res.statusCode || 200) {
      if (res.writableEnded) return ctx;
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(String(data ?? ''));
      return ctx;
    },
    noContent() {
      if (res.writableEnded) return ctx;
      res.statusCode = 204;
      res.end();
      return ctx;
    },
    redirect(location, status = 302) {
      res.statusCode = status;
      res.setHeader('Location', location);
      res.end();
      return ctx;
    },
  };
  return ctx;
}

export function ok(data) { return { ok: true, data }; }
export function fail(code, message, detail) { return { ok: false, code, message, detail }; }

export function paginate(ctx, defaultSize = 20, maxSize = 100) {
  const page = Math.max(1, ctx.queryInt('page', 1));
  const pageSize = Math.min(maxSize, Math.max(1, ctx.queryInt('pageSize', defaultSize)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export default { createContext, parseCookies, serializeCookie, ok, fail, paginate };
