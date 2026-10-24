import { all, get, run } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { notFound, forbidden } from '../utils/errors.js';
import { ok } from '../http/context.js';
import { requireFields, toInt } from './helpers.js';

function serialize(row) {
  return { ...row, pinned: Boolean(row.pinned) };
}

export default function registerAnnouncements(router) {
  router.get('/api/announcements', (ctx) => {
    const contest = ctx.query1('contest');
    const where = [];
    const params = [];
    if (contest) { where.push('contest_id = ?'); params.push(Number(contest)); }
    else if (ctx.query1('global')) { where.push('contest_id IS NULL'); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = all(`SELECT * FROM announcements ${clause} ORDER BY pinned DESC, id DESC LIMIT 200`, ...params);
    return ok(rows.map(serialize));
  });

  router.get('/api/announcements/:id', (ctx) => {
    const row = get('SELECT * FROM announcements WHERE id = ?', toInt(ctx.params.id, '公告ID'));
    if (!row) throw notFound('公告不存在');
    return ok(serialize(row));
  });

  router.post('/api/announcements', requireRole('teacher'), (ctx) => {
    requireFields(ctx.body, ['title']);
    const { title, content = '', contest_id = null, pinned = false } = ctx.body;
    const info = run(
      'INSERT INTO announcements (title, content, author_id, contest_id, pinned) VALUES (?,?,?,?,?)',
      title, content, ctx.user.id, contest_id, pinned ? 1 : 0,
    );
    return ok(serialize(get('SELECT * FROM announcements WHERE id = ?', Number(info.lastInsertRowid))));
  });

  router.put('/api/announcements/:id', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM announcements WHERE id = ?', toInt(ctx.params.id, '公告ID'));
    if (!row) throw notFound('公告不存在');
    if (!isAtLeast(ctx.user, 'admin') && row.author_id !== ctx.user.id) throw forbidden();
    const fields = [];
    const params = [];
    for (const key of ['title', 'content', 'contest_id']) {
      if (ctx.body[key] !== undefined) { fields.push(`${key} = ?`); params.push(ctx.body[key]); }
    }
    if (ctx.body.pinned !== undefined) { fields.push('pinned = ?'); params.push(ctx.body.pinned ? 1 : 0); }
    if (fields.length) { params.push(row.id); run(`UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`, ...params); }
    return ok(serialize(get('SELECT * FROM announcements WHERE id = ?', row.id)));
  });

  router.delete('/api/announcements/:id', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM announcements WHERE id = ?', toInt(ctx.params.id, '公告ID'));
    if (!row) throw notFound('公告不存在');
    if (!isAtLeast(ctx.user, 'admin') && row.author_id !== ctx.user.id) throw forbidden();
    run('DELETE FROM announcements WHERE id = ?', row.id);
    return ok({ deleted: row.id });
  });
}
