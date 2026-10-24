'use strict';

const db = require('../db/database');

function unlock(userId, code) {
  const a = db.get('SELECT id FROM achievements WHERE code = ?', code);
  if (!a) return false;
  const r = db.run(
    'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?,?,?)',
    userId, a.id, db.now()
  );
  return r.changes > 0;
}

function onFirstBlood(userId, problemId) {
  // first ever AC on this problem
  const n = db.get(
    "SELECT COUNT(*) AS n FROM submissions WHERE problem_id = ? AND status = 'accepted'",
    problemId
  ).n;
  if (Number(n) === 1) unlock(userId, 'first_blood');
}

function checkOnSubmission(userId, problemId, status) {
  if (status !== 'accepted') return;
  const acProblems = db.get(
    "SELECT COUNT(DISTINCT problem_id) AS n FROM submissions WHERE user_id = ? AND status = 'accepted'",
    userId
  ).n;
  if (acProblems >= 10) unlock(userId, 'ac_10');
  if (acProblems >= 50) unlock(userId, 'ac_50');
  if (acProblems >= 100) unlock(userId, 'ac_100');

  // streak: consecutive accepted submissions (by id order)
  const recent = db.all(
    'SELECT status FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 10',
    userId
  );
  let streak = 0;
  for (const r of recent) {
    if (r.status === 'accepted') streak++;
    else break;
  }
  if (streak >= 5) unlock(userId, 'streak_5');
  if (streak >= 10) unlock(userId, 'streak_10');

  const hour = new Date().getHours();
  if (hour >= 2 && hour < 4) unlock(userId, 'night_owl');
}

function listForUser(userId) {
  const rows = db.all(
    `SELECT a.code, a.name, a.description, a.icon, ua.unlocked_at
     FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
     WHERE ua.user_id = ? ORDER BY ua.unlocked_at DESC`,
    userId
  );
  const all = db.all('SELECT code, name, description, icon FROM achievements');
  const got = new Set(rows.map(r => r.code));
  return {
    unlocked: rows,
    locked: all.filter(a => !got.has(a.code)),
  };
}

module.exports = { unlock, onFirstBlood, checkOnSubmission, listForUser };
