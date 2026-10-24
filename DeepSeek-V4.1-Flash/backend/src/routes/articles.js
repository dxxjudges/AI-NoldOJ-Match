import { all, get, run, recycleId } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { paginate, ok } from '../http/context.js';
import { escapeLike, requireFields, toInt } from './helpers.js';

function serialize(row) {
  return {
    ...row,
    published: Boolean(row.published),
  };
}

export default function registerArticles(router) {
  router.get('/api/articles', (ctx) => {
    const { page, pageSize, offset } = paginate(ctx);
    const where = [];
    const params = [];
    if (!isAtLeast(ctx.user, 'teacher')) { where.push("(published = 1 OR (publish_at IS NOT NULL AND publish_at <= datetime('now')))"); }
    const search = ctx.query1('search', '');
    if (search) {
      where.push('(REPLACE(title," ","") LIKE ? OR content LIKE ?)');
      params.push(`%${escapeLike(search.replace(/\s+/g, ''))}%`, `%${escapeLike(search)}%`);
    }
    const problem = ctx.query1('problem');
    if (problem) { where.push('problem_id = ?'); params.push(Number(problem)); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM articles ${clause}`, ...params).n;
    const rows = all(
      `SELECT id, title, author_id, author_name, problem_id, published, publish_at, created_at, updated_at
         FROM articles ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...params, pageSize, offset,
    );
    return ok({ total, page, pageSize, items: rows.map(serialize) });
  });

  router.post('/api/articles', requireRole('teacher'), (ctx) => {
    requireFields(ctx.body, ['title']);
    const { title, content = '', problem_id = null, published = false, publish_at = null } = ctx.body;
    const id = recycleId('articles');
    run(
      'INSERT INTO articles (id, title, content, author_id, author_name, problem_id, published, publish_at) VALUES (?,?,?,?,?,?,?,?)',
      id, title, content, ctx.user.id, ctx.user.username, problem_id, published ? 1 : 0, publish_at,
    );
    return ok(serialize(get('SELECT * FROM articles WHERE id = ?', id)));
  });

  router.get('/api/articles/:id', (ctx) => {
    const row = get('SELECT * FROM articles WHERE id = ?', toInt(ctx.params.id, '文章ID'));
    if (!row) throw notFound('文章不存在');
    const visible = isAtLeast(ctx.user, 'teacher') || row.published || (row.publish_at && Date.parse(row.publish_at) <= Date.now());
    if (!visible) throw forbidden('文章尚未发布');
    return ok(serialize(row));
  });

  router.put('/api/articles/:id', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM articles WHERE id = ?', toInt(ctx.params.id, '文章ID'));
    if (!row) throw notFound('文章不存在');
    if (!isAtLeast(ctx.user, 'admin') && row.author_id !== ctx.user.id) throw forbidden();
    const fields = [];
    const params = [];
    for (const key of ['title', 'content', 'problem_id', 'publish_at']) {
      if (ctx.body[key] !== undefined) { fields.push(`${key} = ?`); params.push(ctx.body[key]); }
    }
    if (ctx.body.published !== undefined) { fields.push('published = ?'); params.push(ctx.body.published ? 1 : 0); }
    if (fields.length) {
      fields.push("updated_at = datetime('now')");
      params.push(row.id);
      run(`UPDATE articles SET ${fields.join(', ')} WHERE id = ?`, ...params);
    }
    return ok(serialize(get('SELECT * FROM articles WHERE id = ?', row.id)));
  });

  router.delete('/api/articles/:id', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM articles WHERE id = ?', toInt(ctx.params.id, '文章ID'));
    if (!row) throw notFound('文章不存在');
    if (!isAtLeast(ctx.user, 'admin') && row.author_id !== ctx.user.id) throw forbidden();
    run('DELETE FROM articles WHERE id = ?', row.id);
    return ok({ deleted: row.id });
  });

  router.post('/api/problems/:id/solutions', requireRole('teacher'), (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    const { title, content } = ctx.body;
    if (!title) throw badRequest('缺少标题');
    const id = recycleId('articles');
    run(
      'INSERT INTO articles (id, title, content, author_id, author_name, problem_id, published) VALUES (?,?,?,?,?,?,1)',
      id, title, content || '', ctx.user.id, ctx.user.username, problem.id,
    );
    return ok({ id });
  });
}
