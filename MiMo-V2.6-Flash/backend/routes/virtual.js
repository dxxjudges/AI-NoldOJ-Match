'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { int } = require('../utils/validate');

const router = express.Router();

// POST /api/virtual/:contestId/start  — virtual participation for ended contests
router.post('/:contestId/start', requireAuth, (req, res) => {
  const cid = int(req.params.contestId, 0);
  const c = db.get('SELECT * FROM contests WHERE id = ?', cid);
  if (!c) return res.status(404).json({ error: '比赛不存在' });
  if (db.now() <= c.end_at) return res.status(400).json({ error: '比赛尚未结束，无法虚拟参赛' });
  const existing = db.get('SELECT * FROM virtual_instances WHERE contest_id = ? AND user_id = ?', cid, req.user.id);
  if (existing) return res.status(409).json({ error: '您已虚拟参赛过该比赛', instanceId: existing.id });

  const duration = c.end_at - c.start_at;
  const start = db.now();
  const info = db.run(
    'INSERT INTO virtual_instances (contest_id, user_id, start_at, end_at, created_at) VALUES (?,?,?,?,?)',
    cid, req.user.id, start, start + duration, start
  );
  res.status(201).json({ instanceId: Number(info.lastInsertRowid), startAt: start, endAt: start + duration, durationMs: duration });
});

// GET /api/virtual/:contestId/status
router.get('/:contestId/status', requireAuth, (req, res) => {
  const cid = int(req.params.contestId, 0);
  const v = db.get('SELECT * FROM virtual_instances WHERE contest_id = ? AND user_id = ?', cid, req.user.id);
  if (!v) return res.json({ active: false });
  const now = db.now();
  res.json({
    active: now < v.end_at,
    ended: now >= v.end_at,
    instanceId: v.id,
    startAt: v.start_at,
    endAt: v.end_at,
    remainingMs: Math.max(0, v.end_at - now),
  });
});

// GET /api/virtual/:contestId/board — own virtual board only
router.get('/:contestId/board', requireAuth, (req, res) => {
  const cid = int(req.params.contestId, 0);
  const v = db.get('SELECT * FROM virtual_instances WHERE contest_id = ? AND user_id = ?', cid, req.user.id);
  if (!v) return res.status(404).json({ error: '未虚拟参赛' });
  const problems = db.all('SELECT problem_id, alias, order_index FROM contest_problems WHERE contest_id = ? ORDER BY order_index', cid);
  const subs = db.all(
    'SELECT id, problem_id, status, score, created_at FROM submissions WHERE contest_id = ? AND user_id = ? ORDER BY id',
    cid, req.user.id
  ).filter(s => s.created_at >= v.start_at);
  const cells = {};
  for (const p of problems) {
    const mine = subs.filter(s => s.problem_id === p.problem_id);
    cells[p.problem_id] = {
      attempts: mine.length,
      solved: mine.some(s => s.status === 'accepted'),
      score: mine.filter(s => s.status === 'accepted').reduce((a, s) => a + s.score, 0),
    };
  }
  res.json({ problems, cells, startAt: v.start_at, endAt: v.end_at });
});

module.exports = router;
