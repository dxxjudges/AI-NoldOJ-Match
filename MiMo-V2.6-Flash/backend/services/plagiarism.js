'use strict';

/**
 * Code plagiarism detection (async).
 * Token-sequence similarity: strip comments/whitespace, keep identifiers.
 * Three tiers: >=85% high (red), >=70% suspect (orange), below → not recorded.
 */

const db = require('../db/database');
const { config } = require('../config');

function stripComments(code, lang) {
  let s = String(code);
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  s = s.replace(/#[^\n]*/g, ' '); // python/js hash comments (approximation)
  s = s.replace(/"(\\.|[^"\\])*"/g, ' S ');
  s = s.replace(/'(\\.|[^'\\])*'/g, ' S ');
  return s;
}

function tokenize(code, lang = '') {
  const s = stripComments(code, lang);
  const tokens = s.match(/[A-Za-z_][A-Za-z0-9_]*|\d+|[^\sA-Za-z0-9_]/g) || [];
  return tokens;
}

function tokensOf(code, lang) {
  return tokenize(code, lang);
}

/** Jaccard-like similarity over token multiset + LCS ratio blend. */
function similarity(ta, tb) {
  if (!ta.length || !tb.length) return 0;
  const sa = new Map(), sb = new Map();
  for (const t of ta) sa.set(t, (sa.get(t) || 0) + 1);
  for (const t of tb) sb.set(t, (sb.get(t) || 0) + 1);
  let inter = 0;
  for (const [t, c] of sa) inter += Math.min(c, sb.get(t) || 0);
  const union = ta.length + tb.length - inter;
  const jaccard = union ? inter / union : 0;
  const lcs = lcsRatio(ta, tb);
  return Math.min(1, jaccard * 0.4 + lcs * 0.6);
}

function lcsRatio(a, b) {
  // cap lengths for O(n*m)
  const A = a.slice(0, 400), B = b.slice(0, 400);
  const dp = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    let prev = 0;
    for (let j = 1; j <= B.length; j++) {
      const tmp = dp[j];
      if (A[i - 1] === B[j - 1]) dp[j] = prev + 1;
      else dp[j] = Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[B.length] / Math.max(A.length, B.length);
}

async function runJob(jobId) {
  const job = db.get('SELECT * FROM plagiarism_jobs WHERE id = ?', jobId);
  if (!job) return;
  db.run("UPDATE plagiarism_jobs SET status='running', progress=? WHERE id=?", JSON.stringify({ phase: 'collect' }), jobId);
  try {
    let problemIds = [];
    if (job.problem_id) problemIds = [job.problem_id];
    else if (job.contest_id) {
      problemIds = db.all('SELECT problem_id FROM contest_problems WHERE contest_id = ?', job.contest_id).map(r => r.problem_id);
    }
    const totalPairsHint = problemIds.length;
    let done = 0;
    for (const pid of problemIds) {
      // latest submission per user for this problem
      const subs = db.all(
        `SELECT s.id, s.user_id, s.code, s.language FROM submissions s
         WHERE s.problem_id = ? AND s.status IN ('accepted','wrong_answer','time_limit','memory_limit','runtime_error')
         AND LENGTH(s.code) >= ?
         AND s.id = (SELECT MAX(id) FROM submissions WHERE problem_id = ? AND user_id = s.user_id)
         ORDER BY s.id`,
        pid, config.plagiarism.minCodeLength, pid
      );
      for (let i = 0; i < subs.length; i++) {
        for (let j = i + 1; j < subs.length; j++) {
          if (subs[i].user_id === subs[j].user_id) continue;
          const ta = tokensOf(subs[i].code, subs[i].language);
          const tb = tokensOf(subs[j].code, subs[j].language);
          db.run('INSERT OR REPLACE INTO plagiarism_tokens (submission_id, tokens) VALUES (?,?)',
            subs[i].id, JSON.stringify(ta));
          db.run('INSERT OR REPLACE INTO plagiarism_tokens (submission_id, tokens) VALUES (?,?)',
            subs[j].id, JSON.stringify(tb));
          const sim = similarity(ta, tb);
          if (sim >= config.plagiarism.suspectSimilarity) {
            db.run(
              'INSERT INTO plagiarism_pairs (job_id, submission_a, submission_b, similarity, level) VALUES (?,?,?,?,?)',
              jobId, subs[i].id, subs[j].id, sim,
              sim >= config.plagiarism.highSimilarity ? 'high' : 'suspect'
            );
          }
        }
      }
      done++;
      db.run('UPDATE plagiarism_jobs SET progress=? WHERE id=?',
        JSON.stringify({ phase: 'compare', done, total: totalPairsHint }), jobId);
    }
    db.run("UPDATE plagiarism_jobs SET status='done', finished_at=?, progress=? WHERE id=?",
      db.now(), JSON.stringify({ phase: 'done', done, total: totalPairsHint }), jobId);
  } catch (e) {
    console.error('[plagiarism]', e);
    db.run("UPDATE plagiarism_jobs SET status='failed', finished_at=? WHERE id=?", db.now(), jobId);
  }
}

module.exports = { runJob, tokenize, tokensOf, similarity };
