import { all, get, run, recycleId } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { badRequest, forbidden, notFound, tooMany } from '../utils/errors.js';
import { paginate, ok } from '../http/context.js';
import { toInt } from './helpers.js';
import { canView, visibleEntityIds } from '../services/visibility.js';
import { rateLimit } from '../utils/rateLimit.js';
import config from '../config.js';
import { enqueue } from '../services/judge.js';
import { broadcast } from '../services/websocket.js';

function serializeSubmission(row, { includeSource = false } = {}) {
  const out = {
    id: row.id,
    user_id: row.user_id,
    username: row.username,
    problem_id: row.problem_id,
    problem_title: row.problem_title,
    contest_id: row.contest_id,
    language_id: row.language_id,
    language_name: row.language_name,
    status: row.status,
    score: row.score,
    time_ms: row.time_ms,
    memory_kb: row.memory_kb,
    created_at: row.created_at,
    judged_at: row.judged_at,
  };
  if (includeSource) {
    out.source_code = row.source_code;
    out.files = safeParse(row.files, []);
    out.compile_output = row.compile_output;
    out.detail = row.detail;
    out.ai_review_status = row.ai_review_status;
  }
  return out;
}

function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

const LIST_SELECT = `
  SELECT s.*, u.username, p.title AS problem_title, l.name AS language_name
    FROM submissions s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN problems p ON p.id = s.problem_id
    LEFT JOIN languages l ON l.id = s.language_id`;

function diffLines(aText, bText) {
  const a = String(aText).replace(/\r\n/g, '\n').split('\n');
  const b = String(bText).replace(/\r\n/g, '\n').split('\n');
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'same', left: a[i], right: b[j], leftNo: i + 1, rightNo: j + 1 }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', left: a[i], right: null, leftNo: i + 1, rightNo: null }); i += 1; }
    else { rows.push({ type: 'add', left: null, right: b[j], leftNo: null, rightNo: j + 1 }); j += 1; }
  }
  while (i < n) { rows.push({ type: 'del', left: a[i], right: null, leftNo: i + 1, rightNo: null }); i += 1; }
  while (j < m) { rows.push({ type: 'add', left: null, right: b[j], leftNo: null, rightNo: j + 1 }); j += 1; }
  return rows;
}

