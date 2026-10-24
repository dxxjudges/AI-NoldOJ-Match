const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { one, all, run } = require('../db/db');
const { requireAuth, requireMin, canManage } = require('../utils/middleware');
const visibility = require('../services/visibility');
const tools = require('../ai/tools');

const router = express.Router();
const ROLE = { teacher: 'teacher' };

// ---------- list ----------
router.get('/problems', (req, res) => {
  const { tag, difficulty, search, page = 1, pageSize = 30, showAll = '' } = req.query;
  let rows = all(`
    SELECT p.id, p.title, p.difficulty, p.is_public, p.author_id, p.accepted_count, p.submit_count,
           p.time_limit_ms, p.memory_limit_mb,
           (SELECT COUNT(*) FROM submissions s WHERE s.problem_id=p.id AND s.status='ac') total_ac
    FROM problems p ORDER BY p.id ASC`);
  // visibility filter: private problems only for author/teacher+/group members
  rows = rows.filter(p => {
    if (p.is_public) return true;
    if (!req.user) return false;
    const u = req.user;
    if (u.role === 'admin' || u.role === 'super' || u.id === p.author_id) return true;
    const bound = visibility.visibleGroupIdsForEntity('problem', p.id);
    if (!bound.length) return false;
    const mine = new Set(visibility.userGroupIds(u.id).map(String));
    return bound.some(g => mine.has(String(g)));
  });
  // tag filter
  if (tag) {
    rows = rows.filter(p => one(
      `SELECT 1 FROM problem_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.problem_id=? AND t.name=?`, p.id, tag));
  }
  if (difficulty !== undefined && difficulty !== '') rows = rows.filter(p => p.difficulty === Number(difficulty));
  if (search) {
    const key = normalizeSpaces(search).toLowerCase();
    rows = rows.filter(p => normalizeSpaces(p.title).toLowerCase().includes(key) || String(p.id) === key);
  }
  const wantManage = showAll === '1' && req.user && ['teacher', 'admin', 'super'].includes(req.user.role);
  if (wantManage) {
    // managed view: all problems visible to teacher+
  }
  const total = rows.length;
  const pageN = Math.max(1, Number(page));
  const size = Math.min(100, Math.max(5, Number(pageSize) || 30));
  res.json({ ok: true, data: { total, page: pageN, pageSize: size, items: rows.slice((pageN - 1) * size, pageN * size) } });
});

function normalizeSpaces(s) { return String(s || '').replace(/\s+/g, ''); }

// solved state for current user
function solvedMapFor(userId, problemIds) {
  if (!userId || !problemIds.length) return {};
  const marks = all(
    `SELECT DISTINCT problem_id FROM submissions WHERE user_id=? AND status='ac' AND problem_id IN (${problemIds.map(() => '?').join(',')})`,
    userId, ...problemIds);
  return Object.fromEntries(marks.map(r => [r.problem_id, 1]));
}

