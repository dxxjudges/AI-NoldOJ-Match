'use strict';

/**
 * AI code security review.
 * Async, non-blocking: submission enters 'ai_reviewing', review runs in
 * background; judging starts only after review passes. Malicious code =>
 * auto-ban + kick + token invalidation.
 */

const db = require('../../db/database');
const { config } = require('../../config');
const client = require('./client');
const { injectGuard, truncateCode } = require('./injectGuard');

const SYSTEM_PROMPT = `你是代码安全审计器。判断用户提交的代码是否包含恶意行为：
文件攻击、网络攻击、权限提升、挖矿程序、敏感信息窃取、破坏系统等。
只输出 JSON：{"passed":true|false,"risk":0.0-1.0,"findings":["..."]}`;

async function reviewSubmission(submissionId) {
  const sub = db.get('SELECT * FROM submissions WHERE id = ?', submissionId);
  if (!sub) return;
  if (!config.ai.reviewEnabled) {
    require('../judge/runner').submitToQueue(submissionId);
    return;
  }
  try {
    const code = truncateCode(sub.code);
    const guarded = injectGuard(code);
    const raw = await client.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `语言: ${sub.language}\n代码:\n\`\`\`\n${guarded}\n\`\`\`` },
    ]);
    const parsed = parseVerdict(raw);
    db.run(
      'INSERT INTO ai_reviews (submission_id, passed, risk_score, findings, raw, created_at) VALUES (?,?,?,?,?,?)',
      submissionId, parsed.passed ? 1 : 0, parsed.risk, JSON.stringify(parsed.findings), raw.slice(0, 8000), db.now()
    );
    if (!parsed.passed) {
      db.run("UPDATE submissions SET status='internal_error', detail=? WHERE id=?",
        JSON.stringify({ error: 'AI 安全审查未通过', findings: parsed.findings }), submissionId);
      autoBan(sub.user_id, `AI 安全审查发现恶意代码：${parsed.findings[0] || ''}`);
      return;
    }
    require('../judge/runner').submitToQueue(submissionId);
  } catch (e) {
    console.error('[ai-review] failed, judging continues:', e.message);
    // fail-open: AI outage should not block the judge
    require('../judge/runner').submitToQueue(submissionId);
  }
}

function parseVerdict(raw) {
  try {
    const m = String(raw).match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : '{}');
    return {
      passed: j.passed !== false,
      risk: Number(j.risk) || 0,
      findings: Array.isArray(j.findings) ? j.findings.slice(0, 10) : [],
    };
  } catch (_) {
    return { passed: true, risk: 0, findings: [] };
  }
}

function autoBan(userId, reason) {
  db.run('UPDATE users SET banned = 1, ban_reason = ?, force_logout_at = ?, updated_at = ? WHERE id = ?',
    reason.slice(0, 500), db.now(), db.now(), userId);
  // revoke refresh tokens — access tokens die via banned check + force_logout_at
  db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', db.now(), userId);
  db.run('INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?, ?, ?, ?)',
    userId, 'auto_ban_ai', reason.slice(0, 500), db.now());
  const { bus } = require('../judge/queue');
  bus.emit('kick', { userId, reason });
  console.warn(`[ai-review] Auto-banned user #${userId}: ${reason}`);
}

module.exports = { reviewSubmission, autoBan };
