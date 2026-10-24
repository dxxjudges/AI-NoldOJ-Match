const express = require('express');
const { one, all, run } = require('../db/db');
const { requireAuth, requireMin } = require('../utils/middleware');
const { checkAchievements } = require('../services/achievements');

const router = express.Router();
const isTeacher = (u) => u && ['teacher', 'admin', 'super'].includes(u.role);

// ---------- articles ----------
router.get('/articles', (req, res) => {
  const { problemId, mine = '' } = req.query;
  let rows = all(`
    SELECT a.id, a.title, a.author_id, a.published, a.is_solution, a.problem_id, a.contest_id, a.created_at, a.updated_at,
           u.username, p.title AS problem_title
    FROM articles a LEFT JOIN users u ON u.id=a.author_id LEFT JOIN problems p ON p.id=a.problem_id
    ORDER BY a.updated_at DESC LIMIT 300`);
  // teachers+ see all (including unpublished); regular users see published only
  if (!isTeacher(req.user)) rows = rows.filter(r => r.published === 1);
  if (mine === '1' && req.user) rows = rows.filter(r => r.author_id === req.user.id);
  if (problemId) rows = rows.filter(r => r.problem_id === Number(problemId));
  res.json({ ok: true, data: { items: rows } });
});

router.get('/articles/:id', (req, res) => {
  const a = one(`SELECT a.*, u.username FROM articles a LEFT JOIN users u ON u.id=a.author_id WHERE a.id=?`, req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'Article does not exist' });
  // unpublished readable by author or teacher+
  if (!a.published && !(req.user && (req.user.id === a.author_id || isTeacher(req.user)))) {
    return res.status(403).json({ ok: false, error: 'Not published' });
  }
  res.json({ ok: true, data: a, canEdit: !!(req.user && (req.user.id === a.author_id || isTeacher(req.user))) });
});

