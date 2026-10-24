'use strict';

const db = require('../db/database');

/** Called when a user solves a problem — update progress on all sets containing it. */
function onSolved(userId, problemId) {
  const items = db.all('SELECT set_id FROM problem_set_items WHERE problem_id = ?', problemId);
  for (const it of items) {
    db.run(
      `INSERT INTO problem_set_progress (set_id, user_id, problem_id, solved, updated_at)
       VALUES (?,?,?,1,?)
       ON CONFLICT(set_id, user_id, problem_id) DO UPDATE SET solved = 1, updated_at = excluded.updated_at`,
      it.set_id, userId, problemId, db.now()
    );
  }
}

function progressFor(userId, setId) {
  const total = db.get('SELECT COUNT(*) AS n FROM problem_set_items WHERE set_id = ?', setId).n;
  const solved = db.get(
    'SELECT COUNT(*) AS n FROM problem_set_progress WHERE set_id = ? AND user_id = ? AND solved = 1',
    setId, userId
  ).n;
  return { total: Number(total), solved: Number(solved) };
}

module.exports = { onSolved, progressFor };
