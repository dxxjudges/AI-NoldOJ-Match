const express = require('express');
const { one, all, run } = require('../db/db');
const { requireMin } = require('../utils/middleware');

const router = express.Router();

// Public list: full for admins, enabled-only for others
router.get('/languages', (req, res) => {
  const isAdmin = req.user && req.user.role === 'super';
  const rows = all(`SELECT * FROM languages ORDER BY ord, id`);
  res.json({
    ok: true,
    data: {
      items: rows.map(l => ({
        ...l,
        compile_cmd: isAdmin || ['teacher', 'admin'].includes(req.user && req.user.role) ? l.compile_cmd : undefined,
        run_cmd: isAdmin || ['teacher', 'admin'].includes(req.user && req.user.role) ? l.run_cmd : undefined
      }))
    }
  });
});

router.post('/languages', requireMin('super'), (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.name || !b.runCmd) return res.status(400).json({ ok: false, error: 'code, name, runCmd are required' });
  if (one(`SELECT id FROM languages WHERE code=?`, b.code)) return res.status(400).json({ ok: false, error: 'Language code already exists' });
  const info = run(`INSERT INTO languages (code, name, compile_cmd, run_cmd, enabled, ord) VALUES (?,?,?,?,?,?)`,
    b.code, b.name, b.compileCmd || '', b.runCmd, b.enabled === false ? 0 : 1, Number(b.ord) || 0);
  res.json({ ok: true, data: { id: Number(info.lastInsertRowid) } });
});

router.put('/languages/:id', requireMin('super'), (req, res) => {
  const l = one(`SELECT * FROM languages WHERE id=?`, req.params.id);
  if (!l) return res.status(404).json({ ok: false, error: 'Language does not exist' });
  const b = req.body || {};
  run(`UPDATE languages SET name=?, compile_cmd=?, run_cmd=?, enabled=?, ord=? WHERE id=?`,
    b.name !== undefined ? b.name : l.name,
    b.compileCmd !== undefined ? b.compileCmd : l.compile_cmd,
    b.runCmd !== undefined ? b.runCmd : l.run_cmd,
    b.enabled !== undefined ? (b.enabled ? 1 : 0) : l.enabled,
    b.ord !== undefined ? Number(b.ord) : l.ord, l.id);
  res.json({ ok: true });
});

router.delete('/languages/:id', requireMin('super'), (req, res) => {
  run(`DELETE FROM languages WHERE id=?`, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
