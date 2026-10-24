'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../db/database');
const { config } = require('../../config');
const client = require('./client');

/**
 * AI test-data generation for teachers.
 * normalCount 1-10, edgeCount 0-10. Writes .in/.out files + DB rows.
 */

const SYSTEM = `你是评测数据生成器。根据题目描述生成测试数据。
只输出 JSON：{"cases":[{"input":"...","output":"..."}]}
input/output 内不要包含 Markdown 代码块标记。`;

async function generate(problemId, { normalCount = 3, edgeCount = 2, createdBy } = {}) {
  if (!config.ai.testdataEnabled) return { error: 'AI 数据生成未启用' };
  const problem = db.get('SELECT * FROM problems WHERE id = ?', problemId);
  if (!problem) return { error: '题目不存在' };

  normalCount = Math.min(10, Math.max(1, Number(normalCount) || 3));
  edgeCount = Math.min(10, Math.max(0, Number(edgeCount) || 0));

  const raw = await client.chat([
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `请生成 ${normalCount} 个普通数据和 ${edgeCount} 个边缘数据。\n标题: ${problem.title}\n描述:\n${String(problem.description).slice(0, 3000)}\n输入格式: ${problem.input_format}\n输出格式: ${problem.output_format}`,
    },
  ], { timeoutMs: 120000, temperature: 0.7 });

  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return { error: 'AI 返回格式无法解析' };
  const cases = JSON.parse(m[0]).cases || [];
  if (!Array.isArray(cases) || !cases.length) return { error: '未生成任何测试点' };

  const dir = path.join(config.paths.testdataDir, String(problemId));
  fs.mkdirSync(dir, { recursive: true });
  const group = db.get('SELECT id FROM test_groups WHERE problem_id = ? ORDER BY order_index LIMIT 1', problemId);
  let idx = db.get('SELECT COUNT(*) AS n FROM test_cases WHERE problem_id = ?', problemId).n;
  const created = [];
  for (const c of cases.slice(0, normalCount + edgeCount)) {
    if (!c || typeof c.input !== 'string' || typeof c.output !== 'string') continue;
    const inPath = path.join(dir, `${idx}.in`);
    const outPath = path.join(dir, `${idx}.out`);
    fs.writeFileSync(inPath, c.input, 'utf8');
    fs.writeFileSync(outPath, c.output, 'utf8');
    const info = db.run(
      'INSERT INTO test_cases (problem_id, group_id, case_index, input_path, output_path, score, is_sample, created_at) VALUES (?,?,?,?,?,0,0,?)',
      problemId, group ? group.id : null, idx, inPath, outPath, db.now()
    );
    created.push(Number(info.lastInsertRowid));
    idx++;
  }
  db.run('INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?,?,?,?)',
    createdBy || null, 'ai_testdata', `problem=${problemId} count=${created.length}`, db.now());
  return { created: created.length, ids: created };
}

module.exports = { generate };
