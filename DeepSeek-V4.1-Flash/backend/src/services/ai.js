import config from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('ai');

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|above)/i,
  /you\s+are\s+now\s+/i,
  /system\s*prompt/i,
  /忽略(之前|以上|上述)(的)?(所有)?(指令|要求)/,
  /新的?(指令|规则|设定)/,
  /请?直接(返回|输出)\s*(通过|approved|true)/i,
];

export function detectInjection(text) {
  const hits = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) hits.push(pattern.source);
  }
  return hits;
}

export function sanitizeCode(code, maxChars = 6000) {
  const cleaned = String(code || '').slice(0, maxChars);
  return cleaned.replace(/```/g, '｀｀｀');
}

async function chat(messages, aiConfig, { json = false, timeoutMs } = {}) {
  if (!aiConfig || !aiConfig.baseUrl) throw new Error('AI 服务未配置');
  const base = aiConfig.baseUrl.replace(/\/+$/, '');
  const isOllama = /:11434\b/.test(base) || !/\/v1$/.test(base);
  const url = isOllama ? `${base}/api/chat` : `${base}/chat/completions`;
  const body = {
    model: aiConfig.model,
    messages,
    stream: false,
  };
  if (json && isOllama) body.format = 'json';
  if (!isOllama && json) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || aiConfig.timeoutMs || 60000);
  try {
    const headers = { 'content-type': 'application/json' };
    if (aiConfig.apiKey) headers.authorization = `Bearer ${aiConfig.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI 服务返回 ${res.status}`);
    const data = await res.json();
    if (data.message && typeof data.message.content === 'string') return data.message.content;
    if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content;
    throw new Error('无法解析 AI 响应');
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 未返回 JSON');
  return JSON.parse(match[0]);
}

const REVIEW_SYSTEM = '你是代码安全审查助手。判断用户提交的竞赛代码是否包含恶意行为：'
  + '文件攻击、网络攻击、提权、挖矿、窃取敏感信息、破坏系统、无限资源占用等。'
  + '正常算法题解代码一律视为安全。只返回 JSON，不要输出任何其他内容。';

export async function reviewCode({ code, language }) {
  const aiConfig = config.ai.security;
  if (!aiConfig.enabled) return { skipped: true, malicious: false, reason: '未启用 AI 代码审查' };

  const injections = detectInjection(code);
  const sanitized = sanitizeCode(code);
  const messages = [
    { role: 'system', content: REVIEW_SYSTEM },
    {
      role: 'user',
      content: `语言：${language}\n请审查以下代码，返回形如 {"malicious": true/false, "reason": "..."} 的 JSON：\n\n${sanitized}`,
    },
  ];
  try {
    const raw = await chat(messages, aiConfig, { json: true });
    const parsed = extractJson(raw);
    const malicious = Boolean(parsed.malicious);
    let reason = String(parsed.reason || '');
    if (malicious && /malicious"?\s*:\s*false/i.test(reason)) reason = 'AI 响应异常，按可疑处理';
    return { skipped: false, malicious, reason, injections };
  } catch (err) {
    log.warn('code review failed:', err.message);
    return { skipped: false, malicious: false, reason: `AI 审查失败: ${err.message}`, injections, error: true };
  }
}

const HINT_SYSTEM = '你是一位温柔耐心的算法教练。只给出方向性的思路提示，'
  + '绝对不要给出完整代码或可直接抄写的核心实现。使用中文，控制在 300 字以内。';

export async function generateHint({ title, description, failures, lastStatus }) {
  const aiConfig = config.ai.hint;
  if (!aiConfig.enabled) return { skipped: true, hint: '未启用 AI 提示' };
  const messages = [
    { role: 'system', content: HINT_SYSTEM },
    {
      role: 'user',
      content: `题目：${title}\n描述：${String(description).slice(0, 2000)}\n`
        + `该用户已失败 ${failures} 次，最近状态：${lastStatus}。请给出方向性提示。`,
    },
  ];
  try {
    const hint = await chat(messages, aiConfig);
    return { skipped: false, hint: String(hint).slice(0, aiConfig.maxChars || 300) };
  } catch (err) {
    log.warn('hint failed:', err.message);
    return { skipped: false, hint: `AI 提示生成失败: ${err.message}`, error: true };
  }
}

export async function generateTestData({ title, description, normalCount, edgeCount }) {
  const aiConfig = config.ai.testdata;
  if (!aiConfig.enabled) throw new Error('未启用 AI 测试数据生成');
  const messages = [
    { role: 'system', content: '你是竞赛出题人，负责生成测试数据。只返回 JSON。' },
    {
      role: 'user',
      content: `题目：${title}\n描述：${String(description).slice(0, 2000)}\n`
        + `请生成 ${normalCount} 组普通测试数据与 ${edgeCount} 组边界测试数据。`
        + '严格返回 {"cases":[{"type":"normal|edge","input":"...","output":"..."}]} 格式的 JSON。',
    },
  ];
  const raw = await chat(messages, aiConfig, { json: true });
  const parsed = extractJson(raw);
  const cases = Array.isArray(parsed.cases) ? parsed.cases : [];
  return cases
    .filter((c) => c && typeof c.input === 'string' && typeof c.output === 'string')
    .map((c) => ({ type: c.type === 'edge' ? 'edge' : 'normal', input: c.input, output: c.output }));
}

export async function gradeSubjective({ question, answer, maxScore }) {
  const aiConfig = config.ai.testdata;
  if (!aiConfig.enabled) throw new Error('未启用 AI 批改');
  const messages = [
    { role: 'system', content: '你是阅卷老师。根据题目和参考答案/评分标准对学生作答评分，只返回 JSON。' },
    {
      role: 'user',
      content: `题目：${question.content}\n参考答案：${question.answer}\n满分：${maxScore}\n`
        + `学生作答：${answer}\n返回 {"score": 数值, "comment": "评语"}`,
    },
  ];
  const raw = await chat(messages, aiConfig, { json: true });
  const parsed = extractJson(raw);
  return { score: Math.max(0, Math.min(maxScore, Number(parsed.score) || 0)), comment: String(parsed.comment || '') };
}

export function aiEnabled() {
  return {
    security: Boolean(config.ai.security.enabled),
    hint: Boolean(config.ai.hint.enabled),
    testdata: Boolean(config.ai.testdata.enabled),
  };
}

export default { reviewCode, generateHint, generateTestData, gradeSubjective, detectInjection, sanitizeCode, aiEnabled };
