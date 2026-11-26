import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function loadTokenDigest(tokenPath) {
  const stat = await fs.lstat(tokenPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('invalid_token_file');
  const value = (await fs.readFile(tokenPath, 'utf8')).trim();
  if (/^sha256:[a-fA-F0-9]{64}$/.test(value)) return Buffer.from(value.slice(7), 'hex');
  if (value.length < 32 || value.length > 512 || /\s/.test(value) || value.startsWith('sha256:')) {
    throw new Error('invalid_token_file');
  }
  // Compatibility only; a digest file avoids storing plaintext on this PC.
  return createHash('sha256').update(value).digest();
}
