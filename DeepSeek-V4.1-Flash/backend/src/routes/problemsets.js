import { all, get, run } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { paginate, ok } from '../http/context.js';
import { requireFields, toInt } from './helpers.js';
import { canView, visibleEntityIds } from '../services/visibility.js';

function serialize(row) {
  const problems = all(
    `SELECT pi.problem_id, pi.sort, p.title, p.difficulty
       FROM problemset_items pi JOIN problems p ON p.id = pi.problem_id
      WHERE pi.problemset_id = ? ORDER BY pi.sort, pi.problem_id`,
    row.id,
  );
  return {
    ...row,
    is_public: Boolean(row.is_public),
    problem_count: problems.length,
    problems,
  };
}

export default function registerProblemSets(router) {
  router.get('/api/problemsets', (ctx) => {
    const { page, pageSize, offset } = paginate(ctx);
    const where = [];
    const params = [];
    const visible = visibleEntityIds('problemset', ctx.user, 'problemsets');
    if (visible !== null) {
      if (!visible.length) return ok({ total: 0, page, pageSize, items: [] });
      where.push(`id IN (${visible.map(() => '?').join(',')})`);
      params.push(...visible);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM problemsets ${clause}`, ...params).n;
    const rows = all(`SELECT * FROM problemsets ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
    return ok({ total, page, pageSize, items: rows.map(serialize) });
  });

  router.post('/api/problemsets', requireRole('teacher'), (ctx) => {
    requireFields(ctx.body, ['title']);
    const { title, description = '', is_public = true } = ctx.body;
    const info = run('INSERT INTO problemsets (title, description, created_by, is_public) VALUES (?,?,?,?)',
      title, description, ctx.user.id, is_public ? 1 : 0);
    return ok(serialize(get('SELECT * FROM problemsets WHERE id = ?', Number(info.lastInsertRowid))));
  });

  router.get('/api/problemsets/:id', (ctx) => {
    const row = get('SELECT * FROM problemsets WHERE id = ?', toInt(ctx.params.id, '题单ID'));
    if (!row) throw notFound('题单不存在');
    if (!canView('problemset', ctx.user, row, { ownerField: 'created_by' })) throw forbidden('无权访问该题单');
    const data = serialize(row);
    if (ctx.user) {
      data.progress = all(
        'SELECT problem_id, status FROM problemset_progress WHERE problemset_id = ? AND user_id = ?',
        row.id, ctx.user.id,
      );
    }
    return ok(data);
  });

  router.put('/api/problemsets/:id', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM problemsets WHERE id = ?', toInt(ctx.params.id, '题单ID'));
    if (!row) throw notFound('题单不存在');
    if (!isAtLeast(ctx.user, 'admin') && row.created_by !== ctx.user.id) throw forbidden();
    const fields = [];
    const params = [];
    for (const key of ['title', 'description']) {
      if (ctx.body[key] !== undefined) { fields.push(`${key} = ?`); params.push(ctx.body[key]); }
    }
    if (ctx.body.is_public !== undefined) { fields.push('is_public = ?'); params.push(ctx.body.is_public ? 1 : 0); }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(row.id);
    run(`UPDATE problemsets SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(serialize(get('SELECT * FROM problemsets WHERE id = ?', row.id)));
  });

  router.delete('/api/problemsets/:id', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM problemsets WHERE id = ?', toInt(ctx.params.id, '题单ID'));
    if (!row) throw notFound('题单不存在');
    if (!isAtLeast(ctx.user, 'admin') && row.created_by !== ctx.user.id) throw forbidden();
    run('DELETE FROM problemsets WHERE id = ?', row.id);
    return ok({ deleted: row.id });
  });

  router.post('/api/problemsets/:id/problems', requireRole('teacher'), (ctx) => {
    const set = get('SELECT * FROM problemsets WHERE id = ?', toInt(ctx.params.id, '题单ID'));
    if (!set) throw notFound('题单不存在');
    const ids = Array.isArray(ctx.body.problem_ids) ? ctx.body.problem_ids : [ctx.body.problem_id];
    let sort = get('SELECT COALESCE(MAX(sort),0) AS s FROM problemset_items WHERE problemset_id = ?', set.id).s;
    const added = [];
    for (const pid of ids) {
      const problem = get('SELECT * FROM problems WHERE id = ?', toInt(pid, '题目ID'));
      if (!problem) continue;
      sort += 1;
      run('INSERT OR REPLACE INTO problemset_items (problemset_id, problem_id, sort) VALUES (?,?,?)', set.id, problem.id, sort);
      added.push(problem.id);
    }
    return ok({ added });
  });

  router.delete('/api/problemsets/:id/problems/:problemId', requireRole('teacher'), (ctx) => {
    run('DELETE FROM problemset_items WHERE problemset_id = ? AND problem_id = ?', toInt(ctx.params.id, '题单ID'), toInt(ctx.params.problemId, '题目ID'));
    return ok({ deleted: ctx.params.problemId });
  });

  router.get('/api/problemsets/:id/progress', (ctx) => {
    if (!ctx.user) throw forbidden();
    const rows = all(
      'SELECT problem_id, status, updated_at FROM problemset_progress WHERE problemset_id = ? AND user_id = ?',
      toInt(ctx.params.id, '题单ID'), ctx.user.id,
    );
    return ok(rows);
  });
}
