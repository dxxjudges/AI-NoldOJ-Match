'use strict';

const express = require('express');
const db = require('../db/database');
const { config } = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { int } = require('../utils/validate');
const plagiarism = require('../services/plagiarism');

const router = express.Router();

// POST /api/plagiarism/problem/:pid  (teacher+)
router.post('/problem/:pid', requireAuth, requireRole('teacher'), (req, res) => {
  const pid = int(req.params.pid, 0);
  const info = db.run(
    'INSERT INTO plagiarism_jobs (problem_id, status, created_by, created_at) VALUES (?,?,?,?)',
    pid, 'pending', req.user.id, db.now()
  );
  const jobId = Number(info.lastInsertRowid);
  setImmediate(() => plagiarism.runJob(jobId));
  res.status(201).json({ jobId });
});

// POST /api/plagiarism/contest/:cid  (teacher+)
router.post('/contest/:cid', requireAuth, requireRole('teacher'), (req, res) => {
  const cid = int(req.params.cid, 0);
  const info = db.run(
    'INSERT INTO plagiarism_jobs (contest_id, status, created_by, created_at) VALUES (?,?,?,?)',
    cid, 'pending', req.user.id, db.now()
  );
  const jobId = Number(info.lastInsertRowid);
  setImmediate(() => plagiarism.runJob(jobId));
  res.status(201).json({ jobId });
});

// GET /api/plagiarism/job/:id  (progress + results)
router.get('/job/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const job = db.get('SELECT * FROM plagiarism_jobs WHERE id = ?', id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  job.pairs = db.all(
    `SELECT pp.*, sa.user_id AS ua, sb.user_id AS ub, ua.username AS name_a, ub.username AS name_b
     FROM plagiarism_pairs pp
     LEFT JOIN submissions sa ON sa.id = pp.submission_a
     LEFT JOIN submissions sb ON sb.id = pp.submission_b
     LEFT JOIN users ua ON ua.id = sa.user_id
     LEFT JOIN users ub ON ub.id = sb.user_id
     WHERE pp.job_id = ? ORDER BY pp.similarity DESC`, id
  );
  res.json({ job });
});

// GET /api/plagiarism/compare/:a/:b
router.get('/compare/:a/:b', requireAuth, requireRole('teacher'), (req, res) => {
  const a = db.get('SELECT id, user_id, code, language FROM submissions WHERE id = ?', int(req.params.a, 0));
  const b = db.get('SELECT id, user_id, code, language FROM submissions WHERE id = ?', int(req.params.b, 0));
  if (!a || !b) return res.status(404).json({ error: '提交不存在' });
  res.json({
    a: { ...a, tokens: plagiarism.tokensOf(a.code) },
    b: { ...b, tokens: plagiarism.tokensOf(b.code) },
    similarity: plagiarism.similarity(plagiarism.tokensOf(a.code), plagiarism.tokensOf(b.code)),
  });
});

module.exports = router;
