import { get, run, all } from '../db.js';
import { createLogger } from '../logger.js';

const log = createLogger('achievements');

export const ACHIEVEMENTS = {
  first_blood: { title: '首次通过', description: '首次通过一道题目' },
  streak_7: { title: '七日连击', description: '连续 7 天有提交记录' },
  collector: { title: '收藏专家', description: '收藏 10 道题目' },
  hundred_submits: { title: '百炼成钢', description: '累计提交 100 次' },
  contest_winner: { title: '赛场之星', description: '在比赛中获得第一名' },
  problem_setter: { title: '出题达人', description: '创建 5 道题目' },
};

export function unlockAchievement(userId, key) {
  const meta = ACHIEVEMENTS[key];
  if (!meta) return false;
  const exists = get('SELECT id FROM achievements WHERE user_id = ? AND key = ?', userId, key);
  if (exists) return false;
  run(
    'INSERT INTO achievements (user_id, key, title, description) VALUES (?, ?, ?, ?)',
    userId, key, meta.title, meta.description,
  );
  log.info(`achievement unlocked user=${userId} key=${key}`);
  return true;
}

export function checkAchievements(userId) {
  const submitCount = get('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ?', userId).n;
  if (submitCount >= 100) unlockAchievement(userId, 'hundred_submits');

  const accepted = get(
    "SELECT COUNT(DISTINCT problem_id) AS n FROM submissions WHERE user_id = ? AND status = 'accepted'",
    userId,
  ).n;
  if (accepted >= 1) unlockAchievement(userId, 'first_blood');
  if (accepted >= 10) unlockAchievement(userId, 'collector');
}

export function listAchievements(userId) {
  return all('SELECT key, title, description, unlocked_at FROM achievements WHERE user_id = ? ORDER BY unlocked_at DESC', userId);
}

export default { ACHIEVEMENTS, unlockAchievement, checkAchievements, listAchievements };
