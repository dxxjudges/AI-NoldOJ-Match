const express = require('express');
const { one, all, run } = require('../db/db');
const { requireAuth, safeUser } = require('../utils/middleware');
const achievements = require('../services/achievements');
const { DIFF_NAMES } = require('../services/rating');

const router = express.Router();

router.put('/users/me', requireAuth, (req, res) => {
  const b = req.body || {};
  run(`UPDATE users SET signature=?, bio=?, preferred_lang=? WHERE id=?`,
    String(b.signature || '').slice(0, 200),
    String(b.bio || '').slice(0, 20000),
    String(b.preferredLang || '').slice(0, 30),
    req.user.id);
  res.json({ ok: true });
});

router.put('/users/me/privacy', requireAuth, (req, res) => {
  const set = (flag, v) => run(`UPDATE users SET ${flag}=?
    WHERE id=?`, v ? 1 : 0, req.user.id);
  set('privacy_achievements', !!req.body.hideAchievements);
  set('privacy_dashboard', !!req.body.hideDashboard);
  set('privacy_favorites', !!req.body.hideFavorites);
  res.json({ ok: true });
});

router.get('/users/:id', (req, res) => {
  const u = one(`SELECT * FROM users WHERE id=?`, req.params.id);
  if (!u) return res.status(404).json({ ok: false, error: 'User does not exist' });
  const isSelf = req.user && req.user.id === u.id;
  const isAdmin = req.user && ['admin', 'super'].includes(req.user.role);
  const data = {
    ...safeUser(u),
    banReason: u.banned ? u.ban_reason : undefined
  };
  // privacy switches: achievements/dashboard/favorites; admins always visible
  const achOn = !u.privacy_achievements || isSelf || isAdmin;
  const dashOn = !u.privacy_dashboard || isSelf || isAdmin;
  const favOn = !u.privacy_favorites || isSelf || isAdmin;
  data.privacyFlags = { achievements: achOn, dashboard: dashOn, favorites: favOn };

  if (dashOn) {
    data.dashboard = buildDashboard(u.id);
  }
  res.json({ ok: true, data });
});

function buildDashboard(userId) {
  const subs = all(`SELECT s.*, p.difficulty, l.name AS lang_name FROM submissions s
    JOIN problems p ON p.id=s.problem_id LEFT JOIN languages l ON l.id=s.language_id
    WHERE s.user_id=? AND s.is_ide=0 AND s.judged_at IS NOT NULL ORDER BY s.judged_at DESC LIMIT 4000`, userId);
  // submission calendar: last 365 days
  const dayMap = {};
  for (const s of subs) {
    const d = new Date(s.judged_at).toISOString().slice(0, 10);
    if (!dayMap[d]) dayMap[d] = { total: 0, ac: 0 };
    dayMap[d].total++;
    if (s.status === 'ac') dayMap[d].ac++;
  }
  const calendar = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    calendar.push({ date: d, total: dayMap[d]?.total || 0, ac: dayMap[d]?.ac || 0 });
  }
  const langDist = {};
  for (const s of subs) langDist[s.lang_name || 'Unknown'] = (langDist[s.lang_name || 'Unknown'] || 0) + 1;
  const acDist = {};
  for (const s of subs) {
    if (s.status !== 'ac') continue;
    const k = DIFF_NAMES[s.difficulty] || s.difficulty;
    acDist[k] = (acDist[k] || 0) + 1;
  }
  return { calendar, langDist, acDifficultyDist: acDist, totalSubs: subs.length };
}

router.get('/users/:id/achievements', (req, res) => {
  const u = one(`SELECT * FROM users WHERE id=?`, req.params.id);
  if (!u) return res.status(404).json({ ok: false, error: 'User does not exist' });
  const isSelf = req.user && req.user.id === u.id;
  const isAdmin = req.user && ['admin', 'super'].includes(req.user.role);
  if (u.privacy_achievements && !isSelf && !isAdmin) {
    return res.status(403).json({ ok: false, error: 'This user has hidden achievement list' });
  }
  res.json({ ok: true, data: { items: achievements.listAchievements(u.id) } });
});

router.get('/users/:id/favorites', (req, res) => {
  const u = one(`SELECT * FROM users WHERE id=?`, req.params.id);
  if (!u) return res.status(404).json({ ok: false, error: 'User does not exist' });
  const isSelf = req.user && req.user.id === u.id;
  const isAdmin = req.user && ['admin', 'super'].includes(req.user.role);
  if (u.privacy_favorites && !isSelf && !isAdmin) {
    return res.status(403).json({ ok: false, error: 'This user has hidden favorites' });
  }
  const items = all(`SELECT p.id, p.title, p.difficulty FROM favorites f JOIN problems p ON p.id=f.problem_id WHERE f.user_id=? ORDER BY f.created_at DESC`, u.id);
  res.json({ ok: true, data: { items } });
});

// Rating leaderboard with medals & rank titles
router.get('/rating/leaderboard', (req, res) => {
  const rows = all(`SELECT id, username, role, rating, signature FROM users WHERE banned=0 ORDER BY rating DESC, id ASC LIMIT 100`);
  const items = rows.map((r, i) => {
    let medal = 0; // 1 gold, 2 silver, 3 bronze
    if (i === 0) medal = 1; else if (i === 1) medal = 2; else if (i === 2) medal = 3;
    return { ...r, rank: i + 1, medal, title: rankTitle(r.rating) };
  });
  res.json({ ok: true, data: { items } });
});

function rankTitle(r) {
  if (r >= 2400) return 'Master';
  if (r >= 2100) return 'Diamond';
  if (r >= 1900) return 'Platinum';
  if (r >= 1700) return 'Gold';
  if (r >= 1550) return 'Silver';
  return 'Novice';
}

module.exports = router;
