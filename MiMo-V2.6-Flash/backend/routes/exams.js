'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole, canSee, visibleToGroup } = require('../middleware/auth');
const { str, int, bool, parseJson } = require('../utils/validate');
const { chat } = require('../services/ai/client');
const { config } = require('../config');

const router = express.Router();

router.get('/', (req, res) => {
  const where = [];
  if (!req.user || req.user.role === 'user') where.push('e.is_public = 1');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  res.json({ items: db.all(`SELECT e.id, e.title, e.duration_min, e.pass_score, e.total_score, e.start_at, e.end_at, e.is_public, e.created_at FROM exams e ${whereSql} ORDER BY e.id DESC LIMIT 100`)
    .filter(e => visibleToGroup(req.user, 'exam', e.id)) });
});

router.get('/:id', (req, res) => {
  const id = int(req.params.id, 0);
  const e = db.get('SELECT * FROM exams WHERE id = ?', id);
  if (!e) return res.status(404).json({ error: '考试不存在' });
  if (!canSee(req.user, e.is_public) || !visibleToGroup(req.user, 'exam', id)) {
    return res.status(403).json({ error: '无权访问' });
  }
  const privileged = req.user && ['teacher', 'admin', 'super'].includes(req.user.role);
  const qs = db.all('SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY order_index, id', id);
  // hide answers from students
  e.questions = qs.map(q => {
    const o = { ...q };
    if (!privileged) delete o.answer;
    o.options = parseJson(o.options, []);
    return o;
  });
  if (req.user) {
    e.attempts = db.all('SELECT id, started_at, submitted_at, score, status FROM exam_attempts WHERE exam_id = ? AND user_id = ? ORDER BY id',
      id, req.user.id);
  }
  res.json({ exam: e });
});

