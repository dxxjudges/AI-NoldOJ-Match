import { all, get, run } from '../db.js';
import { requireRole } from '../http/auth.js';
import { notFound } from '../utils/errors.js';
import { ok } from '../http/context.js';
import { toInt } from './helpers.js';
import { startReport, similarity, tokenize } from '../services/plagiarism.js';

export default function registerPlagiarism(router) {
  router.post('/api/problems/:id/plagiarism', requireRole('teacher'), (ctx) => {
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.params.id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    const info = run(
      'INSERT INTO plagiarism_reports (problem_id, created_by, status) VALUES (?,?,?)',
      problem.id, ctx.user.id, 'pending',
    );
    const id = Number(info.lastInsertRowid);
    startReport(id);
    return ok({ reportId: id });
  });

  router.post('/api/contests/:id/plagiarism', requireRole('teacher'), (ctx) => {
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    const problems = all('SELECT problem_id FROM contest_problems WHERE contest_id = ?', contest.id);
    const reports = [];
    for (const { problem_id } of problems) {
      const info = run(
        'INSERT INTO plagiarism_reports (problem_id, contest_id, created_by, status) VALUES (?,?,?,?)',
        problem_id, contest.id, ctx.user.id, 'pending',
      );
      const id = Number(info.lastInsertRowid);
      startReport(id);
      reports.push(id);
    }
    return ok({ reports });
  });

  router.get('/api/plagiarism', requireRole('teacher'), () => {
    const rows = all(
      `SELECT r.*, p.title AS problem_title, c.title AS contest_title
         FROM plagiarism_reports r
         LEFT JOIN problems p ON p.id = r.problem_id
         LEFT JOIN contests c ON c.id = r.contest_id
        ORDER BY r.id DESC LIMIT 100`,
    );
    return ok(rows);
  });

  router.get('/api/plagiarism/:id', requireRole('teacher'), (ctx) => {
    const report = get('SELECT * FROM plagiarism_reports WHERE id = ?', toInt(ctx.params.id, '报告ID'));
    if (!report) throw notFound('报告不存在');
    const pairs = all(
      `SELECT pp.*, ua.username AS user_a_name, ub.username AS user_b_name
         FROM plagiarism_pairs pp
         LEFT JOIN users ua ON ua.id = pp.user_a
         LEFT JOIN users ub ON ub.id = pp.user_b
        WHERE pp.report_id = ? ORDER BY pp.similarity DESC`,
      report.id,
    );
    return ok({ report, pairs });
  });

  router.get('/api/plagiarism/pairs/:pairId', requireRole('teacher'), (ctx) => {
    const pair = get('SELECT * FROM plagiarism_pairs WHERE id = ?', toInt(ctx.params.pairId, '对比ID'));
    if (!pair) throw notFound('对比记录不存在');
    const a = get('SELECT id, source_code, language_id, user_id FROM submissions WHERE id = ?', pair.submission_a);
    const b = get('SELECT id, source_code, language_id, user_id FROM submissions WHERE id = ?', pair.submission_b);
    const tokensA = tokenize(a?.source_code || '');
    const tokensB = tokenize(b?.source_code || '');
    const setB = new Set(tokensB);
    return ok({
      pair,
      left: { ...a, code: a?.source_code || '', tokens: tokensA, match: tokensA.map((t) => setB.has(t)) },
      right: { ...b, code: b?.source_code || '', tokens: tokensB, match: tokensB.map((t) => tokensA.includes(t)) },
      similarity: similarity(a?.source_code || '', b?.source_code || ''),
    });
  });
}
