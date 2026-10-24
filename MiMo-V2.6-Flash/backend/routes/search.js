'use strict';

const express = require('express');
const db = require('../db/database');
const { visibleToGroup } = require('../middleware/auth');
const { str } = require('../utils/validate');

const router = express.Router();

// GET /api/search?q=&type=all|problem|contest|article
router.get('/', (req, res) => {
  const q = str(req.query.q, '', 100).replace(/\s+/g, '');
  const type = str(req.query.type, 'all', 20);
  if (!q) return res.json({ problems: [], contests: [], articles: [] });
  const like = `%${q}%`;
  const out = { problems: [], contests: [], articles: [] };
  if (type === 'all' || type === 'problem') {
    const rows = db.all(
      "SELECT id, title, difficulty FROM problems WHERE replace(title,' ','') LIKE ? OR replace(description,' ','') LIKE ? ORDER BY id DESC LIMIT 20",
      like, like
    );
    out.problems = rows.filter(p => visibleToGroup(req.user, 'problem', p.id));
  }
  if (type === 'all' || type === 'contest') {
    const rows = db.all(
      "SELECT id, title, start_at, end_at FROM contests WHERE replace(title,' ','') LIKE ? OR replace(description,' ','') LIKE ? ORDER BY id DESC LIMIT 20",
      like, like
    );
    out.contests = rows.filter(c => visibleToGroup(req.user, 'contest', c.id));
  }
  if (type === 'all' || type === 'article') {
    const privileged = req.user && ['teacher', 'admin', 'super'].includes(req.user.role);
    out.articles = privileged
      ? db.all("SELECT id, title FROM articles WHERE replace(title,' ','') LIKE ? OR replace(content,' ','') LIKE ? ORDER BY id DESC LIMIT 20", like, like)
      : db.all("SELECT id, title FROM articles WHERE published = 1 AND (replace(title,' ','') LIKE ? OR replace(content,' ','') LIKE ?) ORDER BY id DESC LIMIT 20", like, like);
  }
  res.json(out);
});

module.exports = router;
