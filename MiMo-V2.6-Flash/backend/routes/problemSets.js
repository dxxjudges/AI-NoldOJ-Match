'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole, canSee, visibleToGroup } = require('../middleware/auth');
const { str, int, bool } = require('../utils/validate');
const problemset = require('../services/problemset');

const router = express.Router();

router.get('/', (req, res) => {
  const where = [];
  if (!req.user || req.user.role === 'user') where.push('s.is_public = 1');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.all(`SELECT s.* FROM problem_sets s ${whereSql} ORDER BY s.id DESC LIMIT 100`);
  res.json({ items: rows.filter(s => visibleToGroup(req.user, 'problem_set', s.id)) });
});

router.get('/:id', (req, res) => {
  const id = int(req.params.id, 0);
  const s = db.get('SELECT * FROM problem_sets WHERE id = ?', id);
  if (!s) return res.status(404).json({ error: '题单不存在' });
  if (!canSee(req.user, s.is_public) || !visibleToGroup(req.user, 'problem_set', id)) {
    return res.status(403).json({ error: '无权访问' });
  }
  s.problems = db.all(
    `SELECT p.id, p.title, p.difficulty, pi.order_index FROM problem_set_items pi
     JOIN problems p ON p.id = pi.problem_id WHERE pi.set_id = ? ORDER BY pi.order_index`,
    id
  );
  if (req.user) s.progress = problemset.progressFor(req.user.id, id);
  res.json({ set: s });
});

router.post('/', requireAuth, requireRole('teacher'), (req, res) => {
  const t = db.now();
  const info = db.run(
    'INSERT INTO problem_sets (title, description, is_public, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    str(req.body.title, '', 200), str(req.body.description, ''),
    req.body.is_public !== undefined ? (bool(req.body.is_public) ? 1 : 0) : 1,
    req.user.id, t, t
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const s = db.get('SELECT * FROM problem_sets WHERE id = ?', id);
  if (!s) return res.status(404).json({ error: '题单不存在' });
  db.run('UPDATE problem_sets SET title=?, description=?, is_public=?, updated_at=? WHERE id=?',
    str(req.body.title, s.title, 200), str(req.body.description, s.description),
    req.body.is_public !== undefined ? (bool(req.body.is_public) ? 1 : 0) : s.is_public,
    db.now(), id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  db.run('DELETE FROM problem_sets WHERE id = ?', int(req.params.id, 0));
  res.json({ ok: true });
});

// POST /api/problem-sets/:id/problems { problemId }
router.post('/:id/problems', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const pid = int(req.body.problemId, 0);
  if (!db.get('SELECT id FROM problems WHERE id = ?', pid)) return res.status(404).json({ error: '题目不存在' });
  db.run('INSERT OR IGNORE INTO problem_set_items (set_id, problem_id, order_index) VALUES (?,?,?)',
    id, pid, int(req.body.order_index, db.get('SELECT COUNT(*) AS n FROM problem_set_items WHERE set_id=?', id).n));
  res.status(201).json({ ok: true });
});

// DELETE /api/problem-sets/:id/problems/:pid
router.delete('/:id/problems/:pid', requireAuth, requireRole('teacher'), (req, res) => {
  db.run('DELETE FROM problem_set_items WHERE set_id = ? AND problem_id = ?',
    int(req.params.id, 0), int(req.params.pid, 0));
  res.json({ ok: true });
});

// PUT /api/problem-sets/:id/order  { problemIds: [] }
router.put('/:id/order', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const ids = Array.isArray(req.body.problemIds) ? req.body.problemIds.map(Number) : [];
  ids.forEach((pid, i) => db.run('UPDATE problem_set_items SET order_index = ? WHERE set_id = ? AND problem_id = ?', i, id, pid));
  res.json({ ok: true });
});

module.exports = router;
