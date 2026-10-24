const fs = require('fs');
const path = require('path');
const config = require('../config');
const { one, all, run } = require('../db/db');
const { createWorkspace, cleanupWorkspace, compile, parseRunCmd, sandboxRun } = require('./run');
const { compare } = require('./compare');
const { evalScoreScript } = require('./score');
const events = require('../ws/events');

const MAX_TRIES = 3;

const queue = [];           // submission ids
const running = new Set();
let processing = false;

function enqueue(submissionId) {
  if (running.has(submissionId)) return;
  queue.push(submissionId);
  setImmediate(pump);
}

function queueLength() { return queue.length + running.size; }

async function pump() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0 && running.size < Math.max(1, config.judge.concurrency)) {
      const id = queue.shift();
      if (!id || running.has(id)) continue;
      running.add(id);
      processSubmission(id).catch(e => {
        console.error('[JUDGE] submission', id, 'fatal error:', e.message);
        try {
          run(`UPDATE submissions SET status='se', error_msg=?, judged_at=? WHERE id=? AND status IN ('pending','compiling','judging')`,
            'Repository internal error: ' + e.message.slice(0, 500), Date.now(), id);
          run(`DELETE FROM submission_locks WHERE user_id = (SELECT user_id FROM submissions WHERE id=?)`, id);
        } catch { /* ignore */ }
      }).finally(() => {
        running.delete(id);
        setImmediate(pump);
      });
    }
  } finally {
    processing = false;
  }
}

