import { randomInt, randomBytes } from 'node:crypto';
import config from '../config.js';

// Characters that are easy to confuse (O/0/I/1/l) are excluded.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const store = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
}
setInterval(sweep, 60_000).unref();

function randomChar() {
  return ALPHABET[randomInt(0, ALPHABET.length)];
}

const WIDTH = 180;
const HEIGHT = 56;

function noiseLines() {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    const x1 = randomInt(0, WIDTH);
    const y1 = randomInt(6, HEIGHT - 6);
    const x2 = randomInt(0, WIDTH);
    const y2 = randomInt(6, HEIGHT - 6);
    const stroke = `hsl(${randomInt(0, 360)},60%,55%)`;
    out += `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${stroke}" stroke-width="${randomInt(1, 2)}" fill="none" opacity="0.45"/>`;
  }
  for (let i = 0; i < 40; i += 1) {
    const cx = randomInt(0, WIDTH);
    const cy = randomInt(0, HEIGHT);
    out += `<circle cx="${cx}" cy="${cy}" r="${randomInt(1, 2)}" fill="#9ca3af" opacity="0.5"/>`;
  }
  return out;
}

function buildSvg(answer) {
  // Glyphs are laid out on an evenly spaced grid, anchored at their centre and
  // rotated around their own centre only, so no character can be clipped by the
  // viewBox regardless of its width or the random rotation.
  const step = WIDTH / (answer.length + 1);
  let glyphs = '';
  for (let i = 0; i < answer.length; i += 1) {
    const ch = answer[i];
    const cx = Math.round(step * (i + 1) + randomInt(-3, 3));
    const cy = Math.round(HEIGHT / 2 + randomInt(-4, 4));
    const fontSize = randomInt(28, 34);
    const baseline = Math.round(cy + fontSize * 0.35);
    const rotate = randomInt(-20, 20);
    const skew = randomInt(-6, 6);
    const color = `hsl(${randomInt(0, 360)},${randomInt(55, 85)}%,${randomInt(22, 42)}%)`;
    glyphs += `<text x="${cx}" y="${baseline}" text-anchor="middle" `
      + `transform="rotate(${rotate} ${cx} ${cy}) skewX(${skew})" `
      + `font-family="Consolas, 'Courier New', monospace" font-size="${fontSize}" `
      + `font-weight="700" fill="${color}">${ch}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" `
    + `viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="captcha">`
    + `<rect width="${WIDTH}" height="${HEIGHT}" rx="6" fill="#eef2f7"/>`
    + noiseLines() + glyphs + '</svg>';
}

export function createCaptcha() {
  if (!config.captcha.enabled) return { id: 'disabled', svg: '', disabled: true };
  let answer = '';
  for (let i = 0; i < 4; i += 1) answer += randomChar();
  const id = randomBytes(16).toString('hex');
  store.set(id, { answer, expiresAt: Date.now() + config.captcha.ttlSeconds * 1000 });
  return { id, svg: buildSvg(answer) };
}

export function verifyCaptcha(id, input) {
  if (!config.captcha.enabled) return true;
  if (!id) return false;
  const entry = store.get(id);
  store.delete(id); // one-time use
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) return false;
  return String(input || '').trim().toUpperCase() === entry.answer;
}

export function captchaEnabled() {
  return config.captcha.enabled;
}
