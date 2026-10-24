'use strict';

/**
 * Custom scoring script interpreter.
 *
 * Supported syntax (line or ';' separated):
 *   x = 40
 *   y = min(x, 60) + abs(-2)
 *   if (x >= 40) score = 100 fi
 *   if (x >= 80) score = 100 else score = x fi
 *
 * Operators: + - * / % & | ^ << >> && || ! < > <= >= == !=
 * Functions: min(a,b) max(a,b) abs(a)
 * Built-in variables before run:
 *   full   – group full score
 *   s<i>   – score of test i (0-based) or 'passed'/'failed' as 1/0
 *   n      – number of tests
 *   passed – number of passed tests
 */

class Lexer {
  constructor(src) {
    this.src = src;
    this.pos = 0;
    this.token = null;
    this.next();
  }
  next() {
    const s = this.src;
    while (this.pos < s.length && /\s/.test(s[this.pos])) this.pos++;
    if (this.pos >= s.length) { this.token = { t: 'eof' }; return; }
    const c = s[this.pos];
    const two = s.slice(this.pos, this.pos + 2);
    if (['<=', '>=', '==', '!=', '&&', '||', '<<', '>>'].includes(two)) {
      this.token = { t: 'op', v: two }; this.pos += 2; return;
    }
    if ('+-*/%&|^!<>='.includes(c)) { this.token = { t: 'op', v: c }; this.pos++; return; }
    if (c === '(' || c === ')' || c === ',' || c === ';') { this.token = { t: c }; this.pos++; return; }
    if (/[0-9]/.test(c)) {
      let j = this.pos;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      this.token = { t: 'num', v: Number(s.slice(this.pos, j)) };
      this.pos = j; return;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = this.pos;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      this.token = { t: 'ident', v: s.slice(this.pos, j) };
      this.pos = j; return;
    }
    throw new Error(`评分脚本: 非法字符 '${c}' @${this.pos}`);
  }
}

class Parser {
  constructor(src) { this.lex = new Lexer(src); }
  parseStmts() {
    const stmts = [];
    while (this.lex.token.t !== 'eof') {
      if (this.lex.token.t === ';') { this.lex.next(); continue; }
      stmts.push(this.stmt());
    }
    return stmts;
  }
  stmt() {
    const tk = this.lex.token;
    if (tk.t === 'ident' && tk.v === 'if') {
      this.lex.next();
      if (this.lex.token.t !== '(') throw new Error("评分脚本: if 后需要 '('");
      this.lex.next();
      const cond = this.expr();
      if (this.lex.token.t !== ')') throw new Error("评分脚本: 缺少 ')'");
      this.lex.next();
      const thenStmts = [];
      let elseStmts = [];
      while (!(this.lex.token.t === 'ident' && ['fi', 'else'].includes(this.lex.token.v))) {
        if (this.lex.token.t === 'eof') throw new Error('评分脚本: if 缺少 fi');
        thenStmts.push(this.stmt());
      }
      if (this.lex.token.v === 'else') {
        this.lex.next();
        while (!(this.lex.token.t === 'ident' && this.lex.token.v === 'fi')) {
          if (this.lex.token.t === 'eof') throw new Error('评分脚本: else 缺少 fi');
          elseStmts.push(this.stmt());
        }
      }
      if (this.lex.token.v !== 'fi') throw new Error('评分脚本: 缺少 fi');
      this.lex.next();
      return { k: 'if', cond, then: thenStmts, else: elseStmts };
    }
    if (tk.t === 'ident') {
      const name = tk.v;
      this.lex.next();
      if (this.lex.token.t !== 'op' || this.lex.token.v !== '=') {
        throw new Error(`评分脚本: '${name}' 后需要 '='`);
      }
      this.lex.next();
      const value = this.expr();
      return { k: 'assign', name, value };
    }
    throw new Error(`评分脚本: 意外的记号 ${JSON.stringify(tk)}`);
  }
  expr() { return this.cmp(); }
  cmp() {
    let left = this.or();
    while (this.lex.token.t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(this.lex.token.v)) {
      const op = this.lex.token.v; this.lex.next();
      left = { k: 'bin', op, l: left, r: this.or() };
    }
    return left;
  }
  or() {
    let left = this.and();
    while (this.lex.token.t === 'op' && (this.lex.token.v === '||')) {
      this.lex.next();
      left = { k: 'bin', op: '||', l: left, r: this.and() };
    }
    return left;
  }
  and() {
    let left = this.bitor();
    while (this.lex.token.t === 'op' && (this.lex.token.v === '&&')) {
      this.lex.next();
      left = { k: 'bin', op: '&&', l: left, r: this.bitor() };
    }
    return left;
  }
  bitor() {
    let left = this.bitxor();
    while (this.lex.token.t === 'op' && this.lex.token.v === '|') {
      this.lex.next();
      left = { k: 'bin', op: '|', l: left, r: this.bitxor() };
    }
    return left;
  }
  bitxor() {
    let left = this.bitand();
    while (this.lex.token.t === 'op' && this.lex.token.v === '^') {
      this.lex.next();
      left = { k: 'bin', op: '^', l: left, r: this.bitand() };
    }
    return left;
  }
  bitand() {
    let left = this.shift();
    while (this.lex.token.t === 'op' && this.lex.token.v === '&') {
      this.lex.next();
      left = { k: 'bin', op: '&', l: left, r: this.shift() };
    }
    return left;
  }
  shift() {
    let left = this.add();
    while (this.lex.token.t === 'op' && (this.lex.token.v === '<<' || this.lex.token.v === '>>')) {
      const op = this.lex.token.v; this.lex.next();
      left = { k: 'bin', op, l: left, r: this.add() };
    }
    return left;
  }
  add() {
    let left = this.mul();
    while (this.lex.token.t === 'op' && (this.lex.token.v === '+' || this.lex.token.v === '-')) {
      const op = this.lex.token.v; this.lex.next();
      left = { k: 'bin', op, l: left, r: this.mul() };
    }
    return left;
  }
  mul() {
    let left = this.unary();
    while (this.lex.token.t === 'op' && ['*', '/', '%'].includes(this.lex.token.v)) {
      const op = this.lex.token.v; this.lex.next();
      left = { k: 'bin', op, l: left, r: this.unary() };
    }
    return left;
  }
  unary() {
    if (this.lex.token.t === 'op' && (this.lex.token.v === '-' || this.lex.token.v === '!')) {
      const op = this.lex.token.v; this.lex.next();
      return { k: 'un', op, v: this.unary() };
    }
    return this.primary();
  }
  primary() {
    const tk = this.lex.token;
    if (tk.t === 'num') { this.lex.next(); return { k: 'num', v: tk.v }; }
    if (tk.t === '(') {
      this.lex.next();
      const e = this.expr();
      if (this.lex.token.t !== ')') throw new Error("评分脚本: 缺少 ')'");
      this.lex.next();
      return e;
    }
    if (tk.t === 'ident') {
      const name = tk.v;
      this.lex.next();
      if (this.lex.token.t === '(') {
        this.lex.next();
        const args = [];
        if (this.lex.token.t !== ')') {
          args.push(this.expr());
          while (this.lex.token.t === ',') { this.lex.next(); args.push(this.expr()); }
        }
        if (this.lex.token.t !== ')') throw new Error("评分脚本: 缺少 ')'");
        this.lex.next();
        return { k: 'call', name, args };
      }
      return { k: 'var', name };
    }
    throw new Error(`评分脚本: 意外的记号 ${JSON.stringify(tk)}`);
  }
}

