// Bounded pre-parser shared by the fixed admin API and the MCP transport.
// Drain bad requests without destroying the socket before a safe error reply.
export async function readJsonBody(request, maxBytes) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw new Error('unsupported_content_type');
  }
  if (Number(request.headers['content-length']) > maxBytes) throw new Error('body_too_large');
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const cleanup = () => {
      request.removeListener('data', data);
      request.removeListener('end', end);
      request.removeListener('error', error);
      request.removeListener('aborted', aborted);
    };
    const fail = cause => { cleanup(); request.resume(); reject(cause); };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) return fail(new Error('body_too_large'));
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))); }
      catch { reject(new Error('invalid_json')); }
    };
    const error = () => fail(new Error('request_error'));
    const aborted = () => fail(new Error('aborted'));
    request.on('data', data);
    request.once('end', end);
    request.once('error', error);
    request.once('aborted', aborted);
  });
}
