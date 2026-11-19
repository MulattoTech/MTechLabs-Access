// SPDX-License-Identifier: MIT
// Reproducible source-equivalent owner plugin archive. This does not copy
// Plugin Creator's original compressed bytes and does not modify its release.
import { readFile, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PACKAGE = 'integrations/m-techlabs-desktop';
export const FILES = Object.freeze([
  '.app.json', '.codex-plugin/plugin.json', '.mcp.json', 'README.md',
  'assets/icon.svg', 'mcp.json', 'plugin.json', 'skills/connection-recovery/SKILL.md',
]);
const EXPECTED_VERSION = '0.2.3';
const ENDPOINT = 'https://mcp.m-techlabs.com/mcp';

function octal(header, value, offset, width) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid tar metadata');
  const text = value.toString(8).padStart(width - 1, '0') + '\0';
  if (text.length !== width) throw new Error('Tar header field overflow');
  header.write(text, offset, width, 'ascii');
}
function tarEntry(name, contents) {
  if (!/^[a-zA-Z0-9._/-]{1,100}$/.test(name) || name.startsWith('/') ||
      name.split('/').includes('..') || contents.length > 1048576)
    throw new Error('Unsafe plugin archive entry');
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'ascii');
  octal(header, 0o644, 100, 8);
  octal(header, 0, 108, 8);
  octal(header, 0, 116, 8);
  octal(header, contents.length, 124, 12);
  octal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const sum = header.reduce((total, byte) => total + byte, 0);
  const checksum = sum.toString(8).padStart(6, '0') + '\0 ';
  if (checksum.length !== 8) throw new Error('Tar checksum overflow');
  header.write(checksum, 148, 8, 'ascii');
  return Buffer.concat([header, contents, Buffer.alloc((512 - contents.length % 512) % 512)]);
}
export async function packageCanonicalPlugin(root = ROOT) {
  const artifacts = new Map();
  for (const name of FILES) {
    const source = resolve(root, PACKAGE, name);
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Plugin source entry is not a regular file');
    const content = Buffer.from((await readFile(source, 'utf8')).replace(/\r\n/g, '\n'), 'utf8');
    if (content.includes(0)) throw new Error('Unexpected binary/null byte in plugin source');
    artifacts.set(name, content);
  }
  const parsed = JSON.parse(artifacts.get('plugin.json').toString('utf8'));
  const app = JSON.parse(artifacts.get('.app.json').toString('utf8'));
  const mcp = JSON.parse(artifacts.get('mcp.json').toString('utf8'));
  const legacyMcp = JSON.parse(artifacts.get('.mcp.json').toString('utf8'));
  const plugin = JSON.parse(artifacts.get('.codex-plugin/plugin.json').toString('utf8'));
  if (parsed.version !== EXPECTED_VERSION || parsed.name !== 'm-techlabs-desktop' ||
      plugin.version !== EXPECTED_VERSION || plugin.name !== parsed.name ||
      parsed.extensions?.['com.openai']?.apps !== './.app.json' ||
      Object.keys(app.apps || {}).length !== 1 ||
      mcp.mcpServers?.['m-techlabs-desktop']?.url !== ENDPOINT ||
      legacyMcp.mcpServers?.['m-techlabs-desktop']?.url !== ENDPOINT ||
      mcp.mcpServers?.['m-techlabs-desktop']?.extensions?.['com.openai']?.auth?.client?.mode !== 'dcr')
    throw new Error('Canonical plugin identity, OAuth App dependency, or endpoint drift');
  const tar = Buffer.concat([
    ...[...artifacts.entries()].map(([name, contents]) => tarEntry(name, contents)),
    Buffer.alloc(1024),
  ]);
  const archive = gzipSync(tar, { level: 9, mtime: 0 });
  const manifest = {
    version: EXPECTED_VERSION,
    file: `mterm-chatgpt-v${EXPECTED_VERSION}.tar.gz`,
    sha256: createHash('sha256').update(archive).digest('hex'),
    provenance: {
      kind: 'verified-source-equivalent-repack',
      canonicalRelease: 'pluginrel_6af62cc94f208191ae197a1a9ae7aa65',
      sourceDirectory: PACKAGE,
      exactCompressedCreatorArchive: false,
    },
  };
  return { archive, manifest, files: [...artifacts.keys()] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('No command arguments supported');
  const { archive, manifest, files } = await packageCanonicalPlugin();
  await writeFile(resolve(ROOT, 'plugin-releases', manifest.file), archive, { flag: 'wx' });
  await writeFile(resolve(ROOT, 'plugin-releases/current.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ version: manifest.version, bytes: archive.length,
    sha256: manifest.sha256, entryCount: files.length, kind: manifest.provenance.kind }));
}
