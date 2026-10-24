import { all } from '../db.js';
import { ok } from '../http/context.js';
import { escapeLike } from './helpers.js';
import { visibleEntityIds } from '../services/visibility.js';

export default function registerSearch(router) {
  router.get('/api/search', (ctx) => {
    const q = (ctx.query1('q', '') || '').trim();
    if (!q) return ok({ query: '', problems: [], contests: [], articles: [] });
    const normalized = q.replace(/\s+/g, '');
    const like = `%${escapeLike(q)}%`;
    const likeNorm = `%${escapeLike(normalized)}%`;
    const type = ctx.query1('type', 'all');
    const limit = Math.min(50, ctx.queryInt('limit', 10));

    const result = { query: q, problems: [], contests: [], articles: [] };

    if (type === 'all' || type === 'problem') {
      const visible = visibleEntityIds('problem', ctx.user, 'problems');
      let clause = "(REPLACE(title,' ','') LIKE ? OR REPLACE(description,' ','') LIKE ?)";
      const params = [likeNorm, likeNorm];
      if (visible !== null) {
        if (visible.length) { clause += ` AND id IN (${visible.map(() => '?').join(',')})`; params.push(...visible); }
        else clause += ' AND 0';
      }
      result.problems = all(
        `SELECT id, title, difficulty FROM problems WHERE ${clause} ORDER BY id LIMIT ?`,
        ...params, limit,
      );
    }

    if (type === 'all' || type === 'contest') {
      const visible = visibleEntityIds('contest', ctx.user, 'contests');
      let clause = "(REPLACE(title,' ','') LIKE ? OR REPLACE(description,' ','') LIKE ?)";
      const params = [likeNorm, likeNorm];
      if (visible !== null) {
        if (visible.length) { clause += ` AND id IN (${visible.map(() => '?').join(',')})`; params.push(...visible); }
        else clause += ' AND 0';
      }
      result.contests = all(`SELECT id, title, start_at, end_at FROM contests WHERE ${clause} ORDER BY id LIMIT ?`, ...params, limit);
    }

    if (type === 'all' || type === 'article') {
      const published = ctx.user && ['teacher', 'admin', 'su'].includes(ctx.user.role)
        ? '1=1'
        : "(published = 1 OR (publish_at IS NOT NULL AND publish_at <= datetime('now')))";
      result.articles = all(
        `SELECT id, title FROM articles WHERE ${published} AND (REPLACE(title,' ','') LIKE ? OR REPLACE(content,' ','') LIKE ?) ORDER BY id LIMIT ?`,
        likeNorm, like, limit,
      );
    }

    return ok(result);
  });
}
