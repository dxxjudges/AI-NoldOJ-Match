'use strict';

const express = require('express');
const db = require('../db/database');
const { config } = require('../config');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { str } = require('../utils/validate');

const router = express.Router();

// POST /api/ide/run
router.post('/run', requireAuth, rateLimit('ide', config.security.ideRateLimit.windowSec, config.security.ideRateLimit.max), (req, res) => {
  const language = str(req.body.language, '', 32);
  const code = str(req.body.code, '', config.security.sourceMaxBytes);
  if (!code) return res.status(400).json({ error: '代码不能为空' });
  const lang = db.get('SELECT * FROM languages WHERE id = ? AND enabled = 1', language);
  if (!lang) return res.status(400).json({ error: '语言不可用' });

  const info = db.run(
    'INSERT INTO ide_runs (user_id, language, code, stdin, status, created_at) VALUES (?,?,?,?,?,?)',
    req.user.id, language, code, str(req.body.stdin, '', 65536), 'pending', db.now()
  );
  const id = Number(info.lastInsertRowid);
  require('../services/judge/queue').enqueue({ kind: 'ide', id });
  res.status(201).json({ id, status: 'pending' });
});

// GET /api/ide/run/:id
router.get('/run/:id', requireAuth, (req, res) => {
  const r = db.get('SELECT * FROM ide_runs WHERE id = ?', Number(req.params.id));
  if (!r) return res.status(404).json({ error: '运行记录不存在' });
  if (r.user_id !== req.user.id && req.user.role === 'user') {
    return res.status(403).json({ error: '无权查看' });
  }
  res.json({ run: r });
});

module.exports = router;
