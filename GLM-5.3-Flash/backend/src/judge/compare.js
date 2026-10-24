// Output comparison: strict / loose / float / spj (checker delegates).
function normLines(s) {
  return String(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function strict(a, b) {
  if (a === null || b === null) return false;
  let x = normLines(a), y = normLines(b);
  x = x.replace(/\s+$/, '');
  y = y.replace(/\s+$/, '');
  return x === y;
}

function loose(a, b) {
  if (a === null || b === null) return false;
  const x = normLines(a), y = normLines(b);
  const tx = x.split(/\s+/).filter(Boolean);
  const ty = y.split(/\s+/).filter(Boolean);
  return tx.join(' ') === ty.join(' ');
}

function isFloat(tok) {
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tok);
}

function floats(a, b, tol) {
  if (a === null || b === null) return false;
  const x = normLines(a), y = normLines(b);
  const tx = x.split(/\s+/).filter(Boolean);
  const ty = y.split(/\s+/).filter(Boolean);
  if (tx.length !== ty.length) return false;
  for (let i = 0; i < tx.length; i++) {
    if (tx[i] === ty[i]) continue;
    if (isFloat(tx[i]) && isFloat(ty[i])) {
      if (Math.abs(parseFloat(tx[i]) - parseFloat(ty[i])) > tol) return false;
    } else return false;
  }
  return true;
}

/**
 * @param {'strict'|'loose'|'float'} mode
 */
function compare(actual, expected, mode, tol) {
  if (mode === 'strict') return strict(actual, expected);
  if (mode === 'float') return floats(actual, expected, tol || 0.000001);
  return loose(actual, expected); // default loose
}

module.exports = { strict, loose, floats, compare };
