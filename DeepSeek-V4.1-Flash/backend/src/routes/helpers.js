import { badRequest } from '../utils/errors.js';

export function toInt(value, name = '参数') {
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${name}必须为整数`);
  return n;
}

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw badRequest(`缺少必填字段: ${missing.join(', ')}`);
}

export function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function boolOf(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

export default { toInt, requireFields, escapeLike, boolOf };
