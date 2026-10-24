'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { int } = require('../utils/validate');

const router = express.Router();

// POST /api/ai/hint { problemId }
router.post('/hint', requireAuth, async (req, res) => {
  const pid = int(req.body.problemId, 0);
  const result = await require('../services/ai/hint').getHint(req.user.id, pid);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// POST /api/ai/testdata { problemId, normalCount, edgeCount }  (teacher+)
router.post('/testdata', requireAuth, requireTeacher, async (req, res) => {
  try {
    const result = await require('../services/ai/testdata').generate(
      int(req.body.problemId, 0),
      { normalCount: req.body.normalCount, edgeCount: req.body.edgeCount, createdBy: req.user.id }
    );
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function requireTeacher(req, res, next) {
  if (!req.user || !['teacher', 'admin', 'super'].includes(req.user.role)) {
    return res.status(403).json({ error: '权限不足' });
  }
  next();
}

module.exports = router;
