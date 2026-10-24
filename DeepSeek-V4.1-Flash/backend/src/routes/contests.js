import { all, get, run } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { paginate, ok } from '../http/context.js';
import { requireFields, toInt } from './helpers.js';
import { canView, visibleEntityIds } from '../services/visibility.js';
import { broadcast } from '../services/websocket.js';

function contestStatus(contest) {
  const now = Date.now();
  const start = Date.parse(contest.start_at.replace(' ', 'T'));
  const end = Date.parse(contest.end_at.replace(' ', 'T'));
  if (Number.isNaN(start) || Number.isNaN(end)) return 'unknown';
  if (now < start) return 'pending';
  if (now > end) return 'ended';
  return 'running';
}

function isFrozen(contest) {
  if (!contest.freeze_minutes) return false;
  const now = Date.now();
  const end = Date.parse(contest.end_at.replace(' ', 'T'));
  const freezeAt = end - contest.freeze_minutes * 60_000;
  return now >= freezeAt && now <= end;
}

function serializeContest(contest) {
  return {
    ...contest,
    status: contestStatus(contest),
    frozen: isFrozen(contest),
    problem_count: get('SELECT COUNT(*) AS n FROM contest_problems WHERE contest_id = ?', contest.id).n,
    participant_count: get('SELECT COUNT(*) AS n FROM contest_participants WHERE contest_id = ?', contest.id).n,
  };
}