function evalNode(node, vars) {
  switch (node.k) {
    case 'num': return node.v;
    case 'var': {
      if (node.name in vars) return Number(vars[node.name]) || 0;
      return 0;
    }
    case 'un': {
      const v = evalNode(node.v, vars);
      return node.op === '-' ? -v : (v ? 0 : 1);
    }
    case 'bin': {
      const a = evalNode(node.l, vars);
      // short-circuit
      if (node.op === '&&') return (a ? evalNode(node.r, vars) : 0) ? 1 : 0;
      if (node.op === '||') return (a ? 1 : evalNode(node.r, vars) ? 1 : 0);
      const b = evalNode(node.r, vars);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b;
        case '%': return b === 0 ? 0 : a % b;
        case '&': return a & b;
        case '|': return a | b;
        case '^': return a ^ b;
        case '<<': return a << b;
        case '>>': return a >> b;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        default: throw new Error('评分脚本: 未知运算符 ' + node.op);
      }
    }
    case 'call': {
      const args = node.args.map(a => evalNode(a, vars));
      switch (node.name) {
        case 'min': return Math.min(...args);
        case 'max': return Math.max(...args);
        case 'abs': return Math.abs(args[0] ?? 0);
        default: throw new Error('评分脚本: 未知函数 ' + node.name);
      }
    }
    default: throw new Error('评分脚本: 未知节点');
  }
}

function execStmts(stmts, vars) {
  for (const s of stmts) {
    if (s.k === 'assign') {
      vars[s.name] = evalNode(s.value, vars);
    } else if (s.k === 'if') {
      const c = evalNode(s.cond, vars);
      execStmts(c ? s.then : s.else, vars);
    }
  }
}

/**
 * Run a scoring script.
 * @param {string} script source
 * @param {object} vars initial variables ({ full, n, passed, s0..sN })
 * @returns {number} final value of vars.score (default 0)
 */
function runScript(script, vars) {
  const scope = { ...vars, score: 0 };
  const stmts = new Parser(script).parseStmts();
  execStmts(stmts, scope);
  return Number(scope.score) || 0;
}

/**
 * Aggregate group scores.
 * modes: sum | min | max | avg | count_pass
 */
function aggregate(mode, scores, fullScore) {
  if (!scores.length) return 0;
  switch (mode) {
    case 'min': return Math.min(...scores);
    case 'max': return Math.max(...scores);
    case 'avg': return scores.reduce((a, b) => a + b, 0) / scores.length;
    case 'count_pass': {
      let c = 0;
      for (const s of scores) if (s > 0) c++;
      return c;
    }
    case 'sum':
    default: return scores.reduce((a, b) => a + b, 0);
  }
}

module.exports = { runScript, aggregate };
