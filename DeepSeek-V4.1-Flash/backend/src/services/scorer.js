/**
 * Custom scoring script evaluator.
 *
 * Mini language supporting:
 *   - variables and assignment            x = expr
 *   - arithmetic / bitwise / logical ops  + - * / % ** & | ^ ~ << >> && || !  == != < <= > >=
 *   - ternary and parentheses             cond ? a : b     ( ... )
 *   - functions                           min() max() abs() floor() ceil() round() sqrt() pow() sum() avg()
 *   - conditionals                        if (cond) { ... } else { ... }   (or terminated by "fi")
 *   - return                              return expr
 *
 * The value of the last expression (or an explicit `return`) is the result.
 */

const PRECEDENCE = {
  '||': [1, 2],
  '&&': [2, 3],
  '|': [3, 4],
  '^': [4, 5],
  '&': [5, 6],
  '==': [6, 7], '!=': [6, 7],
  '<': [7, 8], '<=': [7, 8], '>': [7, 8], '>=': [7, 8],
  '<<': [8, 9], '>>': [8, 9],
  '+': [9, 10], '-': [9, 10],
  '*': [10, 11], '/': [10, 11], '%': [10, 11],
  '**': [11, 11],
};

const UNARY = new Set(['!', '~', '-', '+']);

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const src = String(input ?? '');
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1]))) {
      let num = '';
      while (i < src.length && /[0-9.eE]/.test(src[i])) {
        if ((src[i] === 'e' || src[i] === 'E') && /[+-]/.test(src[i + 1])) { num += src[i]; i += 1; }
        num += src[i]; i += 1;
      }
      tokens.push({ type: 'num', value: Number(num) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let id = '';
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) { id += src[i]; i += 1; }
      tokens.push({ type: 'ident', value: id });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '**'].includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if ('+-*/%&|^~!<>?:'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i += 1; continue; }
    if ('(),;{}'.includes(ch)) { tokens.push({ type: 'punct', value: ch }); i += 1; continue; }
    throw new Error(`计分脚本包含无法识别的字符: ${ch}`);
  }
  return tokens;
}

class Parser {
  constructor(tokens, vars) {
    this.tokens = tokens;
    this.pos = 0;
    this.vars = vars;
  }

  peek() { return this.tokens[this.pos]; }

  next() { return this.tokens[this.pos++]; }

  expect(value) {
    const tok = this.next();
    if (!tok || tok.value !== value) throw new Error(`计分脚本语法错误：期望 "${value}"`);
    return tok;
  }

  atEnd() { return this.pos >= this.tokens.length; }

  isPunct(value) {
    const tok = this.peek();
    return tok && tok.type === 'punct' && tok.value === value;
  }

  isIdent(value) {
    const tok = this.peek();
    return tok && tok.type === 'ident' && tok.value === value;
  }

  parseProgram() {
    let result = 0;
    while (!this.atEnd()) {
      const value = this.parseStatement();
      if (value && value.__return !== undefined) return value.__return;
      if (value !== undefined) result = value;
      while (this.isPunct(';')) this.next();
    }
    return result;
  }

  parseStatement() {
    if (this.isIdent('if')) return this.parseIf();
    if (this.isIdent('return')) {
      this.next();
      const value = this.parseExpression();
      this.skipSemicolon();
      return { __return: value };
    }
    if (this.isIdent('let') || this.isIdent('var')) this.next();

    const tok = this.peek();
    const after = this.tokens[this.pos + 1];
    if (tok && tok.type === 'ident' && after && after.type === 'op' && after.value === '=') {
      const name = this.next().value;
      this.next();
      const value = this.parseExpression();
      this.vars[name] = value;
      this.skipSemicolon();
      return value;
    }
    const value = this.parseExpression();
    this.skipSemicolon();
    return value;
  }

  skipSemicolon() { while (this.isPunct(';')) this.next(); }

  parseIf() {
    this.next();
    let cond;
    if (this.isPunct('(')) {
      this.next();
      cond = this.parseExpression();
      this.expect(')');
    } else {
      cond = this.parseExpression();
    }
    const thenValue = this.parseBlock();
    let elseValue;
    if (this.isIdent('else')) {
      this.next();
      elseValue = this.parseBlock();
    }
    const active = cond ? thenValue : elseValue;
    if (active && active.__return !== undefined) return active;
    return active;
  }

