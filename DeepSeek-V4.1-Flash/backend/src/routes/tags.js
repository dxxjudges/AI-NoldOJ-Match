import { all, get, run } from '../db.js';
import { requireRole } from '../http/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { requireFields, toInt } from './helpers.js';
import { ok } from '../http/context.js';

export default function registerTags(router) {
  router.get('/api/tags', () => {
    const rows = all(
      `SELECT t.*, (SELECT COUNT(*) FROM problem_tags pt WHERE pt.tag_id = t.id) AS problem_count
         FROM tags t ORDER BY t.id`,
    );
    return ok(rows);
  });

  router.post('/api/tags', requireRole('teacher'), (ctx) => {
    requireFields(ctx.body, ['name']);
    const { name, color = '#6b7280' } = ctx.body;
    if (get('SELECT id FROM tags WHERE name = ?', name)) throw badRequest('标签已存在');
    const info = run('INSERT INTO tags (name, color) VALUES (?, ?)', name, color);
    return ok(get('SELECT * FROM tags WHERE id = ?', Number(info.lastInsertRowid)));
  });

  router.put('/api/tags/:id', requireRole('teacher'), (ctx) => {
    const tag = get('SELECT * FROM tags WHERE id = ?', toInt(ctx.params.id, '标签ID'));
    if (!tag) throw notFound('标签不存在');
    const { name, color } = ctx.body;
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (color !== undefined) { fields.push('color = ?'); params.push(color); }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(tag.id);
    run(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(get('SELECT * FROM tags WHERE id = ?', tag.id));
  });

  router.delete('/api/tags/:id', requireRole('teacher'), (ctx) => {
    const tag = get('SELECT * FROM tags WHERE id = ?', toInt(ctx.params.id, '标签ID'));
    if (!tag) throw notFound('标签不存在');
    run('DELETE FROM tags WHERE id = ?', tag.id);
    return ok({ deleted: tag.id });
  });
}
