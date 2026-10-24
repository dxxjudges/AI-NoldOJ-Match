const config = require('../config');
const { chat } = require('./client');
const { one, all, run } = require('../db/db');

// AI hint: after 2 failed attempts, guide with directional hints only (no full code), <=300 chars max
const COOLDOWN_MS = 60000;

function userAttempts(userId, problemId) {
  const row = one(
    `SELECT COUNT(*) c, MAX(judged_at) lastAt FROM submissions WHERE user_id=? AND problem_id=? AND status IN ('wa','tle','mle','re','pc')`,
    userId, problemId);
  return row ? row.c : 0;
}

async function getAiHint(userId, problemId) {
  if (!config.ai.hint.enabled) throw Object.assign(new Error('AI 提示功能未开启'), { status: 400 });
  // cooldown per user per problem via rating_history markers? use simple check of last submissions
  const att = userAttempts(userId, problemId);
  if (att < 2) throw Object.assign(new Error('需要先失败 2 次后才能申请 AI 提示'), { status: 400 });

  const recent = one(
    `SELECT MAX(created_at) c FROM submissions WHERE user_id=? AND problem_id=? AND status IN ('wa','tle','mle','re','pc')`,
    userId, problemId);
  if (Date.now() - (recent?.c || 0) < COOLDOWN_MS) {
    throw Object.assign(new Error('冷却中：每题每用户 60 秒才能申请一次提示'), { status: 429 });
  }

  const problem = one(`SELECT id, title, description_md, difficulty FROM problems WHERE id=?`, problemId);
  if (!problem) throw Object.assign(new Error('题目不存在'), { status: 404 });

  const history = all(
    `SELECT status, language_id, code FROM submissions WHERE user_id=? AND problem_id=? ORDER BY id DESC LIMIT 3`,
    userId, problemId);

  const userPrompt = [
    `学生正在练习题目《${problem.title}》(ID ${problem.id})，已失败 ${att} 次。`,
    '题目描述（节选）：', (problem.description_md || '').slice(0, 1200),
    '学生最近的提交状态序列：' + history.map(h => h.status).join(' -> '),
    '现在你是温柔的算法教练，只给出方向性提示（用什么算法/数据结构/思路/常见错误），',
    '不要给出任何完整代码，不超过 300 个汉字左右。']
    .join('\n');

  const resp = await chat(config.ai.hint, [
    { role: 'system', content: '你是温柔的算法教练，只给方向性提示，绝不给完整代码，回答控制在300个汉字以内。' },
    { role: 'user', content: userPrompt }
  ], { temperature: 0.6 });
  return resp.slice(0, 1200);
}

// AI test data generation: write to testdata dir + insert DB rows
async function generateTestCases(problemId, actorId, normalCount, edgeCount) {
  if (!config.ai.testdata.enabled) throw Object.assign(new Error('AI 测试数据功能未开启'), { status: 400 });
  problemId = Number(problemId); normalCount = Math.max(1, Math.min(10, Number(normalCount) || 5));
  edgeCount = Math.max(0, Math.min(10, Number(edgeCount) || 3));
  const problem = one(`SELECT * FROM problems WHERE id=?`, problemId);
  if (!problem) throw Object.assign(new Error('题目不存在'), { status: 404 });

  const prompt = [
    `为题目《${problem.title}》生成测试数据。`,
    '输入格式：', (problem.input_md || '').slice(0, 800),
    '输出格式：', (problem.output_md || '').slice(0, 800),
    `数据范围/提示：${(problem.hint_md || '').slice(0, 800)}`,
    `请生成 ${normalCount} 组普通测试点和 ${edgeCount} 组边界测试点（空输入、极大值、单元素等）。`,
    '每组的输入和输出需一致自洽。输出格式严格如下：',
    '```json\n{"cases":[{"kind":"normal"或"edge","input":"...","output":"..."}]}\n```'
  ].join('\n');

  const resp = await chat(config.ai.testdata, [
    { role: 'system', content: '你是测试数据生成器，只输出严格的 JSON，不要多余文本。' },
    { role: 'user', content: prompt }
  ], { temperature: 0.7 });

  const m = resp.match(/\{[\s\S]*\}/);
  if (!m) throw Object.assign(new Error('AI 未返回有效 JSON'), { status: 500 });
  let cases;
  try { cases = JSON.parse(m[0]).cases || []; } catch (e) {
    throw Object.assign(new Error('解析 AI 生成结果失败'), { status: 500 });
  }

  const dir = require('path').join(config.abs.testdataDir, String(problemId));
  require('fs').mkdirSync(dir, { recursive: true });
  const ordStart = (all(`SELECT id FROM testcases WHERE problem_id=?`, problemId).length);
  let ord = ordStart;
  for (const c of cases.slice(0, 20)) {
    const inName = `ai_${Date.now()}_${ord}.in`;
    const outName = `ai_${Date.now()}_${ord}.out`;
    require('fs').writeFileSync(require('path').join(dir, inName), String(c.input || ''), 'utf8');
    require('fs').writeFileSync(require('path').join(dir, outName), String(c.output || ''), 'utf8');
    run(`INSERT INTO testcases (problem_id, group_id, ord, input_path, output_path, score, is_sample, visible)
         VALUES (?,?,?,?,?,?,0,1)`,
      problemId, null, ord++, inName, outName, problem.judge_mode === 'custom' ? 0 : 10);
  }
  return { generated: cases.length };
}

module.exports = { getAiHint, generateTestCases };
