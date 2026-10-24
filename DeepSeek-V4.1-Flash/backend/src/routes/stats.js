import { all, get } from '../db.js';
import { ok } from '../http/context.js';
import { userGroupIds } from '../services/visibility.js';

export default function registerStats(router) {
  router.get('/api/stats/overview', (ctx) => {
    const visibleProblems = get('SELECT COUNT(*) AS n FROM problems').n;
    return ok({
      users: get('SELECT COUNT(*) AS n FROM users').n,
      problems: visibleProblems,
      submissions: get('SELECT COUNT(*) AS n FROM submissions').n,
      accepted: get("SELECT COUNT(*) AS n FROM submissions WHERE status = 'accepted'").n,
      contests: get('SELECT COUNT(*) AS n FROM contests').n,
      articles: get('SELECT COUNT(*) AS n FROM articles').n,
      todaySubmissions: get("SELECT COUNT(*) AS n FROM submissions WHERE date(created_at) = date('now')").n,
      myGroups: ctx.user ? userGroupIds(ctx.user.id) : [],
    });
  });

  router.get('/api/stats/wordcloud', () => {
    const rows = all(
      `SELECT t.name, t.color, COUNT(pt.problem_id) AS value
         FROM tags t LEFT JOIN problem_tags pt ON pt.tag_id = t.id
        GROUP BY t.id HAVING value > 0 ORDER BY value DESC LIMIT 100`,
    );
    const accepted = all(
      `SELECT p.title AS name, COUNT(s.id) AS accepted_count
         FROM problems p LEFT JOIN submissions s ON s.problem_id = p.id AND s.status = 'accepted'
        GROUP BY p.id ORDER BY accepted_count DESC LIMIT 100`,
    );
    return ok({ tags: rows, problems: accepted });
  });

  router.get('/api/stats/recent', () => {
    const submissions = all(
      `SELECT s.id, s.status, s.created_at, u.id AS user_id, u.username, p.id AS problem_id, p.title AS problem_title
         FROM submissions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN problems p ON p.id = s.problem_id
        ORDER BY s.id DESC LIMIT 20`,
    );
    return ok(submissions);
  });

  router.get('/api/stats/languages', () => {
    const rows = all(
      `SELECT l.name, COUNT(s.id) AS value FROM languages l
         LEFT JOIN submissions s ON s.language_id = l.id GROUP BY l.id ORDER BY value DESC`,
    );
    return ok(rows);
  });
}
