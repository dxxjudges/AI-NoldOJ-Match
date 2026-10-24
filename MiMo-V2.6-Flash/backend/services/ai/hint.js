'use strict';

const db = require('../../db/database');
const { config } = require('../../config');
const client = require('./client');

/**
 * AI hint: after 2 failed attempts on a problem, student may request a
 * directional algorithm hint (no complete code, <= 300 Chinese chars).
 * 60s cooldown per user per problem.
 */

const SYSTEM = `你是温和的算法教练。根据学生在该题的提交历史，给出方向性提示（不超过300汉字）。
禁止给出完整代码或直接答案，只提示思路、算法方向或常见误区。`;

function cooldownRemaining(userId, problemId) {
  const windowMs = config.ai.hintCooldownSec * 1000;
  const row = db.get(
    'SELECT created_at FROM ai_hints WHERE user_id = ? AND problem_id = ? ORDER BY created_at DESC LIMIT 1',
    userId, problemId
  );
  if (!row) return 0;
  const left = Number(row.created_at) + windowMs - db.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

function failCount(userId, problemId) {
  return Number(db.get(
    "SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND problem_id = ? AND status NOT IN ('accepted','pending','queued','compiling','judging','ai_reviewing')",
    userId, problemId
  ).n);
}

async function getHint(userId, problemId) {
  if (!config.ai.hintEnabled) return { error: 'AI 提示未启用' };
  const fails = failCount(userId, problemId);
  if (fails < config.ai.hintFailThreshold) {
    return { error: `至少失败 ${config.ai.hintFailThreshold} 次后才能获取提示` };
  }
  const cool = cooldownRemaining(userId, problemId);
  if (cool > 0) return { error: `冷却中，请 ${cool} 秒后再试` };

  const problem = db.get('SELECT * FROM problems WHERE id = ?', problemId);
  if (!problem) return { error: '题目不存在' };
  const subs = db.all(
    'SELECT status, language, detail FROM submissions WHERE user_id = ? AND problem_id = ? ORDER BY id DESC LIMIT 5',
    userId, problemId
  );

  const context = [
    `题目标题: ${problem.title}`,
    `题目描述(截断): ${String(problem.description).slice(0, 800)}`,
    `数据范围: ${String(problem.hint).slice(0, 200)}`,
    `最近提交: ${subs.map(s => s.status).join(', ')}`,
  ].join('\n');

  try {
    const raw = await client.chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: context },
    ]);
    let hint = String(raw).trim();
    if (hint.length > 600) hint = hint.slice(0, 600);
    db.run('INSERT INTO ai_hints (user_id, problem_id, hint, created_at) VALUES (?,?,?,?)',
      userId, problemId, hint, db.now());
    return { hint };
  } catch (e) {
    return { error: 'AI 服务暂不可用：' + e.message };
  }
}

module.exports = { getHint, cooldownRemaining, failCount };