export default function registerContests(router) {
  router.get('/api/contests', (ctx) => {
    const { page, pageSize, offset } = paginate(ctx);
    const where = [];
    const params = [];
    const visible = visibleEntityIds('contest', ctx.user, 'contests');
    if (visible !== null) {
      if (!visible.length) return ok({ total: 0, page, pageSize, items: [] });
      where.push(`id IN (${visible.map(() => '?').join(',')})`);
      params.push(...visible);
    }
    const search = ctx.query1('search', '');
    if (search) { where.push('(REPLACE(title," ","") LIKE ? OR description LIKE ?)'); params.push(`%${search.replace(/\s+/g, '')}%`, `%${search}%`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM contests ${clause}`, ...params).n;
    const rows = all(`SELECT * FROM contests ${clause} ORDER BY start_at DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
    return ok({ total, page, pageSize, items: rows.map(serializeContest) });
  });

  router.post('/api/contests', requireRole('teacher'), (ctx) => {
    requireFields(ctx.body, ['title', 'start_at', 'end_at']);
    const { title, description = '', start_at, end_at, freeze_minutes = 0, is_public = true, allow_virtual = true } = ctx.body;
    const info = run(
      `INSERT INTO contests (title, description, start_at, end_at, freeze_minutes, created_by, is_public, allow_virtual)
       VALUES (?,?,?,?,?,?,?,?)`,
      title, description, start_at, end_at, Number(freeze_minutes) || 0, ctx.user.id, is_public ? 1 : 0, allow_virtual ? 1 : 0,
    );
    return ok(serializeContest(get('SELECT * FROM contests WHERE id = ?', Number(info.lastInsertRowid))));
  });

  router.get('/api/contests/:id', (ctx) => {
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    if (!canView('contest', ctx.user, contest, { ownerField: 'created_by' })) throw forbidden('无权访问该比赛');
    const data = serializeContest(contest);
    data.problems = all(
      `SELECT cp.problem_id, cp.alias, cp.sort, p.title, p.difficulty, p.visibility
         FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
        WHERE cp.contest_id = ? ORDER BY cp.sort, cp.problem_id`,
      contest.id,
    );
    if (ctx.user) {
      data.joined = Boolean(get('SELECT 1 FROM contest_participants WHERE contest_id = ? AND user_id = ?', contest.id, ctx.user.id));
      const virtual = get('SELECT * FROM virtual_contests WHERE contest_id = ? AND user_id = ?', contest.id, ctx.user.id);
      data.virtual = virtual || null;
    }
    data.announcements = all(
      'SELECT id, title, created_at FROM announcements WHERE contest_id = ? ORDER BY pinned DESC, id DESC',
      contest.id,
    );
    return ok(data);
  });

  router.put('/api/contests/:id', requireRole('teacher'), (ctx) => {
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    if (!isAtLeast(ctx.user, 'admin') && contest.created_by !== ctx.user.id) throw forbidden();
    const fields = [];
    const params = [];
    for (const key of ['title', 'description', 'start_at', 'end_at', 'freeze_minutes', 'is_public', 'allow_virtual']) {
      if (ctx.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(typeof ctx.body[key] === 'boolean' ? (ctx.body[key] ? 1 : 0) : ctx.body[key]);
      }
    }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(contest.id);
    run(`UPDATE contests SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(serializeContest(get('SELECT * FROM contests WHERE id = ?', contest.id)));
  });

  router.delete('/api/contests/:id', requireRole('teacher'), (ctx) => {
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    if (!isAtLeast(ctx.user, 'admin') && contest.created_by !== ctx.user.id) throw forbidden();
    run('DELETE FROM contests WHERE id = ?', contest.id);
    return ok({ deleted: contest.id });
  });

  router.post('/api/contests/:id/problems', requireRole('teacher'), (ctx) => {
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    const { problem_id, alias = '' } = ctx.body;
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(problem_id, '题目ID'));
    if (!problem) throw notFound('题目不存在');
    const sort = get('SELECT COALESCE(MAX(sort),0)+1 AS s FROM contest_problems WHERE contest_id = ?', contest.id).s;
    run('INSERT OR REPLACE INTO contest_problems (contest_id, problem_id, alias, sort) VALUES (?,?,?,?)', contest.id, problem.id, alias, sort);
    return ok({ contest_id: contest.id, problem_id: problem.id });
  });

  router.delete('/api/contests/:id/problems/:problemId', requireRole('teacher'), (ctx) => {
    run('DELETE FROM contest_problems WHERE contest_id = ? AND problem_id = ?', toInt(ctx.params.id, '比赛ID'), toInt(ctx.params.problemId, '题目ID'));
    return ok({ deleted: ctx.params.problemId });
  });

  router.post('/api/contests/:id/participants', requireRole('teacher'), (ctx) => {
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    const ids = Array.isArray(ctx.body.user_ids) ? ctx.body.user_ids : [ctx.body.user_id];
    const added = [];
    for (const uid of ids) {
      const user = get('SELECT * FROM users WHERE id = ?', toInt(uid, '用户ID'));
      if (!user) continue;
      run('INSERT OR IGNORE INTO contest_participants (contest_id, user_id, invited_by) VALUES (?,?,?)', contest.id, user.id, ctx.user.id);
      added.push(user.id);
    }
    return ok({ added });
  });

  router.delete('/api/contests/:id/participants/:userId', requireRole('teacher'), (ctx) => {
    run('DELETE FROM contest_participants WHERE contest_id = ? AND user_id = ?', toInt(ctx.params.id, '比赛ID'), toInt(ctx.params.userId, '用户ID'));
    return ok({ removed: ctx.params.userId });
  });

  router.get('/api/contests/:id/leaderboard', (ctx) => {
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    if (!canView('contest', ctx.user, contest, { ownerField: 'created_by' })) throw forbidden();
    const frozen = isFrozen(contest);
    const hidden = frozen && !isAtLeast(ctx.user, 'admin');
    const problems = all('SELECT problem_id FROM contest_problems WHERE contest_id = ?', contest.id).map((r) => r.problem_id);
    const participants = all(
      'SELECT u.id, u.username, u.rating FROM contest_participants p JOIN users u ON u.id = p.user_id WHERE p.contest_id = ?',
      contest.id,
    );
    const entries = participants.map((user) => {
      const cells = problems.map((pid) => {
        const best = get(
          `SELECT id, status, score, time_ms, created_at FROM submissions
            WHERE user_id = ? AND problem_id = ? AND contest_id = ? AND status != 'banned'
            ORDER BY score DESC, time_ms ASC, id ASC LIMIT 1`,
          user.id, pid, contest.id,
        );
        return best ? { problem_id: pid, score: best.score, status: best.status, time_ms: best.time_ms, id: best.id } : { problem_id: pid, score: 0, status: null };
      });
      const total = cells.reduce((sum, c) => sum + (c.score || 0), 0);
      const penalty = cells.reduce((sum, c) => sum + (c.status === 'accepted' ? Math.floor((c.time_ms || 0) / 1000) : 0), 0);
      return { user_id: user.id, username: user.username, rating: user.rating, total, penalty, cells };
    });
    entries.sort((a, b) => b.total - a.total || a.penalty - b.penalty || a.user_id - b.user_id);
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
      entry.medal = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : null;
    });
    return ok({ frozen, hidden, problems, entries: hidden ? entries.map((e) => ({ ...e, cells: e.cells, total: null })) : entries });
  });

  router.post('/api/contests/:id/unfreeze', requireRole('admin'), (ctx) => {
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    run('UPDATE contests SET freeze_minutes = 0 WHERE id = ?', contest.id);
    broadcast('contest_unfreeze', { contestId: contest.id });
    return ok({ unfrozen: contest.id });
  });

  router.post('/api/contests/:id/virtual', (ctx) => {
    if (!ctx.user) throw forbidden('请先登录');
    const contest = get('SELECT * FROM contests WHERE id = ?', toInt(ctx.params.id, '比赛ID'));
    if (!contest) throw notFound('比赛不存在');
    if (!contest.allow_virtual) throw badRequest('该比赛不支持虚拟参赛');
    if (contestStatus(contest) !== 'ended') throw badRequest('仅可在比赛结束后进行虚拟参赛');
    if (get('SELECT 1 FROM virtual_contests WHERE contest_id = ? AND user_id = ?', contest.id, ctx.user.id)) {
      throw badRequest('你已经参加过该比赛的虚拟赛');
    }
    const info = run('INSERT INTO virtual_contests (contest_id, user_id) VALUES (?,?)', contest.id, ctx.user.id);
    return ok(get('SELECT * FROM virtual_contests WHERE id = ?', Number(info.lastInsertRowid)));
  });

  router.post('/api/virtual/:id/start', (ctx) => {
    if (!ctx.user) throw forbidden();
    const virtual = get('SELECT * FROM virtual_contests WHERE id = ?', toInt(ctx.params.id, '虚拟赛ID'));
    if (!virtual) throw notFound('虚拟赛不存在');
    if (virtual.user_id !== ctx.user.id) throw forbidden();
    if (virtual.start_at) throw badRequest('虚拟赛已开始');
    const contest = get('SELECT * FROM contests WHERE id = ?', virtual.contest_id);
    const start = new Date();
    const end = new Date(start.getTime() + (Date.parse(contest.end_at.replace(' ', 'T')) - Date.parse(contest.start_at.replace(' ', 'T'))));
    run('UPDATE virtual_contests SET start_at = ?, end_at = ? WHERE id = ?',
      start.toISOString(), end.toISOString(), virtual.id);
    return ok(get('SELECT * FROM virtual_contests WHERE id = ?', virtual.id));
  });

  router.get('/api/virtual/:id/leaderboard', (ctx) => {
    const virtual = get('SELECT * FROM virtual_contests WHERE id = ?', toInt(ctx.params.id, '虚拟赛ID'));
    if (!virtual) throw notFound('虚拟赛不存在');
    if (!ctx.user || (virtual.user_id !== ctx.user.id && !isAtLeast(ctx.user, 'admin'))) throw forbidden();
    const cells = all(
      `SELECT problem_id, MAX(score) AS score, MIN(time_ms) AS time_ms
         FROM submissions WHERE virtual_contest_id = ? GROUP BY problem_id`,
      virtual.id,
    );
    const total = cells.reduce((sum, c) => sum + (c.score || 0), 0);
    return ok({ virtual, cells, total });
  });
}
