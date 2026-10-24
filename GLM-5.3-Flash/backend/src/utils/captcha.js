// Self-drawn SVG captcha.
// Glyphs are handwritten-style stroke paths, so the answer string is never
// present in the DOM (<text>) and cannot be extracted by simple DOM reading.
// Uses crypto.randomInt for secure random character selection.
const crypto = require('crypto');
const config = require('../config');

// Confusing characters O/0/I/1/l are excluded.
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.split('');

// Compact stroke-path glyph table (40x40 cell), rendered as polyline-style curves.
const GLYPHS = {
  A: 'M6,36 L17,5 L28,36 M10,24 H24',
  B: 'M8,36 V5 H23 Q32,5 32,12 Q32,19 22,19 H8 M22,19 H26 Q35,20 34,28 Q33,36 24,36',
  C: 'M34,10 Q27,4 20,4 Q7,6 7,20 Q7,34 20,36 Q28,36 34,30',
  D: 'M8,5 V36 M8,5 H18 Q34,7 34,20 Q34,33 18,36 H8',
  E: 'M30,5 H8 V36 H30 M8,20 H24',
  F: 'M30,5 H8 V36 M8,20 H23',
  G: 'M34,10 Q27,4 20,4 Q7,6 7,20 Q7,34 20,36 Q27,36 33,32 V22 H23',
  H: 'M8,5 V36 M28,5 V36 M8,20 H28',
  J: 'M26,5 V30 Q26,37 18,37 Q11,37 9,31',
  K: 'M8,5 V36 M30,5 L12,22 M18,17 L32,36',
  L: 'M8,5 V36 H29',
  M: 'M6,36 V5 L17,22 L28,5 V36',
  N: 'M8,36 V5 L28,36 V5',
  P: 'M8,36 V5 H24 Q34,6 33,14 Q32,22 22,21 H8',
  Q: 'M12,6 Q33,6 31,22 Q28,37 21,36 Q9,34 10,20 Q12,8 24,6 M24,30 L33,38',
  R: 'M8,36 V5 H23 Q33,6 32,14 Q31,21 22,21 H8 M20,21 L32,36',
  S: 'M32,8 Q27,4 19,4 Q8,5 9,12 Q10,19 21,20 Q32,21 32,28 Q31,36 19,36 Q11,36 7,32',
  T: 'M6,5 H32 M20,5 V36',
  U: 'M8,5 V26 Q9,36 20,36 Q31,36 31,26 V5',
  V: 'M7,5 L20,36 L33,5',
  W: 'M5,5 L11,36 L18,14 L25,36 L31,5',
  X: 'M8,5 L30,36 M30,5 L8,36',
  Y: 'M8,5 L20,20 L32,5 M20,20 V36',
  Z: 'M8,6 H30 L9,35 H32',
  2: 'M6,10 Q22,2 35,12 Q20,24 5,34 H35',
  3: 'M8,9 Q28,0 33,12 Q15,15 15,15 Q30,15 33,25 Q20,38 8,32',
  4: 'M28,34 V4 L6,26 H36',
  5: 'M32,5 H10 L8,18 Q14,14 22,16 Q34,22 28,32 Q18,40 6,33',
  6: 'M30,6 Q10,12 10,24 Q10,36 22,35 Q32,33 30,26 Q27,19 15,22',
  7: 'M6,6 H33 L16,36',
  8: 'M20,4 Q10,4 10,11 Q10,18 21,19 Q33,18 32,26 Q32,35 20,35 Q9,35 9,27 Q9,19 20,19 Q31,19 31,11 Q31,4 20,4',
  9: 'M12,34 Q32,30 31,17 Q30,6 20,6 Q10,7 11,15 Q12,22 22,20'
};

const store = new Map(); // id -> { answerHash, expires }

// Jitter a path string's numbers: n == shift, decoy noise offsets
function jitterPath(pathStr, dx, dy, sy) {
  return pathStr.replace(/(-?\d+(?:\.\d+)?)/g, (m, n, idx) => {
    const v = parseFloat(n);
    const val = v + (Math.abs(v) > 10 ? dy : dx) + Math.sin(idx) * sy;
    return String(Math.round(val * 10) / 10);
  });
}

function generate() {
  const answer = Array.from({ length: config.captcha.length },
    () => CHARS[crypto.randomInt(0, CHARS.length)]).join('');
  const id = crypto.randomBytes(16).toString('hex');
  const expires = Date.now() + config.captcha.expireSeconds * 1000;
  // cleanup expired
  for (const [k, v] of store) if (v.expires < Date.now()) store.delete(k);
  store.set(id, { answerHash: crypto.createHash('sha256').update(answer.toUpperCase()).digest('hex'), expires });

  const W = 210, H = 56, cellW = 48, startY = 8;
  const paths = [];
  for (let i = 0; i < answer.length; i++) {
    const g = GLYPHS[answer[i]];
    if (!g) continue;
    const bx = 12 + i * cellW + crypto.randomInt(-2, 3);
    const by = startY + crypto.randomInt(-2, 3);
    const dx = crypto.randomInt(-2, 3), dy = crypto.randomInt(-2, 3), sy = crypto.randomInt(0, 2);
    const rot = crypto.randomInt(-14, 15);
    const sx = (86 + crypto.randomInt(-8, 9)) / 100, sY = (90 + crypto.randomInt(-8, 9)) / 100;
    paths.push(
      `<g transform="translate(${bx},${by}) rotate(${rot}) scale(${sx},${sY})">` +
      `<path d="${jitterPath(g, dx, dy, sy)}" fill="none" stroke-width="${crypto.randomInt(2, 5)}"` +
      ` stroke-linecap="round" stroke-linejoin="round" opacity="${0.75 + crypto.randomInt(0, 4) / 10}"/></g>`
    );
  }
  // interference lines + points
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const x1 = crypto.randomInt(0, W), y1 = crypto.randomInt(0, H);
    const x2 = crypto.randomInt(0, W), y2 = crypto.randomInt(0, H);
    lines.push(`<path d="M${x1},${y1} Q${crypto.randomInt(0, W)},${crypto.randomInt(0, H)} ${x2},${y2}" stroke-width="${crypto.randomInt(1, 3)}" fill="none" stroke-opacity="0.55"/>`);
  }
  for (let i = 0; i < 6; i++) {
    lines.push(`<circle cx="${crypto.randomInt(0, W)}" cy="${crypto.randomInt(0, H)}" r="${crypto.randomInt(1, 2)}"/>`);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" id="x">` +
    `<defs><filter id="x"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="5"/><feComponentTransfer><feFuncA type="linear" slope="0.9"/></feComponentTransfer></filter></defs>` +
    `<g filter="url(#x)" stroke="currentColor" fill="currentColor">${lines.join('')}${paths.join('')}</g></svg>`;
  return { id, svg, expires };
}

function verify(id, input) {
  if (!id || !input) return false;
  const rec = store.get(String(id));
  // One-time use: destroy immediately on hit
  if (rec) store.delete(String(id));
  if (!rec || rec.expires < Date.now()) return false;
  const tryHash = crypto.createHash('sha256').update(String(input).trim().toUpperCase()).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(tryHash), Buffer.from(rec.answerHash));
}

module.exports = { generate, verify };