router.post('/', requireAuth, requireRole('teacher'), (req, res) => {
  const t = db.now();
  const info = db.run(
    `INSERT INTO exams (title, description, duration_min, pass_score, max_attempts, total_score, start_at, end_at, is_public, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    str(req.body.title, '', 200), str(req.body.description, ''),
    int(req.body.duration_min, 60), Number(req.body.pass_score) || 60,
    int(req.body.max_attempts, 1), Number(req.body.total_score) || 100,
    int(req.body.start_at, 0) || null, int(req.body.end_at, 0) || null,
    req.body.is_public !== undefined ? (bool(req.body.is_public) ? 1 : 0) : 1,
    req.user.id, t, t
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const e = db.get('SELECT * FROM exams WHERE id = ?', id);
  if (!e) return res.status(404).json({ error: '考试不存在' });
  db.run(
    `UPDATE exams SET title=?, description=?, duration_min=?, pass_score=?, max_attempts=?, total_score=?, start_at=?, end_at=?, is_public=?, updated_at=? WHERE id=?`,
    str(req.body.title, e.title, 200), str(req.body.description, e.description),
    int(req.body.duration_min, e.duration_min), Number(req.body.pass_score) || e.pass_score,
    int(req.body.max_attempts, e.max_attempts), Number(req.body.total_score) || e.total_score,
    int(req.body.start_at, e.start_at) || null, int(req.body.end_at, e.end_at) || null,
    req.body.is_public !== undefined ? (bool(req.body.is_public) ? 1 : 0) : e.is_public,
    db.now(), id
  );
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  db.run('DELETE FROM exams WHERE id = ?', int(req.params.id, 0));
  res.json({ ok: true });
});

// POST /api/exams/:id/questions
router.post('/:id/questions', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  if (!db.get('SELECT id FROM exams WHERE id = ?', id)) return res.status(404).json({ error: '考试不存在' });
  const type = ['choice', 'truefalse', 'fill', 'essay'].includes(req.body.type) ? req.body.type : 'choice';
  const info = db.run(
    'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, order_index) VALUES (?,?,?,?,?,?,?)',
    id, type, str(req.body.content, '', 20000),
    JSON.stringify(req.body.options || []), str(req.body.answer, '', 2000),
    Number(req.body.score) || 5,
    int(req.body.order_index, db.get('SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id=?', id).n)
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// PUT /api/exams/questions/:qid
router.put('/questions/:qid', requireAuth, requireRole('teacher'), (req, res) => {
  const qid = int(req.params.qid, 0);
  const q = db.get('SELECT * FROM exam_questions WHERE id = ?', qid);
  if (!q) return res.status(404).json({ error: '题目不存在' });
  db.run('UPDATE exam_questions SET type=?, content=?, options=?, answer=?, score=? WHERE id=?',
    ['choice', 'truefalse', 'fill', 'essay'].includes(req.body.type) ? req.body.type : q.type,
    str(req.body.content, q.content, 20000),
    JSON.stringify(req.body.options ?? parseJson(q.options, [])),
    str(req.body.answer, q.answer, 2000),
    Number(req.body.score) || q.score, qid);
  res.json({ ok: true });
});

router.delete('/questions/:qid', requireAuth, requireRole('teacher'), (req, res) => {
  db.run('DELETE FROM exam_questions WHERE id = ?', int(req.params.qid, 0));
  res.json({ ok: true });
});

// POST /api/exams/:id/import  — batch import questions
// Body: { questions: [{ type, content, options?: [{key,text}], answer, score }] }
router.post('/:id/import', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  if (!db.get('SELECT id FROM exams WHERE id = ?', id)) return res.status(404).json({ error: '考试不存在' });
  const qs = Array.isArray(req.body.questions) ? req.body.questions : [];
  if (!qs.length) return res.status(400).json({ error: '无导入数据' });
  const valid = ['choice', 'truefalse', 'fill', 'essay'];
  let imported = 0;
  let order = db.get('SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id = ?', id).n;
  db.tx(() => {
    for (const q of qs.slice(0, 500)) {
      const type = valid.includes(q.type) ? q.type : 'choice';
      const content = str(q.content, '', 20000);
      if (!content) continue;
      db.run(
        'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, order_index) VALUES (?,?,?,?,?,?,?)',
        id, type, content,
        JSON.stringify(Array.isArray(q.options) ? q.options : []),
        str(q.answer, '', 2000),
        Number(q.score) || 5, order++
      );
      imported++;
    }
  });
  res.status(201).json({ imported });
});

// POST /api/exams/:id/start  — begin an attempt
router.post('/:id/start', requireAuth, (req, res) => {
  const id = int(req.params.id, 0);
  const e = db.get('SELECT * FROM exams WHERE id = ?', id);
  if (!e) return res.status(404).json({ error: '考试不存在' });
  const attempts = Number(db.get('SELECT COUNT(*) AS n FROM exam_attempts WHERE exam_id = ? AND user_id = ?', id, req.user.id).n);
  if (attempts >= e.max_attempts) return res.status(400).json({ error: '已达到最大尝试次数' });
  const info = db.run(
    'INSERT INTO exam_attempts (exam_id, user_id, started_at, status) VALUES (?,?,?,?)',
    id, req.user.id, db.now(), 'in_progress'
  );
  res.status(201).json({ attemptId: Number(info.lastInsertRowid), deadline: db.now() + e.duration_min * 60000 });
});

// POST /api/exams/attempts/:aid/submit
router.post('/attempts/:aid/submit', requireAuth, async (req, res) => {
  const aid = int(req.params.aid, 0);
  const att = db.get('SELECT * FROM exam_attempts WHERE id = ?', aid);
  if (!att || att.user_id !== req.user.id) return res.status(404).json({ error: '答卷不存在' });
  if (att.status !== 'in_progress') return res.status(400).json({ error: '答卷已提交' });
  const exam = db.get('SELECT * FROM exams WHERE id = ?', att.exam_id);
  const questions = db.all('SELECT * FROM exam_questions WHERE exam_id = ?', att.exam_id);
  const answers = req.body.answers || {}; // {questionId: answer}

  let total = 0;
  let hasSubjective = false;
  for (const q of questions) {
    const raw = String(answers[q.id] ?? '');
    db.run('INSERT INTO exam_answers (attempt_id, question_id, answer) VALUES (?,?,?)', aid, q.id, raw.slice(0, 20000));
    if (q.type === 'essay' || (q.type === 'fill' && !q.answer)) {
      hasSubjective = true;
      continue;
    }
    const ok = normalizeAns(raw) === normalizeAns(q.answer);
    if (ok) {
      total += Number(q.score) || 0;
      db.run('UPDATE exam_answers SET score = ? WHERE attempt_id = ? AND question_id = ?', Number(q.score) || 0, aid, q.id);
    }
  }
  const status = hasSubjective ? 'submitted' : 'graded';
  db.run('UPDATE exam_attempts SET submitted_at=?, score=?, status=? WHERE id=?',
    db.now(), total, status, aid);
  res.json({ score: total, status, needManualGrading: hasSubjective });
});

function normalizeAns(s) {
  return String(s).trim().toUpperCase().replace(/\s+/g, ' ');
}

// POST /api/exams/attempts/:aid/ai-grade  (teacher+, subjective questions)
router.post('/attempts/:aid/ai-grade', requireAuth, requireRole('teacher'), async (req, res) => {
  const aid = int(req.params.aid, 0);
  const att = db.get('SELECT * FROM exam_attempts WHERE id = ?', aid);
  if (!att) return res.status(404).json({ error: '答卷不存在' });
  if (!config.ai.hintEnabled && !config.ai.reviewEnabled) {
    return res.status(400).json({ error: 'AI 服务未启用' });
  }
  const pendings = db.all(
    `SELECT ea.*, eq.answer AS ref, eq.score AS full FROM exam_answers ea
     JOIN exam_questions eq ON eq.id = ea.question_id
     WHERE ea.attempt_id = ? AND (ea.score IS NULL) AND eq.type IN ('essay','fill')`, aid
  );
  let gained = 0;
  for (const a of pendings) {
    try {
      const raw = await chat([
        { role: 'system', content: '你是阅卷助手。根据参考答案给学生的主观题作答打分，只输出 JSON：{"score":0.0}' },
        { role: 'user', content: `满分 ${a.full}\n参考答案: ${a.ref}\n学生作答: ${a.answer}` },
      ]);
      const m = raw.match(/\{[\s\S]*\}/);
      let s = m ? Number(JSON.parse(m[0]).score) : 0;
      if (!Number.isFinite(s)) s = 0;
      s = Math.max(0, Math.min(a.full, s));
      db.run('UPDATE exam_answers SET score=?, graded_by_ai=1 WHERE id=?', s, a.id);
      gained += s;
    } catch (_) { /* leave ungraded */ }
  }
  const sum = Number(db.get('SELECT COALESCE(SUM(score),0) AS s FROM exam_answers WHERE attempt_id=?', aid).s);
  const still = db.get(
    `SELECT COUNT(*) AS n FROM exam_answers ea JOIN exam_questions eq ON eq.id=ea.question_id
     WHERE ea.attempt_id=? AND ea.score IS NULL`, aid).n;
  if (Number(still) === 0) {
    db.run('UPDATE exam_attempts SET score=?, status=? WHERE id=?', sum, 'graded', aid);
  }
  res.json({ score: sum, graded: pendings.length, remaining: Number(still) });
});

// POST /api/exams/attempts/:aid/grade  (teacher manual grade) {answerId, score}
router.post('/attempts/:aid/grade', requireAuth, requireRole('teacher'), (req, res) => {
  const aid = int(req.params.aid, 0);
  const answerId = int(req.body.answerId, 0);
  const a = db.get('SELECT * FROM exam_answers WHERE id = ? AND attempt_id = ?', answerId, aid);
  if (!a) return res.status(404).json({ error: '作答不存在' });
  const q = db.get('SELECT * FROM exam_questions WHERE id = ?', a.question_id);
  const score = Math.max(0, Math.min(Number(q.score) || 0, Number(req.body.score) || 0));
  db.run('UPDATE exam_answers SET score=?, graded_by_ai=0 WHERE id=?', score, answerId);
  const sum = Number(db.get('SELECT COALESCE(SUM(score),0) AS s FROM exam_answers WHERE attempt_id=?', aid).s);
  const still = Number(db.get(
    `SELECT COUNT(*) AS n FROM exam_answers ea JOIN exam_questions eq ON eq.id=ea.question_id
     WHERE ea.attempt_id=? AND ea.score IS NULL`, aid).n);
  if (still === 0) db.run('UPDATE exam_attempts SET score=?, status=? WHERE id=?', sum, 'graded', aid);
  res.json({ ok: true, score: sum, remaining: still });
});

module.exports = router;