router.get('/problems/:id', (req, res) => {
  const p = one(`SELECT * FROM problems WHERE id=?`, req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  if (visibility.problemForbiddenFor(req.user, p)) {
    if (!req.user) return res.status(401).json({ ok: false, error: 'This problem is not public, please log in first' });
    return res.status(403).json({ ok: false, error: 'No permission to view this private problem' });
  }
  const tags = all(`SELECT t.* FROM tags t JOIN problem_tags pt ON pt.tag_id=t.id WHERE pt.problem_id=?`, p.id);
  const samples = all(`SELECT * FROM problem_samples WHERE problem_id=? ORDER BY ord, id`, p.id);
  const myFav = req.user ? !!one(`SELECT 1 FROM favorites WHERE user_id=? AND problem_id=?`, req.user.id, p.id) : false;
  const canManage = !!(req.user && ['teacher', 'admin', 'super'].includes(req.user.role));
  const testcaseCount = canManage ? one(`SELECT COUNT(*) c FROM testcases WHERE problem_id=?`, p.id)?.c || 0 : undefined;
  // hidden fields for non-managers
  const base = { ...p };
  delete base.copy_md;
  res.json({
    ok: true,
    data: {
      problem: base, tags, samples, favorite: myFav, canManage, testcaseCount,
      solved: !!(req.user && one(`SELECT 1 FROM submissions WHERE user_id=? AND problem_id=? AND status='ac' LIMIT 1`, req.user.id, p.id))
    }
  });
});

function assertManageable(id, req) {
  const p = one(`SELECT * FROM problems WHERE id=?`, id);
  if (!p) return null;
  if (!req.user || !['teacher', 'admin', 'super'].includes(req.user.role)) return null;
  return p;
}

// ---------- CRUD ----------
router.post('/problems', requireMin('teacher'), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ ok: false, error: 'Title cannot be empty' });
  const info = run(
    `INSERT INTO problems (title, description_md, input_md, output_md, hint_md, author_id, is_public, difficulty,
       compare_mode, float_tolerance, time_limit_ms, memory_limit_mb, judge_mode, score_script, copy_md, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    b.title, b.descriptionMd || b.description_md || '', b.inputMd || b.input_md || '', b.outputMd || b.output_md || '',
    b.hintMd || b.hint_md || '', req.user.id,
    b.isPublic === false || b.is_public === false ? 0 : 1,
    Math.max(0, Math.min(5, Number(b.difficulty) || 0)),
    ['strict', 'loose', 'float', 'spj'].includes(b.compareMode || b.compare_mode) ? (b.compareMode || b.compare_mode) : 'loose',
    Number(b.floatTolerance) >= 0 ? Number(b.floatTolerance) : 0.000001,
    Math.max(100, Number(b.timeLimitMs) || 1000),
    Math.max(8, Number(b.memoryLimitMb) || 256),
    b.judgeMode === 'custom' ? 'custom' : 'default',
    b.scoreScript || b.score_script || '',
    b.copyMd || b.copy_md || '',
    Date.now());
  applyTags(info.lastInsertRowid, b.tagIds || []);
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.put('/problems/:id', requireMin('teacher'), (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist or is not manageable' });
  const b = req.body || {};
  run(
    `UPDATE problems SET title=?, description_md=?, input_md=?, output_md=?, hint_md=?, is_public=?, difficulty=?,
       compare_mode=?, float_tolerance=?, time_limit_ms=?, memory_limit_mb=?, judge_mode=?, score_script=?, copy_md=?
     WHERE id=?`,
    b.title !== undefined ? b.title : p.title,
    b.descriptionMd !== undefined ? b.descriptionMd : p.description_md,
    b.inputMd !== undefined ? b.inputMd : p.input_md,
    b.outputMd !== undefined ? b.outputMd : p.output_md,
    b.hintMd !== undefined ? b.hintMd : p.hint_md,
    b.isPublic !== undefined ? (b.isPublic ? 1 : 0) : p.is_public,
    b.difficulty !== undefined ? Math.max(0, Math.min(5, Number(b.difficulty))) : p.difficulty,
    b.compareMode !== undefined ? b.compareMode : p.compare_mode,
    b.floatTolerance !== undefined ? Number(b.floatTolerance) : p.float_tolerance,
    b.timeLimitMs !== undefined ? Math.max(100, Number(b.timeLimitMs)) : p.time_limit_ms,
    b.memoryLimitMb !== undefined ? Math.max(8, Number(b.memoryLimitMb)) : p.memory_limit_mb,
    b.judgeMode !== undefined ? b.judgeMode : p.judge_mode,
    b.scoreScript !== undefined ? b.scoreScript : p.score_script,
    b.copyMd !== undefined ? b.copyMd : p.copy_md,
    p.id);
  if (b.tagIds) applyTags(p.id, b.tagIds);
  res.json({ ok: true });
});

router.delete('/problems/:id', requireMin('teacher'), (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist or is not manageable' });
  // delete cascades; the freed problem id can be reused by new problems (no AUTOINCREMENT)
  run(`DELETE FROM problems WHERE id=?`, p.id);
  run(`DELETE FROM problem_tags WHERE problem_id=?`, p.id);
  run(`DELETE FROM problem_samples WHERE problem_id=?`, p.id);
  run(`DELETE FROM testcase_groups WHERE problem_id=?`, p.id);
  const tcs = all(`SELECT * FROM testcases WHERE problem_id=?`, p.id);
  for (const tc of tcs) {
    for (const f of [path.join(config.abs.testdataDir, String(p.id), tc.input_path), path.join(config.abs.testdataDir, String(p.id), tc.output_path)]) {
      try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
    }
  }
  run(`DELETE FROM testcases WHERE problem_id=?`, p.id);
  run(`DELETE FROM favorites WHERE problem_id=?`, p.id);
  res.json({ ok: true });
});

function applyTags(problemId, tagIds) {
  run(`DELETE FROM problem_tags WHERE problem_id=?`, problemId);
  for (const tid of tagIds) run(`INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?,?)`, problemId, tid);
}

// ---------- samples ----------
router.post('/problems/:id/samples', requireMin('teacher'), (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const b = req.body || {};
  const many = Array.isArray(b.samples) ? b.samples : [b];
  for (const s of many) {
    run(`INSERT INTO problem_samples (problem_id, ord, input, output) VALUES (?,?,?,?)`,
      p.id, Number(s.ord) || 0, String(s.input || ''), String(s.output || ''));
  }
  res.json({ ok: true, data: { added: many.length } });
});
router.delete('/problems/:id/samples/:sampleId', requireMin('teacher'), (req, res) => {
  run(`DELETE FROM problem_samples WHERE id=? AND problem_id=?`, req.params.sampleId, req.params.id);
  res.json({ ok: true });
});

// ---------- testcases (combined view) ----------
router.get('/problems/:id/testcases', requireMin('teacher'), (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const tcs = all(`SELECT * FROM testcases WHERE problem_id=? ORDER BY group_id IS NULL, group_id, ord, id`, p.id).map(tc => {
    let input = '', output = '';
    try { input = fs.readFileSync(path.join(config.abs.testdataDir, String(p.id), tc.input_path), 'utf8').slice(0, 8000); } catch { }
    try { output = fs.readFileSync(path.join(config.abs.testdataDir, String(p.id), tc.output_path), 'utf8').slice(0, 8000); } catch { }
    return { ...tc, input, output };
  });
  const groups = all(`SELECT * FROM testcase_groups WHERE problem_id=? ORDER BY ord, id`, p.id);
  res.json({ ok: true, data: { testcases: tcs, groups } });
});

router.post('/problems/:id/testcases', requireMin('teacher'), (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const b = req.body || {};
  const list = Array.isArray(b.cases) ? b.cases : [b];
  const dir = path.join(config.abs.testdataDir, String(p.id));
  fs.mkdirSync(dir, { recursive: true });
  let ord = (one(`SELECT COUNT(*) c FROM testcases WHERE problem_id=?`, p.id)?.c || 0);
  for (const c of list) {
    const inName = `t_${Date.now()}_${ord}.in`, outName = `t_${Date.now()}_${ord}.out`;
    fs.writeFileSync(path.join(dir, inName), String(c.input || ''), 'utf8');
    fs.writeFileSync(path.join(dir, outName), String(c.output || ''), 'utf8');
    run(`INSERT INTO testcases (problem_id, group_id, ord, input_path, output_path, score, time_limit_ms, memory_limit_mb, float_tolerance, is_sample, visible)
         VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
      p.id, c.groupId || c.group_id || null, ord++,
      inName, outName,
      Number(c.score) >= 0 ? Number(c.score) : 10,
      c.timeLimitMs ? Number(c.timeLimitMs) : null,
      c.memoryLimitMb ? Number(c.memoryLimitMb) : null,
      c.floatTolerance !== undefined && c.floatTolerance !== '' ? Number(c.floatTolerance) : null,
      c.isSample ? 1 : 0);
  }
  res.json({ ok: true, data: { added: list.length } });
});

