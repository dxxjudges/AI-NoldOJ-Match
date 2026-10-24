const express = require('express');
const { one, all, run } = require('../db/db');
const { requireAuth, requireMin } = require('../utils/middleware');
const { chat } = require('../ai/client');
const config = require('../config');

const router = express.Router();
const isTeacher = (u) => u && ['teacher', 'admin', 'super'].includes(u.role);

// ---------- exam CRUD ----------
router.get('/exams', (req, res) => {
  let rows = all(`SELECT e.*, (SELECT COUNT(*) FROM exam_questions q WHERE q.exam_id=e.id) question_count FROM exams e ORDER BY e.id DESC LIMIT 200`);
  rows.forEach(r => {
    r.state = !r.start_at || Date.now() < r.start_at ? 'notstarted' : (!r.end_at || Date.now() < r.end_at ? 'running' : 'ended');
  });
  res.json({ ok: true, data: { items: rows } });
});

router.get('/exams/:id', (req, res) => {
  const e = one(`SELECT * FROM exams WHERE id=?`, req.params.id);
  if (!e) return res.status(404).json({ ok: false, error: 'Exam does not exist' });
  const questions = isTeacher(req.user)
    ? all(`SELECT * FROM exam_questions WHERE exam_id=? ORDER BY ord, id`, e.id)
    : all(`SELECT id, ord, type, content_md, options_json, score, objective FROM exam_questions WHERE exam_id=? ORDER BY ord, id`, e.id);
  const attempts = req.user ? all(`SELECT * FROM exam_attempts WHERE exam_id=? AND user_id=? ORDER BY id`, e.id, req.user.id) : [];
  res.json({
    ok: true, data: {
      exam: e, questions, attempts,
      teacher: isTeacher(req.user),
      state: !e.start_at || Date.now() < e.start_at ? 'notstarted' : (!e.end_at || Date.now() < e.end_at ? 'running' : 'ended')
    }
  });
});

