const express = require('express');
const { one, all, run } = require('../db/db');
const { requireAuth, requireMin } = require('../utils/middleware');
const plag = require('../services/plagiarism');

const router = express.Router();

router.post('/plagiarism/start', requireMin('teacher'), (req, res) => {
  const { problemId, contestId } = req.body || {};
  if (!problemId && !contestId) return res.status(400).json({ ok: false, error: 'Please specify the problem or contest to check' });
  const info = run(`INSERT INTO plagiarism_reports (problem_id, contest_id, status, progress, total, created_by, created_at)
    VALUES (?,?, 'running', 0, 0, ?, ?)`,
    problemId ? Number(problemId) : null, contestId ? Number(contestId) : null,
    req.user.id, Date.now());
  const reportId = Number(info.lastInsertRowid);
  // async non-blocking
  setImmediate(() => {
    plag.runReport(reportId, problemId ? Number(problemId) : null, contestId ? Number(contestId) : null)
      .catch(e => {
        console.error('[PLAGIARISM] report failed:', e);
        run(`UPDATE plagiarism_reports SET status='error' WHERE id=?`, reportId);
      });
  });
  res.json({ ok: true, data: { reportId } });
});

router.get('/plagiarism/:id', requireMin('teacher'), (req, res) => {
  const r = one(`SELECT * FROM plagiarism_reports WHERE id=?`, req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'Check report does not exist' });
  const pairs = all(`
    SELECT pp.*, ua.username a_name, ub.username b_name FROM plagiarism_pairs pp
    JOIN users ua ON ua.id=pp.user_id_a JOIN users ub ON ub.id=pp.user_id_b
    WHERE pp.report_id=? ORDER BY pp.similarity DESC`, r.id);
  res.json({ ok: true, data: { report: r, pairs } });
});

module.exports = router;
