import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
import { all, get, run } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { ok, paginate } from '../http/context.js';
import { toInt } from './helpers.js';
import { parseMultipart } from '../http/multipart.js';
import config from '../config.js';

const MAX_SINGLE = 10 * 1024 * 1024;

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}

export default function registerFiles(router) {
  router.post('/api/files', (ctx) => {
    if (!ctx.user) throw forbidden('请先登录');
    const contentType = ctx.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) throw badRequest('请使用 multipart/form-data 上传');
    const { files } = parseMultipart(ctx.rawBody, contentType);
    if (!files.length) throw badRequest('没有收到文件');

    const user = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    let used = user.quota_used_bytes;
    const created = [];

    for (const file of files) {
      if (file.data.length > MAX_SINGLE) throw badRequest(`文件 ${file.filename} 超过 10MB 单文件限制`);
      if (used + file.data.length > user.quota_bytes) throw forbidden('存储空间配额不足');
      const ext = extname(file.filename);
      const storedName = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
      if (!existsSync(config.core.uploadsDir)) mkdirSync(config.core.uploadsDir, { recursive: true });
      writeFileSync(join(config.core.uploadsDir, storedName), file.data);
      const info = run(
        'INSERT INTO files (user_id, filename, stored_name, mime, size) VALUES (?,?,?,?,?)',
        user.id, safeName(file.filename), storedName, file.contentType, file.data.length,
      );
      used += file.data.length;
      created.push({ id: Number(info.lastInsertRowid), filename: file.filename, url: `/uploads/${storedName}`, size: file.data.length });
    }
    run('UPDATE users SET quota_used_bytes = ? WHERE id = ?', used, user.id);
    return ok({ files: created, used, quota: user.quota_bytes });
  });

  router.get('/api/files', (ctx) => {
    if (!ctx.user) throw forbidden();
    const { page, pageSize, offset } = paginate(ctx);
    const owner = isAtLeast(ctx.user, 'admin') && ctx.query1('all') ? null : ctx.user.id;
    const clause = owner ? 'WHERE user_id = ?' : '';
    const params = owner ? [owner] : [];
    const total = get(`SELECT COUNT(*) AS n FROM files ${clause}`, ...params).n;
    const rows = all(`SELECT * FROM files ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
    return ok({
      total,
      page,
      pageSize,
      quota_used: ctx.user.quota_used_bytes,
      quota_total: ctx.user.quota_bytes,
      items: rows.map((f) => ({ ...f, url: `/uploads/${f.stored_name}` })),
    });
  });

  router.delete('/api/files/:id', (ctx) => {
    if (!ctx.user) throw forbidden();
    const file = get('SELECT * FROM files WHERE id = ?', toInt(ctx.params.id, '文件ID'));
    if (!file) throw notFound('文件不存在');
    if (file.user_id !== ctx.user.id && !isAtLeast(ctx.user, 'admin')) throw forbidden();
    run('DELETE FROM files WHERE id = ?', file.id);
    const owner = get('SELECT quota_used_bytes FROM users WHERE id = ?', file.user_id);
    if (owner) run('UPDATE users SET quota_used_bytes = ? WHERE id = ?', Math.max(0, owner.quota_used_bytes - file.size), file.user_id);
    return ok({ deleted: file.id });
  });

  router.put('/api/files/quota/:userId', requireRole('su'), (ctx) => {
    const user = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.userId, '用户ID'));
    if (!user) throw notFound('用户不存在');
    const quota = Math.max(0, toInt(ctx.body.quota_bytes, '配额'));
    run('UPDATE users SET quota_bytes = ? WHERE id = ?', quota, user.id);
    return ok({ quota_bytes: quota });
  });
}
