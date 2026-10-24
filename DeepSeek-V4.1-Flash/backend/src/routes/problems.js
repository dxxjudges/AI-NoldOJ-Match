import { all, get, run, transaction, recycleId } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { paginate, ok } from '../http/context.js';
import { escapeLike, requireFields, toInt } from './helpers.js';
import { canView, visibleEntityIds } from '../services/visibility.js';
import { generateTestData } from '../services/ai.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import config from '../config.js';

function tagsOf(problemId) {
  return all(
    `SELECT t.id, t.name, t.color FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.problem_id = ?`,
    problemId,
  );
}

function attachTags(problem) {
  return { ...problem, tags: tagsOf(problem.id), samples: safeParse(problem.samples, []) };
}

function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function syncTags(problemId, tags) {
  if (tags === undefined) return;
  run('DELETE FROM problem_tags WHERE problem_id = ?', problemId);
  for (const item of tags) {
    let tagId = null;
    if (typeof item === 'number' || /^\d+$/.test(String(item))) {
      tagId = Number(item);
    } else {
      const existing = get('SELECT id FROM tags WHERE name = ?', String(item));
      tagId = existing ? existing.id : Number(run('INSERT INTO tags (name) VALUES (?)', String(item)).lastInsertRowid);
    }
    if (tagId) run('INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)', problemId, tagId);
  }
}

function assertCanEdit(ctx, problem) {
  if (!ctx.user) throw forbidden();
  if (isAtLeast(ctx.user, 'teacher')) return;
  if (problem.author_id === ctx.user.id) return;
  throw forbidden('无权管理该题目');
}

