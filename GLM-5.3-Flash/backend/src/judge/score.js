// Custom scoring script interpreter.
// Syntax:
//   A = 1;                       (variable assignment)
//   if (cond) { ... } else { ... }   OR   if (cond) stmts fi
//   expressions: + - * / % & | ^ && || == != < <= > >= ( ) min(a,b) max(a,b) abs(x), numbers, variables
// Final score: variable `score` (case-insensitive). If the whole script is a
// single pure expression, it is evaluated directly.
// Available variables set by the judge: CASES (total), PASSED, PARTIAL (0/1),
// TIME, MEMORY, GROUPS (count), SCORE (current default score), plus any custom subtask var set earlier.

// ---------------- Tokenizer ----------------
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: 'name', v: src.slice(i, j) });
      i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      toks.push({ t: 'op', v: two }); i += 2; continue;
    }
    if ('+-*/%<>=(){}&|^!,;'.includes(c)) {
      toks.push({ t: 'op', v: c }); i++; continue;
    }
    throw new Error(`Scoring script: illegal character '${c}'`);
  }
  return toks;
}

// ---------------- Parser (AST) / Evaluator ----------------

// Expression AST node kinds: {k:'num',v} {k:'var',name} {k:'bin',op,l,r}
// {k:'un',op:'-',v} {k:'call',fn,name args:[..]}
function parseExprNode(toks, pos) {
  let p = pos.ref;

  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (v) => {
    const tk = toks[p];
    if (!tk || tk.v !== v) throw new Error(`Scoring script: expected '${v}'`);
    p++;
  };

  function primary() {
    const tk = peek();
    if (!tk) throw new Error('Scoring script: unexpected end');
    if (tk.t === 'num') { next(); return { k: 'num', v: tk.v }; }
    if (tk.t === 'name') {
      const nm = next().v;
      if (nm === 'min' || nm === 'max' || nm === 'abs') {
        expect('(');
        const args = [parseBinary(0)];
        while (peek() && peek().t === 'op' && peek().v === ',') { next(); args.push(parseBinary(0)); }
        expect(')');
        return { k: 'call', fn: nm, args };
      }
      return { k: 'var', name: nm };
    }
    if (tk.v === '(') { next(); const e = parseBinary(0); expect(')'); return e; }
    if (tk.v === '-') { next(); return { k: 'un', op: '-', v: parseBinary(4) }; }
    throw new Error(`Scoring script: unexpected token '${tk.v}'`);
  }

  // precedence climbing
  function parseBinary(minPrec) {
    let left = primary();
    const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '&': 7, '|': 7, '^': 7 };
    while (peek() && peek().t === 'op' && peek().v in PREC && PREC[peek().v] >= minPrec) {
      const op = next().v;
      const right = parseBinary(PREC[op] + 1);
      left = { k: 'bin', op, l: left, r: right };
    }
    return left;
  }

  const node = parseBinary(1);
  pos.ref = p;
  return node;
}

