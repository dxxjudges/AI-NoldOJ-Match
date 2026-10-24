'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole, canSee, visibleToGroup } = require('../middleware/auth');
const { str, int, bool } = require('../utils/validate');

const router = express.Router();

function statusOf(c, now = db.now()) {
  if (now < c.start_at) return 'not_started';
  if (now <= c.end_at) return 'in_progress';
  return 'ended';
}

function contestPublic(c) {
  return { ...c, status: statusOf(c) };
}

// GET /api/contests
router.get('/', (req, res) => {
  const page = Math.max(1, int(req.query.page, 1));
  const pageSize = Math.min(50, int(req.query.pageSize, 20));
  const where = [];
  const params = [];
  if (!req.user || req.user.role === 'user') where.push('c.is_public = 1');
  const kw = str(req.query.keyword, '', 100).replace(/\s+/g, '');
  if (kw) { where.push("replace(c.title,' ','') LIKE ?"); params.push(`%${kw}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM contests c ${whereSql}`, ...params).n;
  const rows = db.all(`SELECT c.* FROM contests c ${whereSql} ORDER BY c.start_at DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize);
  res.json({ items: rows.filter(c => visibleToGroup(req.user, 'contest', c.id)).map(contestPublic), total: Number(total), page, pageSize });
});

// GET /api/contests/:id
router.get('/:id', (req, res) => {
  const id = int(req.params.id, 0);
  const c = db.get('SELECT * FROM contests WHERE id = ?', id);
  if (!c) return res.status(404).json({ error: '比赛不存在' });
  if (!canSee(req.user, c.is_public) || !visibleToGroup(req.user, 'contest', id)) {
    return res.status(403).json({ error: '无权访问该比赛' });
  }
  const st = statusOf(c);
  const problems = db.all(
    `SELECT p.id, p.title, p.difficulty, cp.alias, cp.order_index FROM contest_problems cp
     JOIN problems p ON p.id = cp.problem_id WHERE cp.contest_id = ? ORDER BY cp.order_index`,
    id
  );
  // hide problems before start for non-teacher
  const canSeeProblems = st !== 'not_started' || (req.user && ROLE(req.user) >= 1);
  const out = contestPublic(c);
  out.problems = canSeeProblems ? problems : [];
  const isParticipant = req.user && (
    db.get('SELECT 1 AS x FROM contest_participants WHERE contest_id=? AND user_id=?', id, req.user.id) ||
    db.get('SELECT 1 AS x FROM contest_invites WHERE contest_id=? AND user_id=?', id, req.user.id)
  );
  out.joined = !!isParticipant;
  res.json({ contest: out });
});

function ROLE(u) {
  return { user: 0, teacher: 1, admin: 2, super: 3 }[u.role] ?? 0;
}

// GET /api/contests/:id/board  (leaderboard with freeze)
router.get('/:id/board', (req, res) => {
  const id = int(req.params.id, 0);
  const c = db.get('SELECT * FROM contests WHERE id = ?', id);
  if (!c) return res.status(404).json({ error: '比赛不存在' });
  if (!canSee(req.user, c.is_public) || !visibleToGroup(req.user, 'contest', id)) {
    return res.status(403).json({ error: '无权访问' });
  }
  const now = db.now();
  const st = statusOf(c, now);
  const freezeStart = c.end_at - c.freeze_minutes * 60000;
  const frozen = (c.freeze_minutes > 0 && now >= freezeStart && st === 'in_progress') || c.frozen;

  const participants = db.all(
    `SELECT u.id AS user_id, u.username FROM contest_participants cp JOIN users u ON u.id = cp.user_id
     WHERE cp.contest_id = ?`, id
  );
  const problems = db.all('SELECT problem_id, alias, order_index FROM contest_problems WHERE contest_id = ? ORDER BY order_index', id);
  const board = [];
  for (const p of participants) {
    let row = { user_id: p.user_id, username: p.username, total: 0, penalty: 0, cells: {} };
    for (const prob of problems) {
      const subs = db.all(
        `SELECT id, status, score, created_at FROM submissions
         WHERE contest_id = ? AND user_id = ? AND problem_id = ? ORDER BY id`,
        id, p.user_id, prob.problem_id
      ).filter(s => (!frozen || s.created_at <= freezeStart));
      let cell = { solved: false, attempts: 0, score: 0, first_ac: null };
      for (const s of subs) {
        if (frozen && s.created_at > freezeStart) continue;
        cell.attempts++;
        if (s.status === 'accepted' && !cell.solved) {
          cell.solved = true;
          cell.first_ac = s.created_at;
          cell.score = s.score;
          row.total += s.score;
          row.penalty += Math.floor((s.created_at - c.start_at) / 60000);
        }
      }
      row.cells[prob.problem_id] = cell;
    }
    board.push(row);
  }
  board.sort((a, b) => b.total - a.total || a.penalty - b.penalty || a.user_id - b.user_id);
  board.forEach((r, i) => { r.rank = i + 1; });
  res.json({ board, frozen, freezeStart, problems });
});

// POST /api/contests  (teacher+)
router.post('/', requireAuth, requireRole('teacher'), (req, res) => {
  const t = db.now();
  const title = str(req.body.title, '', 200);
  const start = Number(req.body.start_at), end = Number(req.body.end_at);
  if (!title || !start || !end || end <= start) return res.status(400).json({ error: '参数错误' });
  const info = db.run(
    `INSERT INTO contests (title, description, start_at, end_at, rating_enabled, freeze_minutes, is_public, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    title, str(req.body.description, ''), start, end,
    bool(req.body.rating_enabled) ? 1 : 0, int(req.body.freeze_minutes, 0),
    req.body.is_public !== undefined ? (bool(req.body.is_public) ? 1 : 0) : 1,
    req.user.id, t, t
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// PUT /api/contests/:id
router.put('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const c = db.get('SELECT * FROM contests WHERE id = ?', id);
  if (!c) return res.status(404).json({ error: '比赛不存在' });
  db.run(
    `UPDATE contests SET title=?, description=?, start_at=?, end_at=?, rating_enabled=?, freeze_minutes=?, is_public=?, updated_at=? WHERE id=?`,
    str(req.body.title, c.title, 200), str(req.body.description, c.description),
    Number(req.body.start_at) || c.start_at, Number(req.body.end_at) || c.end_at,
    req.body.rating_enabled !== undefined ? (bool(req.body.rating_enabled) ? 1 : 0) : c.rating_enabled,
    int(req.body.freeze_minutes, c.freeze_minutes),
    req.body.is_public !== undefined ? (bool(req.body.is_public) ? 1 : 0) : c.is_public,
    db.now(), id
  );
  res.json({ ok: true });
});

// DELETE /api/contests/:id
router.delete('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  db.run('DELETE FROM contests WHERE id = ?', int(req.params.id, 0));
  res.json({ ok: true });
});

// POST /api/contests/:id/problems  { problemId, alias }
router.post('/:id/problems', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const pid = int(req.body.problemId, 0);
  if (!db.get('SELECT id FROM problems WHERE id = ?', pid)) return res.status(404).json({ error: '题目不存在' });
  db.run(
    'INSERT OR IGNORE INTO contest_problems (contest_id, problem_id, alias, order_index) VALUES (?,?,?,?)',
    id, pid, str(req.body.alias, '', 50),
    int(req.body.order_index, db.get('SELECT COUNT(*) AS n FROM contest_problems WHERE contest_id=?', id).n)
  );
  res.status(201).json({ ok: true });
});

// DELETE /api/contests/:id/problems/:pid
router.delete('/:id/problems/:pid', requireAuth, requireRole('teacher'), (req, res) => {
  db.run('DELETE FROM contest_problems WHERE contest_id = ? AND problem_id = ?',
    int(req.params.id, 0), int(req.params.pid, 0));
  res.json({ ok: true });
});

// POST /api/contests/:id/invite  { username }
router.post('/:id/invite', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const u = db.get('SELECT id FROM users WHERE username = ?', str(req.body.username, '', 64));
  if (!u) return res.status(404).json({ error: '用户不存在' });
  db.run('INSERT OR IGNORE INTO contest_invites (contest_id, user_id, created_at) VALUES (?,?,?)', id, u.id, db.now());
  db.run('INSERT OR IGNORE INTO contest_participants (contest_id, user_id, joined_at) VALUES (?,?,?)', id, u.id, db.now());
  res.json({ ok: true });
});

// POST /api/contests/:id/join
router.post('/:id/join', requireAuth, (req, res) => {
  const id = int(req.params.id, 0);
  const c = db.get('SELECT * FROM contests WHERE id = ?', id);
  if (!c || !canSee(req.user, c.is_public)) return res.status(404).json({ error: '比赛不存在' });
  db.run('INSERT OR IGNORE INTO contest_participants (contest_id, user_id, joined_at) VALUES (?,?,?)', id, req.user.id, db.now());
  res.json({ ok: true });
});

// POST /api/contests/:id/unfreeze  (admin+)
router.post('/:id/unfreeze', requireAuth, requireRole('admin'), (req, res) => {
  db.run('UPDATE contests SET frozen = 0 WHERE id = ?', int(req.params.id, 0));
  res.json({ ok: true });
});

// POST /api/contests/:id/publish-solutions  (teacher+)
// Marks linked official solution articles visible; sets solutions_published.
router.post('/:id/publish-solutions', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const c = db.get('SELECT * FROM contests WHERE id = ?', id);
  if (!c) return res.status(404).json({ error: '比赛不存在' });
  if (db.now() <= c.end_at && req.body.force !== true) {
    return res.status(400).json({ error: '比赛未结束（可用 force=true 强制发布）' });
  }
  const pids = db.all('SELECT problem_id FROM contest_problems WHERE contest_id = ?', id).map(r => r.problem_id);
  let published = 0;
  for (const pid of pids) {
    const r = db.run(
      "UPDATE articles SET published = 1, updated_at = ? WHERE problem_id = ? AND is_solution = 1 AND published = 0",
      db.now(), pid
    );
    published += r.changes;
  }
  db.run('UPDATE contests SET solutions_published = 1, updated_at = ? WHERE id = ?', db.now(), id);
  res.json({ ok: true, published });
});

