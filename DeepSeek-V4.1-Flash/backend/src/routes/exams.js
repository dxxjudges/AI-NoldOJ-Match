import { all, get, run } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { paginate, ok } from '../http/context.js';
import { requireFields, toInt } from './helpers.js';
import { canView, visibleEntityIds } from '../services/visibility.js';
import { gradeSubjective } from '../services/ai.js';

function normalize(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function autoGrade(question, answer) {
  if (answer === undefined || answer === null || answer === '') return 0;
  switch (question.type) {
    case 'choice':
    case 'judge':
      return normalize(answer) === normalize(question.answer) ? question.score : 0;
    case 'fill_objective':
      return normalize(answer) === normalize(question.answer) ? question.score : 0;
    default:
      return null; // requires manual / AI grading
  }
}

function serializeExam(exam) {
  return {
    ...exam,
    is_public: Boolean(exam.is_public),
    question_count: get('SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id = ?', exam.id).n,
    total_score: get('SELECT COALESCE(SUM(score),0) AS s FROM exam_questions WHERE exam_id = ?', exam.id).s,
  };
}

export default function registerExams(router) {
  router.get('/api/exams', (ctx) => {
    const { page, pageSize, offset } = paginate(ctx);
    const where = [];
    const params = [];
    const visible = visibleEntityIds('exam', ctx.user, 'exams');
    if (visible !== null) {
      if (!visible.length) return ok({ total: 0, page, pageSize, items: [] });
      where.push(`id IN (${visible.map(() => '?').join(',')})`);
      params.push(...visible);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM exams ${clause}`, ...params).n;
    const rows = all(`SELECT * FROM exams ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
    return ok({ total, page, pageSize, items: rows.map(serializeExam) });
  });

  router.post('/api/exams', requireRole('teacher'), (ctx) => {
    requireFields(ctx.body, ['title']);
    const { title, description = '', start_at = null, end_at = null, time_limit_minutes = 0, pass_score = 60, max_attempts = 1, is_public = true } = ctx.body;
    const info = run(
      `INSERT INTO exams (title, description, created_by, start_at, end_at, time_limit_minutes, pass_score, max_attempts, is_public)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      title, description, ctx.user.id, start_at, end_at, Number(time_limit_minutes) || 0, Number(pass_score) || 0, Number(max_attempts) || 1, is_public ? 1 : 0,
    );
    return ok(serializeExam(get('SELECT * FROM exams WHERE id = ?', Number(info.lastInsertRowid))));
  });

  router.get('/api/exams/:id', (ctx) => {
    const exam = get('SELECT * FROM exams WHERE id = ?', toInt(ctx.params.id, '考试ID'));
    if (!exam) throw notFound('考试不存在');
    if (!canView('exam', ctx.user, exam, { ownerField: 'created_by' })) throw forbidden();
    const data = serializeExam(exam);
    const isStaff = isAtLeast(ctx.user, 'teacher');
    data.questions = all('SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY sort, id', exam.id).map((q) => (
      isStaff ? { ...q, options: safeParse(q.options, []) } : { ...q, options: safeParse(q.options, []), answer: undefined, analysis: undefined }
    ));
    if (ctx.user) {
      data.attempts = all(
        'SELECT id, attempt_no, score, status, submitted_at FROM exam_submissions WHERE exam_id = ? AND user_id = ? ORDER BY attempt_no',
        exam.id, ctx.user.id,
      );
    }
    return ok(data);
  });

  router.put('/api/exams/:id', requireRole('teacher'), (ctx) => {
    const exam = get('SELECT * FROM exams WHERE id = ?', toInt(ctx.params.id, '考试ID'));
    if (!exam) throw notFound('考试不存在');
    if (!isAtLeast(ctx.user, 'admin') && exam.created_by !== ctx.user.id) throw forbidden();
    const fields = [];
    const params = [];
    for (const key of ['title', 'description', 'start_at', 'end_at', 'time_limit_minutes', 'pass_score', 'max_attempts']) {
      if (ctx.body[key] !== undefined) { fields.push(`${key} = ?`); params.push(ctx.body[key]); }
    }
    if (ctx.body.is_public !== undefined) { fields.push('is_public = ?'); params.push(ctx.body.is_public ? 1 : 0); }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(exam.id);
    run(`UPDATE exams SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(serializeExam(get('SELECT * FROM exams WHERE id = ?', exam.id)));
  });

  router.delete('/api/exams/:id', requireRole('teacher'), (ctx) => {
    const exam = get('SELECT * FROM exams WHERE id = ?', toInt(ctx.params.id, '考试ID'));
    if (!exam) throw notFound('考试不存在');
    if (!isAtLeast(ctx.user, 'admin') && exam.created_by !== ctx.user.id) throw forbidden();
    run('DELETE FROM exams WHERE id = ?', exam.id);
    return ok({ deleted: exam.id });
  });

  router.post('/api/exams/:id/questions', requireRole('teacher'), (ctx) => {
    const exam = get('SELECT * FROM exams WHERE id = ?', toInt(ctx.params.id, '考试ID'));
    if (!exam) throw notFound('考试不存在');
    const list = Array.isArray(ctx.body.questions) ? ctx.body.questions : [ctx.body];
    const created = [];
    for (const q of list) {
      const sort = get('SELECT COALESCE(MAX(sort),0)+1 AS s FROM exam_questions WHERE exam_id = ?', exam.id).s;
      const info = run(
        'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, analysis, sort) VALUES (?,?,?,?,?,?,?,?)',
        exam.id, q.type || 'choice', q.content || '', JSON.stringify(q.options || []), q.answer || '', Number(q.score) || 0, q.analysis || '', sort,
      );
      created.push(Number(info.lastInsertRowid));
    }
    return ok({ created });
  });

  router.put('/api/exam-questions/:id', requireRole('teacher'), (ctx) => {
    const q = get('SELECT * FROM exam_questions WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!q) throw notFound('试题不存在');
    const fields = [];
    const params = [];
    for (const key of ['type', 'content', 'answer', 'analysis']) {
      if (ctx.body[key] !== undefined) { fields.push(`${key} = ?`); params.push(ctx.body[key]); }
    }
    if (ctx.body.options !== undefined) { fields.push('options = ?'); params.push(JSON.stringify(ctx.body.options)); }
    if (ctx.body.score !== undefined) { fields.push('score = ?'); params.push(Number(ctx.body.score) || 0); }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(q.id);
    run(`UPDATE exam_questions SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(get('SELECT * FROM exam_questions WHERE id = ?', q.id));
  });

  router.delete('/api/exam-questions/:id', requireRole('teacher'), (ctx) => {
    run('DELETE FROM exam_questions WHERE id = ?', toInt(ctx.params.id, '试题ID'));
    return ok({ deleted: ctx.params.id });
  });

  router.post('/api/exams/:id/import', requireRole('teacher'), (ctx) => {
    const exam = get('SELECT * FROM exams WHERE id = ?', toInt(ctx.params.id, '考试ID'));
    if (!exam) throw notFound('考试不存在');
    const rows = Array.isArray(ctx.body.questions) ? ctx.body.questions : [];
    const created = [];
    for (const q of rows) {
      const sort = get('SELECT COALESCE(MAX(sort),0)+1 AS s FROM exam_questions WHERE exam_id = ?', exam.id).s;
      const info = run(
        'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, analysis, sort) VALUES (?,?,?,?,?,?,?,?)',
        exam.id, q.type || 'choice', q.content || '', JSON.stringify(q.options || []), q.answer || '', Number(q.score) || 0, q.analysis || '', sort,
      );
      created.push(Number(info.lastInsertRowid));
    }
    return ok({ created });
  });

  router.post('/api/exams/:id/start', (ctx) => {
    if (!ctx.user) throw forbidden();
    const exam = get('SELECT * FROM exams WHERE id = ?', toInt(ctx.params.id, '考试ID'));
    if (!exam) throw notFound('考试不存在');
    const attempts = get('SELECT COUNT(*) AS n FROM exam_submissions WHERE exam_id = ? AND user_id = ?', exam.id, ctx.user.id).n;
    if (attempts >= exam.max_attempts) throw badRequest('已达到最大考试次数');
    const info = run(
      'INSERT INTO exam_submissions (exam_id, user_id, attempt_no, status) VALUES (?,?,?,?)',
      exam.id, ctx.user.id, attempts + 1, 'in_progress',
    );
    return ok(get('SELECT * FROM exam_submissions WHERE id = ?', Number(info.lastInsertRowid)));
  });

  router.post('/api/exam-submissions/:id/submit', async (ctx) => {
    if (!ctx.user) throw forbidden();
    const sub = get('SELECT * FROM exam_submissions WHERE id = ?', toInt(ctx.params.id, '作答ID'));
    if (!sub) throw notFound('作答记录不存在');
    if (sub.user_id !== ctx.user.id) throw forbidden();
    const answers = ctx.body.answers || {};
    const questions = all('SELECT * FROM exam_questions WHERE exam_id = ?', sub.exam_id);

    let score = 0;
    let needsManual = false;
    const details = {};
    for (const q of questions) {
      const answer = answers[q.id];
      const auto = autoGrade(q, answer);
      if (auto === null) {
        needsManual = true;
        details[q.id] = { score: null, comment: '待人工/AI批改' };
      } else {
        score += auto;
        details[q.id] = { score: auto };
      }
    }

    run(
      "UPDATE exam_submissions SET answers = ?, score = ?, status = ?, submitted_at = datetime('now') WHERE id = ?",
      JSON.stringify(answers), score, needsManual ? 'submitted' : 'graded', sub.id,
    );
    return ok({ id: sub.id, score, needsManual, details });
  });

  router.get('/api/exam-submissions/:id', (ctx) => {
    if (!ctx.user) throw forbidden();
    const sub = get('SELECT * FROM exam_submissions WHERE id = ?', toInt(ctx.params.id, '作答ID'));
    if (!sub) throw notFound('作答记录不存在');
    if (sub.user_id !== ctx.user.id && !isAtLeast(ctx.user, 'teacher')) throw forbidden();
    return ok({ ...sub, answers: safeParse(sub.answers, {}) });
  });

  router.get('/api/exams/:id/submissions', requireRole('teacher'), (ctx) => {
    const rows = all(
      `SELECT es.*, u.username FROM exam_submissions es LEFT JOIN users u ON u.id = es.user_id
        WHERE es.exam_id = ? ORDER BY es.id DESC`,
      toInt(ctx.params.id, '考试ID'),
    );
    return ok(rows.map((r) => ({ ...r, answers: safeParse(r.answers, {}) })));
  });

  router.post('/api/exam-submissions/:id/grade', requireRole('teacher'), async (ctx) => {
    const sub = get('SELECT * FROM exam_submissions WHERE id = ?', toInt(ctx.params.id, '作答ID'));
    if (!sub) throw notFound('作答记录不存在');
    const questions = all('SELECT * FROM exam_questions WHERE exam_id = ?', sub.exam_id);
    const answers = safeParse(sub.answers, {});
    const grades = ctx.body.grades || {};
    let score = 0;
    for (const q of questions) {
      const provided = grades[q.id];
      if (provided !== undefined) {
        score += Math.max(0, Math.min(q.score, Number(provided)));
      } else {
        const auto = autoGrade(q, answers[q.id]);
        if (auto !== null) score += auto;
        else if (ctx.body.useAi) {
          try {
            const result = await gradeSubjective({ question: q, answer: answers[q.id], maxScore: q.score });
            score += result.score;
          } catch { /* fallback to 0 */ }
        }
      }
    }
    run(
      "UPDATE exam_submissions SET score = ?, status = 'graded', graded_at = datetime('now'), graded_by = ? WHERE id = ?",
      score, ctx.user.id, sub.id,
    );
    return ok({ id: sub.id, score });
  });
}

function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}
