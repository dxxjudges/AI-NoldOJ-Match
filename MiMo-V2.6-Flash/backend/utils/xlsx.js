'use strict';

/**
 * Lightweight xlsx (zip+XML) reader for admin Excel import.
 * Supports sharedStrings + first worksheet cell values.
 * Returns array of rows (arrays of strings/numbers).
 */

const { inflateRawSync } = require('zlib');

/**
 * Minimal ZIP central-directory reader (no deps).
 * Returns Map of entry name -> Buffer.
 */
function readZip(buf) {
  // find EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('无效的 xlsx 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    // local header
    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error('不支持的压缩方式: ' + method);
    entries.set(name, data);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function colToIndex(ref) {
  // "B2" -> 1
  let col = 0;
  for (const ch of ref) {
    if (ch >= 'A' && ch <= 'Z') col = col * 26 + (ch.charCodeAt(0) - 64);
    else break;
  }
  return col - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const refM = attrs.match(/r="([A-Z]+)\d+"/);
      const col = refM ? colToIndex(refM[1]) : cells.length;
      const tM = attrs.match(/t="([^"]+)"/);
      const type = tM ? tM[1] : 'n';
      let v = '';
      if (type === 'inlineStr') {
        const isM = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        v = isM ? decodeXml(isM[1]) : '';
      } else {
        const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
        const rawV = vM ? vM[1] : '';
        if (type === 's') v = shared[Number(rawV)] ?? '';
        else if (type === 'b') v = rawV === '1' ? 'TRUE' : 'FALSE';
        else v = rawV;
      }
      while (cells.length < col) cells.push('');
      cells[col] = v;
    }
    rows.push(cells);
  }
  return rows;
}

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * Read first worksheet of an xlsx buffer into rows of values.
 */
function readXlsx(buffer) {
  const entries = readZip(buffer);
  let shared = [];
  const ss = entries.get('xl/sharedStrings.xml');
  if (ss) {
    const xml = ss.toString('utf8');
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml))) {
      const texts = [];
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(m[1]))) texts.push(decodeXml(t[1]));
      shared.push(texts.join(''));
    }
  }
  // first worksheet
  let sheetName = 'xl/worksheets/sheet1.xml';
  if (!entries.has(sheetName)) {
    for (const k of entries.keys()) {
      if (k.startsWith('xl/worksheets/sheet')) { sheetName = k; break; }
    }
  }
  const sheet = entries.get(sheetName);
  if (!sheet) throw new Error('xlsx 中找不到工作表');
  return parseSheet(sheet.toString('utf8'), shared);
}

/**
 * Convert rows to objects using the first row as header.
 */
function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h || '').trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some(c => String(c || '').trim())) continue;
    const o = {};
    header.forEach((h, j) => { if (h) o[h] = r[j] ?? ''; });
    out.push(o);
  }
  return out;
}

module.exports = { readXlsx, rowsToObjects };
