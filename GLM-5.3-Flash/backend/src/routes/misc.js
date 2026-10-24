const express = require('express');
const { one, all, run } = require('../db/db');
const { requireMin } = require('../utils/middleware');
const events = require('../ws/events');

const router = express.Router();

// ---------- tags ----------
router.get('/tags', (req, res) => {
  res.json({ ok: true, data: { items: all(`SELECT * FROM tags ORDER BY id`) } });
});
router.post('/tags', requireMin('super'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ ok: false, error: 'Tag name cannot be empty' });
  if (one(`SELECT id FROM tags WHERE name=?`, b.name)) return res.status(400).json({ ok: false, error: 'Tag already exists' });
  const info = run(`INSERT INTO tags (name, color) VALUES (?,?)`, b.name, b.color || '#5b9bff');
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});
router.put('/tags/:id', requireMin('super'), (req, res) => {
  run(`UPDATE tags SET name=?, color=? WHERE id=?`, req.body.name, req.body.color || '#5b9bff', req.params.id);
  res.json({ ok: true });
});
router.delete('/tags/:id', requireMin('super'), (req, res) => {
  run(`DELETE FROM problem_tags WHERE tag_id=?`, req.params.id);
  run(`DELETE FROM tags WHERE id=?`, req.params.id);
  res.json({ ok: true });
});

// ---------- announcements ----------
router.get('/announcements', (req, res) => {
  const { contestId } = req.query;
  let rows = all(`
    SELECT a.*, u.username FROM announcements a LEFT JOIN users u ON u.id=a.created_by
    ORDER BY a.pinned DESC, a.created_at DESC LIMIT 200`);
  if (contestId) rows = rows.filter(r => r.contest_id === Number(contestId) || r.contest_id === null);
  else rows = rows.filter(r => r.contest_id === null);
  res.json({ ok: true, data: { items: rows } });
});

router.get('/announcements/:id', (req, res) => {
  const a = one(`SELECT a.*, u.username FROM announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=?`, req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'Announcement does not exist' });
  res.json({ ok: true, data: a });
});

router.post('/announcements', requireMin('teacher'), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ ok: false, error: 'Title cannot be empty' });
  const info = run(`INSERT INTO announcements (title, content_md, contest_id, pinned, created_by, created_at) VALUES (?,?,?,?,?,?)`,
    b.title, b.contentMd || b.content_md || '', b.contestId ? Number(b.contestId) : null, b.pinned ? 1 : 0,
    req.user.id, Date.now());
  const a = one(`SELECT * FROM announcements WHERE id=?`, info.lastInsertRowid);
  events.broadcast('announcement:new', { id: a.id, title: a.title, contestId: a.contest_id });
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.put('/announcements/:id', requireMin('teacher'), (req, res) => {
  const a = one(`SELECT * FROM announcements WHERE id=?`, req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'Announcement does not exist' });
  const b = req.body || {};
  run(`UPDATE announcements SET title=?, content_md=?, contest_id=?, pinned=? WHERE id=?`,
    b.title !== undefined ? b.title : a.title,
    b.contentMd !== undefined ? b.contentMd : a.content_md,
    b.contestId !== undefined ? (b.contestId ? Number(b.contestId) : null) : a.contest_id,
    b.pinned !== undefined ? (b.pinned ? 1 : 0) : a.pinned, a.id);
  res.json({ ok: true });
});

router.delete('/announcements/:id', requireMin('teacher'), (req, res) => {
  run(`DELETE FROM announcements WHERE id=?`, req.params.id);
  res.json({ ok: true });
});

// ---------- stats (homepage) ----------
router.get('/stats', (req, res) => {
  const cnt = (sql) => one(sql).c;
  const users = cnt(`SELECT COUNT(*) c FROM users`);
  const problems = cnt(`SELECT COUNT(*) c FROM problems WHERE is_public=1`);
  const submissions = cnt(`SELECT COUNT(*) c FROM submissions WHERE is_ide=0`);
  const accepted = cnt(`SELECT COUNT(*) c FROM submissions WHERE is_ide=0 AND status='ac'`);
  const contests = cnt(`SELECT COUNT(*) c FROM contests`);
  res.json({
    ok: true,
    data: { users, problems, submissions, accepted, contests,
      acceptedRatio: submissions ? Math.round(accepted / submissions * 100) : 0 }
  });
});

// ---------- fuzzy search (ignores spaces, real-time) ----------
function normSpaces(s) { return String(s || '').replace(/\s+/g, ''); }

router.get('/search', (req, res) => {
  const q = normSpaces(req.query.q || '').toLowerCase();
  if (!q) return res.json({ ok: true, data: { problems: [], contests: [], articles: [] } });
  const problems = all(`SELECT id, title, difficulty, is_public FROM problems ORDER BY id DESC LIMIT 200`)
    .filter(p => normSpaces(p.title).toLowerCase().includes(q) || String(p.id) === q)
    .filter(p => p.is_public || (req.user && (['teacher', 'admin', 'super'].includes(req.user.role) || p.author_id === req.user.id)))
    .slice(0, 20);
  const contests = all(`SELECT id, title, start_time, end_time FROM contests LIMIT 200`)
    .filter(c => normSpaces(c.title).toLowerCase().includes(q) || String(c.id) === q).slice(0, 10);
  const articles = all(`SELECT id, title, published, author_id FROM articles LIMIT 200`)
    .filter(a => (a.published || (req.user && (['teacher', 'admin', 'super'].includes(req.user.role) || a.author_id === req.user.id))))
    .filter(a => normSpaces(a.title).toLowerCase().includes(q) || String(a.id) === q).slice(0, 10);
  res.json({ ok: true, data: { problems, contests, articles } });
});

module.exports = router;
