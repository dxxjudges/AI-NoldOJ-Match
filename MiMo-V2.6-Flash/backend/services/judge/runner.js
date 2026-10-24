'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../../config');
const db = require('../../db/database');
const sandbox = require('../sandbox/runner');
const languages = require('./languages');
const comparator = require('./comparator');
const scoring = require('./scoring');
const queue = require('./queue');
const { bus } = require('./queue');

function setStatus(subId, status, extra = {}) {
  db.run(
    'UPDATE submissions SET status = ? WHERE id = ?',
    status, subId
  );
  bus.emit('submission', { id: subId, status, ...extra });
}

async function judgeSubmission(subId) {
  const sub = db.get('SELECT * FROM submissions WHERE id = ?', subId);
  if (!sub) return;
  const problem = db.get('SELECT * FROM problems WHERE id = ?', sub.problem_id);
  if (!problem) {
    setStatus(subId, 'internal_error');
    return;
  }
  const lang = languages.getEnabled(sub.language);
  if (!lang) {
    setStatus(subId, 'system_error');
    return;
  }

  const cases = db.all(
    `SELECT tc.*, tg.full_score, tg.aggregation, tg.depends_on, tg.scoring_script AS group_script, tg.id AS gid
     FROM test_cases tc LEFT JOIN test_groups tg ON tg.id = tc.group_id
     WHERE tc.problem_id = ? ORDER BY tc.case_index`,
    sub.problem_id
  );
  if (!cases.length) {
    setStatus(subId, 'internal_error');
    db.run("UPDATE submissions SET detail = ? WHERE id = ?", JSON.stringify({ error: '该题目暂无测试数据' }), subId);
    return;
  }

  const sessionDir = sandbox.makeSessionDir(`sub${subId}`);
  try {
    // ---- write source ----
    const srcName = 'main' + lang.source_ext;
    const srcPath = path.join(sessionDir, srcName);
    const binPath = path.join(sessionDir, 'main');
    fs.writeFileSync(srcPath, sub.code, 'utf8');
    // multi-file submission: write extra files into the session dir
    const extraFiles = db.all('SELECT filename, content FROM submission_files WHERE submission_id = ?', subId);
    for (const f of extraFiles) {
      const safe = path.basename(String(f.filename)).replace(/[^\w.\-一-龥]/g, '_');
      if (!safe || safe === '.' || safe === '..') continue;
      fs.writeFileSync(path.join(sessionDir, safe), f.content, 'utf8');
    }

    // ---- compile ----
    if (Number(lang.is_compiled)) {
      setStatus(subId, 'compiling');
      const cmdLine = languages.expand(lang.compile_cmd, { src: srcPath, bin: binPath, dir: sessionDir, stack: problem.stack_limit_mb });
      const [exe, ...args] = languages.splitCmd(cmdLine);
      const c = await sandbox.run({
        cmd: exe, args, cwd: sessionDir,
        timeLimitMs: config.judge.compileTimeoutMs,
        memoryLimitMb: 1024,
      });
      if (c.exitCode !== 0) {
        setStatus(subId, 'compile_error');
        db.run(
          'UPDATE submissions SET compile_output = ?, judged_at = ? WHERE id = ?',
          (c.stderr || c.stdout || '编译失败').slice(0, 65536), db.now(), subId
        );
        updateStats(sub, false);
        return;
      }
      db.run('UPDATE submissions SET compile_output = ? WHERE id = ?', (c.stderr || '').slice(0, 65536), subId);
    }

    // ---- run test cases ----
    setStatus(subId, 'judging');
    const runCmd = languages.expand(lang.run_cmd, { src: srcPath, bin: binPath, dir: sessionDir, stack: problem.stack_limit_mb });
    const [runExe, ...runArgs] = languages.splitCmd(runCmd);
    const timeLimit = Math.round(problem.time_limit_ms * (lang.time_factor || 1));

    const groupMap = new Map();
    for (const c of cases) {
      const gid = c.gid || 0;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, {
          id: gid, full_score: Number(c.full_score) || 100,
          aggregation: c.aggregation || 'sum',
          depends_on: c.depends_on ? JSON.parse(c.depends_on) : [],
          script: c.group_script || '',
          results: [],
        });
      }
    }

    let allPassed = true;
    let finalScore = 0;
    const detail = { cases: [], groups: [] };

    for (let i = 0; i < cases.length; i++) {
      const tc = cases[i];
      const input = readFile(tc.input_path);
      const expected = readFile(tc.output_path);
      const r = await sandbox.run({
        cmd: runExe, args: runArgs, cwd: sessionDir,
        input,
        timeLimitMs: timeLimit,
        memoryLimitMb: problem.memory_limit_mb,
        outputLimitKb: problem.output_limit_kb,
      });

      let verdict = 'accepted';
      if (r.timedOut) verdict = 'time_limit';
      else if (r.memoryKilled) verdict = 'memory_limit';
      else if (r.outputKilled) verdict = 'output_limit';
      else if (r.exitCode !== 0) verdict = 'runtime_error';
      else if (!comparator.compare('strict', expected, r.stdout)) {
        // try float tolerance as a courtesy when expected has floats
        if (!/\d\.\d/.test(expected) || !comparator.compare('float', expected, r.stdout)) {
          verdict = 'wrong_answer';
        }
      }

      const passed = verdict === 'accepted';
      if (!passed) allPassed = false;
      const gid = tc.gid || 0;
      const g = groupMap.get(gid);
      if (g) g.results.push({ index: i, passed, verdict });

      detail.cases.push({
        index: i, group: gid, verdict,
        time_ms: r.timeMs, memory_kb: r.memoryKb,
        exit_code: r.exitCode,
        message: verdict === 'runtime_error' ? (r.stderr || '').slice(0, 2000)
          : verdict === 'time_limit' ? `超过时间限制 ${timeLimit}ms`
          : verdict === 'memory_limit' ? `超过内存限制 ${problem.memory_limit_mb}MB`
          : verdict === 'output_limit' ? '超过输出限制' : '',
      });

      bus.emit('submission', { id: subId, status: 'judging', progress: { done: i + 1, total: cases.length } });
    }

    // ---- aggregate per group with dependency + scoring script ----
    const groupScores = new Map();
    const groupsSorted = [...groupMap.values()].sort((a, b) => a.id - b.id);
    for (const g of groupsSorted) {
      const depsOk = g.depends_on.every(d => (groupScores.get(d) || 0) > 0);
      if (!depsOk) {
        groupScores.set(g.id, 0);
        detail.groups.push({ id: g.id, score: 0, reason: '依赖分组未通过' });
        continue;
      }
      const n = g.results.length;
      const passedCount = g.results.filter(r => r.passed).length;
      let score;
      if (g.script && g.script.trim()) {
        const vars = { full: g.full_score, n, passed: passedCount };
        g.results.forEach((r, idx) => { vars[`s${idx}`] = r.passed ? 1 : 0; });
        try {
          score = scoring.runScript(g.script, vars);
        } catch (e) {
          console.error('[judge] group script error:', e.message);
          score = scoring.aggregate('sum', g.results.map(r => r.passed ? g.full_score / n : 0), g.full_score);
        }
      } else {
        score = scoring.aggregate(
          g.aggregation,
          g.results.map(r => r.passed ? g.full_score / n : 0),
          g.full_score
        );
      }
      score = Math.max(0, Math.min(g.full_score, score));
      groupScores.set(g.id, score);
      detail.groups.push({ id: g.id, score, aggregation: g.aggregation });
    }

    // ---- problem-level scoring script override ----
    if (problem.scoring_script && problem.scoring_script.trim()) {
      const vars = { n: groupScores.size, passed: [...groupScores.values()].filter(s => s > 0).length, full: 100 };
      [...groupScores.entries()].forEach(([gid, s], idx) => { vars[`s${idx}`] = s; vars[`g${gid}`] = s; });
      try {
        finalScore = scoring.runScript(problem.scoring_script, vars);
      } catch (e) {
        console.error('[judge] problem script error:', e.message);
        finalScore = [...groupScores.values()].reduce((a, b) => a + b, 0);
      }
    } else {
      finalScore = [...groupScores.values()].reduce((a, b) => a + b, 0);
    }
    finalScore = Math.max(0, Math.min(100, finalScore));

    const status = allPassed && finalScore >= 100 ? 'accepted'
      : finalScore > 0 ? 'wrong_answer'
      : (detail.cases[0] && detail.cases[0].verdict !== 'wrong_answer') ? detail.cases[0].verdict
      : 'wrong_answer';

    const maxTime = Math.max(0, ...detail.cases.map(c => c.time_ms || 0));
    const maxMem = Math.max(0, ...detail.cases.map(c => c.memory_kb || 0));

    db.run(
      `UPDATE submissions SET status=?, score=?, time_ms=?, memory_kb=?, detail=?, judged_at=? WHERE id=?`,
      status, finalScore, maxTime, maxMem, JSON.stringify(detail), db.now(), subId
    );
    updateStats(sub, status === 'accepted');
    bus.emit('submission', { id: subId, status, score: finalScore, time_ms: maxTime, memory_kb: maxMem });
    require('../../services/rating').onJudged(subId, sub.user_id, status);
    require('../../services/achievements').checkOnSubmission(sub.user_id, sub.problem_id, status);
  } catch (e) {
    console.error('[judge] fatal', e);
    setStatus(subId, 'internal_error');
    db.run('UPDATE submissions SET detail = ? WHERE id = ?', JSON.stringify({ error: String(e.message) }), subId);
  } finally {
    sandbox.cleanupDir(sessionDir);
  }
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function updateStats(sub, accepted) {
  db.run('UPDATE problems SET submit_count = submit_count + 1 WHERE id = ?', sub.problem_id);
  if (accepted) db.run('UPDATE problems SET accept_count = accept_count + 1 WHERE id = ?', sub.problem_id);
  if (accepted) {
    require('../../services/achievements').onFirstBlood(sub.user_id, sub.problem_id);
    require('../../services/problemset').onSolved(sub.user_id, sub.problem_id);
  }
}

/** Queue a submission for judging (called from routes after AI review passes). */
function submitToQueue(submissionId) {
  setStatus(submissionId, 'queued');
  queue.enqueue({ kind: 'submission', id: submissionId });
}

module.exports = { judgeSubmission, submitToQueue };