router.post('/exams', requireMin('teacher'), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ ok: false, error: 'Title cannot be empty' });
  const info = run(`INSERT INTO exams (title, description_md, start_at, end_at, time_limit_min, pass_score, max_attempts, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    b.title, b.descriptionMd || '', b.startAt ? Number(b.startAt) : null, b.endAt ? Number(b.endAt) : null,
    Math.max(1, Number(b.timeLimitMin) || 60), Number(b.passScore) || 60, Math.max(1, Number(b.maxAttempts) || 1),
    req.user.id, Date.now());
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.put('/exams/:id', requireMin('teacher'), (req, res) => {
  const e = one(`SELECT * FROM exams WHERE id=?`, req.params.id);
  if (!e) return res.status(404).json({ ok: false, error: 'Exam does not exist' });
  const b = req.body || {};
  run(`UPDATE exams SET title=?, description_md=?, start_at=?, end_at=?, time_limit_min=?, pass_score=?, max_attempts=? WHERE id=?`,
    b.title !== undefined ? b.title : e.title,
    b.descriptionMd !== undefined ? b.descriptionMd : e.description_md,
    b.startAt !== undefined ? (b.startAt ? Number(b.startAt) : null) : e.start_at,
    b.endAt !== undefined ? (b.endAt ? Number(b.endAt) : null) : e.end_at,
    b.timeLimitMin !== undefined ? Math.max(1, Number(b.timeLimitMin)) : e.time_limit_min,
    b.passScore !== undefined ? Number(b.passScore) : e.pass_score,
    b.maxAttempts !== undefined ? Math.max(1, Number(b.maxAttempts)) : e.max_attempts, e.id);
  res.json({ ok: true });
});

router.delete('/exams/:id', requireMin('teacher'), (req, res) => {
  run(`DELETE FROM exam_questions WHERE exam_id=?`, req.params.id);
  run(`DELETE FROM exam_attempts WHERE exam_id=?`, req.params.id);
  run(`DELETE FROM exams WHERE id=?`, req.params.id);
  res.json({ ok: true });
});

// ---------- questions ----------
router.post('/exams/:id/questions', requireMin('teacher'), (req, res) => {
  const e = one(`SELECT * FROM exams WHERE id=?`, req.params.id);
  if (!e) return res.status(404).json({ ok: false, error: 'Exam does not exist' });
  const b = req.body || {};
  if (!['choice', 'judge', 'blank', 'essay'].includes(b.type)) return res.status(400).json({ ok: false, error: 'Invalid question type' });
  const info = run(`INSERT INTO exam_questions (exam_id, ord, type, content_md, options_json, answer, score, objective) VALUES (?,?,?,?,?,?,?,?)`,
    e.id, Number(b.ord) || 0, b.type, b.contentMd || '',
    JSON.stringify(b.options || []), String(b.answer || ''),
    Number(b.score) || 10,
    b.type === 'essay' || (b.type === 'blank' && b.subjective) ? 0 : 1);
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.put('/exam-questions/:qid', requireMin('teacher'), (req, res) => {
  const q = one(`SELECT * FROM exam_questions WHERE id=?`, req.params.qid);
  if (!q) return res.status(404).json({ ok: false, error: 'Question does not exist' });
  const b = req.body || {};
  run(`UPDATE exam_questions SET ord=?, type=?, content_md=?, options_json=?, answer=?, score=?, objective=? WHERE id=?`,
    b.ord !== undefined ? Number(b.ord) : q.ord,
    b.type !== undefined ? b.type : q.type,
    b.contentMd !== undefined ? b.contentMd : q.content_md,
    b.options !== undefined ? JSON.stringify(b.options) : q.options_json,
    b.answer !== undefined ? String(b.answer) : q.answer,
    b.score !== undefined ? Number(b.score) : q.score,
    b.objective !== undefined ? (b.objective ? 1 : 0) : q.objective, q.id);
  res.json({ ok: true });
});

router.delete('/exam-questions/:qid', requireMin('teacher'), (req, res) => {
  run(`DELETE FROM exam_questions WHERE id=?`, req.params.qid);
  res.json({ ok: true });
});

// ---------- attempts & submission/grading ----------
router.post('/exams/:id/attempt', requireAuth, (req, res) => {
  const e = one(`SELECT * FROM exams WHERE id=?`, req.params.id);
  if (!e) return res.status(404).json({ ok: false, error: 'Exam does not exist' });
  if (e.start_at && Date.now() < e.start_at) return res.status(400).json({ ok: false, error: 'Exam has not started' });
  if (e.end_at && Date.now() > e.end_at) return res.status(400).json({ ok: false, error: 'Exam has ended' });
  const count = one(`SELECT COUNT(*) c FROM exam_attempts WHERE exam_id=? AND user_id=? AND submitted_at IS NOT NULL`, e.id, req.user.id).c;
  if (count >= e.max_attempts) return res.status(400).json({ ok: false, error: 'Maximum attempts reached' });
  const info = run(`INSERT INTO exam_attempts (exam_id, user_id, answers_json, status, started_at) VALUES (?,?,'{}','pending',?)`, e.id, req.user.id, Date.now());
  res.json({ ok: true, data: { attemptId: Number(info.lastInsertRowid) } });
});

router.post('/exam-attempts/:aid/submit', requireAuth, async (req, res) => {
  const a = one(`SELECT * FROM exam_attempts WHERE id=?`, req.params.aid);
  if (!a || a.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'Exam attempt does not exist' });
  if (a.submitted_at) return res.status(400).json({ ok: false, error: 'Already submitted' });
  const e = one(`SELECT * FROM exams WHERE id=?`, a.exam_id);
  // time limit enforcement (server-side timing)
  if (Date.now() - a.started_at > (e.time_limit_min + 1) * 60 * 1000) {
    return res.status(400).json({ ok: false, error: 'Exam time limit exceeded' });
  }
  const answers = req.body.answers || {};
  run(`UPDATE exam_attempts SET answers_json=?, submitted_at=? WHERE id=?`, JSON.stringify(answers), Date.now(), a.id);
  // grade pass: objective auto via sync call; subjective AI + teacher manual
  gradeAttempt(a.id).catch(e => console.warn('[EXAM] grade failed:', e.message));
  res.json({ ok: true, data: { attemptId: a.id } });
});

async function gradeAttempt(attemptId) {
  const a = one(`SELECT * FROM exam_attempts WHERE id=?`, attemptId);
  if (!a || !a.submitted_at) return null;
  const questions = all(`SELECT * FROM exam_questions WHERE exam_id=? ORDER BY ord, id`, a.exam_id);
  let answers = {};
  try { answers = JSON.parse(a.answers_json || '{}'); } catch { }
  let score = 0, pendingSubjective = 0;
  for (const q of questions) {
    const ans = answers[q.id] !== undefined ? answers[q.id] : answers[String(q.id)];
    if (!q.objective) { pendingSubjective++; continue; }
    const key = String(q.answer || '').trim().toLowerCase();
    const mine = Array.isArray(ans) ? ans.map(String).sort().join(',').toLowerCase() : String(ans == null ? '' : ans).trim().toLowerCase();
    let ok = false;
    if (q.type === 'choice' && key.includes(',')) ok = mine === key.split(',').sort().join(',');
    else ok = mine === key;
    if (ok) score += q.score;
  }
  // subjective AI grading
  if (pendingSubjective > 0 && config.ai.examGrade.enabled) {
    for (const q of questions.filter(qq => !qq.objective)) {
      const ans = answers[q.id] !== undefined ? answers[q.id] : answers[String(q.id)];
      if (!ans) continue;
      try {
        const resp = await chat(config.ai.examGrade, [
          { role: 'system', content: '你是阅卷助手。根据参考答案对学生作答打分（0-满分），只输出数字：得分' },
          { role: 'user', content: `题目：${q.content_md}\n参考答案：${q.answer || '（无参考答案）'}\n学生作答：${String(ans).slice(0, 3000)}\n满分：${q.score}\n只输出一个数字。` }
        ], { timeoutMs: 60000, temperature: 0.1 });
        const m = resp.match(/-?\d+(\.\d+)?/);
        if (m) score += Math.max(0, Math.min(q.score, Number(m[0])));
      } catch { /* teacher manual grade fallback */ }
    }
    pendingSubjective = 0; // attempted AI grading; teacher can still adjust
  }
  run(`UPDATE exam_attempts SET score=?, status=? WHERE id=?`, score, pendingSubjective > 0 ? 'pending' : 'graded', a.id);
  return score;
}

// teacher manual grading (adjust or final)
router.post('/exam-attempts/:aid/grade', requireMin('teacher'), (req, res) => {
  const a = one(`SELECT * FROM exam_attempts WHERE id=?`, req.params.aid);
  if (!a) return res.status(404).json({ ok: false, error: 'Exam attempt does not exist' });
  const b = req.body || {};
  run(`UPDATE exam_attempts SET answers_json=?, score=?, status='graded' WHERE id=?`,
    b.score !== undefined ? a.answers_json : a.answers_json,
    Number(b.score) || 0, a.id);
  res.json({ ok: true });
});

router.get('/exams/:id/attempts', requireMin('teacher'), (req, res) => {
  const items = all(`
    SELECT ea.*, u.username FROM exam_attempts ea JOIN users u ON u.id=ea.user_id
    WHERE ea.exam_id=? ORDER BY ea.id`, req.params.id);
  res.json({ ok: true, data: { items } });
});

module.exports = router;