router.post('/articles', requireAuth, (req, res) => {
  if (!isTeacher(req.user)) return res.status(403).json({ ok: false, error: 'Only teachers and above can publish articles' });
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ ok: false, error: 'Title cannot be empty' });
  const info = run(`INSERT INTO articles (title, content_md, author_id, published, is_solution, problem_id, contest_id, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    b.title, b.contentMd || '', req.user.id, b.published ? 1 : 0, b.isSolution ? 1 : 0,
    b.problemId ? Number(b.problemId) : null, b.contestId ? Number(b.contestId) : null,
    Date.now(), Date.now());
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.put('/articles/:id', requireAuth, (req, res) => {
  const a = one(`SELECT * FROM articles WHERE id=?`, req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'Article does not exist' });
  const own = req.user.id === a.author_id;
  if (!own && !isTeacher(req.user)) return res.status(403).json({ ok: false, error: 'Can only edit your own articles' });
  const b = req.body || {};
  run(`UPDATE articles SET title=?, content_md=?, published=?, is_solution=?, problem_id=?, contest_id=?, updated_at=? WHERE id=?`,
    b.title !== undefined ? b.title : a.title,
    b.contentMd !== undefined ? b.contentMd : a.content_md,
    b.published !== undefined ? (b.published ? 1 : 0) : a.published,
    b.isSolution !== undefined ? (b.isSolution ? 1 : 0) : a.is_solution,
    b.problemId !== undefined ? (b.problemId ? Number(b.problemId) : null) : a.problem_id,
    b.contestId !== undefined ? (b.contestId ? Number(b.contestId) : null) : a.contest_id,
    Date.now(), a.id);
  res.json({ ok: true });
});

router.delete('/articles/:id', requireAuth, (req, res) => {
  const a = one(`SELECT * FROM articles WHERE id=?`, req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'Article does not exist' });
  if (req.user.id !== a.author_id && !isTeacher(req.user)) return res.status(403).json({ ok: false, error: 'No permission to delete' });
  run(`DELETE FROM articles WHERE id=?`, a.id);
  res.json({ ok: true });
});

// ---------- discussions (problem scoped) ----------
router.get('/problems/:id/discussions', (req, res) => {
  const pid = Number(req.params.id);
  const p = one(`SELECT id FROM problems WHERE id=?`, pid);
  if (!p) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const rows = all(`
    SELECT d.*, u.username,
      (SELECT COUNT(*) FROM discussion_replies r WHERE r.discussion_id=d.id) reply_count,
      (SELECT MAX(created_at) FROM discussion_replies r2 WHERE r2.discussion_id=d.id) last_reply_at
    FROM discussions d JOIN users u ON u.id=d.user_id
    WHERE d.problem_id=?
    ORDER BY d.pinned DESC, d.official DESC, d.created_at DESC LIMIT 200`, pid);
  res.json({ ok: true, data: { items: rows } });
});

router.post('/problems/:id/discussions', requireAuth, (req, res) => {
  const pid = Number(req.params.id);
  if (!one(`SELECT id FROM problems WHERE id=?`, pid)) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ ok: false, error: 'Title cannot be empty' });
  // XSS: content rendered client-side with sanitizing renderer; also strip <script> server-side
  const content = sanitizeMd(String(b.contentMd || b.content_md || '').slice(0, 20000));
  const info = run(`INSERT INTO discussions (problem_id, user_id, title, content_md, pinned, locked, official, created_at, updated_at)
    VALUES (?,?,?,?,0,0,0,?,?)`, pid, req.user.id, String(b.title).slice(0, 200), content, Date.now(), Date.now());
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.get('/discussions/:id', (req, res) => {
  const d = one(`SELECT d.*, u.username FROM discussions d JOIN users u ON u.id=d.user_id WHERE d.id=?`, req.params.id);
  if (!d) return res.status(404).json({ ok: false, error: 'Discussion thread does not exist' });
  // Two-level nested replies: top-level replies with their children
  const tops = all(`SELECT r.*, u.username FROM discussion_replies r JOIN users u ON u.id=r.user_id
    WHERE r.discussion_id=? AND (r.parent_id IS NULL OR r.parent_id=0) ORDER BY r.created_at, r.id`, d.id);
  const topsIds = tops.map(t => t.id);
  const children = topsIds.length ? all(`SELECT r.*, u.username FROM discussion_replies r JOIN users u ON u.id=r.user_id
    WHERE r.discussion_id=? AND r.parent_id IN (${topsIds.map(() => '?').join(',')}) ORDER BY r.created_at, r.id`, d.id, ...topsIds) : [];
  res.json({
    ok: true,
    data: {
      thread: d,
      teacher: isTeacher(req.user),
      canEdit: !!(req.user && req.user.id === d.user_id),
      replies: tops.map(t => ({ ...t, children: children.filter(c => c.parent_id === t.id) }))
    }
  });
});

router.post('/discussions/:id/replies', requireAuth, (req, res) => {
  const d = one(`SELECT * FROM discussions WHERE id=?`, req.params.id);
  if (!d) return res.status(404).json({ ok: false, error: 'Discussion thread does not exist' });
  if (d.locked) return res.status(403).json({ ok: false, error: 'Discussion is locked (read-only)' });
  const b = req.body || {};
  let parentId = b.parentId ? Number(b.parentId) : null;
  if (parentId) {
    const parent = one(`SELECT * FROM discussion_replies WHERE id=? AND discussion_id=?`, parentId, d.id);
    if (!parent) return res.status(400).json({ ok: false, error: 'Parent reply does not exist' });
    // Two-level nesting: replies to children flatten to child level attaching same parent
    if (parent.parent_id) parentId = parent.parent_id;
  }
  const content = sanitizeMd(String(b.contentMd || '').slice(0, 10000));
  if (!content.trim()) return res.status(400).json({ ok: false, error: 'Reply content cannot be empty' });
  const info = run(`INSERT INTO discussion_replies (discussion_id, parent_id, user_id, content_md, created_at) VALUES (?,?,?,?,?)`,
    d.id, parentId, req.user.id, content, Date.now());
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.put('/discussions/:id', requireAuth, (req, res) => {
  const d = one(`SELECT * FROM discussions WHERE id=?`, req.params.id);
  if (!d) return res.status(404).json({ ok: false, error: 'Discussion thread does not exist' });
  const own = req.user.id === d.user_id;
  if (!own && !isTeacher(req.user)) return res.status(403).json({ ok: false, error: 'Can only edit your own posts' });
  const b = req.body || {};
  run(`UPDATE discussions SET title=?, content_md=?, updated_at=? WHERE id=?`,
    b.title !== undefined ? String(b.title).slice(0, 200) : d.title,
    b.contentMd !== undefined ? sanitizeMd(String(b.contentMd).slice(0, 20000)) : d.content_md,
    Date.now(), d.id);
  res.json({ ok: true });
});

// Permissions: author can delete own; teacher+ pin/bless(official)/lock; admin deletes any
router.post('/discussions/:id/moderate', requireAuth, (req, res) => {
  const d = one(`SELECT * FROM discussions WHERE id=?`, req.params.id);
  if (!d) return res.status(404).json({ ok: false, error: 'Discussion thread does not exist' });
  const action = req.body.action;
  const teacher = isTeacher(req.user);
  const admin = req.user.role === 'admin' || req.user.role === 'super';
  switch (action) {
    case 'pin':
    case 'unpin':
      if (!teacher) return res.status(403).json({ ok: false, error: 'Only teachers and above can pin' });
      run(`UPDATE discussions SET pinned=? WHERE id=?`, action === 'pin' ? 1 : 0, d.id);
      break;
    case 'official':
    case 'unofficial':
      if (!teacher) return res.status(403).json({ ok: false, error: 'Only teachers and above can mark official solutions' });
      run(`UPDATE discussions SET official=? WHERE id=?`, action === 'official' ? 1 : 0, d.id);
      break;
    case 'lock':
    case 'unlock':
      if (!teacher) return res.status(403).json({ ok: false, error: 'Only teachers and above can lock' });
      run(`UPDATE discussions SET locked=? WHERE id=?`, action === 'lock' ? 1 : 0, d.id);
      break;
    case 'delete':
      if (!own && !admin && !teacher) return res.status(403).json({ ok: false, error: 'No permission to delete' });
      run(`DELETE FROM discussions WHERE id=?`, d.id);
      run(`DELETE FROM discussion_replies WHERE discussion_id=?`, d.id);
      break;
    default:
      return res.status(400).json({ ok: false, error: 'Unknown moderation action' });
  }
  res.json({ ok: true });
});

router.delete('/replies/:id', requireAuth, (req, res) => {
  const r = one(`SELECT * FROM discussion_replies WHERE id=?`, req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'Reply does not exist' });
  const admin = req.user.role === 'admin' || req.user.role === 'super';
  if (r.user_id !== req.user.id && !admin) return res.status(403).json({ ok: false, error: 'No permission to delete' });
  run(`DELETE FROM discussion_replies WHERE id=?`, r.id);
  res.json({ ok: true });
});

// basic server-side XSS stripping (client uses sanitized markdown renderer too)
function sanitizeMd(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

module.exports = router;