function evalNode(node, ctx) {
  const truthy = (v) => !(v === 0 || v === false || v === undefined || v === null || isNaN(v));
  const num = (v) => (typeof v === 'number' && !isNaN(v)) ? v : 0;
  switch (node.k) {
    case 'num': return node.v;
    case 'var': {
      if (Object.prototype.hasOwnProperty.call(ctx, node.name)) return ctx[node.name];
      if (Object.prototype.hasOwnProperty.call(ctx, node.name.toLowerCase())) return ctx[node.name.toLowerCase()];
      throw new Error(`Scoring script: unknown variable '${node.name}'`);
    }
    case 'un': {
      const v = evalNode(node.v, ctx);
      return node.op === '-' ? -num(v) : num(v);
    }
    case 'call': {
      const a = node.args.map(x => num(evalNode(x, ctx)));
      if (node.fn === 'min') return Math.min(a[0], a[1]);
      if (node.fn === 'max') return Math.max(a[0], a[1]);
      if (node.fn === 'abs') return Math.abs(a[0]);
      throw new Error(`Scoring script: unknown function '${node.fn}'`);
    }
    case 'bin': {
      const l = evalNode(node.l, ctx);
      const r = evalNode(node.r, ctx);
      switch (node.op) {
        case '+': return num(l) + num(r);
        case '-': return num(l) - num(r);
        case '*': return num(l) * num(r);
        case '/': { const d = num(r); if (d === 0) throw new Error('Scoring script: division by zero'); return num(l) / d; }
        case '%': { const d = num(r); if (d === 0) throw new Error('Scoring script: modulo by zero'); return num(l) % d; }
        case '&': return (num(l) | 0) & (num(r) | 0);
        case '|': return (num(l) | 0) | (num(r) | 0);
        case '^': return (num(l) | 0) ^ (num(r) | 0);
        case '&&': return (truthy(l) && truthy(r)) ? 1 : 0;
        case '||': return (truthy(l) || truthy(r)) ? 1 : 0;
        case '==': return num(l) === num(r) ? 1 : 0;
        case '!=': return num(l) !== num(r) ? 1 : 0;
        case '<': return num(l) < num(r) ? 1 : 0;
        case '<=': return num(l) <= num(r) ? 1 : 0;
        case '>': return num(l) > num(r) ? 1 : 0;
        case '>=': return num(l) >= num(r) ? 1 : 0;
        default: throw new Error(`Scoring script: unknown operator '${node.op}'`);
      }
    }
    default: throw new Error('Scoring script: bad AST node');
  }
}

// Statement parsing: returns {k:'assign',name,pos:[start,end]} or {k:'if',condStart,endBranches...}
// Statements are re-parsed at execution time from token ranges to get lazy, sequential semantics.
function parseStatement(toks, pos, ends) {
  const peek = () => toks[pos.ref];
  const next = () => toks[pos.ref++];

  const tk = peek();
  if (!tk) throw new Error('Scoring script: unexpected end');
  if (tk.t === 'op' && tk.v === ';') { next(); return null; } // empty statement
  if (tk.t === 'name' && tk.v === 'if') {
    next();
    if (!peek() || peek().v !== '(') throw new Error("Scoring script: expected '(' after if");
    next();
    const condNode = parseExprNode(toks, pos);
    if (!peek() || peek().v !== ')') throw new Error("Scoring script: expected ')' after if condition");
    next();

    // peek at body style
    let braceStyle = false;
    if (peek() && peek().v === '{') { braceStyle = true; next(); }

    const parseBody = () => {
      const stmts = [];
      for (;;) {
        if (!toks[pos.ref]) {
          if (braceStyle) throw new Error("Scoring script: missing '}'");
          throw new Error('Scoring script: if statement not closed (missing fi)');
        }
        const cur = peek();
        if (braceStyle && cur.v === '}') { next(); return stmts; }
        if (!braceStyle && cur.t === 'name' && (cur.v === 'fi' || cur.v === 'else')) return stmts;
        const st = parseStatement(toks, pos);
        if (st) stmts.push(st);
      }
    };

    const thenBody = parseBody();
    let elseBody = [];
    if (!braceStyle && peek() && peek().t === 'name' && peek().v === 'fi') next(); // plain if <stmts> fi
    const after = peek();
    if (!braceStyle && after && after.t === 'name' && after.v === 'else') {
      next();
      elseBody = parseBody();
      if (!peek() || peek().v !== 'fi') throw new Error('Scoring script: if/else statement not closed (missing fi)');
      next();
    } else if (braceStyle && after && after.t === 'name' && after.v === 'else') {
      next();
      if (peek() && peek().v === '{') { next(); elseBody = parseBody(); }
      else {
        // else <stmts> ; (single-statement shorthand) — treat until fi or ';'
        for (;;) {
          if (!toks[pos.ref]) break;
          const c = peek();
          if (c.t === 'name' && c.v === 'fi') { next(); break; }
          if (c.v === ';') { next(); break; }
          const st = parseStatement(toks, pos);
          if (st) elseBody.push(st);
        }
      }
    }

    // tolerate stray ';' after the if statement
    if (peek() && peek().t === 'op' && peek().v === ';') next();
    return { k: 'if', cond: condNode, then: thenBody, else: elseBody };
  }
  if (tk.t === 'name') {
    const nm = next().v;
    if (!peek() || peek().v !== '=') throw new Error(`Scoring script: expected '=' after '${nm}'`);
    next();
    const start = pos.ref;
    const probePos = { ref: start };
    parseExprNode(toks, probePos);
    const end = probePos.ref;
    // skip stray ';' that belongs to the line
    if (toks[end] && toks[end].v === ';') { /* kept in range for simplicity */ pos.ref = end + 1; }
    else pos.ref = end;
    return { k: 'assign', name: nm, start, end };
  }
  throw new Error(`Scoring script: unsupported statement '${tk.v}'`);
}

