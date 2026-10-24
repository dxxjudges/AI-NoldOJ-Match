// IDE quick-run: separate queue path, three-stage status (Under Review -> Compiling -> Running),
// memory measurement, WebSocket events, startup convergence of stale runs.
const { one, run } = require('../db/db');
const { createWorkspace, cleanupWorkspace, compile, parseRunCmd, sandboxRun } = require('../judge/run');
const events = require('../ws/events');

const runs = new Map(); // runId -> state
const queue = [];
let active = 0;
const CONCURRENCY = 2;

let seq = 0;
function nextRunId() {
  return 'ide_' + Date.now().toString(36) + '_' + (++seq).toString(36);
}

function broadcast(runId, patch) {
  const r = runs.get(runId);
  if (r) Object.assign(r, patch);
  events.broadcast('ide:update', { runId, stage: patch.stage || (runs.get(runId) && runs.get(runId).stage), result: patch.result || null });
}

function pump() {
  while (queue.length > 0 && active < CONCURRENCY) {
    const { lang, code, input, userId, runId } = queue.shift();
    active++;
    process(lang, code, input, userId, runId).finally(() => {
      active--;
      setImmediate(pump);
      // converge: drop finished runs from memory after 5 min
      setTimeout(() => { const r = runs.get(runId); if (r && r.stage === 'done') runs.delete(runId); }, 5 * 60 * 1000).unref();
    });
  }
}

async function process(lang, code, input, userId, runId) {
  const work = createWorkspace();
  try {
    broadcast(runId, { stage: 'compiling' });
    const c = await compile(lang, work, 'main.' + (lang.code || 'code'), [{ name: 'main.' + (lang.code || 'code'), content: code }]);
    if (!c.ok) {
      broadcast(runId, { stage: 'done', result: { exitCode: 'CE', timeMs: 0, memoryKb: 0, stdout: '', stderr: c.output || '' } });
      return;
    }
    broadcast(runId, { stage: 'running' });
    fsWriteInput(work, input);
    const rp = parseRunCmd(lang.run_cmd, work, 'main.' + (lang.code || 'code'));
    const res = await sandboxRun(rp.program, rp.args, work, input ? require('path').join(work, 'in.txt') : '', config.judge.ideRunTimeout || 15000, 512);
    const stdout = require('fs').existsSync(require('path').join(work, '__out.txt'))
      ? require('fs').readFileSync(require('path').join(work, '__out.txt'), 'utf8') : '';
    broadcast(runId, {
      stage: 'done',
      result: {
        exitCode: res.timedOut || (res.error && !res.output) ? 'TLE/SE' : (res.exitCode === 0 || res.exitCode === '0' ? 0 : res.exitCode),
        timeMs: res.timeMs || 0,
        memoryKb: res.memoryKb || 0,
        stdout: stdout.slice(0, 60000),
        stderr: (res.stderr || '').slice(0, 4000),
        mode: res.mode || ''
      }
    });
  } catch (e) {
    broadcast(runId, { stage: 'done', result: { exitCode: -1, timeMs: 0, memoryKb: 0, stdout: '', stderr: 'Internal error: ' + e.message } });
  } finally {
    cleanupWorkspace(work);
  }
}

function fsWriteInput(work, input) {
  if (!input) return;
  try {
    require('fs').writeFileSync(require('path').join(work, 'in.txt'), input, 'utf8');
  } catch { }
}

function start(lang, code, input, userId, reviewFn) {
  const runId = nextRunId();
  runs.set(runId, { runId, userId, stage: 'pending', result: null, createdAt: Date.now() });
  broadcast(runId, { stage: 'pending' });
  // AI review for IDE runs too (when enabled)
  setImmediate(async () => {
    try {
      if (reviewFn && require('../config').ai.securityReview.enabled) {
        const review = await reviewFn(code, lang.name, userId);
        if (!review.pass) {
          broadcast(runId, { stage: 'done', result: { exitCode: -1, timeMs: 0, memoryKb: 0, stdout: '', stderr: 'AI security review did not pass' } });
          return;
        }
      }
    } catch { /* fail open */ }
    queue.push({ lang, code, input, userId, runId });
    pump();
  });
  return runId;
}

function get(runId) {
  return runs.get(runId) || null;
}

module.exports = { start, get };
