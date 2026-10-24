const express = require('express');
const config = require('../config');
const { one, all, run } = require('../db/db');
const { requireAuth, requireMin, safeUser } = require('../utils/middleware');
const rateLimit = require('../utils/rateLimit');
const judge = require('../judge/judge');
const ide = require('../judge/ide');
const { reviewSubmission } = require('../ai/securityReview');

const router = express.Router();

function ipOf(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

const STATUS_FILTERS = ['ac', 'wa', 'tle', 'mle', 're', 'ce', 'se', 'pc', 'pending', 'judging', 'compiling'];

// ---------- create submission ----------
router.post('/submissions', requireAuth, async (req, res) => {
  try {
    if (req.user.banned) return res.status(403).json({ ok: false, error: 'Account banned' });
    if (!rateLimit.hit('sub:' + req.user.id + ':' + ipOf(req), config.core.submissionRateLimit, 60 * 1000)) {
      return res.status(429).json({ ok: false, error: 'Submission too frequent' });
    }
    const b = req.body || {};
    const problem = one(`SELECT * FROM problems WHERE id=?`, b.problemId);
    if (!problem) return res.status(404).json({ ok: false, error: 'Problem does not exist' });
    const lang = one(`SELECT * FROM languages WHERE id=? AND enabled=1`, b.languageId || req.user.preferred_lang);
    if (!lang) return res.status(400).json({ ok: false, error: 'This language is disabled or does not exist' });

    // Multi-file submission
    let code = '', codeFiles = [];
    if (Array.isArray(b.files) && b.files.length) {
      for (const f of b.files.slice(0, 10)) {
        if (!f.content) continue;
        codeFiles.push({ name: String(f.name || 'file.source').slice(0, 120), content: String(f.content) });
      }
      code = codeFiles[0] ? codeFiles[0].content : '';
      const totalSize = codeFiles.reduce((a, f) => a + f.content.length, 0);
      if (totalSize > config.core.codeMaxLength) return res.status(400).json({ ok: false, error: `Total source code size exceeds the ${Math.floor(config.core.codeMaxLength / 1024)}KB limit` });
    } else {
      code = String(b.code || '');
      if (code.length > config.core.codeMaxLength) return res.status(400).json({ ok: false, error: `Source code size exceeds the ${Math.floor(config.core.codeMaxLength / 1024)}KB limit` });
      if (!code.trim()) return res.status(400).json({ ok: false, error: 'Code cannot be empty' });
    }

    // Non-privileged users cannot submit again while awaiting judgment (submission lock)
    const privileged = ['super'].includes(req.user.role) || (req.user.role === 'admin');
    if (!privileged && !b.runOnly) {
      const pending = one(`SELECT id FROM submissions WHERE user_id=? AND is_ide=0 AND status IN ('pending','compiling','judging') LIMIT 1`, req.user.id);
      if (pending) return res.status(429).json({ ok: false, error: 'You have a submission currently being judged; please wait for it to finish before submitting again' });
    }

    const contestId = b.contestId ? Number(b.contestId) : null;
    if (contestId) {
      const c = one(`SELECT * FROM contests WHERE id=?`, contestId);
      const inContest = one(`SELECT 1 FROM contest_participants WHERE contest_id=? AND user_id=?`, contestId, req.user.id);
      if (!c) return res.status(404).json({ ok: false, error: 'Contest does not exist' });
      const now = Date.now();
      if (!(now >= c.start_time && now < c.end_time)) return res.status(400).json({ ok: false, error: 'Contest is not active' });
      if (!inContest) return res.status(403).json({ ok: false, error: 'You have not joined this contest' });
    }
    const virtualId = b.virtualId ? Number(b.virtualId) : null;

    const info = run(
      `INSERT INTO submissions (user_id, problem_id, contest_id, virtual_id, language_id, code, code_files, status, created_at)
       VALUES (?,?,?,?,?,?,?, 'pending', ?)`,
      req.user.id, problem.id, contestId, virtualId, lang.id, code, JSON.stringify(codeFiles), Date.now());
    const subId = Number(info.lastInsertRowid);

    // Async AI security review; judge only proceeds after passing (non-blocking)
    setImmediate(async () => {
      try {
        const review = await reviewSubmission(codeFiles.length ? JSON.stringify(codeFiles) : code, lang.name, req.user.id);
        if (!review.pass) {
          run(`UPDATE submissions SET status='se', error_msg='AI security review did not pass: ' || ?, judged_at=? WHERE id=?`,
            review.reason || 'minor violation', Date.now(), subId);
          return;
        }
      } catch { /* fail-open */ }
      judge.enqueue(subId);
    });

    res.json({ ok: true, data: { id: subId, status: 'pending' } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- list ----------
router.get('/submissions', (req, res) => {
  const { userId, problemId, status, page = 1, pageSize = 20, mine = '', contestId } = req.query;
  let rows = all(`
    SELECT s.id, s.user_id, s.problem_id, s.contest_id, s.language_id, s.status, s.score, s.case_total, s.case_passed,
           s.time_ms, s.memory_kb, s.error_msg, s.created_at, s.judged_at, s.is_ide,
           u.username, p.title AS problem_title, l.name AS language_name
    FROM submissions s JOIN users u ON u.id=s.user_id JOIN problems p ON p.id=s.problem_id
    LEFT JOIN languages l ON l.id=s.language_id
    WHERE s.is_ide=0
    ORDER BY s.id DESC LIMIT 500`);
  if (mine === '1' && req.user) rows = rows.filter(r => r.user_id === req.user.id);
  if (userId) rows = rows.filter(r => r.user_id === Number(userId));
  if (problemId) rows = rows.filter(r => r.problem_id === Number(problemId));
  if (contestId) rows = rows.filter(r => r.contest_id === Number(contestId));
  if (status && STATUS_FILTERS.includes(status)) rows = rows.filter(r => r.status === status);
  const total = rows.length;
  const pageN = Math.max(1, Number(page));
  const size = Math.min(100, Math.max(5, Number(pageSize) || 20));
  res.json({ ok: true, data: { total, page: pageN, pageSize: size, items: rows.slice((pageN - 1) * size, pageN * size) } });
});

// ---------- detail ----------
router.get('/submissions/:id', (req, res) => {
  const s = one(`
    SELECT s.*, u.username, p.title AS problem_title, l.name AS language_name
    FROM submissions s JOIN users u ON u.id=s.user_id JOIN problems p ON p.id=s.problem_id
    LEFT JOIN languages l ON l.id=s.language_id WHERE s.id=?`, req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'Submission record does not exist' });
  const isOwner = req.user && req.user.id === s.user_id;
  const isTeacher = !!(req.user && ['teacher', 'admin', 'super'].includes(req.user.role));
  const cases = all(`SELECT * FROM submission_cases WHERE submission_id=? ORDER BY ord, id`, s.id);
  const showCode = isOwner || isTeacher;
  res.json({
    ok: true,
    data: {
      submission: {
        ...s,
        code: showCode ? s.code : undefined,
        code_files: showCode ? s.code_files : undefined,
        code_files_meta: showCode && s.code_files ? safeParse(s.code_files) : undefined
      },
      cases,
      showCode
    }
  });
});
function safeParse(s) { try { return JSON.parse(s).map(f => ({ name: f.name, size: (f.content || '').length })); } catch { return []; } }

router.get('/submissions/:id/code', requireAuth, (req, res) => {
  const s = one(`SELECT * FROM submissions WHERE id=?`, req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'Submission record does not exist' });
  const isTeacher = ['teacher', 'admin', 'super'].includes(req.user.role);
  if (s.user_id !== req.user.id && !isTeacher) return res.status(403).json({ ok: false, error: 'Cannot view others source code' });
  res.json({ ok: true, data: { code: s.code, files: safeParse(s.code_files) } });
});

// ---------- rejudge ----------
router.post('/submissions/:id/rejudge', requireMin('teacher'), (req, res) => {
  const s = one(`SELECT * FROM submissions WHERE id=?`, req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'Submission record does not exist' });
  if (s.is_ide) return res.status(400).json({ ok: false, error: 'Cannot rejudge IDE runs' });
  run(`UPDATE submissions SET status='pending', score=0, case_passed=0, time_ms=0, memory_kb=0, error_msg='' WHERE id=?`, s.id);
  judge.enqueue(s.id);
  res.json({ ok: true });
});

// ---------- delete (ID recycling) ----------
router.delete('/submissions/:id', requireMin('admin'), (req, res) => {
  const s = one(`SELECT * FROM submissions WHERE id=?`, req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'Submission record does not exist' });
  run(`DELETE FROM submissions WHERE id=?`, s.id);        // plain PK => id reusable
  run(`DELETE FROM submission_cases WHERE submission_id=?`, s.id);
  res.json({ ok: true });
});

// ---------- diff: compare two own submissions of same problem ----------
router.get('/submissions/:idA/diff/:idB', requireAuth, (req, res) => {
  const a = one(`SELECT * FROM submissions WHERE id=?`, req.params.idA);
  const b = one(`SELECT * FROM submissions WHERE id=?`, req.params.idB);
  if (!a || !b) return res.status(404).json({ ok: false, error: 'Submission record does not exist' });
  const isTeacher = ['teacher', 'admin', 'super'].includes(req.user.role);
  if (a.user_id !== req.user.id || b.user_id !== req.user.id) {
    if (!isTeacher) return res.status(403).json({ ok: false, error: 'Can only compare own submissions' });
  }
  if (a.user_id !== b.user_id) return res.status(400).json({ ok: false, error: 'Only submissions by the same user on the same problem can be compared' });
  res.json({
    ok: true,
    data: {
      a: { id: a.id, createdAt: a.created_at, status: a.status, code: a.code },
      b: { id: b.id, createdAt: b.created_at, status: b.status, code: b.code }
    }
  });
});

// ---------- IDE run (login required; queue based) ----------
router.post('/ide/run', requireAuth, async (req, res) => {
  if (req.user.banned) return res.status(403).json({ ok: false, error: 'Account banned' });
  if (!rateLimit.hit('ide:' + req.user.id, config.core.ideRateLimit, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'IDE executions too frequent' });
  }
  const b = req.body || {};
  const lang = one(`SELECT * FROM languages WHERE id=? AND enabled=1`, b.languageId || req.user.preferred_lang);
  if (!lang) return res.status(400).json({ ok: false, error: 'This language is disabled or does not exist' });
  const code = String(b.code || '');
  if (code.length > config.core.codeMaxLength) return res.status(400).json({ ok: false, error: 'Code exceeds size limit' });
  const input = String(b.input || '').slice(0, 200000);
  const runId = ide.start(lang, code, input, req.user.id, reviewSubmission);
  res.json({ ok: true, data: { runId } });
});

router.get('/ide/run/:runId', requireAuth, (req, res) => {
  const r = ide.get(req.params.runId);
  if (!r || r.userId !== req.user.id) return res.status(404).json({ ok: false, error: 'Execution task does not exist or has expired' });
  res.json({ ok: true, data: r });
});

module.exports = router;