function runStatement(st, ctx) {
  if (st.k === 'assign') {
    const probePos = { ref: st.start };
    const node = parseExprNodeCached(st, probePos, ctx); // re-parse per execution (lazy RHS)
    const v = evalNode(node, ctx);
    ctx[st.name] = v;
    ctx[st.name.toLowerCase()] = v;
    return;
  }
  if (st.k === 'if') {
    const c = evalNode(st.cond, ctx);
    const truthy = !((c === 0) || c === false || c === undefined || c === null || (typeof c === 'number' && isNaN(c)));
    (truthy ? st.then : st.else).forEach((s) => runStatement(s, ctx));
  }
}

// Parse fresh AST node for the RHS at exec time (laziness)
function parseExprNodeCached(st, _pos, _ctx) {
  const probePos = { ref: st.start };
  return parseExprNode(LAST_TOKS, probePos);
}

let LAST_TOKS = null;

// mode 'script': evaluate all statements, mode 'expr': single expression
let _parse_heads;

function makeParserStatementList(toks, pos, ends) { /* retained for API stability */ }

/**
 * Evaluate a scoring script.
 * @returns {number} final score
 */
function evalScoreScript(script, envVars) {
  const toks = tokenize(script);
  LAST_TOKS = toks;
  const pos = { ref: 0 };

  // Decide script vs single-expression: a top-level '=' outside braces/parens means script mode.
  let depth = 0, isScript = false;
  for (const tk of toks) {
    if (tk.t === 'op' && '([{'.includes(tk.v)) depth++;
    if (tk.t === 'op' && ')]}'.includes(tk.v)) depth--;
    if (depth === 0 && tk.t === 'op' && tk.v === '=') { isScript = true; break; }
  }
  if (!isScript && toks.length && toks[0].t === 'name' && toks[0].v === 'if') isScript = true;

  if (!isScript) {
    const node = parseExprNode(toks, pos);
    const ctx = Object.fromEntries(Object.entries(envVars).map(([k, v]) => [k.toLowerCase(), v]));
    const result = Number(evalNode(node, ctx));
    return result;
  }

  const ctx = Object.fromEntries(Object.entries(envVars).map(([k, v]) => [k.toLowerCase(), v]));
  const stmts = [];
  for (;;) {
    if (pos.ref >= toks.length) break;
    const st = parseStatement(toks, pos);
    if (st) stmts.push(st);
  }
  try {
    stmts.forEach((s) => runStatement(s, ctx));
  } finally {
    LAST_TOKS = null;
  }
  const result = ctx['score'] !== undefined ? ctx['score'] : ctx['r'];
  if (result === undefined || result === null || (typeof result === 'number' && isNaN(result))) {
    throw new Error('Scoring script: final variable score not set');
  }
  return Number(result);
}

module.exports = { evalScoreScript };
