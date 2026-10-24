import { all, get, run } from '../db.js';
import config from '../config.js';
import { createLogger } from '../logger.js';
import { broadcast } from './websocket.js';

const log = createLogger('plagiarism');

function stripComments(code, languageKey) {
  let text = String(code ?? '');
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  text = text.replace(/\/\/[^\n]*/g, ' ');
  if (languageKey === 'python') text = text.replace(/#[^\n]*/g, ' ');
  return text;
}

export function tokenize(code, languageKey = '') {
  const text = stripComments(code, languageKey);
  const tokens = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[+\-*/%=<>!&|^~?:;,(){}[\].]+/g;
  let match;
  while ((match = re.exec(text)) !== null) tokens.push(match[0]);
  return tokens;
}

function shingles(tokens, k = 5) {
  const set = new Set();
  if (tokens.length < k) {
    if (tokens.length) set.add(tokens.join('\u0001'));
    return set;
  }
  for (let i = 0; i + k <= tokens.length; i += 1) {
    set.add(tokens.slice(i, i + k).join('\u0001'));
  }
  return set;
}

export function similarity(codeA, codeB, languageKey = '') {
  const a = shingles(tokenize(codeA, languageKey));
  const b = shingles(tokenize(codeB, languageKey));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

export function tierOf(score) {
  if (score >= config.plagiarism.highThreshold) return 'high';
  if (score >= config.plagiarism.suspectThreshold) return 'suspect';
  return 'none';
}

export async function runReport(reportId) {
  const report = get('SELECT * FROM plagiarism_reports WHERE id = ?', reportId);
  if (!report) return;
  run("UPDATE plagiarism_reports SET status = 'running', message = '' WHERE id = ?", reportId);

  const problem = get('SELECT * FROM problems WHERE id = ?', report.problem_id);
  if (!problem) {
    run("UPDATE plagiarism_reports SET status = 'failed', message = '题目不存在' WHERE id = ?", reportId);
    return;
  }

  const languageKeys = new Map(all('SELECT id, key FROM languages').map((l) => [l.id, l.key]));

  const submissions = all(
    `SELECT s.id, s.user_id, s.language_id, s.source_code
       FROM submissions s
       JOIN (SELECT user_id, MAX(id) AS max_id FROM submissions WHERE problem_id = ? AND status != 'banned' GROUP BY user_id) m
         ON s.id = m.max_id`,
    report.problem_id,
  );

  const minTokens = config.plagiarism.minTokenLength;
  const filtered = submissions.filter((s) => tokenize(s.source_code, languageKeys.get(s.language_id)).length >= minTokens);
  const totalPairs = (filtered.length * (filtered.length - 1)) / 2;
  run('UPDATE plagiarism_reports SET total = ? WHERE id = ?', totalPairs, reportId);

  let done = 0;
  let found = 0;
  for (let i = 0; i < filtered.length; i += 1) {
    for (let j = i + 1; j < filtered.length; j += 1) {
      const a = filtered[i];
      const b = filtered[j];
      const score = similarity(a.source_code, b.source_code, languageKeys.get(a.language_id));
      const tier = tierOf(score);
      if (tier !== 'none') {
        found += 1;
        run(
          'INSERT INTO plagiarism_pairs (report_id, problem_id, user_a, user_b, submission_a, submission_b, similarity, tier) VALUES (?,?,?,?,?,?,?,?)',
          reportId, report.problem_id, a.user_id, b.user_id, a.id, b.id, score, tier,
        );
      }
      done += 1;
      if (done % 5 === 0 || done === totalPairs) {
        const progress = totalPairs ? Math.round((done / totalPairs) * 100) : 100;
        run('UPDATE plagiarism_reports SET progress = ? WHERE id = ?', progress, reportId);
        broadcast('plagiarism_progress', { reportId, progress, found });
      }
      if (done % 50 === 0) await new Promise((r) => setImmediate(r));
    }
  }

  run(
    "UPDATE plagiarism_reports SET status = 'done', progress = 100, message = ?, finished_at = datetime('now') WHERE id = ?",
    `共发现 ${found} 对可疑提交`, reportId,
  );
  broadcast('plagiarism_done', { reportId, found });
  log.info(`report ${reportId} finished, ${found} pairs`);
}

export function startReport(reportId) {
  setImmediate(() => {
    runReport(reportId).catch((err) => {
      log.error('plagiarism report failed', err);
      run("UPDATE plagiarism_reports SET status = 'failed', message = ? WHERE id = ?", err.message, reportId);
    });
  });
}

export default { similarity, tierOf, startReport, runReport, tokenize };
