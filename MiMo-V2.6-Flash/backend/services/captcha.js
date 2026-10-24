'use strict';

const crypto = require('crypto');
const db = require('../db/database');

// Charset excludes easily-confused O/0/I/1
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 5x7 bitmap font (each row = 5 bits). Answer rendered as path outlines only.
const FONT = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  2: [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  3: [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
};

const CELL = 6;      // pixel size of one font pixel
const CW = 5 * CELL; // char width
const CH = 7 * CELL; // char height
const GAP = 10;

function secureRandomInt(max) {
  // rejection sampling with crypto for uniformity
  const limit = Math.floor(0xffffffff / max) * max;
  let v;
  do {
    v = crypto.randomBytes(4).readUInt32BE(0);
  } while (v >= limit);
  return v % max;
}

function randomAnswer(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) s += CHARSET[secureRandomInt(CHARSET.length)];
  return s;
}

function charToPath(ch, ox, oy, px) {
  const rows = FONT[ch];
  if (!rows) return '';
  let d = '';
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 5; c++) {
      if (rows[r] & (1 << (4 - c))) {
        const x = ox + c * CELL;
        const y = oy + r * CELL;
        // shrink each pixel slightly for a dotted/rounded look
        const s = px;
        d += `M${(x + s).toFixed(1)} ${y.toFixed(1)}h${(CELL - 2 * s).toFixed(1)}v${CELL.toFixed(1)}h${-(CELL - 2 * s).toFixed(1)}z`;
      }
    }
  }
  return d;
}

/**
 * Generate an SVG captcha. The answer string is NOT present in the SVG —
 * only path outlines, so DOM reading cannot recover it.
 */
function generate(length = 4) {
  const answer = randomAnswer(length);
  const w = length * CW + (length - 1) * GAP + 24;
  const h = CH + 40;

  let body = '';
  // interference lines
  for (let i = 0; i < 4; i++) {
    const x1 = secureRandomInt(w), y1 = secureRandomInt(h);
    const x2 = secureRandomInt(w), y2 = secureRandomInt(h);
    body += `<path d="M${x1} ${y1}Q${(x1 + x2) / 2 + (secureRandomInt(40) - 20)} ${(y1 + y2) / 2 + (secureRandomInt(40) - 20)} ${x2} ${y2}" stroke="hsl(${secureRandomInt(360)},55%,45%)" stroke-width="1.4" fill="none" opacity="0.55"/>`;
  }
  // dots noise
  for (let i = 0; i < 30; i++) {
    body += `<circle cx="${secureRandomInt(w)}" cy="${secureRandomInt(h)}" r="${1 + secureRandomInt(2)}" fill="hsl(${secureRandomInt(360)},50%,50%)" opacity="0.35"/>`;
  }
  // glyph outlines, each with random rotation/skew/offset/color
  let x = 12;
  for (const ch of answer) {
    const rot = (secureRandomInt(16) - 8).toFixed(1);
    const dy = secureRandomInt(10) - 5;
    const fill = `hsl(${secureRandomInt(360)},65%,${30 + secureRandomInt(25)}%)`;
    const d = charToPath(ch, 0, 10 + dy, 0.8 + secureRandomInt(4) / 10);
    body += `<g transform="translate(${x},0) rotate(${rot},${CW / 2},${CH / 2})"><path d="${d}" fill="${fill}"/></g>`;
    x += CW + GAP;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>` +
    `<rect width="100%" height="100%" fill="#f4f6f8"/>` +
    `<g filter="url(#n)" opacity="0.25"><rect width="100%" height="100%" fill="none"/></g>` +
    body +
    `</svg>`;

  const id = crypto.randomBytes(16).toString('hex');
  db.run(
    'INSERT INTO captchas (id, answer, expires_at, used, created_at) VALUES (?,?,?,?,?)',
    id, answer.toUpperCase(), db.now() + 5 * 60 * 1000, 0, db.now()
  );
  return { id, svg };
}

/** One-time verification; destroys captcha regardless of outcome. */
function verify(id, userInput) {
  if (!id || typeof userInput !== 'string') return false;
  const row = db.get('SELECT id, answer, expires_at, used FROM captchas WHERE id = ?', id);
  db.run('DELETE FROM captchas WHERE id = ?', id); // one-time use
  if (!row) return false;
  if (row.used) return false;
  if (db.now() > Number(row.expires_at)) return false;
  return String(userInput).trim().toUpperCase() === row.answer;
}

function cleanup() {
  db.run('DELETE FROM captchas WHERE expires_at < ?', db.now());
}

module.exports = { generate, verify, cleanup, CHARSET };
