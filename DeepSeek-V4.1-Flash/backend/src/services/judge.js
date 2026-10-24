import { writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { get, all, run } from '../db.js';
import config from '../config.js';
import { createLogger } from '../logger.js';
import { runInSandbox, createWorkDir, removeWorkDir } from './sandbox-runner.js';
import { compile, resolveRunCommand } from './compiler.js';
import { compare } from './comparator.js';
import { evaluateScript, aggregate } from './scorer.js';
import { reviewCode } from './ai.js';
import { broadcast, sendToUser } from './websocket.js';
import { applyRating } from './rating.js';
import { unlockAchievement } from './achievements.js';

const log = createLogger('judge');

const STATUS_TEXT = {
  pending: '等待中',
  reviewing: '审查中',
  queued: '排队中',
  compiling: '编译中',
  running: '运行中',
  accepted: '通过',
  wrong_answer: '答案错误',
  time_limit: '超出时间限制',
  memory_limit: '超出内存限制',
  runtime_error: '运行时错误',
  compile_error: '编译错误',
  system_error: '系统错误',
  banned: '已封禁',
};

const queue = [];
let active = 0;

export function queueLength() { return queue.length; }
export function activeCount() { return active; }

export function enqueue(submissionId) {
  queue.push(submissionId);
  pump();
}

function pump() {
  const concurrency = Math.max(1, config.judge.concurrency || 1);
  while (active < concurrency && queue.length) {
    const id = queue.shift();
    active += 1;
    judge(id)
      .catch((err) => log.error('judge crashed', id, err))
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

function setStatus(submissionId, status, extra = {}) {
  const fields = ['status = ?'];
  const params = [status];
  for (const [key, value] of Object.entries(extra)) {
    fields.push(`${key} = ?`);
    params.push(value);
  }
  params.push(submissionId);
  run(`UPDATE submissions SET ${fields.join(', ')} WHERE id = ?`, ...params);
  broadcast('submission_status', { id: submissionId, status });
  const submission = get('SELECT user_id FROM submissions WHERE id = ?', submissionId);
  if (submission) sendToUser(submission.user_id, 'submission_status', { id: submissionId, status });
}

function writeSources(workDir, language, sourceCode, files) {
  let mainFile;
  let list = [];
  if (files && files.length) {
    list = files;
  } else {
    list = [{ name: defaultMainName(language), content: sourceCode }];
  }
  for (const file of list) {
    const safe = String(file.name).replace(/[\\/]/g, '_');
    writeFileSync(join(workDir, safe), file.content ?? '');
  }
  mainFile = list.find((f) => f.main)?.name || list[0].name;
  return { mainFile: String(mainFile).replace(/[\\/]/g, '_'), files: list };
}

function defaultMainName(language) {
  if (language.key === 'java') return 'Main.java';
  return `main.${language.ext || 'txt'}`;
}

function loadTestcases(problem) {
  let cases = all(
    'SELECT id, group_id, input, output, score, sort FROM testcases WHERE problem_id = ? ORDER BY sort, id',
    problem.id,
  );
  if (cases.length) return cases;

  const dir = problem.testdata_dir || join(config.core.testdataDir, String(problem.id));
  if (existsSync(dir)) {
    const files = [];
    for (const name of readdirSafe(dir)) {
      if (name.endsWith('.in')) files.push(name.slice(0, -3));
    }
    files.sort();
    cases = files.map((base, idx) => ({
      id: null,
      group_id: null,
      input: readFileSafe(join(dir, `${base}.in`)),
      output: readFileSafe(join(dir, `${base}.out`)),
      score: 0,
      sort: idx,
    }));
  }
  return cases;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readFileSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

async function judge(submissionId) {
  const submission = get('SELECT * FROM submissions WHERE id = ?', submissionId);
  if (!submission) return;
  const problem = get('SELECT * FROM problems WHERE id = ?', submission.problem_id);
  const language = get('SELECT * FROM languages WHERE id = ?', submission.language_id);
  if (!problem || !language) {
    setStatus(submissionId, 'system_error', { detail: '题目或语言不存在', judged: 1 });
    return;
  }

  // 1. AI security review
  if (config.ai.security.enabled && submission.status !== 'reviewing') {
    setStatus(submissionId, 'reviewing');
    const review = await reviewCode({ code: submission.source_code, language: language.name });
    run('UPDATE submissions SET ai_review_status = ?, ai_review_result = ? WHERE id = ?',
      review.skipped ? 'skipped' : 'done', review.reason || '', submissionId);
    if (review.malicious) {
      run('UPDATE users SET banned = 1, force_logout_at = datetime(\'now\') WHERE id = ?', submission.user_id);
      setStatus(submissionId, 'banned', { detail: `AI 审查判定为恶意代码：${review.reason}`, judged: 1, judged_at: new Date().toISOString() });
      broadcast('user_banned', { userId: submission.user_id });
      return;
    }
  }

  const workDir = createWorkDir(`sub-${submissionId}`);
  try {
    setStatus(submissionId, 'compiling');
    const files = parseFiles(submission.files);
    const { mainFile } = writeSources(workDir, language, submission.source_code, files);

    const compileResult = await compile({
      language,
      workDir,
      mainFile,
      exeName: 'main',
      timeLimitMs: Math.max(20000, problem.time_limit_ms * 5),
      memoryLimitKb: Math.max(1048576, problem.memory_limit_kb * 4),
    });
    if (!compileResult.ok) {
      setStatus(submissionId, 'compile_error', {
        compile_output: compileResult.output,
        detail: '编译失败',
        judged: 1,
        judged_at: new Date().toISOString(),
      });
      applyRating(submission.user_id, { status: 'compile_error', problem });
      return;
    }

    const cases = loadTestcases(problem);
    if (!cases.length) {
      setStatus(submissionId, 'system_error', { detail: '该题目没有测试数据', judged: 1, judged_at: new Date().toISOString() });
      return;
    }

    setStatus(submissionId, 'running');
    run('DELETE FROM submission_cases WHERE submission_id = ?', submissionId);

    const vars = { source: mainFile, exe: 'main', dir: workDir, main: mainFile };
    const runCmd = resolveRunCommand(language, vars);

    const results = [];
    let timeMs = 0;
    let memoryKb = 0;

    for (let i = 0; i < cases.length; i += 1) {
      const testcase = cases[i];
      const exec = await runInSandbox({
        exe: runCmd.exe,
        args: runCmd.args,
        cwd: workDir,
        stdin: testcase.input,
        timeLimitMs: problem.time_limit_ms,
        memoryLimitKb: problem.memory_limit_kb,
        processLimit: 16,
      });

      let status = 'accepted';
      let message = '';
      if (exec.timedOut) status = 'time_limit';
      else if (exec.memoryExceeded) status = 'memory_limit';
      else if (exec.exitCode !== 0) { status = 'runtime_error'; message = (exec.stderr || '').slice(0, 500); }
      else {
        const cmp = await compare({
          mode: problem.comparison_mode,
          epsilon: problem.float_epsilon,
          output: exec.stdout,
          expected: testcase.output,
          input: testcase.input,
          testdataDir: problem.testdata_dir || join(config.core.testdataDir, String(problem.id)),
          workDir,
        });
        if (!cmp.ok) { status = 'wrong_answer'; message = cmp.message || ''; }
      }

      const caseScore = status === 'accepted' ? testcase.score || 0 : 0;
      results.push({ id: testcase.id, idx: i, status, score: caseScore, timeMs: exec.wallMs, memoryKb: exec.memoryKb, groupId: testcase.group_id });
      timeMs = Math.max(timeMs, exec.wallMs);
      memoryKb = Math.max(memoryKb, exec.memoryKb);

      run(
        'INSERT INTO submission_cases (submission_id, testcase_id, idx, status, score, time_ms, memory_kb, message) VALUES (?,?,?,?,?,?,?,?)',
        submissionId, testcase.id, i, status, caseScore, exec.wallMs, exec.memoryKb, message,
      );
      broadcast('judge_progress', { submissionId, done: i + 1, total: cases.length, status });
    }

    const { score, overall } = scoreSubmission(problem, results, cases);
    const firstAc = overall === 'accepted' && !hasAccepted(submission.user_id, problem.id, submissionId);

    setStatus(submissionId, overall, {
      score,
      time_ms: timeMs,
      memory_kb: memoryKb,
      detail: buildDetail(results),
      judged: 1,
      judged_at: new Date().toISOString(),
    });

    applyRating(submission.user_id, { status: overall, problem, firstAc });
    updateProblemsetProgress(submission.user_id, problem.id, overall);
    checkAchievements(submission.user_id, { problem, overall, firstAc });
  } catch (err) {
    log.error('judge error', err);
    setStatus(submissionId, 'system_error', { detail: err.message, judged: 1, judged_at: new Date().toISOString() });
  } finally {
    removeWorkDir(workDir);
  }
}

function parseFiles(json) {
  try {
    const files = JSON.parse(json || '[]');
    return Array.isArray(files) ? files : [];
  } catch {
    return [];
  }
}

function hasAccepted(userId, problemId, exceptId) {
  const row = get(
    "SELECT id FROM submissions WHERE user_id = ? AND problem_id = ? AND status = 'accepted' AND id != ? LIMIT 1",
    userId, problemId, exceptId,
  );
  return Boolean(row);
}

function scoreSubmission(problem, results, cases) {
  const statusOrder = ['system_error', 'runtime_error', 'time_limit', 'memory_limit', 'wrong_answer'];
  let overall = 'accepted';
  for (const status of statusOrder) {
    if (results.some((r) => r.status === status)) { overall = status; break; }
  }

  const groups = all('SELECT * FROM problem_groups WHERE problem_id = ? ORDER BY sort, id', problem.id);
  let score;

  if (groups.length) {
    const byGroup = new Map();
    for (const r of results) {
      if (r.groupId == null) continue;
      if (!byGroup.has(r.groupId)) byGroup.set(r.groupId, []);
      byGroup.get(r.groupId).push(r);
    }
    const groupScores = new Map();
    for (const group of groups) {
      const groupResults = byGroup.get(group.id) || [];
      const caseMap = new Map(cases.map((c) => [c.id, c]));
      const passedAll = groupResults.length > 0 && groupResults.every((r) => r.status === 'accepted');
      let depsOk = true;
      try {
        const deps = JSON.parse(group.dependencies || '[]');
        depsOk = deps.every((depId) => (groupScores.get(depId) ?? 0) >= fullScoreOf(groups, depId));
      } catch { depsOk = true; }

      if (!depsOk) { groupScores.set(group.id, 0); continue; }

      let value;
      if (group.scoring_script && group.scoring_script.trim()) {
        value = evaluateScript(group.scoring_script, {
          passed: groupResults.filter((r) => r.status === 'accepted').length,
          total: groupResults.length,
          full: group.full_score,
        }) ?? 0;
      } else if (passedAll) {
        value = group.full_score;
      } else if (group.aggregation === 'custom') {
        value = 0;
      } else {
        const perCase = groupResults.map((r) => {
          const c = caseMap.get(r.id);
          return c && c.score ? c.score : (group.full_score / Math.max(1, groupResults.length));
        });
        const raw = aggregate(group.aggregation, perCase);
        value = passedAll ? group.full_score : raw;
      }
      groupScores.set(group.id, Math.round(value));
    }
    score = [...groupScores.values()].reduce((a, b) => a + b, 0);
  } else {
    score = results.reduce((sum, r) => sum + (r.score || 0), 0);
    if (!results.some((r) => r.score)) score = overall === 'accepted' ? 100 : 0;
  }

  if (problem.scoring_script && problem.scoring_script.trim()) {
    try {
      const passed = results.filter((r) => r.status === 'accepted').length;
      const value = evaluateScript(problem.scoring_script, {
        total: results.length,
        passed,
        failed: results.length - passed,
        score,
        time: Math.max(0, ...results.map((r) => r.timeMs)),
        mem: Math.max(0, ...results.map((r) => r.memoryKb)),
      });
      if (value !== null) score = value;
    } catch (err) {
      log.warn('problem scoring script failed:', err.message);
    }
  }

  return { score: Math.max(0, Math.round(score)), overall };
}

function fullScoreOf(groups, id) {
  const g = groups.find((x) => x.id === id);
  return g ? g.full_score : 0;
}

function buildDetail(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return Object.entries(counts).map(([status, n]) => `${STATUS_TEXT[status] || status} × ${n}`).join('，');
}

function updateProblemsetProgress(userId, problemId, status) {
  if (status !== 'accepted') return;
  run(
    "UPDATE problemset_progress SET status = 'done', updated_at = datetime('now') WHERE user_id = ? AND problem_id = ?",
    userId, problemId,
  );
}

function checkAchievements(userId, { overall: _overall, firstAc }) {
  if (!firstAc) return;
  try {
    unlockAchievement(userId, 'first_blood');
  } catch (err) {
    log.warn('achievement unlock failed:', err.message);
  }
}

export function pendingSnapshot() {
  return all(
    "SELECT id, user_id, problem_id, status FROM submissions WHERE judged = 0 ORDER BY id",
  );
}

export { judge, STATUS_TEXT };
export default { enqueue, queueLength, activeCount };
