// Minimal .xlsx (Excel) reader: zip central directory + zlib inflateRaw.
// Supports single-sheet workbooks with inline/shared strings. Read-only.
const zlib = require('zlib');

function readZipEntries(buf) {
  // find EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let off = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    // local header
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = comp;
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else data = null;
    entries.set(name, data);
    off += 46 + nameLen + extraLen + commLen;
  }
  return entries;
}

function xmlText(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function tagContent(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/**
 * Parse xlsx buffer -> array of rows (array of string cell values)
 */
function parseXlsx(buf) {
  const zip = readZipEntries(buf);
  // shared strings
  let shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const xml = zip.get('xl/sharedStrings.xml').toString('utf8');
    shared = tagContent(xml, 'si').map(si =>
      (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => xmlText(t.replace(/<[^>]+>/g, ''))).join(''));
  }
  // first worksheet
  const sheetName = [...zip.keys()].filter(k => /^xl\/worksheets\/sheet1\.xml$/.test(k))[0] ||
    [...zip.keys()].filter(k => /worksheets\/.*\.xml$/.test(k))[0];
  if (!sheetName) throw new Error('No worksheet found');
  const xml = zip.get(sheetName).toString('utf8');
  const rows = [];
  for (const rowXml of tagContent(xml, 'row')) {
    const cells = [];
    const cellRe = /<c([^>]*)\/?>([\s\S]*?)(?:<\/c>)?(?=<c[\s>]|<\/row>|$)/g;
    let m;
    // simpler: iterate <c> blocks
    const cRe = /<c\s([^>]*)>([\s\S]*?)<\/c>|<c\s([^>]*)\/>/g;
    while ((m = cRe.exec(rowXml))) {
      const attrs = m[1] || m[3] || '';
      const inner = m[2] || '';
      const tMatch = attrs.match(/t="([^"]+)"/);
      const rMatch = attrs.match(/r="([A-Z]+)(\d+)"/);
      const colIdx = rMatch ? colLettersToIndex(rMatch[1]) : cells.length;
      let val = '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (tMatch && tMatch[1] === 's' && v) val = shared[Number(v[1])] || '';
      else if (tMatch && tMatch[1] === 'inlineStr') val = xmlText(inner.replace(/<[^>]+>/g, ''));
      else if (v) val = xmlText(v[1]);
      while (cells.length < colIdx) cells.push('');
      cells[colIdx] = val;
    }
    rows.push(cells);
  }
  return rows;
}

function colLettersToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

module.exports = { parseXlsx };
