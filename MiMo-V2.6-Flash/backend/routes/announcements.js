'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { str, int, bool } = require('../utils/validate');

const router = express.Router();

router.get('/', (req, res) => {
  const contestId = int(req.query.contest, 0);
  let sql = 'SELECT * FROM announcements';
  const params = [];
  if (contestId) { sql += ' WHERE contest_id = ?'; params.push(contestId); }
  sql += ' ORDER BY pinned DESC, id DESC LIMIT 50';
  res.json({ items: db.all(sql, ...params) });
});

router.get('/:id', (req, res) => {
  const a = db.get('SELECT * FROM announcements WHERE id = ?', int(req.params.id, 0));
  if (!a) return res.status(404).json({ error: '公告不存在' });
  res.json({ announcement: a });
});

router.post('/', requireAuth, requireRole('teacher'), (req, res) => {
  const t = db.now();
  const info = db.run(
    'INSERT INTO announcements (title, content, pinned, contest_id, author_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    str(req.body.title, '', 200), str(req.body.content, '', 100000),
    bool(req.body.pinned) ? 1 : 0, int(req.body.contest_id, 0) || null, req.user.id, t, t
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const a = db.get('SELECT * FROM announcements WHERE id = ?', id);
  if (!a) return res.status(404).json({ error: '公告不存在' });
  db.run(
    'UPDATE announcements SET title=?, content=?, pinned=?, updated_at=? WHERE id=?',
    str(req.body.title, a.title, 200), str(req.body.content, a.content, 100000),
    req.body.pinned !== undefined ? (bool(req.body.pinned) ? 1 : 0) : a.pinned,
    db.now(), id
  );
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  db.run('DELETE FROM announcements WHERE id = ?', int(req.params.id, 0));
  res.json({ ok: true });
});

module.exports = router;
