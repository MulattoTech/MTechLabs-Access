import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ordinaryPath } from './dev-instance.mjs';
import { windowsPath } from './dev-runtime-plan.mjs';

async function readBoundedSnapshot(filename, maximum) {
  const expected = await ordinaryPath(filename);
  const handle = await fs.open(filename, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > maximum ||
        before.dev !== expected.stat.dev || before.ino !== expected.stat.ino) throw new Error('runtime_file_unverified');
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (length > maximum || BigInt(length) !== before.size || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || after.nlink !== 1n) {
      throw new Error('runtime_file_unverified');
    }
    return { bytes: bytes.subarray(0, length), filename: expected.filename, stat: after };
  } finally { await handle.close(); }
}
export async function readBytes(filename, maximum) {
  return (await readBoundedSnapshot(filename, maximum)).bytes;
}
export async function snapshot(filename) {
  const data = await readBytes(filename, 16384);
  return { value: JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '')), sha256: createHash('sha256').update(data).digest('hex') };
}

export function fileIdentity(actual) {
  const stat = actual.stat;
  return { filename: windowsPath(actual.filename), dev: String(stat.dev), ino: String(stat.ino),
    nlink: String(stat.nlink), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
}

// Reference snapshots also recheck the selected pathname after the bounded
// handle read. These identities are private input bindings, not file contents.
export async function stableFileSnapshot(filename, maximum) {
  const value = await readBoundedSnapshot(filename, maximum);
  const identity = fileIdentity(value);
  const after = fileIdentity(await ordinaryPath(filename));
  if (JSON.stringify(identity) !== JSON.stringify(after)) throw new Error('runtime_file_unverified');
  return { ...value, identity, sha256: createHash('sha256').update(value.bytes).digest('hex') };
}

export function isValidSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function formatByteCount(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "0 B";
  return `${Math.floor(bytes)} B`;
}

export function truncateUtf8Preview(text, maxChars = 256) {
  if (typeof text !== "string") return "";
  const limit = typeof maxChars === "number" && Number.isInteger(maxChars) && maxChars >= 0 ? maxChars : 256;
  return text.length <= limit ? text : text.slice(0, limit);
}

export function parseJsonOrNull(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); } catch { return null; }
}

export function normalizeLfLines(text) {
  if (typeof text !== "string") return "";
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

export function splitLinesNormalized(text) {
  if (typeof text !== "string" || !text) return [];
  return text.replace(/^\uFEFF/, "").split(/\r?\n/);
}

export function countLinesNormalized(text) {
  if (typeof text !== "string" || !text) return 0;
  return splitLinesNormalized(text).length;
}
