const config = require('../config');
const { one, run } = require('../db/db');

const DIFF_NAMES = ['Entry', 'Easy', 'Medium', 'Hard', 'Very Hard', 'Expert'];

// Rating algorithm (configurable):
//  - New AC: acNewBase + difficulty * acDifficultyBonus
//  - Repeat AC: acRepeatBase
//  - CE: -cePenalty
//  - Self-delete protected; banned users unaffected
function applyRatingAfterJudge(userId, submissionId, problem, status, outputs) {
  if (!problem || !userId) return null;
  const user = one(`SELECT id, rating, banned FROM users WHERE id=?`, userId);
  if (!user || user.banned) return null;

  const r = config.rating;
  let delta = 0, reason = '';
  if (status === 'ac') {
    const solved = one(
      `SELECT id FROM submissions WHERE user_id=? AND problem_id=? AND status='ac' AND id<>? LIMIT 1`,
      userId, problem.id, submissionId);
    if (!solved) {
      delta = r.acNewBase + (problem.difficulty || 0) * r.acDifficultyBonus;
      reason = `First solve of problem ${problem.id} (${DIFF_NAMES[problem.difficulty] || '--'})`;
    } else {
      delta = r.acRepeatBase;
      reason = 'Problem already solved previously';
    }
  } else if (status === 'ce') {
    delta = -r.cePenalty;
    reason = 'Compilation error';
  } else {
    return null;
  }

  const before = user.rating;
  const after = Math.max(0, before + delta);
  run(`UPDATE users SET rating=? WHERE id=?`, after, userId);
  run(`INSERT INTO rating_history (user_id, submission_id, delta, before, after, reason, created_at) VALUES (?,?,?,?,?,?,?)`,
    userId, submissionId, delta, before, after, reason, Date.now());
  return { delta, before, after };
}

module.exports = { applyRatingAfterJudge, DIFF_NAMES };
