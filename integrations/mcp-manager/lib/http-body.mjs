// Bounded pre-parser shared by the fixed admin API and the MCP transport.
// Drain bad requests without destroying the socket before a safe error reply.
export async function readJsonBody(request, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error('invalid_max_bytes');
  }
  const contentType = request.headers['content-type'] ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new Error('unsupported_content_type');
  }
  const contentLengthHeader = request.headers['content-length'];
  if (contentLengthHeader !== undefined) {
    const parsedLength = Number(contentLengthHeader);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new Error('body_too_large');
    }
  }
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    let settled = false;
    const cleanup = () => {
      request.removeListener('data', data);
      request.removeListener('end', end);
      request.removeListener('error', error);
      request.removeListener('aborted', aborted);
      request.removeListener('close', onClose);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const fail = cause => {
      request.resume();
      settle(reject, cause);
    };
    const data = chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) return fail(new Error('body_too_large'));
      chunks.push(chunk);
    };
    const end = () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks, bytes).toString('utf8').replace(/^\uFEFF/, '');
        settle(resolve, JSON.parse(raw));
      } catch {
        fail(new Error('invalid_json'));
      }
    };
    const error = () => fail(new Error('request_error'));
    const aborted = () => fail(new Error('aborted'));
    const onClose = () => {
      if (!request.readableEnded) fail(new Error('aborted'));
    };
    request.on('data', data);
    request.once('end', end);
    request.once('error', error);
    request.once('aborted', aborted);
    request.once('close', onClose);
  });
}
