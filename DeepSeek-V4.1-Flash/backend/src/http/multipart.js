/**
 * Minimal multipart/form-data parser (dependency-free).
 * Parses a Buffer body and returns { fields, files: [{ name, filename, contentType, data }] }.
 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('缺少 multipart boundary');
  const boundary = `--${(match[1] || match[2]).trim()}`;
  const boundaryBuf = Buffer.from(boundary);
  const fields = {};
  const files = [];

  let index = buffer.indexOf(boundaryBuf);
  if (index === -1) return { fields, files };
  index += boundaryBuf.length;

  while (index < buffer.length) {
    if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a) index += 2;
    if (buffer.slice(index, index + 2).toString() === '--') break;

    const headerEnd = buffer.indexOf('\r\n\r\n', index);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(index, headerEnd).toString('utf8');
    const nextBoundary = buffer.indexOf(boundaryBuf, headerEnd);
    if (nextBoundary === -1) break;
    let contentEnd = nextBoundary;
    if (buffer[contentEnd - 2] === 0x0d && buffer[contentEnd - 1] === 0x0a) contentEnd -= 2;
    const data = buffer.slice(headerEnd + 4, contentEnd);

    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const name = nameMatch ? nameMatch[1] : '';

    if (filenameMatch && filenameMatch[1]) {
      files.push({
        name,
        filename: filenameMatch[1],
        contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
        data,
      });
    } else {
      fields[name] = data.toString('utf8');
    }

    index = nextBoundary + boundaryBuf.length;
  }
  return { fields, files };
}

export default { parseMultipart };