// GET /api/contests/:id/solutions  — linked solution articles (visible after end/publish)
router.get('/:id/solutions', (req, res) => {
  const id = int(req.params.id, 0);
  const c = db.get('SELECT * FROM contests WHERE id = ?', id);
  if (!c) return res.status(404).json({ error: '比赛不存在' });
  if (!canSee(req.user, c.is_public) || !visibleToGroup(req.user, 'contest', id)) {
    return res.status(403).json({ error: '无权访问' });
  }
  const privileged = req.user && ROLE(req.user) >= 1;
  const ended = db.now() > c.end_at;
  if (!privileged && !ended && !c.solutions_published) {
    return res.json({ items: [] });
  }
  const pids = db.all('SELECT problem_id FROM contest_problems WHERE contest_id = ?', id).map(r => r.problem_id);
  if (!pids.length) return res.json({ items: [] });
  const placeholders = pids.map(() => '?').join(',');
  const items = privileged
    ? db.all(`SELECT id, title, problem_id, author_name, published FROM articles WHERE is_solution = 1 AND problem_id IN (${placeholders})`, ...pids)
    : db.all(`SELECT id, title, problem_id, author_name, published FROM articles WHERE is_solution = 1 AND published = 1 AND problem_id IN (${placeholders})`, ...pids);
  res.json({ items });
});

module.exports = router;
