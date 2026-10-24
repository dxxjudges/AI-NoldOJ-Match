'use strict';

const express = require('express');
const db = require('../db/database');
const { config } = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { str, int, parseJson } = require('../utils/validate');

const router = express.Router();

// GET /api/submissions?user=&problem=&status=&page=
router.get('/', (req, res) => {
  const page = Math.max(1, int(req.query.page, 1));
  const pageSize = Math.min(100, Math.max(1, int(req.query.pageSize, 20)));
  const where = [];
  const params = [];
  if (req.query.user) { where.push('s.user_id = ?'); params.push(int(req.query.user, 0)); }
  if (req.query.username) {
    where.push('s.user_id = (SELECT id FROM users WHERE username = ?)');
    params.push(str(req.query.username, '', 64));
  }
  if (req.query.problem) { where.push('s.problem_id = ?'); params.push(int(req.query.problem, 0)); }
  if (req.query.status) { where.push('s.status = ?'); params.push(str(req.query.status, '', 30)); }
  // non-teacher only sees public problems' submissions (simple filter)
  if (!req.user || req.user.role === 'user') {
    where.push("(s.contest_id IS NULL OR s.contest_id IN (SELECT id FROM contests WHERE is_public = 1))");
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM submissions s ${whereSql}`, ...params).n;
  const rows = db.all(
    `SELECT s.id, s.user_id, s.problem_id, s.contest_id, s.language, s.status, s.score, s.time_ms, s.memory_kb, s.created_at, s.judged_at,
            u.username, p.title AS problem_title
     FROM submissions s JOIN users u ON u.id = s.user_id JOIN problems p ON p.id = s.problem_id
     ${whereSql} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  );
  res.json({ items: rows.map(r => ({ ...r, queue_position: r.status === 'pending' || r.status === 'queued' ? undefined : undefined })), total: Number(total), page, pageSize });
});

// POST /api/submissions
router.post('/', requireAuth, rateLimit('submit', config.security.submitRateLimit.windowSec, config.security.submitRateLimit.max), (req, res) => {
  const problemId = int(req.body.problemId, 0);
  const language = str(req.body.language, '', 32);
  const code = str(req.body.code, '', config.security.sourceMaxBytes);
  const contestId = int(req.body.contestId, 0) || null;

  if (!code || Buffer.byteLength(code, 'utf8') > config.security.sourceMaxBytes) {
    return res.status(400).json({ error: `代码不能为空或超过 ${config.security.sourceMaxBytes / 1024}KB` });
  }
  const problem = db.get('SELECT * FROM problems WHERE id = ?', problemId);
  if (!problem) return res.status(404).json({ error: '题目不存在' });
  const { canSee, visibleToGroup } = require('../middleware/auth');
  if (!canSee(req.user, problem.is_public) || !visibleToGroup(req.user, 'problem', problemId)) {
    return res.status(403).json({ error: '无权提交该题目' });
  }
  const lang = db.get('SELECT * FROM languages WHERE id = ? AND enabled = 1', language);
  if (!lang) return res.status(400).json({ error: '语言不可用' });

  // submission lock: no pending submissions (super exempt)
  if (req.user.role !== 'super') {
    const pending = db.get(
      "SELECT id FROM submissions WHERE user_id = ? AND status IN ('pending','ai_reviewing','queued','compiling','judging') LIMIT 1",
      req.user.id
    );
    if (pending) return res.status(409).json({ error: '您有正在评测的提交，请稍候' });
  }

  const t = db.now();
  const id = db.tx(() => {
    const sid = db.allocId('submission_id_pool', 1, 'submissions');
    db.run(
      'INSERT INTO submissions (id,user_id,problem_id,contest_id,language,code,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
      sid, req.user.id, problemId, contestId, language, code, 'pending', t
    );
    if (Array.isArray(req.body.files) && req.body.files.length) {
      for (const f of req.body.files.slice(0, 32)) {
        db.run('INSERT INTO submission_files (submission_id, filename, content) VALUES (?,?,?)',
          sid, str(f.filename, 'file', 128), str(f.content, '', 1048576));
      }
    }
    return sid;
  });

  // AI review first (async), then judging
  if (config.ai.reviewEnabled) {
    db.run("UPDATE submissions SET status='ai_reviewing' WHERE id=?", id);
    setImmediate(() => require('../services/ai/review').reviewSubmission(id));
  } else {
    require('../services/judge/runner').submitToQueue(id);
  }

  res.status(201).json({ id, status: config.ai.reviewEnabled ? 'ai_reviewing' : 'pending' });
});

// GET /api/submissions/:id
router.get('/:id', (req, res) => {
  const id = int(req.params.id, 0);
  const s = db.get(
    `SELECT s.*, u.username, p.title AS problem_title, p.time_limit_ms, p.memory_limit_mb
     FROM submissions s JOIN users u ON u.id = s.user_id JOIN problems p ON p.id = s.problem_id
     WHERE s.id = ?`, id
  );
  if (!s) return res.status(404).json({ error: '提交不存在' });
  const isOwner = req.user && req.user.id === s.user_id;
  const privileged = req.user && ['teacher', 'admin', 'super'].includes(req.user.role);
  const detail = parseJson(s.detail, {});
  if (!isOwner && !privileged) {
    delete s.code;
    delete detail.cases; // per-case detail only for owner/privileged
  }
  s.detail = detail;
  s.files = db.all('SELECT filename, content FROM submission_files WHERE submission_id = ?', id);
  res.json({ submission: s });
});

// POST /api/submissions/:id/rejudge  (teacher+)
router.post('/:id/rejudge', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const s = db.get('SELECT * FROM submissions WHERE id = ?', id);
  if (!s) return res.status(404).json({ error: '提交不存在' });
  db.run("UPDATE submissions SET status='pending', rated=0, judged_at=NULL, score=0 WHERE id=?", id);
  require('../services/judge/runner').submitToQueue(id);
  res.json({ ok: true });
});

// DELETE /api/submissions/:id  (admin+)
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = int(req.params.id, 0);
  const s = db.get('SELECT * FROM submissions WHERE id = ?', id);
  if (!s) return res.status(404).json({ error: '提交不存在' });
  db.tx(() => {
    db.run('DELETE FROM submissions WHERE id = ?', id);
    db.run('INSERT OR IGNORE INTO submission_id_pool (id) VALUES (?)', id);
  });
  res.json({ ok: true });
});

// GET /api/submissions/compare?a=&b=  (diff)
router.get('/compare/:a/:b', requireAuth, (req, res) => {
  const a = db.get('SELECT * FROM submissions WHERE id = ?', int(req.params.a, 0));
  const b = db.get('SELECT * FROM submissions WHERE id = ?', int(req.params.b, 0));
  if (!a || !b) return res.status(404).json({ error: '提交不存在' });
  if (a.user_id !== b.user_id || a.problem_id !== b.problem_id) {
    return res.status(400).json({ error: '仅支持同一用户同一题目的提交对比' });
  }
  if (!req.user || (req.user.id !== a.user_id && req.user.role === 'user')) {
    return res.status(403).json({ error: '无权对比' });
  }
  res.json({ a: { id: a.id, language: a.language, code: a.code, created_at: a.created_at }, b: { id: b.id, language: b.language, code: b.code, created_at: b.created_at } });
});

module.exports = router;
