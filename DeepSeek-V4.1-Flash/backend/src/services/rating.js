import { get, run } from '../db.js';
import { broadcast, sendToUser } from './websocket.js';
import { createLogger } from '../logger.js';

const log = createLogger('rating');

const COMPILE_ERROR_PENALTY = -2;

function rewardForDifficulty(difficulty) {
  return 50 + Math.max(1, Number(difficulty) || 1) * 10;
}

export function applyRating(userId, { status, problem, firstAc = false }) {
  if (!userId) return;
  const user = get('SELECT id, rating FROM users WHERE id = ?', userId);
  if (!user) return;

  let delta = 0;
  if (status === 'compile_error') delta = COMPILE_ERROR_PENALTY;
  else if (status === 'accepted' && firstAc) delta = rewardForDifficulty(problem?.difficulty);

  if (delta === 0) return;

  const next = Math.max(0, user.rating + delta);
  run('UPDATE users SET rating = ? WHERE id = ?', next, userId);
  log.debug(`rating ${userId}: ${user.rating} -> ${next} (${delta > 0 ? '+' : ''}${delta})`);
  broadcast('rating_update', { userId, rating: next, delta });
  sendToUser(userId, 'rating_update', { rating: next, delta });
}

export function setRating(userId, value) {
  run('UPDATE users SET rating = ? WHERE id = ?', Math.max(0, Math.round(value)), userId);
  broadcast('rating_update', { userId, rating: value });
}

export function rankTitle(rating) {
  if (rating >= 2600) return '大师';
  if (rating >= 2200) return '专家';
  if (rating >= 1800) return '高手';
  if (rating >= 1500) return '熟练';
  if (rating >= 1200) return '入门';
  return '新手';
}

export default { applyRating, setRating, rankTitle };
