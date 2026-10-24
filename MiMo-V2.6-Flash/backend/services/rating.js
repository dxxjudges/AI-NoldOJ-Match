'use strict';

const db = require('../db/database');

const TITLES = [
  [2200, '大师'], [1800, '专家'], [1500, '进阶'], [1200, '熟练'], [900, '入门'], [0, '新手'],
];

function titleOf(rating) {
  for (const [min, name] of TITLES) if (rating >= min) return name;
  return '新手';
}

/**
 * Update user rating after a judging completes.
 * New AC awards points; compilation error deducts points.
 */
function onJudged(submissionId, userId, status) {
  const sub = db.get('SELECT * FROM submissions WHERE id = ?', submissionId);
  if (!sub || sub.rated) return;
  const user = db.get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return;

  let delta = 0;
  if (status === 'accepted') {
    // first AC on this problem awards more
    const prior = db.get(
      "SELECT COUNT(*) AS n FROM submissions WHERE user_id=? AND problem_id=? AND status='accepted' AND id < ?",
      userId, sub.problem_id, submissionId
    );
    delta = Number(prior.n) === 0 ? 20 : 5;
  } else if (status === 'compile_error') {
    delta = -2;
  } else {
    delta = 0;
  }
  if (delta !== 0) {
    db.run('UPDATE users SET rating = MAX(0, rating + ?), updated_at = ? WHERE id = ?', delta, db.now(), userId);
  }
  db.run('UPDATE submissions SET rated = 1 WHERE id = ?', submissionId);
  const { bus } = require('./judge/queue');
  const fresh = db.get('SELECT rating FROM users WHERE id = ?', userId);
  bus.emit('rating', { userId, rating: fresh ? fresh.rating : user.rating, delta });
}

function leaderboard(limit = 50) {
  const rows = db.all(
    'SELECT id, username, rating FROM users WHERE banned = 0 ORDER BY rating DESC, id ASC LIMIT ?',
    limit
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1, title: titleOf(r.rating) }));
}

module.exports = { onJudged, leaderboard, titleOf };
