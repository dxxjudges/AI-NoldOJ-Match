'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { str, int, bool } = require('../utils/validate');

const router = express.Router();

// GET /api/discussions?problem=
router.get('/', (req, res) => {
  const pid = int(req.query.problem, 0);
  if (!pid) return res.status(400).json({ error: '缺少题目参数' });
  const roots = db.all(
    `SELECT d.*, u.username FROM discussions d JOIN users u ON u.id = d.user_id
     WHERE d.problem_id = ? AND d.parent_id IS NULL
     ORDER BY d.pinned DESC, d.is_official DESC, d.id DESC LIMIT 100`, pid
  );
  for (const r of roots) {
    r.replies = db.all(
      `SELECT d.*, u.username FROM discussions d JOIN users u ON u.id = d.user_id
       WHERE d.parent_id = ? ORDER BY d.id ASC LIMIT 200`, r.id
    );
  }
  res.json({ items: roots });
});

// POST /api/discussions
router.post('/', requireAuth, (req, res) => {
  const pid = int(req.body.problem_id, 0);
  const problem = db.get('SELECT id FROM problems WHERE id = ?', pid);
  if (!problem) return res.status(404).json({ error: '题目不存在' });
  const parentId = int(req.body.parent_id, 0) || null;
  if (parentId) {
    const parent = db.get('SELECT * FROM discussions WHERE id = ?', parentId);
    if (!parent) return res.status(404).json({ error: '父评论不存在' });
    if (parent.parent_id) return res.status(400).json({ error: '仅支持两级回复' });
    if (parent.locked) return res.status(403).json({ error: '该讨论已锁定' });
    // contest lock: if problem is in an ongoing contest, discussions locked
    const ongoing = db.get(
      `SELECT 1 AS x FROM contest_problems cp JOIN contests c ON c.id = cp.contest_id
       WHERE cp.problem_id = ? AND c.start_at <= ? AND c.end_at >= ?`, pid, db.now(), db.now()
    );
    if (ongoing) return res.status(403).json({ error: '比赛进行中，讨论已锁定' });
  }
  const content = str(req.body.content, '', 20000);
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  const t = db.now();
  const info = db.run(
    'INSERT INTO discussions (problem_id, user_id, parent_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    pid, req.user.id, parentId, str(req.body.title, '', 200), content, t, t
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// PUT /api/discussions/:id  (own edit)
router.put('/:id', requireAuth, (req, res) => {
  const id = int(req.params.id, 0);
  const d = db.get('SELECT * FROM discussions WHERE id = ?', id);
  if (!d) return res.status(404).json({ error: '不存在' });
  if (d.user_id !== req.user.id) return res.status(403).json({ error: '只能编辑自己的内容' });
  db.run('UPDATE discussions SET content=?, updated_at=? WHERE id=?',
    str(req.body.content, d.content, 20000), db.now(), id);
  res.json({ ok: true });
});

// POST /api/discussions/:id/pin | /bless | /official  (teacher+)
router.post('/:id/:action', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const col = { pin: 'pinned', bless: 'blessed', official: 'is_official' }[req.params.action];
  if (!col) return res.status(404).json({ error: '操作不存在' });
  const d = db.get('SELECT * FROM discussions WHERE id = ?', id);
  if (!d) return res.status(404).json({ error: '不存在' });
  db.run(`UPDATE discussions SET ${col} = ?, updated_at = ? WHERE id = ?`, d[col] ? 0 : 1, db.now(), id);
  res.json({ ok: true, value: d[col] ? 0 : 1 });
});

// DELETE /api/discussions/:id  (own, or admin any)
router.delete('/:id', requireAuth, (req, res) => {
  const id = int(req.params.id, 0);
  const d = db.get('SELECT * FROM discussions WHERE id = ?', id);
  if (!d) return res.status(404).json({ error: '不存在' });
  const privileged = ['admin', 'super'].includes(req.user.role);
  if (d.user_id !== req.user.id && !privileged) return res.status(403).json({ error: '无权删除' });
  db.run('DELETE FROM discussions WHERE id = ? OR parent_id = ?', id, id);
  res.json({ ok: true });
});

module.exports = router;