router.put('/problems/:id/testcases/:tcId', requireMin('teacher'), (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const tc = one(`SELECT * FROM testcases WHERE id=? AND problem_id=?`, req.params.tcId, p.id);
  if (!tc) return res.status(404).json({ ok: false, error: 'Test case does not exist' });
  const b = req.body || {};
  const dir = path.join(config.abs.testdataDir, String(p.id));
  if (b.input !== undefined) fs.writeFileSync(path.join(dir, tc.input_path), String(b.input || ''), 'utf8');
  if (b.output !== undefined) fs.writeFileSync(path.join(dir, tc.output_path), String(b.output || ''), 'utf8');
  run(`UPDATE testcases SET group_id=?, score=?, is_sample=?, visible=?, time_limit_ms=?, memory_limit_mb=?, float_tolerance=? WHERE id=?`,
    b.groupId !== undefined ? (b.groupId || null) : tc.group_id,
    b.score !== undefined ? Number(b.score) : tc.score,
    b.isSample !== undefined ? (b.isSample ? 1 : 0) : tc.is_sample,
    b.visible !== undefined ? (b.visible ? 1 : 0) : tc.visible,
    b.timeLimitMs !== undefined ? Number(b.timeLimitMs) || null : tc.time_limit_ms,
    b.memoryLimitMb !== undefined ? Number(b.memoryLimitMb) || null : tc.memory_limit_mb,
    b.floatTolerance !== undefined ? (b.floatTolerance === null || b.floatTolerance === '' ? null : Number(b.floatTolerance)) : tc.float_tolerance,
    tc.id);
  res.json({ ok: true });
});

