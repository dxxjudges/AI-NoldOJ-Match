import { all, get, run } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { forbidden, notFound, badRequest } from '../utils/errors.js';
import { ok } from '../http/context.js';
import { requireFields, toInt } from './helpers.js';
import { canView } from '../services/visibility.js';

function buildTree(problemId) {
  const rows = all(
    `SELECT d.*, u.role AS author_role FROM discussions d
       LEFT JOIN users u ON u.id = d.author_id
      WHERE d.problem_id = ? AND d.deleted = 0
      ORDER BY d.pinned DESC, d.is_official DESC, d.id ASC`,
    problemId,
  );
  const roots = [];
  const map = new Map();
  for (const row of rows) {
    const node = { ...row, pinned: Boolean(row.pinned), locked: Boolean(row.locked), is_official: Boolean(row.is_official), replies: [] };
    map.set(row.id, node);
  }
  for (const row of rows) {
    const node = map.get(row.id);
    if (row.parent_id && map.has(row.parent_id)) map.get(row.parent_id).replies.push(node);
    else roots.push(node);
  }
  return roots;
}

export default function registerDiscussions(router) {
  router.get('/api/problems/:id/discussions', (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    if (!canView('problem', ctx.user, problem)) throw forbidden();
    return ok(buildTree(problem.id));
  });

  router.post('/api/discussions', (ctx) => {
    if (!ctx.user) throw forbidden('请先登录');
    requireFields(ctx.body, ['problem_id', 'content']);
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.body.problem_id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    if (!canView('problem', ctx.user, problem)) throw forbidden();
    const content = String(ctx.body.content).slice(0, 10000);
    let parentId = null;
    if (ctx.body.parent_id) {
      const parent = get('SELECT * FROM discussions WHERE id = ?', toInt(ctx.body.parent_id, '父帖ID'));
      if (parent) parentId = parent.parent_id || parent.id; // flatten to 2 levels
      if (parent && parent.locked) throw badRequest('该讨论已被锁定');
    }
    const info = run(
      'INSERT INTO discussions (problem_id, author_id, author_name, parent_id, content) VALUES (?,?,?,?,?)',
      problem.id, ctx.user.id, ctx.user.username, parentId, content,
    );
    return ok(get('SELECT * FROM discussions WHERE id = ?', Number(info.lastInsertRowid)));
  });

  router.put('/api/discussions/:id', (ctx) => {
    if (!ctx.user) throw forbidden();
    const row = get('SELECT * FROM discussions WHERE id = ?', toInt(ctx.params.id, '讨论ID'));
    if (!row) throw notFound('讨论不存在');
    if (row.author_id !== ctx.user.id && !isAtLeast(ctx.user, 'admin')) throw forbidden();
    if (row.locked && !isAtLeast(ctx.user, 'teacher')) throw badRequest('讨论已锁定');
    run("UPDATE discussions SET content = ?, updated_at = datetime('now') WHERE id = ?", String(ctx.body.content || '').slice(0, 10000), row.id);
    return ok(get('SELECT * FROM discussions WHERE id = ?', row.id));
  });

  router.delete('/api/discussions/:id', (ctx) => {
    if (!ctx.user) throw forbidden();
    const row = get('SELECT * FROM discussions WHERE id = ?', toInt(ctx.params.id, '讨论ID'));
    if (!row) throw notFound('讨论不存在');
    if (row.author_id !== ctx.user.id && !isAtLeast(ctx.user, 'admin')) throw forbidden();
    run('UPDATE discussions SET deleted = 1 WHERE id = ?', row.id);
    return ok({ deleted: row.id });
  });

  router.post('/api/discussions/:id/pin', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM discussions WHERE id = ?', toInt(ctx.params.id, '讨论ID'));
    if (!row) throw notFound('讨论不存在');
    run('UPDATE discussions SET pinned = ? WHERE id = ?', row.pinned ? 0 : 1, row.id);
    return ok({ pinned: !row.pinned });
  });

  router.post('/api/discussions/:id/lock', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM discussions WHERE id = ?', toInt(ctx.params.id, '讨论ID'));
    if (!row) throw notFound('讨论不存在');
    run('UPDATE discussions SET locked = ? WHERE id = ?', row.locked ? 0 : 1, row.id);
    return ok({ locked: !row.locked });
  });

  router.post('/api/discussions/:id/official', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM discussions WHERE id = ?', toInt(ctx.params.id, '讨论ID'));
    if (!row) throw notFound('讨论不存在');
    if (row.parent_id) throw badRequest('只能将顶层讨论标记为官方题解');
    run('UPDATE discussions SET is_official = ? WHERE id = ?', row.is_official ? 0 : 1, row.id);
    return ok({ is_official: !row.is_official });
  });
}
