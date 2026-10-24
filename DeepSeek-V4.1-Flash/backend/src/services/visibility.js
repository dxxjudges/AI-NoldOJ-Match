import { all, get } from '../db.js';
import { isAtLeast } from '../http/auth.js';

export function userGroupIds(userId) {
  if (!userId) return [];
  return all('SELECT group_id FROM user_group_members WHERE user_id = ?', userId).map((r) => r.group_id);
}

export function groupsFor(entityType, entityId) {
  return all(
    'SELECT group_id FROM group_visibility WHERE entity_type = ? AND entity_id = ?',
    entityType, entityId,
  ).map((r) => r.group_id);
}

export function userInAnyGroup(userId, groupIds) {
  if (!groupIds.length) return false;
  const set = new Set(userGroupIds(userId));
  return groupIds.some((g) => set.has(g));
}

function isPublicFlag(row) {
  if (row.visibility !== undefined) return row.visibility === 'public';
  if (row.is_public !== undefined) return Boolean(row.is_public);
  return true;
}

/**
 * Determine whether a user may view a problem / contest / exam / problemset.
 * Staff (admin+) always can; authors/creators can; group-bound entities require membership.
 */
export function canView(entityType, user, row, { ownerField = 'author_id' } = {}) {
  if (!row) return false;
  if (isAtLeast(user, 'admin')) return true;
  if (isPublicFlag(row)) return true;
  if (isAtLeast(user, 'teacher') && user && row[ownerField] === user.id) return true;
  const groupIds = groupsFor(entityType, row.id);
  if (groupIds.length && user && userInAnyGroup(user.id, groupIds)) return true;
  return false;
}

export function visibleEntityIds(entityType, user, table) {
  if (isAtLeast(user, 'teacher')) return null; // see all
  const publicCol = table === 'problems' ? 'visibility' : 'is_public';
  const publicVal = table === 'problems' ? "'public'" : '1';
  const groupIds = userGroupIds(user ? user.id : 0);
  if (!groupIds.length) {
    return all(`SELECT id FROM ${table} WHERE ${publicCol} = ${publicVal}`).map((r) => r.id);
  }
  const placeholders = groupIds.map(() => '?').join(',');
  return all(
    `SELECT DISTINCT id FROM ${table}
       WHERE ${publicCol} = ${publicVal}
          OR id IN (SELECT entity_id FROM group_visibility WHERE entity_type = ? AND group_id IN (${placeholders}))`,
    entityType, ...groupIds,
  ).map((r) => r.id);
}

export function assertVisible(entityType, user, row, options) {
  if (!canView(entityType, user, row, options)) {
    const err = new Error('无权访问该资源');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

export function findById(table, id) {
  return get(`SELECT * FROM ${table} WHERE id = ?`, id);
}

export default { canView, userGroupIds, visibleEntityIds, userInAnyGroup, groupsFor };
