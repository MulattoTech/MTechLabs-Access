import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function readValidatedTokenText(tokenPath) {
  if (typeof tokenPath !== 'string' || !tokenPath.trim()) throw new Error('invalid_token_file');
  const stat = await fs.lstat(tokenPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('invalid_token_file');
  const value = (await fs.readFile(tokenPath, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (/^sha256:[a-fA-F0-9]{64}$/.test(value)) {
    return { kind: 'digest', value, digest: Buffer.from(value.slice(7), 'hex') };
  }
  if (value.length < 32 || value.length > 512 || /\s/.test(value) || value.startsWith('sha256:')) {
    throw new Error('invalid_token_file');
  }
  return { kind: 'raw', value, digest: createHash('sha256').update(value).digest() };
}

export async function loadTokenDigest(tokenPath) {
  const parsed = await readValidatedTokenText(tokenPath);
  return parsed.digest;
}

export async function inspectTokenFormat(tokenPath) {
  const parsed = await readValidatedTokenText(tokenPath);
  return { format: parsed.kind, valid: true, encodedLength: parsed.value.length };
}
