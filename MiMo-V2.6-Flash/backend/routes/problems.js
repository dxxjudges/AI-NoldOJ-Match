'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole, canSee, visibleToGroup } = require('../middleware/auth');
const { str, int, bool, parseJson } = require('../utils/validate');

const router = express.Router();

const DIFFICULTIES = ['entry', 'basic', 'medium', 'hard', 'advanced', 'expert'];

function problemRow(p) {
  if (!p) return null;
  return {
    ...p,
    samples: parseJson(p.samples, []),
  };
}

function loadTags(problemId) {
  return db.all(
    'SELECT t.id, t.name, t.color FROM tags t JOIN problem_tags pt ON pt.tag_id = t.id WHERE pt.problem_id = ?',
    problemId
  );
}

// GET /api/problems?keyword=&tag=&difficulty=&category=&page=&pageSize=
router.get('/', (req, res) => {
  const page = Math.max(1, int(req.query.page, 1));
  const pageSize = Math.min(100, Math.max(1, int(req.query.pageSize, 20)));
  const keyword = str(req.query.keyword, '', 100).replace(/\s+/g, '');
  const difficulty = str(req.query.difficulty, '', 20);
  const tag = str(req.query.tag, '', 50);
  const category = str(req.query.category, '', 50);

  const where = [];
  const params = [];
  // visibility: public OR (teacher+ and bound groups)
  if (!req.user || (req.user.role === 'user')) {
    where.push('p.is_public = 1');
  }
  if (keyword) {
    where.push("(replace(p.title,' ','') LIKE ? OR replace(p.description,' ','') LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (difficulty && DIFFICULTIES.includes(difficulty)) {
    where.push('p.difficulty = ?'); params.push(difficulty);
  }
  if (category) { where.push('p.category = ?'); params.push(category); }
  if (tag) {
    where.push('p.id IN (SELECT pt.problem_id FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?)');
    params.push(tag);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM problems p ${whereSql}`, ...params).n;
  const rows = db.all(
    `SELECT p.* FROM problems p ${whereSql} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  );
  const items = rows.filter(p => visibleToGroup(req.user, 'problem', p.id)).map(problemRow);
  res.json({ items, total: Number(total), page, pageSize });
});

// GET /api/problems/tags
router.get('/tags', (req, res) => {
  res.json({ items: db.all('SELECT * FROM tags ORDER BY id') });
});

// GET /api/problems/:id
router.get('/:id', (req, res) => {
  const id = int(req.params.id, 0);
  const p = db.get('SELECT * FROM problems WHERE id = ?', id);
  if (!p) return res.status(404).json({ error: '题目不存在' });
  if (!canSee(req.user, p.is_public) || !visibleToGroup(req.user, 'problem', id)) {
    return res.status(403).json({ error: '无权访问该题目' });
  }
  const out = problemRow(p);
  out.tags = loadTags(id);
  // samples list from test cases marked as sample
  const sampleCases = db.all('SELECT id, case_index, input_path, output_path FROM test_cases WHERE problem_id = ? AND is_sample = 1 ORDER BY case_index', id);
  out.sample_cases = sampleCases.map(c => ({
    id: c.id, index: c.case_index,
    input: safeRead(c.input_path), output: safeRead(c.output_path),
  }));
  out.favorited = req.user
    ? !!db.get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND problem_id = ?', req.user.id, id)
    : false;
  res.json({ problem: out });
});

function safeRead(p) {
  try { return require('fs').readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

// POST /api/problems  (teacher+)
router.post('/', requireAuth, requireRole('teacher'), (req, res) => {
  const t = db.now();
  const title = str(req.body.title, '', 200);
  if (!title) return res.status(400).json({ error: '标题不能为空' });
  const difficulty = DIFFICULTIES.includes(req.body.difficulty) ? req.body.difficulty : 'entry';
  const id = db.tx(() => {
    const pid = db.allocId('problem_id_pool', 1000, 'problems');
    db.run(
      `INSERT INTO problems (id,title,author,description,input_format,output_format,samples,hint,difficulty,category,
        time_limit_ms,memory_limit_mb,output_limit_kb,stack_limit_mb,is_public,scoring_script,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      pid, title, str(req.body.author, '', 64),
      str(req.body.description, ''), str(req.body.input_format, ''), str(req.body.output_format, ''),
      JSON.stringify(req.body.samples || []), str(req.body.hint, ''), difficulty, str(req.body.category, '', 50),
      int(req.body.time_limit_ms, 2000), int(req.body.memory_limit_mb, 256),
      int(req.body.output_limit_kb, 65536), int(req.body.stack_limit_mb, 64),
      bool(req.body.is_public) ? 1 : 0, str(req.body.scoring_script, ''),
      req.user.id, t, t
    );
    if (Array.isArray(req.body.tags)) {
      for (const name of req.body.tags) {
        let tag = db.get('SELECT id FROM tags WHERE name = ?', String(name));
        if (!tag) {
          db.run('INSERT INTO tags (name) VALUES (?)', String(name));
          tag = db.get('SELECT id FROM tags WHERE name = ?', String(name));
        }
        db.run('INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?,?)', pid, tag.id);
      }
    }
    // default single group
    db.run(
      'INSERT INTO test_groups (problem_id, name, full_score, aggregation, order_index) VALUES (?,?,?,?,0)',
      pid, '测试点 1', 100, 'sum'
    );
    return pid;
  });
  res.status(201).json({ id });
});

// PUT /api/problems/:id  (teacher+)
router.put('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const p = db.get('SELECT * FROM problems WHERE id = ?', id);
  if (!p) return res.status(404).json({ error: '题目不存在' });
  const t = db.now();
  const difficulty = DIFFICULTIES.includes(req.body.difficulty) ? req.body.difficulty : p.difficulty;
  db.run(
    `UPDATE problems SET title=?,author=?,description=?,input_format=?,output_format=?,samples=?,hint=?,difficulty=?,category=?,
      time_limit_ms=?,memory_limit_mb=?,output_limit_kb=?,stack_limit_mb=?,is_public=?,scoring_script=?,updated_at=?
     WHERE id=?`,
    str(req.body.title, p.title, 200), str(req.body.author, p.author, 64),
    str(req.body.description, p.description), str(req.body.input_format, p.input_format),
    str(req.body.output_format, p.output_format),
    JSON.stringify(req.body.samples ?? parseJson(p.samples, [])),
    str(req.body.hint, p.hint), difficulty, str(req.body.category, p.category, 50),
    int(req.body.time_limit_ms, p.time_limit_ms), int(req.body.memory_limit_mb, p.memory_limit_mb),
    int(req.body.output_limit_kb, p.output_limit_kb), int(req.body.stack_limit_mb, p.stack_limit_mb),
    req.body.is_public !== undefined ? (bool(req.body.is_public) ? 1 : 0) : p.is_public,
    str(req.body.scoring_script, p.scoring_script), t, id
  );
  if (Array.isArray(req.body.tags)) {
    db.run('DELETE FROM problem_tags WHERE problem_id = ?', id);
    for (const name of req.body.tags) {
      let tag = db.get('SELECT id FROM tags WHERE name = ?', String(name));
      if (!tag) {
        db.run('INSERT INTO tags (name) VALUES (?)', String(name));
        tag = db.get('SELECT id FROM tags WHERE name = ?', String(name));
      }
      db.run('INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?,?)', id, tag.id);
    }
  }
  res.json({ ok: true });
});

// DELETE /api/problems/:id  (teacher+), ids recycled
router.delete('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const p = db.get('SELECT * FROM problems WHERE id = ?', id);
  if (!p) return res.status(404).json({ error: '题目不存在' });
  db.tx(() => {
    db.run('DELETE FROM problems WHERE id = ?', id);
    db.run('INSERT OR IGNORE INTO problem_id_pool (id) VALUES (?)', id);
  });
  res.json({ ok: true });
});

// ---- test groups & cases ----

// GET /api/problems/:id/groups
router.get('/:id/groups', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const groups = db.all('SELECT * FROM test_groups WHERE problem_id = ? ORDER BY order_index, id', id);
  for (const g of groups) {
    g.depends_on = parseJson(g.depends_on, []);
    g.cases = db.all('SELECT * FROM test_cases WHERE group_id = ? ORDER BY case_index', g.id);
  }
  res.json({ items: groups });
});

// POST /api/problems/:id/groups
router.post('/:id/groups', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  if (!db.get('SELECT id FROM problems WHERE id = ?', id)) return res.status(404).json({ error: '题目不存在' });
  const aggregation = ['sum', 'min', 'max', 'avg', 'count_pass'].includes(req.body.aggregation) ? req.body.aggregation : 'sum';
  const info = db.run(
    'INSERT INTO test_groups (problem_id, name, full_score, aggregation, depends_on, scoring_script, order_index) VALUES (?,?,?,?,?,?,?)',
    id, str(req.body.name, '新分组', 100), Number(req.body.full_score) || 100, aggregation,
    JSON.stringify(req.body.depends_on || []), str(req.body.scoring_script, ''),
    int(req.body.order_index, db.get('SELECT COUNT(*) AS n FROM test_groups WHERE problem_id = ?', id).n)
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// POST /api/problems/:id/cases  (inline add)
router.post('/:id/cases', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  if (!db.get('SELECT id FROM problems WHERE id = ?', id)) return res.status(404).json({ error: '题目不存在' });
  const fs = require('fs');
  const path = require('path');
  const { config } = require('../config');
  const dir = path.join(config.paths.testdataDir, String(id));
  fs.mkdirSync(dir, { recursive: true });
  const groups = db.all('SELECT id FROM test_groups WHERE problem_id = ? ORDER BY order_index LIMIT 1', id);
  const groupId = int(req.body.group_id, 0) || (groups[0] ? groups[0].id : null);
  const idx = db.get('SELECT COUNT(*) AS n FROM test_cases WHERE problem_id = ?', id).n;
  const inPath = path.join(dir, `${idx}.in`);
  const outPath = path.join(dir, `${idx}.out`);
  fs.writeFileSync(inPath, str(req.body.input, ''), 'utf8');
  fs.writeFileSync(outPath, str(req.body.output, ''), 'utf8');
  const info = db.run(
    'INSERT INTO test_cases (problem_id, group_id, case_index, input_path, output_path, score, is_sample, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, groupId, idx, inPath, outPath, Number(req.body.score) || 0, bool(req.body.is_sample) ? 1 : 0, db.now()
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// PUT /api/problems/cases/:caseId
router.put('/cases/:caseId', requireAuth, requireRole('teacher'), (req, res) => {
  const caseId = int(req.params.caseId, 0);
  const c = db.get('SELECT * FROM test_cases WHERE id = ?', caseId);
  if (!c) return res.status(404).json({ error: '测试点不存在' });
  if (req.body.input !== undefined) require('fs').writeFileSync(c.input_path, str(req.body.input, ''), 'utf8');
  if (req.body.output !== undefined) require('fs').writeFileSync(c.output_path, str(req.body.output, ''), 'utf8');
  db.run('UPDATE test_cases SET score=?, is_sample=?, group_id=? WHERE id=?',
    Number(req.body.score) || c.score,
    req.body.is_sample !== undefined ? (bool(req.body.is_sample) ? 1 : 0) : c.is_sample,
    req.body.group_id !== undefined ? int(req.body.group_id, 0) || null : c.group_id,
    caseId);
  res.json({ ok: true });
});

// DELETE /api/problems/cases/:caseId
router.delete('/cases/:caseId', requireAuth, requireRole('teacher'), (req, res) => {
  const caseId = int(req.params.caseId, 0);
  const c = db.get('SELECT * FROM test_cases WHERE id = ?', caseId);
  if (!c) return res.status(404).json({ error: '测试点不存在' });
  for (const p of [c.input_path, c.output_path]) {
    try { require('fs').unlinkSync(p); } catch (_) {}
  }
  db.run('DELETE FROM test_cases WHERE id = ?', caseId);
  res.json({ ok: true });
});

module.exports = router;
