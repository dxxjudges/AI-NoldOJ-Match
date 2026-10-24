'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, ROLE_RANK } = require('../middleware/auth');
const { str, int, bool, parseJson } = require('../utils/validate');
const rating = require('../services/rating');
const achievements = require('../services/achievements');

const router = express.Router();

// GET /api/users/ranking
router.get('/ranking', (req, res) => {
  res.json({ items: rating.leaderboard(100) });
});

// GET /api/users/:username  (profile)
router.get('/:username', (req, res) => {
  const u = db.get(
    'SELECT id, username, role, rating, signature, bio, preferred_language, created_at, banned FROM users WHERE username = ?',
    str(req.params.username, '', 64)
  );
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const viewer = req.user;
  const privileged = viewer && (ROLE_RANK[viewer.role] >= ROLE_RANK.admin);
  const self = viewer && viewer.id === u.id;
  const priv = db.get('SELECT * FROM privacy_settings WHERE user_id = ?', u.id) ||
    { hide_achievements: 0, hide_dashboard: 0, hide_favorites: 0 };

  const out = {
    user: { id: u.id, username: u.username, role: u.role, rating: u.rating, signature: u.signature, bio: u.bio, preferred_language: u.preferred_language, created_at: u.created_at },
    title: rating.titleOf(u.rating),
    stats: {
      submit: Number(db.get('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ?', u.id).n),
      accepted: Number(db.get("SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND status='accepted'", u.id).n),
      solved: Number(db.get("SELECT COUNT(DISTINCT problem_id) AS n FROM submissions WHERE user_id = ? AND status='accepted'", u.id).n),
    },
  };
  if (self || privileged || !priv.hide_achievements) {
    out.achievements = achievements.listForUser(u.id);
  }
  if (self || privileged || !priv.hide_favorites) {
    out.favorites = db.all(
      'SELECT p.id, p.title, p.difficulty FROM favorites f JOIN problems p ON p.id = f.problem_id WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 100',
      u.id
    );
  }
  if (self || privileged || !priv.hide_dashboard) {
    // dashboard: language distribution + AC by difficulty (last 365 days)
    out.dashboard = {
      languages: db.all(
        'SELECT language, COUNT(*) AS count FROM submissions WHERE user_id = ? GROUP BY language ORDER BY count DESC',
        u.id
      ),
      difficulty: db.all(
        `SELECT p.difficulty, COUNT(DISTINCT s.problem_id) AS count
         FROM submissions s JOIN problems p ON p.id = s.problem_id
         WHERE s.user_id = ? AND s.status = 'accepted' GROUP BY p.difficulty`,
        u.id
      ),
      calendar: db.all(
        `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') AS day, COUNT(*) AS count
         FROM submissions WHERE user_id = ? AND created_at > ? GROUP BY day`,
        u.id, db.now() - 365 * 86400 * 1000
      ),
    };
  }
  res.json(out);
});

// PUT /api/users/me  (update own profile)
router.put('/me', requireAuth, (req, res) => {
  const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  db.run(
    'UPDATE users SET signature=?, bio=?, preferred_language=?, updated_at=? WHERE id=?',
    str(req.body.signature, u.signature, 500),
    str(req.body.bio, u.bio, 5000),
    str(req.body.preferred_language, u.preferred_language, 32) || null,
    db.now(), req.user.id
  );
  if (req.body.privacy) {
    db.run(
      `INSERT INTO privacy_settings (user_id, hide_achievements, hide_dashboard, hide_favorites) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET hide_achievements=excluded.hide_achievements,
         hide_dashboard=excluded.hide_dashboard, hide_favorites=excluded.hide_favorites`,
      req.user.id,
      bool(req.body.privacy.hideAchievements) ? 1 : 0,
      bool(req.body.privacy.hideDashboard) ? 1 : 0,
      bool(req.body.privacy.hideFavorites) ? 1 : 0
    );
  }
  res.json({ ok: true });
});

// POST /api/users/favorites/:problemId
router.post('/favorites/:problemId', requireAuth, (req, res) => {
  const pid = int(req.params.problemId, 0);
  const r = db.run('INSERT OR IGNORE INTO favorites (user_id, problem_id, created_at) VALUES (?,?,?)',
    req.user.id, pid, db.now());
  if (r.changes > 0) achievements.unlock(req.user.id, 'collector');
  res.json({ ok: true, favorited: true });
});

// DELETE /api/users/favorites/:problemId
router.delete('/favorites/:problemId', requireAuth, (req, res) => {
  db.run('DELETE FROM favorites WHERE user_id = ? AND problem_id = ?', req.user.id, int(req.params.problemId, 0));
  res.json({ ok: true, favorited: false });
});

module.exports = router;
