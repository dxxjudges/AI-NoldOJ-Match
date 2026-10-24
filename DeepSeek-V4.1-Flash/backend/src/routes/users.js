import { get, all, run } from '../db.js';
import { publicUser, requireRole, isAtLeast, ROLE_LEVEL } from '../http/auth.js';
import { hashPassword, generatePassword } from '../utils/password.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { paginate, ok } from '../http/context.js';
import { boolOf, escapeLike, requireFields, toInt } from './helpers.js';
import { issueAccessToken } from '../utils/jwt.js';
import { rankTitle } from '../services/rating.js';
import { listAchievements, ACHIEVEMENTS } from '../services/achievements.js';
import { addUserToAllGroup } from '../seed.js';
import { broadcast } from '../services/websocket.js';
import config from '../config.js';

function canManage(actor, target) {
  if (!actor) return false;
  if (actor.id === target.id) return true;
  if (actor.role === 'su') return true;
  if (actor.role === 'admin') return ROLE_LEVEL[target.role] <= ROLE_LEVEL.admin;
  return false;
}

export default function registerUsers(router) {
  router.get('/api/users', requireRole('admin'), (ctx) => {
    const { page, pageSize, offset } = paginate(ctx);
    const search = ctx.query1('search', '');
    const role = ctx.query1('role', '');
    const where = [];
    const params = [];
    if (search) { where.push('username LIKE ?'); params.push(`%${escapeLike(search)}%`); }
    if (role) { where.push('role = ?'); params.push(role); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM users ${clause}`, ...params).n;
    const rows = all(
      `SELECT * FROM users ${clause} ORDER BY id LIMIT ? OFFSET ?`,
      ...params, pageSize, offset,
    );
    return ok({ total, page, pageSize, items: rows.map(publicUser) });
  });

  router.get('/api/users/leaderboard', (ctx) => {
    const limit = Math.min(100, ctx.queryInt('limit', 50));
    const rows = all(
      'SELECT id, username, role, rating, signature FROM users WHERE banned = 0 ORDER BY rating DESC, id ASC LIMIT ?',
      limit,
    );
    return ok(rows.map((row, index) => ({
      rank: index + 1,
      ...row,
      title: rankTitle(row.rating),
      medal: index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : null,
    })));
  });

  router.get('/api/users/:id', (ctx) => {
    const raw = String(ctx.params.id);
    const user = /^\d+$/.test(raw)
      ? get('SELECT * FROM users WHERE id = ?', Number(raw))
      : get('SELECT * FROM users WHERE username = ?', raw);
    if (!user) throw notFound('用户不存在');
    const viewer = ctx.user;
    const isSelf = viewer && viewer.id === user.id;
    const isStaff = isAtLeast(viewer, 'admin');
    if (user.banned && !isStaff && !isSelf) throw notFound('用户不存在');
    const data = publicUser(user);
    data.stats = {
      accepted: get("SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND status = 'accepted'", user.id).n,
      submissions: get('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ?', user.id).n,
      solved: get("SELECT COUNT(DISTINCT problem_id) AS n FROM submissions WHERE user_id = ? AND status = 'accepted'", user.id).n,
    };
    data.achievementCount = get('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ?', user.id).n;
    if (!isSelf && !isStaff) {
      data.bio = data.privacy.dashboard ? '' : data.bio;
    }
    return ok(data);
  });

  router.post('/api/users', requireRole('su'), (ctx) => {
    const { username, password, role = 'user' } = ctx.body;
    requireFields(ctx.body, ['username']);
    if (get('SELECT id FROM users WHERE username = ?', username)) throw badRequest('用户名已存在');
    if (!ROLE_LEVEL[role]) throw badRequest('角色无效');
    const pass = password || generatePassword(12);
    const info = run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      username, hashPassword(pass), role,
    );
    const id = Number(info.lastInsertRowid);
    addUserToAllGroup(id);
    return ok({ id, username, password: pass });
  });

  router.put('/api/users/:id', (ctx) => {
    const id = toInt(ctx.params.id, '用户ID');
    const target = get('SELECT * FROM users WHERE id = ?', id);
    if (!target) throw notFound('用户不存在');
    if (!ctx.user) throw forbidden();
    if (ctx.user.id !== id && !isAtLeast(ctx.user, 'admin')) throw forbidden('无权修改该用户');

    const { signature, bio, preferred_language, privacy = {}, role, rating } = ctx.body;
    const fields = [];
    const params = [];
    if (signature !== undefined) { fields.push('signature = ?'); params.push(String(signature).slice(0, 200)); }
    if (bio !== undefined) { fields.push('bio = ?'); params.push(String(bio).slice(0, 5000)); }
    if (preferred_language !== undefined) {
      const lang = preferred_language ? get('SELECT id FROM languages WHERE key = ? OR id = ?', preferred_language, preferred_language) : null;
      fields.push('preferred_language = ?');
      params.push(lang ? String(preferred_language) : null);
    }
    if (privacy.achievements !== undefined) { fields.push('privacy_achievements = ?'); params.push(boolOf(privacy.achievements) ? 1 : 0); }
    if (privacy.dashboard !== undefined) { fields.push('privacy_dashboard = ?'); params.push(boolOf(privacy.dashboard) ? 1 : 0); }
    if (privacy.favorites !== undefined) { fields.push('privacy_favorites = ?'); params.push(boolOf(privacy.favorites) ? 1 : 0); }
    if (role !== undefined && isAtLeast(ctx.user, 'su')) {
      if (!ROLE_LEVEL[role]) throw badRequest('角色无效');
      fields.push('role = ?'); params.push(role);
    }
    if (rating !== undefined && isAtLeast(ctx.user, 'su')) {
      fields.push('rating = ?'); params.push(Math.max(0, Math.round(Number(rating) || 0)));
    }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(id);
    run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...params);
    const updated = get('SELECT * FROM users WHERE id = ?', id);
    broadcast('user_update', { userId: id });
    return ok(publicUser(updated));
  });

  router.delete('/api/users/:id', requireRole('admin'), (ctx) => {
    const target = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.id, '用户ID'));
    if (!target) throw notFound('用户不存在');
    if (!canManage(ctx.user, target)) throw forbidden('无权删除该用户');
    if (target.role === 'su' && ctx.user.id !== target.id) throw forbidden('无法删除其他超级管理员');
    run('DELETE FROM users WHERE id = ?', target.id);
    broadcast('user_update', { userId: target.id, deleted: true });
    return ok({ deleted: target.id });
  });

  router.post('/api/users/:id/role', requireRole('su'), (ctx) => {
    const target = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.id, '用户ID'));
    if (!target) throw notFound('用户不存在');
    const { role } = ctx.body;
    if (!ROLE_LEVEL[role]) throw badRequest('角色无效');
    run('UPDATE users SET role = ? WHERE id = ?', role, target.id);
    return ok(publicUser(get('SELECT * FROM users WHERE id = ?', target.id)));
  });

  router.post('/api/users/:id/password', requireRole('su'), (ctx) => {
    const target = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.id, '用户ID'));
    if (!target) throw notFound('用户不存在');
    const password = ctx.body.password || generatePassword(12);
    run('UPDATE users SET password_hash = ?, force_logout_at = datetime(\'now\') WHERE id = ?', hashPassword(password), target.id);
    return ok({ password });
  });

  router.post('/api/users/:id/ban', requireRole('admin'), (ctx) => {
    const target = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.id, '用户ID'));
    if (!target) throw notFound('用户不存在');
    if (!canManage(ctx.user, target)) throw forbidden('无权封禁该用户');
    run("UPDATE users SET banned = 1, force_logout_at = datetime('now') WHERE id = ?", target.id);
    broadcast('user_banned', { userId: target.id });
    return ok({ banned: target.id });
  });

  router.post('/api/users/:id/unban', requireRole('admin'), (ctx) => {
    const target = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.id, '用户ID'));
    if (!target) throw notFound('用户不存在');
    if (!canManage(ctx.user, target)) throw forbidden('无权解封该用户');
    run('UPDATE users SET banned = 0 WHERE id = ?', target.id);
    return ok({ banned: 0 });
  });

  router.post('/api/users/:id/force-logout', requireRole('admin'), (ctx) => {
    const target = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.id, '用户ID'));
    if (!target) throw notFound('用户不存在');
    if (!canManage(ctx.user, target)) throw forbidden('无权操作该用户');
    run("UPDATE users SET force_logout_at = datetime('now') WHERE id = ?", target.id);
    broadcast('force_logout', { userId: target.id });
    return ok({ userId: target.id });
  });

  router.post('/api/users/:id/login-as', requireRole('su'), (ctx) => {
    const target = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.id, '用户ID'));
    if (!target) throw notFound('用户不存在');
    if (target.banned) throw forbidden('无法登录被封禁账号');
    return ok({ accessToken: issueAccessToken(target), user: publicUser(target) });
  });

  router.post('/api/users/:id/quota', requireRole('su'), (ctx) => {
    const target = get('SELECT * FROM users WHERE id = ?', toInt(ctx.params.id, '用户ID'));
    if (!target) throw notFound('用户不存在');
    const quota = Math.max(0, toInt(ctx.body.quota_bytes, '配额'));
    run('UPDATE users SET quota_bytes = ? WHERE id = ?', quota, target.id);
    return ok({ quota_bytes: quota });
  });

  router.get('/api/users/:id/achievements', (ctx) => {
    const id = toInt(ctx.params.id, '用户ID');
    const target = get('SELECT * FROM users WHERE id = ?', id);
    if (!target) throw notFound('用户不存在');
    const isSelf = ctx.user && ctx.user.id === id;
    if (!isSelf && !isAtLeast(ctx.user, 'admin') && target.privacy_achievements) throw forbidden('该用户已隐藏成就');
    const unlocked = listAchievements(id);
    const unlockedKeys = new Set(unlocked.map((a) => a.key));
    const catalog = Object.entries(ACHIEVEMENTS).map(([key, meta]) => ({
      key, ...meta, unlocked: unlockedKeys.has(key), unlocked_at: unlocked.find((a) => a.key === key)?.unlocked_at || null,
    }));
    return ok({ unlocked, catalog });
  });

  router.get('/api/users/:id/dashboard', (ctx) => {
    const id = toInt(ctx.params.id, '用户ID');
    const target = get('SELECT * FROM users WHERE id = ?', id);
    if (!target) throw notFound('用户不存在');
    const isSelf = ctx.user && ctx.user.id === id;
    if (!isSelf && !isAtLeast(ctx.user, 'admin') && target.privacy_dashboard) throw forbidden('该用户已隐藏数据看板');

    const calendar = all(
      `SELECT date(created_at) AS day, COUNT(*) AS n
         FROM submissions WHERE user_id = ? AND created_at >= datetime('now','-365 days')
         GROUP BY day ORDER BY day`,
      id,
    );
    const languages = all(
      `SELECT l.name AS name, COUNT(*) AS n
         FROM submissions s JOIN languages l ON l.id = s.language_id
         WHERE s.user_id = ? GROUP BY l.id ORDER BY n DESC`,
      id,
    );
    const difficulty = all(
      `SELECT p.difficulty AS difficulty, COUNT(DISTINCT p.id) AS n
         FROM submissions s JOIN problems p ON p.id = s.problem_id
         WHERE s.user_id = ? AND s.status = 'accepted' GROUP BY p.difficulty ORDER BY p.difficulty`,
      id,
    );
    return ok({ calendar, languages, difficulty });
  });

  router.get('/api/users/:id/favorites', (ctx) => {
    const id = toInt(ctx.params.id, '用户ID');
    const target = get('SELECT * FROM users WHERE id = ?', id);
    if (!target) throw notFound('用户不存在');
    const isSelf = ctx.user && ctx.user.id === id;
    if (!isSelf && !isAtLeast(ctx.user, 'admin') && target.privacy_favorites) throw forbidden('该用户已隐藏收藏');
    const rows = all(
      `SELECT p.id, p.title, p.difficulty, f.created_at
         FROM favorites f JOIN problems p ON p.id = f.problem_id
         WHERE f.user_id = ? ORDER BY f.created_at DESC`,
      id,
    );
    return ok(rows);
  });

  router.post('/api/users/import', requireRole('su'), (ctx) => {
    // Minimal CSV/JSON batch import. xlsx parsing is an extension point.
    const { users = [], defaultPassword } = ctx.body;
    if (!Array.isArray(users)) throw badRequest('users 必须为数组');
    const password = defaultPassword || generatePassword(12);
    const created = [];
    for (const entry of users) {
      const username = typeof entry === 'string' ? entry : entry.username;
      if (!username || get('SELECT id FROM users WHERE username = ?', username)) continue;
      const info = run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', username, hashPassword(password), 'user');
      addUserToAllGroup(Number(info.lastInsertRowid));
      created.push(username);
    }
    return ok({ created, defaultPassword: password });
  });

  router.post('/api/users/:id/favorites/:problemId', (ctx) => {
    if (!ctx.user) throw forbidden();
    const problemId = toInt(ctx.params.problemId, '题目ID');
    const id = toInt(ctx.params.id, '用户ID');
    if (ctx.user.id !== id) throw forbidden();
    if (!get('SELECT id FROM problems WHERE id = ?', problemId)) throw notFound('题目不存在');
    run('INSERT OR IGNORE INTO favorites (user_id, problem_id) VALUES (?, ?)', id, problemId);
    return ok({ favorited: true });
  });

  const removeFavorite = (ctx) => {
    if (!ctx.user) throw forbidden();
    const id = toInt(ctx.params.id, '用户ID');
    if (ctx.user.id !== id) throw forbidden();
    run('DELETE FROM favorites WHERE user_id = ? AND problem_id = ?', id, toInt(ctx.params.problemId, '题目ID'));
    return ok({ favorited: false });
  };
  router.post('/api/users/:id/favorites/:problemId/remove', removeFavorite);
  router.delete('/api/users/:id/favorites/:problemId', removeFavorite);

  router.get('/api/users/:id/email-config', requireRole('su'), () => ok({ enabled: config.email.enabled, from: config.email.from }));
}
