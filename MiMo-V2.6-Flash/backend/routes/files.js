'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { config } = require('../config');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

fs.mkdirSync(config.paths.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: config.paths.uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 16);
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.files.maxSingleFileMb * 1024 * 1024 },
});

function usedBytes(userId) {
  return Number(db.get('SELECT COALESCE(SUM(size),0) AS s FROM hosted_files WHERE user_id = ?', userId).s);
}

// POST /api/files/upload
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  const quotaMb = u.single_file_limit_mb ?? Math.min(config.files.maxSingleFileMb, 10);
  const totalQuotaMb = u.storage_quota_mb ?? config.files.defaultUserQuotaMb;
  if (req.file.size > quotaMb * 1024 * 1024) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(400).json({ error: `单文件不能超过 ${quotaMb}MB` });
  }
  if (usedBytes(req.user.id) + req.file.size > totalQuotaMb * 1024 * 1024) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(400).json({ error: `存储空间已满（配额 ${totalQuotaMb}MB）` });
  }
  const info = db.run(
    'INSERT INTO hosted_files (user_id, filename, stored_name, mime, size, created_at) VALUES (?,?,?,?,?,?)',
    req.user.id, req.file.originalname, req.file.filename, req.file.mimetype || '', req.file.size, db.now()
  );
  res.status(201).json({
    id: Number(info.lastInsertRowid),
    url: `/uploads/${req.file.filename}`,
    filename: req.file.originalname,
    size: req.file.size,
  });
});

// GET /api/files/mine
router.get('/mine', requireAuth, (req, res) => {
  const items = db.all('SELECT id, filename, stored_name, mime, size, created_at FROM hosted_files WHERE user_id = ? ORDER BY id DESC LIMIT 200', req.user.id);
  const u = db.get('SELECT storage_quota_mb FROM users WHERE id = ?', req.user.id);
  res.json({
    items, used_bytes: usedBytes(req.user.id),
    quota_mb: u.storage_quota_mb ?? config.files.defaultUserQuotaMb,
  });
});

// DELETE /api/files/:id
router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const f = db.get('SELECT * FROM hosted_files WHERE id = ?', id);
  if (!f) return res.status(404).json({ error: '文件不存在' });
  const privileged = ['admin', 'super'].includes(req.user.role);
  if (f.user_id !== req.user.id && !privileged) return res.status(403).json({ error: '无权删除' });
  try { fs.unlinkSync(path.join(config.paths.uploadDir, f.stored_name)); } catch (_) {}
  db.run('DELETE FROM hosted_files WHERE id = ?', id);
  res.json({ ok: true });
});

module.exports = router;