  parseBlock() {
    let result = 0;
    if (this.isPunct('{')) {
      this.next();
      while (!this.isPunct('}') && !this.atEnd()) {
        const val = this.parseStatement();
        if (val && val.__return !== undefined) {
          this.skipToBrace();
          return val;
        }
        if (val !== undefined) result = val;
      }
      if (this.isPunct('}')) this.next();
      return result;
    }
    while (!this.atEnd() && !this.isIdent('else') && !this.isIdent('fi')) {
      const val = this.parseStatement();
      if (val && val.__return !== undefined) return val;
      if (val !== undefined) result = val;
    }
    if (this.isIdent('fi')) this.next();
    return result;
  }

  skipToBrace() {
    let depth = 0;
    while (!this.atEnd()) {
      const tok = this.next();
      if (tok.value === '{') depth += 1;
      if (tok.value === '}') {
        if (depth === 0) return;
        depth -= 1;
      }
    }
  }

  parseExpression(minBp = 0) {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (!tok) break;
      if (tok.type === 'op' && tok.value === '?') {
        if (minBp > 0) break;
        this.next();
        const thenExpr = this.parseExpression(0);
        this.expect(':');
        const elseExpr = this.parseExpression(0);
        left = left ? thenExpr : elseExpr;
        continue;
      }
      if (tok.type !== 'op' || !PRECEDENCE[tok.value]) break;
      const [lbp, rbp] = PRECEDENCE[tok.value];
      if (lbp < minBp) break;
      const op = this.next().value;
      const right = this.parseExpression(rbp);
      left = applyBinary(op, left, right);
    }
    return left;
  }

  parseUnary() {
    const tok = this.peek();
    if (tok && tok.type === 'op' && UNARY.has(tok.value)) {
      this.next();
      const operand = this.parseUnary();
      if (tok.value === '!') return operand ? 0 : 1;
      if (tok.value === '~') return ~operand;
      if (tok.value === '-') return -operand;
      return +operand;
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.next();
    if (!tok) throw new Error('计分脚本意外结束');
    if (tok.type === 'num') return tok.value;
    if (tok.type === 'ident') {
      if (this.isPunct('(')) {
        this.next();
        const args = [];
        if (!this.isPunct(')')) {
          args.push(this.parseExpression(0));
          while (this.isPunct(',')) { this.next(); args.push(this.parseExpression(0)); }
        }
        this.expect(')');
        return callFunction(tok.value, args);
      }
      if (Object.prototype.hasOwnProperty.call(this.vars, tok.value)) return this.vars[tok.value];
      throw new Error(`计分脚本未定义的变量: ${tok.value}`);
    }
    if (tok.type === 'punct' && tok.value === '(') {
      const value = this.parseExpression(0);
      this.expect(')');
      return value;
    }
    throw new Error(`计分脚本语法错误，意外的符号: ${tok.value}`);
  }
}

function applyBinary(op, a, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? 0 : a / b;
    case '%': return b === 0 ? 0 : a % b;
    case '**': return a ** b;
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '&&': return a && b ? 1 : 0;
    case '||': return a || b ? 1 : 0;
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
    case '<': return a < b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    default: throw new Error(`计分脚本不支持运算符: ${op}`);
  }
}

function callFunction(name, args) {
  switch (name) {
    case 'min': return Math.min(...args);
    case 'max': return Math.max(...args);
    case 'abs': return Math.abs(args[0]);
    case 'floor': return Math.floor(args[0]);
    case 'ceil': return Math.ceil(args[0]);
    case 'round': return Math.round(args[0]);
    case 'sqrt': return Math.sqrt(args[0]);
    case 'pow': return Math.pow(args[0], args[1]);
    case 'sum': return args.reduce((a, b) => a + b, 0);
    case 'avg': return args.length ? args.reduce((a, b) => a + b, 0) / args.length : 0;
    case 'count': return args.filter(Boolean).length;
    default: throw new Error(`计分脚本未知函数: ${name}`);
  }
}

export function evaluateScript(script, context = {}) {
  if (!script || !String(script).trim()) return null;
  const tokens = tokenize(script);
  const parser = new Parser(tokens, { ...context });
  const value = parser.parseProgram();
  const num = Number(value);
  if (Number.isNaN(num)) throw new Error('计分脚本返回了非数值结果');
  return num;
}

export function aggregate(strategy, scores) {
  if (!scores.length) return 0;
  switch (strategy) {
    case 'min': return Math.min(...scores);
    case 'max': return Math.max(...scores);
    case 'avg': return scores.reduce((a, b) => a + b, 0) / scores.length;
    case 'sum':
    default:
      return scores.reduce((a, b) => a + b, 0);
  }
}

export default { evaluateScript, aggregate };
