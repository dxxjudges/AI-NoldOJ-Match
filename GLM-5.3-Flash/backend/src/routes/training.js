const express = require('express');
const { one, all, run } = require('../db/db');
const { requireAuth, requireMin } = require('../utils/middleware');
const { getAiHint } = require('../ai/tools');

const router = express.Router();
const isTeacher = (u) => u && ['teacher', 'admin', 'super'].includes(u.role);

// ---------- AI hint (2 failures cooldown 60s) ----------
router.post('/ai/hint', requireAuth, async (req, res) => {
  try {
    const hint = await getAiHint(req.user.id, Number(req.body.problemId));
    res.json({ ok: true, data: { hint } });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ---------- problem sets (training plans) ----------
router.get('/problem-sets', (req, res) => {
  let rows = all(`
    SELECT ps.*, (SELECT COUNT(*) FROM problem_set_items i WHERE i.set_id=ps.id) problem_count
    FROM problem_sets ps ORDER BY ps.id DESC LIMIT 100`);
  if (!isTeacher(req.user)) rows = rows.filter(r => r.is_public === 1);
  res.json({ ok: true, data: { items: rows } });
});

router.get('/problem-sets/:id', (req, res) => {
  const s = one(`SELECT * FROM problem_sets WHERE id=?`, req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'Problem set does not exist' });
  if (!s.is_public && !isTeacher(req.user) && !(req.user && req.user.id === s.created_by)) {
    return res.status(403).json({ ok: false, error: 'Private problem set' });
  }
  const items = all(`
    SELECT i.problem_id, i.ord, p.title, p.difficulty FROM problem_set_items i
    JOIN problems p ON p.id=i.problem_id WHERE i.set_id=? ORDER BY i.ord, p.id`, s.id);
  let progress = null;
  if (req.user) {
    progress = {
      solved: all(`SELECT problem_id FROM problem_set_progress WHERE set_id=? AND user_id=?`, s.id, req.user.id).map(r => r.problem_id)
    };
  }
  res.json({ ok: true, data: { set: s, items, progress } });
});

router.post('/problem-sets', requireMin('teacher'), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ ok: false, error: 'Title cannot be empty' });
  const info = run(`INSERT INTO problem_sets (title, description_md, is_public, created_by, created_at) VALUES (?,?,?,?,?)`,
    b.title, b.descriptionMd || '', b.isPublic === false ? 0 : 1, req.user.id, Date.now());
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});
router.put('/problem-sets/:id', requireMin('teacher'), (req, res) => {
  const s = one(`SELECT * FROM problem_sets WHERE id=?`, req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'Problem set does not exist' });
  const b = req.body || {};
  run(`UPDATE problem_sets SET title=?, description_md=?, is_public=? WHERE id=?`,
    b.title !== undefined ? b.title : s.title,
    b.descriptionMd !== undefined ? b.descriptionMd : s.description_md,
    b.isPublic !== undefined ? (b.isPublic ? 1 : 0) : s.is_public, s.id);
  res.json({ ok: true });
});
router.delete('/problem-sets/:id', requireMin('teacher'), (req, res) => {
  run(`DELETE FROM problem_set_items WHERE set_id=?`, req.params.id);
  run(`DELETE FROM problem_set_progress WHERE set_id=?`, req.params.id);
  run(`DELETE FROM problem_sets WHERE id=?`, req.params.id);
  res.json({ ok: true });
});
router.post('/problem-sets/:id/problems', requireMin('teacher'), (req, res) => {
  const b = req.body || {};
  if (b.remove) run(`DELETE FROM problem_set_items WHERE set_id=? AND problem_id=?`, req.params.id, b.problemId);
  else run(`INSERT OR REPLACE INTO problem_set_items (set_id, problem_id, ord) VALUES (?,?,?)`,
    req.params.id, Number(b.problemId), Number(b.ord) || 0);
  res.json({ ok: true });
});

// progress auto-recorded when judging completes (see judge -> on AC check set membership)
router.get('/problem-sets/:id/progress/self', requireAuth, (req, res) => {
  const items = all(`SELECT problem_id FROM problem_set_progress WHERE set_id=? AND user_id=?`, req.params.id, req.user.id);
  res.json({ ok: true, data: { solvedIds: items.map(r => r.problem_id) } });
});

module.exports = router;
