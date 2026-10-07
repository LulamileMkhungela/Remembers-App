/**
 * Minimal multipart/form-data parser (binary safe, no dependencies).
 * Returns { fields, files } where each file is { field, name, mimeType, data }.
 */
export function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delimiter);
  if (start === -1) throw new Error("multipart: boundary not found");

  while (start !== -1) {
    let next = buffer.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const chunk = buffer.subarray(start + delimiter.length, next);
    if (chunk.length > 4) parts.push(chunk);
    start = next;
  }

  const fields = {};
  const files = [];
  for (const raw of parts) {
    let chunk = raw;
    if (chunk.subarray(0, 2).toString() === "\r\n") chunk = chunk.subarray(2);
    if (chunk.subarray(0, 2).toString() === "--") continue;
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerText = chunk.subarray(0, headerEnd).toString("utf8");
    let body = chunk.subarray(headerEnd + 4);
    if (body.subarray(body.length - 2).toString() === "\r\n") body = body.subarray(0, body.length - 2);

    const nameMatch = headerText.match(/name="([^"]*)"/i);
    const fileMatch = headerText.match(/filename="([^"]*)"/i);
    const typeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    const field = nameMatch ? nameMatch[1] : "file";
    if (fileMatch) {
      files.push({ field, name: fileMatch[1] || "upload.png", mimeType: typeMatch ? typeMatch[1].trim() : "application/octet-stream", data: body });
    } else {
      fields[field] = body.toString("utf8");
    }
  }
  return { fields, files };
}

export function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
