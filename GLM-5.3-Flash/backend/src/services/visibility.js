const { one, all } = require('../db/db');

// Group-based visibility helpers.
// Private entities are visible to: authors, admins/super, and members of bound groups.

function userGroupIds(userId) {
  if (!userId) return [];
  return all(`SELECT group_id gid FROM group_members WHERE user_id=?`, userId).map(r => r.gid);
}

function visibleGroupIdsForEntity(type, entityId) {
  return all(`SELECT group_id gid FROM group_visibility WHERE entity_type=? AND entity_id=?`, type, entityId).map(r => r.gid);
}

function userCanSeeProblem(user, problem) {
  if (!problem) return false;
  if (problem.is_public) {
    return true; // lists filter again by role below; public is always visible
  }
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'super' || user.id === problem.author_id) return true;
  const entityGroups = visibleGroupIdsForEntity('problem', problem.id);
  const privateBound = visibleGroupIdsForEntity('problem', problem.id);
  if (privateBound.length === 0) return false;
  const mine = new Set(userGroupIds(user.id));
  return privateBound.some(g => mine.has(String(g)) || mine.has(g));
}

// Caller ensures `user` exists; check private problem access for detail routes
function problemForbiddenFor(user, problem) {
  if (problem.is_public) return false;
  if (user && (user.role === 'admin' || user.role === 'super' || user.id === problem.author_id)) return false;
  if (user) {
    const bound = visibleGroupIdsForEntity('problem', problem.id);
    const mine = new Set(userGroupIds(user.id).map(String));
    if (bound.some(g => mine.has(String(g)))) return false;
  }
  return true;
}

// Split contest participants: e.g. contest visibility similar rules
function contestVisibilityCheck(user, contest) {
  return true; // contests public by default in v1 scaffold
}

function addVisibilityGroup(groupId, entityType, entityId) {
  const { run } = require('../db/db');
  run(`INSERT OR IGNORE INTO group_visibility (group_id, entity_type, entity_id) VALUES (?,?,?)`,
    groupId, entityType, entityId);
}

module.exports = { userGroupIds, userCanSeeProblem, problemForbiddenFor, visibleGroupIdsForEntity, addVisibilityGroup, contestVisibilityCheck };
