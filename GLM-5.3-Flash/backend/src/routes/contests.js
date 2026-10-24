const express = require('express');
const { one, all, run } = require('../db/db');
const { requireAuth, requireMin } = require('../utils/middleware');
const events = require('../ws/events');

const router = express.Router();

function contestState(c) {
  const now = Date.now();
  if (now < c.start_time) return 'notstarted';
  if (now < c.end_time) return 'running';
  return 'ended';
}

const isTeacher = (u) => u && ['teacher', 'admin', 'super'].includes(u.role);

// ---------- CRUD ----------
router.get('/contests', (req, res) => {
  let rows = all(`SELECT c.*, (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id=c.id) problem_count
    FROM contests c ORDER BY c.start_time DESC LIMIT 200`);
  rows.forEach(r => r.state = contestState(r));
  res.json({ ok: true, data: { items: rows } });
});

router.get('/contests/:id', (req, res) => {
  const c = one(`SELECT * FROM contests WHERE id=?`, req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Contest does not exist' });
  c.state = contestState(c);
  const problems = all(`
    SELECT p.id, p.title, cp.alias, cp.ord, p.difficulty
    FROM contest_problems cp JOIN problems p ON p.id=cp.problem_id WHERE cp.contest_id=? ORDER BY cp.ord, p.id`, c.id);
  let joined = false, invited = false;
  if (req.user) {
    joined = !!one(`SELECT 1 FROM contest_participants WHERE contest_id=? AND user_id=?`, c.id, req.user.id);
    invited = !!one(`SELECT 1 FROM contest_invites WHERE contest_id=? AND user_id=? AND used=0`, c.id, req.user.id);
  }
  let virtual = null;
  if (req.user && c.state === 'ended') {
    virtual = one(`SELECT * FROM virtual_participations WHERE contest_id=? AND user_id=?`, c.id, req.user.id) || null;
  }
  const frozen = computeFreeze(c, c.state);
  res.json({ ok: true, data: { contest: c, problems, joined, invited, virtual, frozen: frozen.frozen, freezeAt: frozen.freezeAt } });
});

function computeFreeze(c, state) {
  if (c.freeze_minutes <= 0) return { frozen: false, freezeAt: null };
  const freezeAt = c.end_time - c.freeze_minutes * 60 * 1000;
  const frozen = state === 'running' && Date.now() >= freezeAt;
  return { frozen, freezeAt };
}

router.post('/contests', requireMin('teacher'), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ ok: false, error: 'Title cannot be empty' });
  const start = Number(b.startTime) || Date.now();
  const end = Number(b.endTime) || start + 3600 * 1000;
  const info = run(`INSERT INTO contests (title, description_md, start_time, end_time, freeze_minutes, solution_article_id, scoreboard_public, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    b.title, b.descriptionMd || '', start, end, Math.max(0, Number(b.freezeMinutes) || 0),
    b.solutionArticleId ? Number(b.solutionArticleId) : null, b.scoreboardPublic === false ? 0 : 1, req.user.id, Date.now());
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.put('/contests/:id', requireMin('teacher'), (req, res) => {
  const c = one(`SELECT * FROM contests WHERE id=?`, req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Contest does not exist' });
  const b = req.body || {};
  run(`UPDATE contests SET title=?, description_md=?, start_time=?, end_time=?, freeze_minutes=? WHERE id=?`,
    b.title !== undefined ? b.title : c.title,
    b.descriptionMd !== undefined ? b.descriptionMd : c.description_md,
    b.startTime !== undefined ? Number(b.startTime) : c.start_time,
    b.endTime !== undefined ? Number(b.endTime) : c.end_time,
    b.freezeMinutes !== undefined ? Math.max(0, Number(b.freezeMinutes)) : c.freeze_minutes, c.id);
  res.json({ ok: true });
});

router.delete('/contests/:id', requireMin('teacher'), (req, res) => {
  run(`DELETE FROM contest_problems WHERE contest_id=?`, req.params.id);
  run(`DELETE FROM contest_participants WHERE contest_id=?`, req.params.id);
  run(`DELETE FROM contest_invites WHERE contest_id=?`, req.params.id);
  run(`DELETE FROM contests WHERE id=?`, req.params.id);
  res.json({ ok: true });
});

// ---------- problems in contest (can attach private problems) ----------
router.post('/contests/:id/problems', requireMin('teacher'), (req, res) => {
  const b = req.body || {};
  const info = run(`INSERT OR REPLACE INTO contest_problems (contest_id, problem_id, alias, ord) VALUES (?,?,?,?)`,
    Number(req.params.id), Number(b.problemId), b.alias || '', Number(b.ord) || 0);
  res.json({ ok: true });
});
router.delete('/contests/:id/problems/:pid', requireMin('teacher'), (req, res) => {
  run(`DELETE FROM contest_problems WHERE contest_id=? AND problem_id=?`, req.params.id, req.params.pid);
  res.json({ ok: true });
});

// ---------- join & invite ----------
router.post('/contests/:id/join', requireAuth, (req, res) => {
  const c = one(`SELECT * FROM contests WHERE id=?`, req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Contest does not exist' });
  const state = contestState(c);
  if (state !== 'running') return res.status(400).json({ ok: false, error: state === 'notstarted' ? 'Contest has not started' : 'Contest has ended' });
  // invite required (any invited user)
  const inv = one(`SELECT * FROM contest_invites WHERE contest_id=? AND user_id=?`, c.id, req.user.id);
  if (!inv && !isTeacher(req.user)) return res.status(403).json({ ok: false, error: 'You have not been invited to this contest' });
  run(`INSERT OR IGNORE INTO contest_participants (contest_id, user_id, joined_at) VALUES (?,?,?)`, c.id, req.user.id, Date.now());
  if (inv) run(`UPDATE contest_invites SET used=1 WHERE id=?`, inv.id);
  events.broadcast('leaderboard:update', { contestId: c.id });
  res.json({ ok: true });
});

router.post('/contests/:id/invite', requireMin('teacher'), (req, res) => {
  const c = one(`SELECT * FROM contests WHERE id=?`, req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Contest does not exist' });
  const b = req.body || {};
  const targetUserIds = [];
  if (Array.isArray(b.userIds)) targetUserIds.push(...b.userIds);
  if (b.username) {
    const u = one(`SELECT id FROM users WHERE username=?`, b.username);
    if (u) targetUserIds.push(u.id);
  }
  for (const uid of targetUserIds) {
    run(`INSERT INTO contest_invites (contest_id, user_id, invited_by, used, created_at) VALUES (?,?,?,0,?)`,
      c.id, uid, req.user.id, Date.now());
  }
  res.json({ ok: true, data: { invited: targetUserIds.length } });
});

router.get('/contests/:id/participants', requireMin('teacher'), (req, res) => {
  const items = all(`SELECT u.id, u.username, cp.joined_at FROM contest_participants cp JOIN users u ON u.id=cp.user_id WHERE cp.contest_id=? ORDER BY cp.joined_at`, req.params.id);
  const invites = all(`SELECT ci.*, u.username FROM contest_invites ci JOIN users u ON u.id=ci.user_id WHERE ci.contest_id=?`, req.params.id);
  res.json({ ok: true, data: { items, invites, state: contestState(one(`SELECT * FROM contests WHERE id=?`, req.params.id) || {}) } });
});

// ---------- leaderboard (freeze supported) ----------
router.get('/contests/:id/leaderboard', (req, res) => {
  const c = one(`SELECT * FROM contests WHERE id=?`, req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Contest does not exist' });
  const state = contestState(c);
  const fr = computeFreeze(c, state);
  if (!c.scoreboard_public) return res.status(403).json({ ok: false, error: 'Leaderboard is not public' });

  let subs = all(`
    SELECT s.id, s.user_id, s.problem_id, s.score, s.status, s.created_at, s.judged_at
    FROM submissions s WHERE s.contest_id=? AND s.is_ide=0 AND s.status IS NOT NULL
    ORDER BY s.created_at ASC`, c.id);
  if (fr.frozen) {
    subs = subs.filter(s => s.created_at < fr.freezeAt);
  }
  const parts = all(`SELECT cp.user_id, u.username FROM contest_participants cp JOIN users u ON u.id=cp.user_id WHERE cp.contest_id=?`, c.id);
  const probs = all(`SELECT cp.problem_id, cp.alias, p.title FROM contest_problems cp JOIN problems p ON p.id=cp.problem_id WHERE cp.contest_id=? ORDER BY cp.ord, p.id`, c.id);

  const rows = parts.map(p => {
    const bySolved = {};
    let total = 0, penalty = 0;
    for (const pid of probs) bySolved[pid.problem_id] = { solved: false, score: 0, at: 0, tries: 0, contestStartRelative: null };
    for (const s of subs.filter(ss => ss.user_id === p.user_id)) {
      const e = bySolved[s.problem_id];
      if (!e) continue;
      e.tries++;
      if (s.status === 'ac' && !e.solved) {
        e.solved = true; e.score = s.score;
        e.at = s.created_at;
        e.contestStartRelative = Math.max(0, Math.round((s.created_at - c.start_time) / 1000));
      }
      e.score = Math.max(e.score, s.status === 'ac' ? s.score : e.score);
    }
    for (const k of Object.keys(bySolved)) {
      const e = bySolved[k];
      total += e.score;
      if (e.solved) penalty += e.contestStartRelative + e.tries * 12 * 60; // 12 min per wrong try
    }
    return { userId: p.user_id, username: p.username, total, penalty, perProblem: bySolved };
  });
  rows.sort((a, b) => b.total - a.total || a.penalty - b.penalty);
  rows.forEach((r, i) => r.medal = i === 0 ? 1 : i === 1 ? 2 : i === 2 ? 3 : 0);
  res.json({
    ok: true,
    data: {
      problems: probs, rows, frozen: fr.frozen, freezeAt: fr.freezeAt,
      manualUnfrozen: !!c.solution_published && state === 'ended',
      state
    }
  });
});

// manual unfreeze after end (publish final standings)
router.post('/contests/:id/unfreeze', requireMin('teacher'), (req, res) => {
  run(`UPDATE contests SET solution_published=1 WHERE id=?`, req.params.id);
  res.json({ ok: true });
});

// auto-publish solution article after contest ends
router.post('/contests/:id/publish-solution', requireMin('teacher'), (req, res) => {
  const c = one(`SELECT * FROM contests WHERE id=?`, req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Contest does not exist' });
  if (contestState(c) !== 'ended') return res.status(400).json({ ok: false, error: 'Contest has not ended yet' });
  run(`UPDATE contests SET solution_published=1 WHERE id=?`, c.id);
  res.json({ ok: true });
});

// ---------- virtual contests ----------
router.post('/contests/:id/virtual', requireAuth, (req, res) => {
  const c = one(`SELECT * FROM contests WHERE id=?`, req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Contest does not exist' });
  if (contestState(c) !== 'ended') return res.status(400).json({ ok: false, error: 'Can only start virtual participation after the contest has ended' });
  const dup = one(`SELECT id FROM virtual_participations WHERE contest_id=? AND user_id=?`, c.id, req.user.id);
  if (dup) return res.status(400).json({ ok: false, error: 'You have already virtually participated in this contest' });
  const info = run(`INSERT INTO virtual_participations (contest_id, user_id, started_at) VALUES (?,?,?)`, c.id, req.user.id, Date.now());
  res.json({ ok: true, data: { virtualId: Number(info.lastInsertRowid), startedAt: Date.now(), durationMs: c.end_time - c.start_time } });
});

router.get('/virtual/:virtualId', (req, res) => {
  const v = one(`SELECT * FROM virtual_participations WHERE id=?`, req.params.virtualId);
  if (!v) return res.status(404).json({ ok: false, error: 'Virtual participation does not exist' });
  const c = one(`SELECT * FROM contests WHERE id=?`, v.contest_id);
  const durationMs = c.end_time - c.start_time;
  const elapsed = Date.now() - v.started_at;
  const ended = elapsed >= durationMs;
  // virtual leaderboard: own submissions only, judged against virtual start
  const subs = all(`SELECT id, problem_id, score, status, created_at FROM submissions WHERE virtual_id=? AND user_id=? ORDER BY created_at`, v.id, v.user_id);
  const probs = all(`SELECT cp.problem_id, cp.alias, p.title FROM contest_problems cp JOIN problems p ON p.id=cp.problem_id WHERE cp.contest_id=? ORDER BY cp.ord`, c.id);
  const byProblem = {};
  for (const pid of probs) byProblem[pid.problem_id] = { solved: 0, score: 0, at: 0 };
  let total = 0, penalty = 0;
  for (const s of subs) {
    const e = byProblem[s.problem_id];
    if (!e) continue;
    if (s.status === 'ac' && !e.solved) {
      e.solved = 1; e.score = s.score;
      e.at = Math.max(0, Math.round((s.created_at - v.started_at) / 1000));
    }
    e.score = Math.max(e.score, s.status === 'ac' ? s.score : e.score);
  }
  for (const k of Object.keys(byProblem)) { total += byProblem[k].score; if (byProblem[k].solved) penalty += byProblem[k].at; }
  res.json({
    ok: true,
    data: {
      virtual: v, contest: { id: c.id, title: c.title }, durationMs, elapsed, remainingMs: Math.max(0, durationMs - elapsed), ended,
      problems: probs, byProblem, total, penalty, userId: v.user_id
    }
  });
});

module.exports = router;