router.delete('/problems/:id/testcases/:tcId', requireMin('teacher'), (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const tc = one(`SELECT * FROM testcases WHERE id=? AND problem_id=?`, req.params.tcId, p.id);
  if (!tc) return res.status(404).json({ ok: false, error: 'Test case does not exist' });
  for (const f of [tc.input_path, tc.output_path]) {
    try { fs.rmSync(path.join(config.abs.testdataDir, String(p.id), f), { force: true }); } catch { }
  }
  run(`DELETE FROM testcases WHERE id=?`, tc.id);
  res.json({ ok: true });
});

// ---------- groups / subtasks ----------
router.post('/problems/:id/groups', requireMin('teacher'), (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const b = req.body || {};
  const info = run(`INSERT INTO testcase_groups (problem_id, name, score, agg, depends, score_script, ord) VALUES (?,?,?,?,?,?,?)`,
    p.id, b.name || `Group ${Date.now() % 10000}`,
    Number(b.score) >= 0 ? Number(b.score) : 10,
    ['sum', 'min', 'max'].includes(b.agg) ? b.agg : 'min',
    JSON.stringify(b.depends || []),
    b.scoreScript || '', Number(b.ord) || 0);
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});
router.put('/problems/:id/groups/:gid', requireMin('teacher'), (req, res) => {
  run(`UPDATE testcase_groups SET name=?, score=?, agg=?, depends=?, score_script=? WHERE id=? AND problem_id=?`,
    req.body.name, Number(req.body.score) || 0, req.body.agg || 'min',
    JSON.stringify(req.body.depends || []), req.body.scoreScript || '', req.params.gid, req.params.id);
  res.json({ ok: true });
});
router.delete('/problems/:id/groups/:gid', requireMin('teacher'), (req, res) => {
  run(`UPDATE testcases SET group_id=NULL WHERE group_id=?`, req.params.gid);
  run(`DELETE FROM testcase_groups WHERE id=? AND problem_id=?`, req.params.gid, req.params.id);
  res.json({ ok: true });
});

// ---------- AI test data generation ----------
router.post('/problems/:id/ai-testdata', requireMin('teacher'), async (req, res) => {
  const p = assertManageable(req.params.id, req);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  try {
    const r = await tools.generateTestCases(p.id, req.user.id, req.body.normalCount, req.body.edgeCount);
    res.json({ ok: true, data: r });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ---------- favorites ----------
router.post('/problems/:id/favorite', requireAuth, (req, res) => {
  const p = one(`SELECT * FROM problems WHERE id=?`, req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const exists = one(`SELECT 1 FROM favorites WHERE user_id=? AND problem_id=?`, req.user.id, p.id);
  if (exists) run(`DELETE FROM favorites WHERE user_id=? AND problem_id=?`, req.user.id, p.id);
  else run(`INSERT INTO favorites (user_id, problem_id, created_at) VALUES (?,?,?)`, req.user.id, p.id, Date.now());
  res.json({ ok: true, data: { favorite: !exists } });
});

router.get('/favorites/my', requireAuth, (req, res) => {
  const items = all(
    `SELECT p.id, p.title, p.difficulty, f.created_at FROM favorites f JOIN problems p ON p.id=f.problem_id
     WHERE f.user_id=? ORDER BY f.created_at DESC`, req.user.id);
  res.json({ ok: true, data: { items } });
});

// visibility binding for groups handled in admin routes
module.exports = router;