export default function registerSubmissions(router) {
  router.get('/api/submissions', (ctx) => {
    const { page, pageSize, offset } = paginate(ctx);
    const where = [];
    const params = [];
    const visible = visibleEntityIds('problem', ctx.user, 'problems');
    if (visible !== null) {
      if (!visible.length) return ok({ total: 0, page, pageSize, items: [] });
      where.push(`s.problem_id IN (${visible.map(() => '?').join(',')})`);
      params.push(...visible);
    }
    const user = ctx.query1('user');
    const problem = ctx.query1('problem');
    const status = ctx.query1('status');
    const contest = ctx.query1('contest');
    if (user) { where.push('s.user_id = ?'); params.push(Number(user)); }
    if (problem) { where.push('s.problem_id = ?'); params.push(Number(problem)); }
    if (status) { where.push('s.status = ?'); params.push(status); }
    if (contest) { where.push('s.contest_id = ?'); params.push(Number(contest)); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM submissions s ${clause}`, ...params).n;
    const rows = all(`${LIST_SELECT} ${clause} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
    return ok({ total, page, pageSize, items: rows.map((r) => serializeSubmission(r)) });
  });

  router.post('/api/submissions', (ctx) => {
    if (!ctx.user) throw forbidden('请先登录');
    const limit = rateLimit(`submit:${ctx.user.id}`, config.rateLimit.submit);
    if (!limit.ok) throw tooMany(`提交过于频繁，请 ${limit.retryAfter} 秒后再试`);

    const { problem_id, language, language_id, source_code = '', files = [], contest_id = null } = ctx.body;
    const pid = toInt(problem_id, '题目ID');
    const problem = get('SELECT * FROM problems WHERE id = ?', pid);
    if (!problem) throw notFound('题目不存在');
    if (!canView('problem', ctx.user, problem)) throw forbidden('无权访问该题目');

    const langId = language_id ?? language;
    const lang = get('SELECT * FROM languages WHERE (id = ? OR key = ?) AND enabled = 1', langId, langId);
    if (!lang) throw badRequest('语言不存在或已被禁用');

    const codeText = String(source_code || '');
    const fileList = Array.isArray(files) ? files : [];
    if (!codeText.trim() && !fileList.length) throw badRequest('代码不能为空');
    if (Buffer.byteLength(codeText, 'utf8') > config.core.codeMaxBytes) throw badRequest('代码长度超过 128KB 限制');

    const pending = get(
      "SELECT id FROM submissions WHERE user_id = ? AND judged = 0 AND status NOT IN ('system_error','compile_error','banned') LIMIT 1",
      ctx.user.id,
    );
    if (pending && !isAtLeast(ctx.user, 'admin')) throw forbidden('存在未完成的提交，请等待评判完成');

    let contestId = null;
    if (contest_id) {
      const contest = get('SELECT * FROM contests WHERE id = ?', Number(contest_id));
      if (contest && get('SELECT 1 FROM contest_participants WHERE contest_id = ? AND user_id = ?', contest.id, ctx.user.id)) {
        contestId = contest.id;
      }
    } else {
      const active = get(
        `SELECT c.id FROM contests c
           JOIN contest_problems cp ON cp.contest_id = c.id
           JOIN contest_participants p ON p.contest_id = c.id AND p.user_id = ?
          WHERE cp.problem_id = ? AND datetime('now') BETWEEN c.start_at AND c.end_at LIMIT 1`,
        ctx.user.id, pid,
      );
      if (active) contestId = active.id;
    }

    const id = recycleId('submissions');
    run(
      `INSERT INTO submissions (id, user_id, problem_id, contest_id, language_id, source_code, files, status)
       VALUES (?,?,?,?,?,?,?, 'queued')`,
      id, ctx.user.id, pid, contestId, lang.id, codeText, JSON.stringify(fileList),
    );
    broadcast('submission_new', { id, user_id: ctx.user.id, problem_id: pid });
    enqueue(id);
    return ok({ id, status: 'queued' });
  });

  router.get('/api/submissions/:id', (ctx) => {
    const row = get(`${LIST_SELECT} WHERE s.id = ?`, toInt(ctx.params.id, '提交ID'));
    if (!row) throw notFound('提交不存在');
    const problem = get('SELECT * FROM problems WHERE id = ?', row.problem_id);
    if (problem && !canView('problem', ctx.user, problem) && !isAtLeast(ctx.user, 'teacher')) throw forbidden();
    const data = serializeSubmission(row, { includeSource: true });
    if (!isAtLeast(ctx.user, 'teacher') && ctx.user && row.user_id !== ctx.user.id && problem && problem.visibility !== 'public') {
      data.source_code = '';
    }
    return ok(data);
  });

  router.get('/api/submissions/:id/cases', (ctx) => {
    const row = get('SELECT * FROM submissions WHERE id = ?', toInt(ctx.params.id, '提交ID'));
    if (!row) throw notFound('提交不存在');
    const cases = all('SELECT * FROM submission_cases WHERE submission_id = ? ORDER BY idx', row.id);
    const canSeeAll = isAtLeast(ctx.user, 'teacher') || (ctx.user && ctx.user.id === row.user_id);
    const data = cases.map((c, index) => ({
      idx: c.idx,
      status: c.status,
      score: c.score,
      time_ms: c.time_ms,
      memory_kb: c.memory_kb,
      message: canSeeAll ? c.message : '',
      hidden: false,
      label: `测试点 #${index + 1}`,
    }));
    return ok(data);
  });

  router.post('/api/submissions/:id/rejudge', requireRole('teacher'), (ctx) => {
    const row = get('SELECT * FROM submissions WHERE id = ?', toInt(ctx.params.id, '提交ID'));
    if (!row) throw notFound('提交不存在');
    run("UPDATE submissions SET status = 'queued', judged = 0, score = 0, detail = '' WHERE id = ?", row.id);
    run('DELETE FROM submission_cases WHERE submission_id = ?', row.id);
    enqueue(row.id);
    return ok({ id: row.id, status: 'queued' });
  });

  router.delete('/api/submissions/:id', requireRole('admin'), (ctx) => {
    const row = get('SELECT * FROM submissions WHERE id = ?', toInt(ctx.params.id, '提交ID'));
    if (!row) throw notFound('提交不存在');
    run('DELETE FROM submissions WHERE id = ?', row.id);
    return ok({ deleted: row.id });
  });

  router.get('/api/submissions/:a/diff/:b', (ctx) => {
    const a = get('SELECT * FROM submissions WHERE id = ?', toInt(ctx.params.a, '提交ID'));
    const b = get('SELECT * FROM submissions WHERE id = ?', toInt(ctx.params.b, '提交ID'));
    if (!a || !b) throw notFound('提交不存在');
    const canSee = (s) => isAtLeast(ctx.user, 'teacher') || (ctx.user && ctx.user.id === s.user_id);
    if (!canSee(a) || !canSee(b)) throw forbidden('无权查看该提交的代码');
    return ok({
      left: { id: a.id, language_id: a.language_id, created_at: a.created_at },
      right: { id: b.id, language_id: b.language_id, created_at: b.created_at },
      rows: diffLines(a.source_code, b.source_code),
    });
  });
}
