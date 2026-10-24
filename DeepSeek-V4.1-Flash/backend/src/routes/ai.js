import { get } from '../db.js';
import { requireRole } from '../http/auth.js';
import { badRequest, notFound, forbidden } from '../utils/errors.js';
import { ok } from '../http/context.js';
import { toInt } from './helpers.js';
import config from '../config.js';
import { generateHint, reviewCode, aiEnabled, detectInjection } from '../services/ai.js';

const hintCooldown = new Map();

export default function registerAi(router) {
  router.get('/api/ai/status', () => ok({
    ...aiEnabled(),
    securityModel: config.ai.security.enabled ? config.ai.security.model : null,
    hintCooldownSeconds: config.ai.hint.cooldownSeconds,
  }));

  router.post('/api/ai/hint', (ctx) => {
    if (!ctx.user) throw forbidden('请先登录');
    if (!config.ai.hint.enabled) throw badRequest('AI 提示功能未启用');
    const problem = get('SELECT * FROM problems WHERE id = ?', toInt(ctx.body.problem_id, '题目ID'));
    if (!problem) throw notFound('题目不存在');

    const failures = get(
      "SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND problem_id = ? AND status NOT IN ('pending','queued','compiling','running','accepted')",
      ctx.user.id, problem.id,
    ).n;
    if (failures < config.ai.hint.minFailures) {
      throw badRequest(`失败 ${config.ai.hint.minFailures} 次后才可使用提示（当前 ${failures} 次）`);
    }

    const key = `${ctx.user.id}:${problem.id}`;
    const now = Date.now();
    const last = hintCooldown.get(key) || 0;
    if (now - last < config.ai.hint.cooldownSeconds * 1000) {
      const wait = Math.ceil((config.ai.hint.cooldownSeconds * 1000 - (now - last)) / 1000);
      throw badRequest(`提示冷却中，请 ${wait} 秒后再试`);
    }
    hintCooldown.set(key, now);

    const lastStatus = get(
      'SELECT status FROM submissions WHERE user_id = ? AND problem_id = ? ORDER BY id DESC LIMIT 1',
      ctx.user.id, problem.id,
    )?.status;

    return generateHint({
      title: problem.title,
      description: problem.description,
      failures,
      lastStatus,
    }).then((result) => ok(result));
  });

  router.post('/api/ai/review', requireRole('teacher'), async (ctx) => {
    const { code, language = 'unknown' } = ctx.body;
    if (!code) throw badRequest('缺少代码');
    const result = await reviewCode({ code, language });
    const injections = detectInjection(code);
    return ok({ ...result, injections });
  });

  router.get('/api/ai/testdata-config', requireRole('teacher'), () => ok({
    enabled: Boolean(config.ai.testdata.enabled),
    model: config.ai.testdata.model,
  }));
}