function updateSub(id, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE submissions SET ${keys.map(k => `${k}=?`).join(', ')} WHERE id=?`;
  run(sql, ...keys.map(k => fields[k]), id);
  broadcastSub(id);
}

function broadcastSub(id) {
  const s = one(`SELECT id, user_id, problem_id, status, score, case_total, case_passed, time_ms, memory_kb FROM submissions WHERE id=?`, id);
  if (s) {
    events.broadcast('sub:update', {
      id: s.id, userId: s.user_id, problemId: s.problem_id,
      status: s.status, score: s.score, cases: s.case_passed + '/' + s.case_total,
      timeMs: s.time_ms, memoryKb: s.memory_kb
    });
  }
}

async function processSubmission(subId) {
  const sub = one(`SELECT * FROM submissions WHERE id=?`, subId);
  if (!sub || !['pending'].includes(sub.status)) return;

  const problem = one(`SELECT * FROM problems WHERE id=?`, sub.problem_id);
  if (!problem) { updateSub(subId, { status: 'se', error_msg: 'Problem does not exist', judged_at: Date.now() }); return; }

  const lang = one(`SELECT * FROM languages WHERE id=?`, sub.language_id);
  updateSub(subId, { status: 'compiling', error_msg: '' });

  const files = [];
  let codeFiles = null;
  try { codeFiles = JSON.parse(sub.code_files || '[]'); } catch { codeFiles = null; }
  if (codeFiles && codeFiles.length) {
    for (const f of codeFiles) files.push({ name: f.name, content: f.content });
  } else {
    files.push({ name: 'main_' + (lang ? lang.code : 'code') + '.source', content: sub.code });
  }

  const work = createWorkspace();
  try {
    // ---- compile ----
    if (!lang || !lang.enabled) {
      finishCompileError(subId, sub, 'This language is disabled or does not exist', [], problem);
      return;
    }
    const entryName = files[0].name;
    const c = await compile(lang, work, entryName, files);
    if (!c.ok) {
      finishCompileError(subId, sub, 'Compilation failed', [(c.output || 'No compiler output').slice(0, 16000)], problem);
      return;
    }

    updateSub(subId, { status: 'judging' });

    // ---- run test cases ----
    const testcases = all(`SELECT * FROM testcases WHERE problem_id=? ORDER BY ord, id`, problem.id);
    if (testcases.length === 0) {
      finishWithError(subId, sub, 'This problem has no test cases configured', []);
      return;
    }
    const groups = all(`SELECT * FROM testcase_groups WHERE problem_id=? ORDER BY ord, id`, problem.id);

    const caseResults = [];   // {testcase, res, status, score}
    const checker = resolveChecker(problem.id);

    for (const tc of testcases) {
      const tl = (tc.time_limit_ms || problem.time_limit_ms || 1000);
      const ml = (tc.memory_limit_mb || problem.memory_limit_mb || 256);
      const inputPath = path.join(config.abs.testdataDir, String(problem.id), tc.input_path);
      if (!fs.existsSync(inputPath)) {
        caseResults.push({ tc, res: { error: 'input_missing' }, status: 'se', score: 0 });
        continue;
      }
      const rp = parseRunCmd(lang.run_cmd, work, entryName);
      const res = await sandboxRun(rp.program, rp.args, work, inputPath, tl, ml);

      // Verdict
      let status = 'ac';
      const exitOk = res.exitCode === 0;
      if (res.error) status = 'se';
      else if (res.timedOut === true) status = 'tle';
      else if (res.memoryKb > ml * 1024) status = 'mle';
      else if (!exitOk) status = 're';
      else {
        const actual = res.output || '';
        const expected = readTestCaseOutput(tc, problem.id);
        if (tc_owns_time(res, tl)) status = 'tle';
        else if (compare_mode_compare(problem, tc, checker, inputPath, actual, expected, work)) status = 'ac';
        else status = 'wa';
      }
      const passed = status === 'ac';
      const score = passed ? (tc.score || 10) : 0;
      caseResults.push({ tc, res, status, score });
      // Live push per case
      events.broadcast('sub:case', { submissionId: subId, testcaseId: tc.id, status });
    }

    // ---- aggregate ----
    const sumScore = caseResults.reduce((a, c) => a + c.score, 0);
    const passedCount = caseResults.filter(c => c.status === 'ac').length;
    const actualTime = Math.max(0, ...caseResults.map(c => c.res.timeMs || 0));
    const actualMem = Math.max(0, ...caseResults.map(c => c.res.memoryKb || 0));

    let finalScore = 0;
    let finalStatus;
    const worstNonAc = caseResults.map(c => c.status).find(s => s !== 'ac') || 'wa';

    if (problem.judge_mode === 'custom' && (problem.score_script || '').trim()) {
      try {
        finalScore = evalScoreScript(problem.score_script, {
          CASES: testcases.length, PASSED: passedCount, PARTIAL: passedCount > 0 ? 1 : 0,
          TIME: actualTime, MEMORY: actualMem, GROUPS: groups.length, SCORE: sumScore
        });
        finalScore = Math.max(0, Number(finalScore) || 0);
      } catch (e) {
        finalScore = sumScore;
      }
    } else if (groups.length > 0) {
      // Grouped scoring honoring dependencies and aggregation
      const groupScore = {};
      const ordered = topologicalGroups(groups);
      for (const g of ordered) {
        const deps = safeDeps(g.depends);
        const depOk = deps.every(d => (groupScore[d] || 0) >= (one(`SELECT score FROM testcase_groups WHERE id=?`, d)?.score || 0) * 0.999);
        const cases = caseResults.filter(c => c.tc.group_id === g.id);
        if (!depOk || cases.length === 0) { groupScore[g.id] = 0; continue; }
        let s = 0;
        if (g.agg === 'sum') s = cases.reduce((a, c) => a + c.score, 0);
        else if (g.agg === 'max') s = Math.max(...cases.map(c => c.score));
        else s = Math.min(...cases.map(c => c.score)); // 'min' default
        if ((g.score_script || '').trim()) {
          try {
            s = evalScoreScript(g.score_script, {
              CASES: cases.length, PASSED: cases.filter(c => c.status === 'ac').length,
              SCORE: s, TOTAL: g.score, TIME: actualTime, MEMORY: actualMem
            });
            s = Math.max(0, Number(s) || 0);
          } catch { /* keep aggregated s */ }
        }
        groupScore[g.id] = Math.min(s, g.score);
      }
      finalScore = Object.values(groupScore).reduce((a, b) => a + b, 0);
    } else {
      finalScore = sumScore;
    }

    if (caseResults.some(c => c.status === 'se')) finalStatus = 'se';
    else if (passedCount === 0) finalStatus = worstNonAc;
    else if (passedCount === testcases.length && finalScore >= totalProblemScore(problem, testcases, groups) - 1e-9) finalStatus = 'ac';
    else finalStatus = 'pc';

    // persist per-case rows
    run(`DELETE FROM submission_cases WHERE submission_id=?`, subId);
    let ord = 0;
    for (const cr of caseResults) {
      run(`INSERT INTO submission_cases (submission_id, testcase_id, group_id, ord, status, score, time_ms, memory_kb, msg)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        subId, cr.tc.id, cr.tc.group_id, ord++, cr.status, cr.score,
        Math.max(0, cr.res.timeMs || 0), Math.max(0, cr.res.memoryKb || 0),
        (cr.res && cr.res.error ? cr.res.error : '').slice(0, 500));
    }

    const ratingDelta = require('../services/rating').applyRatingAfterJudge(sub.user_id, subId, problem, finalStatus);
    require('../services/achievements').checkAchievements(sub.user_id);

    // problem set progress: auto-record solved problems in any training plan
    if (finalStatus === 'ac') {
      const sets = all(`SELECT set_id FROM problem_set_items WHERE problem_id=?`, problem.id);
      for (const s of sets) {
        run(`INSERT OR IGNORE INTO problem_set_progress (set_id, user_id, problem_id, solved_at) VALUES (?,?,?,?)`,
          s.set_id, sub.user_id, problem.id, Date.now());
      }
    }

    updateSub(subId, {
      status: finalStatus,
      score: Math.round(finalScore * 100) / 100,
      case_total: testcases.length,
      case_passed: passedCount,
      time_ms: actualTime,
      memory_kb: actualMem,
      error_msg: finalStatus === 'se' ? ('Some test cases encountered an internal error: ' +
        (caseResults.find(c => c.res && c.res.error)?.res.error || '')) : '',
      judged_at: Date.now()
    });
    events.broadcast('rating:update', { userId: sub.user_id, delta: ratingDelta && ratingDelta.delta });
  } finally {
    cleanupWorkspace(work); // independent per-judge temp dir, auto cleaned
  }
}

