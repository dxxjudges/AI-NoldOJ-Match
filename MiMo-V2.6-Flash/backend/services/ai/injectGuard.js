'use strict';

/** Prompt-injection protection for AI review. */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts)/i,
  /disregard\s+(your|the|all)\s+(system\s+)?(prompt|instructions)/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /system\s*prompt/i,
  /假装|忽略(以上|之前|前面)(的)?(所有)?(指令|提示)/,
  /你现在是|新的系统提示|覆盖(系统|安全)规则/,
  /DAN\s+mode|jailbreak/i,
  /```[\s\S]*?(system|assistant)\s*:/i,
];

function containsInjection(code) {
  return INJECTION_PATTERNS.some(re => re.test(code));
}

/** Neutralise injection vectors and cap length before sending to the AI. */
function injectGuard(code) {
  let s = String(code);
  if (containsInjection(s)) {
    s = '/* [injection-pattern-redacted] */\n' + s.replace(/./g, c => (Math.random() < 0.02 ? ' ' : c));
  }
  return truncateCode(s);
}

const MAX_CODE_CHARS = 6000;

function truncateCode(code) {
  const s = String(code);
  if (s.length <= MAX_CODE_CHARS) return s;
  return s.slice(0, MAX_CODE_CHARS) + '\n/* ...truncated... */';
}

/** Detect if an AI response looks manipulated (e.g. model echoed jailbreak). */
function responseLooksManipulated(raw) {
  return containsInjection(raw) || /"passed"\s*:\s*true[\s\S]*"passed"\s*:\s*false/.test(raw);
}

module.exports = { containsInjection, injectGuard, truncateCode, responseLooksManipulated };
