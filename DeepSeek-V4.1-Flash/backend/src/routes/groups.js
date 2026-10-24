import { all, get, run } from '../db.js';
import { requireRole } from '../http/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { ok } from '../http/context.js';
import { requireFields, toInt } from './helpers.js';
import { userGroupIds } from '../services/visibility.js';

export default function registerGroups(router) {
  router.get('/api/groups', requireRole('admin'), () => {
    const groups = all('SELECT * FROM user_groups ORDER BY is_system DESC, id');
    return ok(groups.map((g) => ({
      ...g,
      is_system: Boolean(g.is_system),
      member_count: get('SELECT COUNT(*) AS n FROM user_group_members WHERE group_id = ?', g.id).n,
    })));
  });

  router.get('/api/groups/mine', (ctx) => {
    if (!ctx.user) return ok([]);
    const ids = userGroupIds(ctx.user.id);
    if (!ids.length) return ok([]);
    const groups = all(`SELECT * FROM user_groups WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    return ok(groups.map((g) => ({ ...g, is_system: Boolean(g.is_system) })));
  });

  router.post('/api/groups', requireRole('admin'), (ctx) => {
    requireFields(ctx.body, ['name']);
    const { name, description = '' } = ctx.body;
    if (get('SELECT id FROM user_groups WHERE name = ?', name)) throw badRequest('用户组已存在');
    const info = run('INSERT INTO user_groups (name, description, created_by) VALUES (?,?,?)', name, description, ctx.user.id);
    return ok(get('SELECT * FROM user_groups WHERE id = ?', Number(info.lastInsertRowid)));
  });

  router.put('/api/groups/:id', requireRole('admin'), (ctx) => {
    const group = get('SELECT * FROM user_groups WHERE id = ?', toInt(ctx.params.id, '用户组ID'));
    if (!group) throw notFound('用户组不存在');
    if (group.is_system) throw badRequest('系统内置用户组不可修改');
    const fields = [];
    const params = [];
    if (ctx.body.name !== undefined) { fields.push('name = ?'); params.push(ctx.body.name); }
    if (ctx.body.description !== undefined) { fields.push('description = ?'); params.push(ctx.body.description); }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(group.id);
    run(`UPDATE user_groups SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(get('SELECT * FROM user_groups WHERE id = ?', group.id));
  });

  router.delete('/api/groups/:id', requireRole('admin'), (ctx) => {
    const group = get('SELECT * FROM user_groups WHERE id = ?', toInt(ctx.params.id, '用户组ID'));
    if (!group) throw notFound('用户组不存在');
    if (group.is_system) throw badRequest('系统内置用户组不可删除');
    run('DELETE FROM user_groups WHERE id = ?', group.id);
    return ok({ deleted: group.id });
  });

  router.get('/api/groups/:id/members', requireRole('admin'), (ctx) => {
    const rows = all(
      `SELECT u.id, u.username, u.role, u.rating FROM user_group_members m
        JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.id`,
      toInt(ctx.params.id, '用户组ID'),
    );
    return ok(rows);
  });

  router.post('/api/groups/:id/members', requireRole('admin'), (ctx) => {
    const group = get('SELECT * FROM user_groups WHERE id = ?', toInt(ctx.params.id, '用户组ID'));
    if (!group) throw notFound('用户组不存在');
    const ids = Array.isArray(ctx.body.user_ids) ? ctx.body.user_ids : [ctx.body.user_id];
    const added = [];
    for (const uid of ids) {
      const user = get('SELECT id FROM users WHERE id = ?', toInt(uid, '用户ID'));
      if (!user) continue;
      run('INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?,?)', group.id, user.id);
      added.push(user.id);
    }
    return ok({ added });
  });

  router.delete('/api/groups/:id/members/:userId', requireRole('admin'), (ctx) => {
    const group = get('SELECT * FROM user_groups WHERE id = ?', toInt(ctx.params.id, '用户组ID'));
    if (!group) throw notFound('用户组不存在');
    if (group.is_system) throw badRequest('系统内置用户组不可移除成员');
    run('DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?', group.id, toInt(ctx.params.userId, '用户ID'));
    return ok({ removed: ctx.params.userId });
  });

  router.post('/api/groups/:id/visibility', requireRole('admin'), (ctx) => {
    const group = get('SELECT * FROM user_groups WHERE id = ?', toInt(ctx.params.id, '用户组ID'));
    if (!group) throw notFound('用户组不存在');
    const { entity_type, entity_ids = [] } = ctx.body;
    if (!['problem', 'contest', 'exam', 'problemset', 'article'].includes(entity_type)) throw badRequest('实体类型无效');
    run('DELETE FROM group_visibility WHERE group_id = ? AND entity_type = ?', group.id, entity_type);
    for (const id of entity_ids) {
      run('INSERT OR IGNORE INTO group_visibility (group_id, entity_type, entity_id) VALUES (?,?,?)', group.id, entity_type, Number(id));
    }
    return ok({ entity_type, entity_ids });
  });

  router.get('/api/groups/:id/visibility', requireRole('admin'), (ctx) => {
    const rows = all('SELECT entity_type, entity_id FROM group_visibility WHERE group_id = ?', toInt(ctx.params.id, '用户组ID'));
    return ok(rows);
  });
}
