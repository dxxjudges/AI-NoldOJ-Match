// Code plagiarism detection:
//  - tokenize source (strip comments/whitespace, preserve variable names)
//  - compare token sequences via LCS overlap (dice coefficient)
//  - verdict: >=85% high (red), >=70% suspect (orange); below not recorded
//  - async background execution with progress
const { one, all, run } = require('../db/db');
const events = require('../ws/events');

const HIGH = 0.85, SUSPECT = 0.70;
const MIN_TOKENS = 20; // skip too-short code

function tokenize(code) {
  let s = String(code || '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');      // block comments
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');  // line comments (keeps http://)
  s = s.replace(/(^|[^:])#[^\n]*/g, '$1 ');     // python comments
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''"); // collapse strings
  return s.split(/[^A-Za-z0-9_]+/).filter(Boolean);
}

function lcsSimilarity(a, b) {
  if (a.length < MIN_TOKENS || b.length < MIN_TOKENS) return 0;
  if (a.length * b.length > 4000000) { // downsample huge inputs
    const sa = Math.ceil(a.length / 2000), sb = Math.ceil(b.length / 2000);
    a = a.filter((_, i) => i % sa === 0);
    b = b.filter((_, i) => i % sb === 0);
  }
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ai === b[j - 1] ? (prev[j - 1] + 1) : Math.max(prev[j], cur[j - 1]);
    }
    const t = prev; prev = cur; cur = t;
  }
  const lcs = prev[b.length];
  return (2 * lcs) / (a.length + b.length);
}

function crossPairs(subs) {
  const out = [];
  for (let i = 0; i < subs.length; i++) {
    for (let j = i + 1; j < subs.length; j++) {
      if (subs[i].user_id === subs[j].user_id) continue; // same user skipped
      out.push({ a: subs[i], b: subs[j] });
    }
  }
  return out;
}

async function runReport(reportId, scopeProblemId, contestId) {
  let pairs = [];
  if (scopeProblemId) {
    const latest = all(`
      SELECT s.id, s.user_id, s.code FROM submissions s
      WHERE s.problem_id=? AND s.is_ide=0
        AND s.id IN (SELECT MAX(id) FROM submissions WHERE problem_id=? GROUP BY user_id)`,
      scopeProblemId, scopeProblemId);
    pairs = crossPairs(latest);
  } else if (contestId) {
    const latest = all(`
      SELECT s.id, s.user_id, s.problem_id, s.code FROM submissions s
      WHERE s.contest_id=? AND s.is_ide=0
        AND s.id IN (SELECT MAX(id) FROM submissions WHERE contest_id=? GROUP BY user_id, problem_id)`,
      contestId, contestId);
    const byP = new Map();
    for (const s of latest) {
      if (!byP.has(s.problem_id)) byP.set(s.problem_id, []);
      byP.get(s.problem_id).push(s);
    }
    for (const [, arr] of byP) pairs.push(...crossPairs(arr));
  }
  run(`UPDATE plagiarism_reports SET total=? WHERE id=?`, pairs.length, reportId);
  let done = 0;
  for (const p of pairs) {
    try {
      const sim = lcsSimilarity(tokenize(p.a.code), tokenize(p.b.code));
      if (sim >= SUSPECT) {
        run(`INSERT INTO plagiarism_pairs (report_id, user_id_a, user_id_b, submission_id_a, submission_id_b, similarity, verdict)
          VALUES (?,?,?,?,?,?,?)`,
          reportId, p.a.user_id, p.b.user_id, p.a.id, p.b.id, Math.round(sim * 10000) / 10000,
          sim >= HIGH ? 'high' : 'suspect');
      }
    } catch (e) {
      console.warn('[PLAGIARISM] pair error:', e.message);
    }
    done++;
    if (done % 5 === 0 || done === pairs.length) {
      run(`UPDATE plagiarism_reports SET progress=? WHERE id=?`, done, reportId);
      events.broadcast('plagiarism:progress', { reportId, progress: done, total: pairs.length });
    }
    await new Promise(r => setImmediate(r));
  }
  run(`UPDATE plagiarism_reports SET status='done' WHERE id=?`, reportId);
  events.broadcast('plagiarism:progress', { reportId, done: true });
}

module.exports = { runReport, tokenize, lcsSimilarity, HIGH, SUSPECT };
