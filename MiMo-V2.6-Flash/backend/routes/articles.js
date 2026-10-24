'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole, ROLE_RANK } = require('../middleware/auth');
const { str, int, bool } = require('../utils/validate');

const router = express.Router();

router.get('/', (req, res) => {
  const page = Math.max(1, int(req.query.page, 1));
  const pageSize = Math.min(50, int(req.query.pageSize, 20));
  const where = [];
  const params = [];
  const privileged = req.user && ROLE_RANK[req.user.role] >= ROLE_RANK.teacher;
  if (!privileged) where.push('a.published = 1');
  const kw = str(req.query.keyword, '', 100).replace(/\s+/g, '');
  if (kw) { where.push("replace(a.title,' ','') LIKE ?"); params.push(`%${kw}%`); }
  if (req.query.problem) { where.push('a.problem_id = ?'); params.push(int(req.query.problem, 0)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM articles a ${whereSql}`, ...params).n;
  const items = db.all(
    `SELECT a.id, a.title, a.problem_id, a.is_solution, a.published, a.author_name, a.view_count, a.created_at, a.updated_at
     FROM articles a ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  );
  res.json({ items, total: Number(total), page, pageSize });
});

router.get('/:id', (req, res) => {
  const id = int(req.params.id, 0);
  const a = db.get('SELECT * FROM articles WHERE id = ?', id);
  if (!a) return res.status(404).json({ error: '文章不存在' });
  const privileged = req.user && ROLE_RANK[req.user.role] >= ROLE_RANK.teacher;
  if (!a.published && !privileged) return res.status(403).json({ error: '文章未发布' });
  db.run('UPDATE articles SET view_count = view_count + 1 WHERE id = ?', id);
  res.json({ article: a });
});

router.post('/', requireAuth, requireRole('teacher'), (req, res) => {
  const t = db.now();
  const title = str(req.body.title, '', 200);
  if (!title || !req.body.content) return res.status(400).json({ error: '标题和内容不能为空' });
  const id = db.tx(() => {
    const aid = db.allocId('article_id_pool', 1, 'articles');
    db.run(
      `INSERT INTO articles (id,title,content,problem_id,is_solution,published,author_id,author_name,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      aid, title, str(req.body.content, '', 1000000),
      int(req.body.problem_id, 0) || null, bool(req.body.is_solution) ? 1 : 0,
      req.body.published !== undefined ? (bool(req.body.published) ? 1 : 0) : 1,
      req.user.id, req.user.username, t, t
    );
    return aid;
  });
  res.status(201).json({ id });
});

router.put('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  const a = db.get('SELECT * FROM articles WHERE id = ?', id);
  if (!a) return res.status(404).json({ error: '文章不存在' });
  db.run(
    `UPDATE articles SET title=?, content=?, problem_id=?, is_solution=?, published=?, updated_at=? WHERE id=?`,
    str(req.body.title, a.title, 200), str(req.body.content, a.content, 1000000),
    req.body.problem_id !== undefined ? (int(req.body.problem_id, 0) || null) : a.problem_id,
    req.body.is_solution !== undefined ? (bool(req.body.is_solution) ? 1 : 0) : a.is_solution,
    req.body.published !== undefined ? (bool(req.body.published) ? 1 : 0) : a.published,
    db.now(), id
  );
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const id = int(req.params.id, 0);
  db.tx(() => {
    db.run('DELETE FROM articles WHERE id = ?', id);
    db.run('INSERT OR IGNORE INTO article_id_pool (id) VALUES (?)', id);
  });
  res.json({ ok: true });
});

module.exports = router;
