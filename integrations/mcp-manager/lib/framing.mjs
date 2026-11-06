export function createLineFramer({ maxBytes, onLine, onError }) {
  let pieces = [];
  let size = 0;
  let discarded = false;
  function append(piece) {
    if (!piece.length || discarded) return;
    if (size + piece.length > maxBytes) {
      pieces = [];
      size = 0;
      discarded = true;
      return;
    }
    pieces.push(piece);
    size += piece.length;
  }
  function complete() {
    if (discarded) {
      onError('frame_too_large');
    } else if (size) {
      const value = Buffer.concat(pieces, size).toString('utf8').replace(/\r$/, '');
      if (value.trim()) onLine(value);
    }
    pieces = [];
    size = 0;
    discarded = false;
  }
  return {
    push(value) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      let start = 0;
      for (;;) {
        const newline = chunk.indexOf(10, start);
        if (newline === -1) {
          append(chunk.subarray(start));
          break;
        }
        append(chunk.subarray(start, newline));
        complete();
        start = newline + 1;
      }
    },
    end() {
      complete();
    },
  };
}

export function requestKey(id) {
  if (id === null || typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) {
    return typeof id + ':' + JSON.stringify(id);
  }
  throw new Error('invalid_id');
}

export function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}