export default function registerProblems(router) {
  router.get('/api/problems', (ctx) => {
    const { page, pageSize, offset } = paginate(ctx);
    const search = ctx.query1('search', '');
    const tag = ctx.query1('tag', '');
    const difficulty = ctx.query1('difficulty', '');
    const category = ctx.query1('category', '');
    const where = [];
    const params = [];

    const visible = visibleEntityIds('problem', ctx.user, 'problems');
    if (visible !== null) {
      if (!visible.length) return ok({ total: 0, page, pageSize, items: [] });
      where.push(`p.id IN (${visible.map(() => '?').join(',')})`);
      params.push(...visible);
    }
    if (search) {
      const normalized = search.replace(/\s+/g, '');
      where.push('(REPLACE(p.title, " ", "") LIKE ? OR p.description LIKE ?)');
      params.push(`%${escapeLike(normalized)}%`, `%${escapeLike(search)}%`);
    }
    if (difficulty) { where.push('p.difficulty = ?'); params.push(Number(difficulty)); }
    if (category) { where.push('p.category = ?'); params.push(category); }
    if (tag) {
      where.push('p.id IN (SELECT pt.problem_id FROM problem_tags pt WHERE pt.tag_id = ?)');
      params.push(Number(tag));
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM problems p ${clause}`, ...params).n;
    const rows = all(
      `SELECT p.* FROM problems p ${clause} ORDER BY p.id LIMIT ? OFFSET ?`,
      ...params, pageSize, offset,
    );
    return ok({ total, page, pageSize, items: rows.map(attachTags) });
  });

  router.post('/api/problems', requireRole('teacher'), (ctx) => {
    requireFields(ctx.body, ['title']);
    const {
      title, description = '', input_format = '', output_format = '', hint = '',
      samples = [], difficulty = 1, category = '', tags, visibility = 'public',
      time_limit_ms = 1000, memory_limit_kb = 262144, comparison_mode = 'strict',
      float_epsilon = 1e-6, scoring_script = '', source = '',
    } = ctx.body;

    const id = recycleId('problems');
    const testdataDir = join(config.core.testdataDir, String(id));
    run(
      `INSERT INTO problems (id, title, description, input_format, output_format, hint, samples,
        difficulty, category, author_id, author_name, visibility, time_limit_ms, memory_limit_kb,
        comparison_mode, float_epsilon, scoring_script, testdata_dir, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, title, description, input_format, output_format, hint, JSON.stringify(samples),
      Number(difficulty) || 1, category, ctx.user.id, ctx.user.username, visibility,
      Number(time_limit_ms) || 1000, Number(memory_limit_kb) || 262144,
      comparison_mode, Number(float_epsilon) || 1e-6, scoring_script, testdataDir, source,
    );
    syncTags(id, tags);
    return ok(attachTags(get('SELECT * FROM problems WHERE id = ?', id)));
  });

  router.get('/api/problems/:id', (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    if (!canView('problem', ctx.user, problem)) throw forbidden('无权访问该题目');
    const data = attachTags(problem);
    data.groups = all('SELECT * FROM problem_groups WHERE problem_id = ? ORDER BY sort, id', problem.id);
    data.testcaseCount = get('SELECT COUNT(*) AS n FROM testcases WHERE problem_id = ?', problem.id).n;
    if (ctx.user) {
      data.favorited = Boolean(get('SELECT 1 FROM favorites WHERE user_id = ? AND problem_id = ?', ctx.user.id, problem.id));
      data.myStatus = get(
        "SELECT status FROM submissions WHERE user_id = ? AND problem_id = ? ORDER BY id DESC LIMIT 1",
        ctx.user.id, problem.id,
      )?.status || null;
    }
    return ok(data);
  });

  router.put('/api/problems/:id', (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    assertCanEdit(ctx, problem);
    const fields = [];
    const params = [];
    const editable = ['title', 'description', 'input_format', 'output_format', 'hint', 'difficulty',
      'category', 'visibility', 'time_limit_ms', 'memory_limit_kb', 'comparison_mode', 'float_epsilon',
      'scoring_script', 'source'];
    for (const key of editable) {
      if (ctx.body[key] !== undefined) { fields.push(`${key} = ?`); params.push(ctx.body[key]); }
    }
    if (ctx.body.samples !== undefined) { fields.push('samples = ?'); params.push(JSON.stringify(ctx.body.samples)); }
    if (fields.length) {
      fields.push("updated_at = datetime('now')");
      params.push(problem.id);
      run(`UPDATE problems SET ${fields.join(', ')} WHERE id = ?`, ...params);
    }
    if (ctx.body.tags !== undefined) syncTags(problem.id, ctx.body.tags);
    return ok(attachTags(get('SELECT * FROM problems WHERE id = ?', problem.id)));
  });

  router.delete('/api/problems/:id', (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    assertCanEdit(ctx, problem);
    run('DELETE FROM problems WHERE id = ?', problem.id);
    return ok({ deleted: problem.id });
  });

  // ---- Test cases ----
  router.get('/api/problems/:id/testcases', (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    assertCanEdit(ctx, problem);
    return ok(all('SELECT * FROM testcases WHERE problem_id = ? ORDER BY sort, id', problem.id));
  });

  router.post('/api/problems/:id/testcases', (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    assertCanEdit(ctx, problem);
    const { input = '', output = '', score = 0, group_id = null, is_sample = 0 } = ctx.body;
    const sort = get('SELECT COALESCE(MAX(sort),0)+1 AS s FROM testcases WHERE problem_id = ?', problem.id).s;
    const info = run(
      'INSERT INTO testcases (problem_id, group_id, input, output, score, is_sample, sort) VALUES (?,?,?,?,?,?,?)',
      problem.id, group_id, input, output, Number(score) || 0, is_sample ? 1 : 0, sort,
    );
    return ok(get('SELECT * FROM testcases WHERE id = ?', Number(info.lastInsertRowid)));
  });

  router.post('/api/problems/:id/testcases/batch', (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    assertCanEdit(ctx, problem);
    const cases = Array.isArray(ctx.body.cases) ? ctx.body.cases : [];
    let sort = get('SELECT COALESCE(MAX(sort),0) AS s FROM testcases WHERE problem_id = ?', problem.id).s;
    const created = [];
    transaction(() => {
      for (const item of cases) {
        sort += 1;
        const info = run(
          'INSERT INTO testcases (problem_id, group_id, input, output, score, is_sample, sort) VALUES (?,?,?,?,?,?,?)',
          problem.id, item.group_id || null, item.input || '', item.output || '', Number(item.score) || 0, item.is_sample ? 1 : 0, sort,
        );
        created.push(Number(info.lastInsertRowid));
      }
    });
    return ok({ created });
  });

  router.put('/api/testcases/:id', (ctx) => {
    const tc = get('SELECT * FROM testcases WHERE id = ?', toInt(ctx.params.id, '测试点ID'));
    if (!tc) throw notFound('测试点不存在');
    const problem = get('SELECT * FROM problems WHERE id = ?', tc.problem_id);
    assertCanEdit(ctx, problem);
    const { input, output, score, group_id, is_sample, sort } = ctx.body;
    const fields = [];
    const params = [];
    if (input !== undefined) { fields.push('input = ?'); params.push(input); }
    if (output !== undefined) { fields.push('output = ?'); params.push(output); }
    if (score !== undefined) { fields.push('score = ?'); params.push(Number(score) || 0); }
    if (group_id !== undefined) { fields.push('group_id = ?'); params.push(group_id); }
    if (is_sample !== undefined) { fields.push('is_sample = ?'); params.push(is_sample ? 1 : 0); }
    if (sort !== undefined) { fields.push('sort = ?'); params.push(toInt(sort, '排序')); }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(tc.id);
    run(`UPDATE testcases SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(get('SELECT * FROM testcases WHERE id = ?', tc.id));
  });

  router.delete('/api/testcases/:id', (ctx) => {
    const tc = get('SELECT * FROM testcases WHERE id = ?', toInt(ctx.params.id, '测试点ID'));
    if (!tc) throw notFound('测试点不存在');
    const problem = get('SELECT * FROM problems WHERE id = ?', tc.problem_id);
    assertCanEdit(ctx, problem);
    run('DELETE FROM testcases WHERE id = ?', tc.id);
    return ok({ deleted: tc.id });
  });

  // ---- Groups (subtasks) ----
  router.post('/api/problems/:id/groups', (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    assertCanEdit(ctx, problem);
    const { name = '', full_score = 100, aggregation = 'sum', dependencies = [], scoring_script = '' } = ctx.body;
    const sort = get('SELECT COALESCE(MAX(sort),0)+1 AS s FROM problem_groups WHERE problem_id = ?', problem.id).s;
    const info = run(
      'INSERT INTO problem_groups (problem_id, name, full_score, aggregation, dependencies, scoring_script, sort) VALUES (?,?,?,?,?,?,?)',
      problem.id, name, Number(full_score) || 0, aggregation, JSON.stringify(dependencies), scoring_script, sort,
    );
    return ok(get('SELECT * FROM problem_groups WHERE id = ?', Number(info.lastInsertRowid)));
  });

  router.put('/api/problem-groups/:id', (ctx) => {
    const group = get('SELECT * FROM problem_groups WHERE id = ?', toInt(ctx.params.id, '分组ID'));
    if (!group) throw notFound('分组不存在');
    const problem = get('SELECT * FROM problems WHERE id = ?', group.problem_id);
    assertCanEdit(ctx, problem);
    const { name, full_score, aggregation, dependencies, scoring_script, sort } = ctx.body;
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (full_score !== undefined) { fields.push('full_score = ?'); params.push(Number(full_score) || 0); }
    if (aggregation !== undefined) { fields.push('aggregation = ?'); params.push(aggregation); }
    if (dependencies !== undefined) { fields.push('dependencies = ?'); params.push(JSON.stringify(dependencies)); }
    if (scoring_script !== undefined) { fields.push('scoring_script = ?'); params.push(scoring_script); }
    if (sort !== undefined) { fields.push('sort = ?'); params.push(toInt(sort, '排序')); }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(group.id);
    run(`UPDATE problem_groups SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(get('SELECT * FROM problem_groups WHERE id = ?', group.id));
  });

  router.delete('/api/problem-groups/:id', (ctx) => {
    const group = get('SELECT * FROM problem_groups WHERE id = ?', toInt(ctx.params.id, '分组ID'));
    if (!group) throw notFound('分组不存在');
    const problem = get('SELECT * FROM problems WHERE id = ?', group.problem_id);
    assertCanEdit(ctx, problem);
    run('DELETE FROM problem_groups WHERE id = ?', group.id);
    return ok({ deleted: group.id });
  });

  // ---- AI test data generation ----
  router.post('/api/problems/:id/generate-testdata', requireRole('teacher'), async (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    const normalCount = Math.min(10, Math.max(1, toInt(ctx.body.normalCount ?? 3, '普通用例数')));
    const edgeCount = Math.min(10, Math.max(0, toInt(ctx.body.edgeCount ?? 1, '边界用例数')));
    const cases = await generateTestData({
      title: problem.title,
      description: problem.description,
      normalCount,
      edgeCount,
    });
    const dir = problem.testdata_dir || join(config.core.testdataDir, String(problem.id));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const created = [];
    let sort = get('SELECT COALESCE(MAX(sort),0) AS s FROM testcases WHERE problem_id = ?', problem.id).s;
    for (let i = 0; i < cases.length; i += 1) {
      const item = cases[i];
      sort += 1;
      writeFileSync(join(dir, `${sort}.in`), item.input);
      writeFileSync(join(dir, `${sort}.out`), item.output);
      const info = run(
        'INSERT INTO testcases (problem_id, input, output, score, sort) VALUES (?,?,?,?,?)',
        problem.id, item.input, item.output, 0, sort,
      );
      created.push(Number(info.lastInsertRowid));
    }
    return ok({ created, generated: cases.length });
  });

  // ---- Group visibility binding ----
  router.post('/api/problems/:id/visibility', requireRole('teacher'), (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    assertCanEdit(ctx, problem);
    const groupIds = Array.isArray(ctx.body.groupIds) ? ctx.body.groupIds : [];
    run("DELETE FROM group_visibility WHERE entity_type = 'problem' AND entity_id = ?", problem.id);
    for (const gid of groupIds) {
      run("INSERT OR IGNORE INTO group_visibility (group_id, entity_type, entity_id) VALUES (?, 'problem', ?)", Number(gid), problem.id);
    }
    run('UPDATE problems SET visibility = ? WHERE id = ?', groupIds.length ? 'private' : 'public', problem.id);
    return ok({ groupIds, visibility: groupIds.length ? 'private' : 'public' });
  });
}
