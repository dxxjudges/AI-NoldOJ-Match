const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { one, all, run } = require('../db/db');
const { requireAuth, requireMin } = require('../utils/middleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.md': 'text/markdown', '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
};

// quota check: single file size <= user.max_file_mb; total usage <= used_bytes + size <= quota_gb GB
router.post('/files', requireAuth, upload.single('file'), (req, res) => {
  if (req.user.banned) return res.status(403).json({ ok: false, error: 'Account banned' });
  const f = req.file;
  if (!f) return res.status(400).json({ ok: false, error: 'No file uploaded' });
  const maxFileBytes = req.user.max_file_mb * 1024 * 1024;
  const quotaBytes = req.user.quota_gb * 1024 * 1024 * 1024;
  if (f.size > maxFileBytes) {
    return res.status(400).json({ ok: false, error: `Single file limit ${req.user.max_file_mb}MB exceeded` });
  }
  if (req.user.used_bytes + f.size > quotaBytes) {
    return res.status(400).json({ ok: false, error: `Total storage space ${req.user.quota_gb}GB limit exceeded` });
  }
  const ext = path.extname(f.originalname || '').toLowerCase().slice(0, 10);
  const stored = crypto.randomBytes(8).toString('hex') + ext;
  fs.mkdirSync(config.abs.uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(config.abs.uploadsDir, stored), f.buffer);
  const info = run(`INSERT INTO user_files (user_id, original_name, stored_name, size, mime, created_at) VALUES (?,?,?,?,?,?)`,
    req.user.id, String(f.originalname || stored).slice(0, 250), stored, f.size, f.mimetype || MIME[ext] || '', Date.now());
  run(`UPDATE users SET used_bytes = used_bytes + ? WHERE id=?`, f.size, req.user.id);
  res.json({
    ok: true,
    data: {
      id: Number(info.lastInsertRowid),
      url: '/api/files/img/' + stored,
      originalName: f.originalname, size: f.size
    }
  });
});

// public access via stored url (image hosting)
router.get('/files/img/:stored', (req, res) => {
  const rec = one(`SELECT * FROM user_files WHERE stored_name=?`, req.params.stored);
  if (!rec) return res.status(404).json({ ok: false, error: 'File does not exist' });
  const p = path.join(config.abs.uploadsDir, rec.stored_name);
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: 'File does not exist' });
  res.setHeader('Content-Type', rec.mime || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});

router.get('/files/my', requireAuth, (req, res) => {
  const items = all(`SELECT id, original_name originalName, size, mime, created_at createdAt FROM user_files WHERE user_id=? ORDER BY id DESC LIMIT 200`, req.user.id);
  res.json({ ok: true, data: { items, usedBytes: req.user.used_bytes, quotaGb: req.user.quota_gb } });
});

router.delete('/files/:id', requireAuth, (req, res) => {
  const rec = one(`SELECT * FROM user_files WHERE id=?`, req.params.id);
  if (!rec) return res.status(404).json({ ok: false, error: 'File does not exist' });
  const own = rec.user_id === req.user.id;
  const admin = req.user.role === 'admin' || req.user.role === 'super';
  if (!own && !admin) return res.status(403).json({ ok: false, error: 'No permission to delete' });
  try { fs.rmSync(path.join(config.abs.uploadsDir, rec.stored_name), { force: true }); } catch { }
  run(`DELETE FROM user_files WHERE id=?`, rec.id);
  run(`UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id=?`, rec.size, rec.user_id);
  res.json({ ok: true });
});

module.exports = router;