function tc_owns_time(res, tl) {
  // wall time exceeded => TLE (exit still 0 -- program finished but too slow)
  return (res.timeMs || 0) > tl + 50 && (res.cpuMs || 0) > tl;
}

function compare_mode_compare(problem, tc, checker, inputPath, actual, expected, work) {
  const tol = tc.float_tolerance !== undefined && tc.float_tolerance !== null ? tc.float_tolerance : problem.float_tolerance;
  if (problem.compare_mode === 'spj' && checker) {
    return runChecker(checker, inputPath, expected, actual, work, problem);
  }
  return compare(actual, expected, problem.compare_mode, tol);
}

function readTestCaseOutput(tc, problemId) {
  try {
    return fs.readFileSync(path.join(config.abs.testdataDir, String(problemId), tc.output_path), 'utf8');
  } catch { return null; }
}

function resolveChecker(problemId) {
  const dir = path.join(config.abs.testdataDir, String(problemId));
  for (const name of ['check.exe', 'check.py', 'spj.py', 'spj.exe']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return { path: p, kind: p.endsWith('.py') ? 'py' : 'exe' };
  }
  return null;
}

let checkerBusy = false;
function runChecker(checker, inputPath, expected, actual, work, problem) {
  // Synchronous simple check via temp files + child spawn would be async; keep it promise-based by node spawn wrapped.
  return checkerRun(checker, inputPath, expected, actual, work);
}
function checkerRun(checker, inputPath, expected, actual, work) {
  // Simplistic synchronous SPJ: python checker receives stdin/out/expect file paths as argv, exit 0 = AC.
  const { execFileSync } = require('child_process');
  try {
    fs.writeFileSync(path.join(work, '__exp.txt'), expected || '', 'utf8');
    fs.writeFileSync(path.join(work, '__act.txt'), actual || '', 'utf8');
    const args = checker.kind === 'py'
      ? [checker.path, inputPath, path.join(work, '__exp.txt'), path.join(work, '__act.txt')]
      : [inputPath, path.join(work, '__exp.txt'), path.join(work, '__act.txt')];
    const cp = checker.kind === 'py' ? 'py' : checker.path;
    const r = execFileSync(cp, args, { timeout: 8000, encoding: 'utf8', windowsHide: true });
    return r.trim() !== 'NO';
  } catch {
    return false;
  }
}

function totalProblemScore(problem, tcs, groups) {
  if (groups.length > 0) return groups.reduce((a, g) => a + (g.score || 0), 0);
  return tcs.reduce((a, t) => a + (t.score || 10), 0);
}

function safeDeps(j) {
  try { return JSON.parse(j || '[]'); } catch { return []; }
}

function topologicalGroups(groups) {
  const byId = new Map(groups.map(g => [g.id, g]));
  const visited = new Set(), order = [];
  const visit = (g) => {
    if (visited.has(g.id)) return;
    visited.add(g.id);
    for (const d of safeDeps(g.depends)) if (byId.has(d)) visit(byId.get(d));
    order.push(g);
  };
  groups.forEach(visit);
  return order;
}

function finishCompileError(subId, sub, msg, outputs, problem) {
  const ratingSvc = require('../services/rating');
  ratingSvc.applyRatingAfterJudge(sub.user_id, subId, problem, 'ce', outputs);
  updateSub(subId, {
    status: 'ce',
    error_msg: msg,
    compile_output: (outputs[0] || '').slice(0, 16000),
    judged_at: Date.now()
  });
  events.broadcast('rating:update', { userId: sub.user_id, delta: -config.rating.cePenalty });
}

function finishWithError(subId, sub, msg, outputs) {
  updateSub(subId, {
    status: 'se',
    error_msg: msg,
    compile_output: (outputs[0] || '').slice(0, 8000),
    judged_at: Date.now()
  });
}

module.exports = { enqueue, queueLength, processSubmission };
