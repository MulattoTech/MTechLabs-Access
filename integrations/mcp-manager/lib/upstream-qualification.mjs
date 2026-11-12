// SPDX-License-Identifier: MIT
// AI-Change: 2026-11-12-upstream-033 (OpenAI / GPT-6 Astra Pro; self-reported)
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Diagnostics are observations, not inferred causes. Never retain error text,
// paths, URLs, module names or other values supplied in a tool response.
export function observeToolFailure(result) {
  const malformed = !Array.isArray(result?.content) || result.content.length !== 1 ||
    result.content[0]?.type !== 'text' || typeof result.content[0].text !== 'string';
  const text = malformed ? '' : result.content[0].text;
  const sample = text.slice(0, 16384);
  const patterns = {
    browser_launch: /Failed to launch (?:the )?(?:browser|chrome)|browser is already running/i,
    browser_sandbox: /No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace|SUID sandbox helper/i,
    browser_crashpad: /chrome_crashpad_handler|crashpad.*database/i,
    browser_missing: /Could not find Chrome|requires Chrome or Chromium|Browser was not found|Chrome executable.*not found/i,
    browser_protocol: /DevTools|Protocol error|Target closed|Session closed/i,
    module_load: /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i,
    native_library: /error while loading shared libraries|cannot open shared object|ERR_DLOPEN_FAILED|invalid ELF header/i,
    filesystem_denied: /EACCES|EPERM|EROFS|Access denied|read-only file system|outside.*allowed|not.*allowed director/i,
    filesystem_missing: /ENOENT|no such file or directory/i,
    network: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_CONNECTION_REFUSED|certificate.*(?:invalid|verify|expired)/i,
    timeout: /Timed out|TimeoutError|ETIMEDOUT/i,
  };
  const codes = ['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT',
    'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED', 'ERR_CONNECTION_REFUSED'];
  return { isError: result?.isError === true, malformed, textEncoding: 'utf-8',
    textBytes: Buffer.byteLength(text), textSha256: malformed ? null : sha256(text),
    inspectedCharacters: sample.length,
    inspectionTruncated: text.length > sample.length,
    signals: Object.entries(patterns).filter(([, pattern]) => pattern.test(sample)).map(([id]) => id),
    errorCodes: codes.filter(code => new RegExp('(?<![A-Z_])' + code + '(?![A-Z_])').test(sample)) };
}
// Both published packages intentionally remove internal structured search facts
// at the public MCP boundary. Parse only the known, bounded fixture wire format.
export function parseSearchProbe(result, { kind, root, sessionId, offset = 0, length = 2, requireComplete = false }) {
  if (result?.isError === true || !Array.isArray(result?.content) || result.content.length !== 1 ||
      result.content[0]?.type !== 'text' || typeof result.content[0].text !== 'string' ||
      Buffer.byteLength(result.content[0].text) > 65536) throw new Error('qualification_search_wire');
  const text = result.content[0].text.replaceAll('\r\n', '\n').trimEnd();
  const id = '(search_[1-9]\\d*_\\d{10,16})';
  const start = new RegExp('^Started content search session: ' + id + '\\nPattern: "MTERM_SEARCH_NEEDLE"\\nPath: ([^\\n]+)\\nStatus: (COMPLETED|RUNNING)\\nRuntime: \\d+ms\\nTotal results: (\\d+) (matches|match)\\n');
  const page = new RegExp('^Search session: ' + id + '\\nStatus: (COMPLETED|IN PROGRESS)\\nRuntime: \\d+s\\nTotal results: (\\d+) (matches|match)\\n');
  const header = kind === 'start' ? start.exec(text) : kind === 'page' ? page.exec(text) : null;
  if (!header) throw new Error('qualification_search_header');
  const actualId = header[1], status = header[kind === 'start' ? 3 : 2];
  const totalMatches = Number(header[kind === 'start' ? 4 : 3]);
  if (header[kind === 'start' ? 5 : 4] !== (totalMatches === 1 ? 'match' : 'matches')) throw new Error('qualification_search_count_grammar');
  if (totalMatches > 6 || (sessionId !== undefined && actualId !== sessionId) ||
      (kind === 'start' && !samePath(path.resolve(header[2]), path.resolve(root)))) throw new Error('qualification_search_identity');
  const isComplete = status === 'COMPLETED';
  if (requireComplete && !isComplete) throw new Error('qualification_search_not_complete');
  if (isComplete && !text.endsWith('✅ Search completed.')) throw new Error('qualification_search_not_clean');
  if (isComplete && totalMatches !== 6) throw new Error('qualification_search_completed_count');
  const rows = text.split('\n').filter(line => line.startsWith('📄 '));
  const markers = rows.map(line => {
    const row = /^📄 (.+):1 - MTERM_SEARCH_NEEDLE$/.exec(line);
    const index = row && /^match-([0-5])\.txt$/.exec(path.basename(row[1]));
    if (!row || !index || !samePath(path.resolve(row[1]), path.join(path.resolve(root), `match-${index[1]}.txt`))) {
      throw new Error('qualification_search_fixture_row');
    }
    return Number(index[1]);
  });
  if (new Set(markers).size !== markers.length || markers.length > totalMatches) throw new Error('qualification_search_duplicate_rows');
  let hasMoreResults = !isComplete || totalMatches > markers.length;
  if (kind === 'page') {
    const range = /^Showing results (\d+)-(\d+)$/m.exec(text);
    const more = /^📖 More results available\. Use get_more_search_results with offset: (\d+)$/m.exec(text);
    if (markers.length > length || offset + markers.length > totalMatches ||
        (markers.length > 0 && (!range || Number(range[1]) !== offset || Number(range[2]) !== offset + markers.length - 1)) ||
        (markers.length === 0 && range) || (more && Number(more[1]) !== offset + markers.length)) throw new Error('qualification_search_page_bounds');
    if (isComplete && markers.length !== Math.min(length, totalMatches - offset)) throw new Error('qualification_search_completed_page_count');
    hasMoreResults = !!more || !isComplete;
    if (isComplete && hasMoreResults !== (offset + markers.length < totalMatches)) throw new Error('qualification_search_more_marker');
  }
  return { sessionId: actualId, isComplete, outcome: isComplete ? 'completed' : 'running', totalMatches,
    totalResults: totalMatches, returnedCount: markers.length, hasMoreResults, markers };
}
export function isBlockedProbe(result, command, markerExists) {
  const text = result?.content?.[0]?.text;
  return markerExists === false && result?.isError === true && result.content?.length === 1 &&
    result.content[0].type === 'text' && typeof text === 'string' && Buffer.byteLength(text) <= 16384 &&
    (text === 'Error: Command not allowed: ' + command ||
      text === 'Error: Command not allowed: "mterm_qualification_blocked" is in the blockedCommands setting.');
}
export function isOwnedConfiguration(result, expected) {
  const config = result?.structuredContent?.config;
  return result?.isError !== true && config !== null && typeof config === 'object' && !Array.isArray(config) &&
    Object.entries(expected).every(([key, value]) => isDeepStrictEqual(config[key], value));
}
export function isBoundedProcessTail(result) {
  const text = (result?.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
  const markers = [...text.matchAll(/MTERM_PROCESS_LINE_(\d+)/g)].map(match => Number(match[1]));
  return result?.isError !== true && Buffer.byteLength(text) <= 8192 && isDeepStrictEqual(markers, [297, 298, 299]);
}
const fail = code => { throw new Error(code); };
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const contained = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
function lanePath(workspace, lane) {
  if (!['control', 'candidate'].includes(lane)) fail('qualification_lane');
  return path.join(workspace.root, lane);
}

// This is an accident-prevention guard, not a security sandbox or host attestation.
// Fresh GitHub-hosted accounts are required because upstream also uses os.userInfo().
export function validateQualificationHost(env = process.env, platform = process.platform, nodeVersion = process.versions.node) {
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      env.MTERM_DISPOSABLE_UPSTREAM_QUALIFICATION !== '1' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
      !['linux', 'win32'].includes(platform) || !/^24\./.test(nodeVersion) ||
      typeof env.RUNNER_TEMP !== 'string' || !path.isAbsolute(env.RUNNER_TEMP)) fail('qualification_host_required');
}

async function unlinked(target, boundary) {
  if (!contained(boundary, target)) fail('qualification_path_outside_workspace');
  let current = boundary;
  const components = path.relative(boundary, target).split(path.sep).filter(Boolean);
  for (const component of ['', ...components]) {
    if (component) current = path.join(current, component);
    if ((await fs.lstat(current)).isSymbolicLink()) fail('qualification_path_link');
  }
  if (!samePath(await fs.realpath(target), path.resolve(target))) fail('qualification_path_alias');
}

export async function createQualificationWorkspace({ runnerTemp, sourceRoot }) {
  const requested = path.resolve(runnerTemp);
  // Windows os.tmpdir() may use an ordinary 8.3 name (RUNNER~1). Resolve it
  // without treating it as a link; reject actual links/junctions at every level.
  let current = path.parse(requested).root;
  for (const segment of path.relative(current, requested).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) fail('qualification_root_link');
  }
  const parent = await fs.realpath(requested), source = await fs.realpath(path.resolve(sourceRoot));
  if (contained(parent, source) || contained(source, parent) ||
      !(await fs.stat(parent)).isDirectory()) fail('qualification_root_not_separate');
  const root = await fs.mkdtemp(path.join(parent, 'mterm-upstream-qualification-'));
  await fs.chmod(root, 0o700);
  const stat = await fs.lstat(root), nonce = randomUUID();
  const workspace = Object.freeze({ root, parent, dev: stat.dev, ino: stat.ino, nonce });
  await fs.writeFile(path.join(root, 'owner.json'), JSON.stringify({ schemaVersion: 1, nonce }), { flag: 'wx', mode: 0o600 });
  for (const lane of ['control', 'candidate']) for (const sub of ['install', 'home', 'state', 'fixtures', 'temp']) {
    await fs.mkdir(path.join(root, lane, sub), { recursive: true, mode: 0o700 });
  }
  await fs.mkdir(path.join(root, 'reports'), { mode: 0o700 });
  return workspace;
}

export async function assertOwnedWorkspace(workspace) {
  try {
    const stat = await fs.lstat(workspace.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== workspace.dev || stat.ino !== workspace.ino ||
        !samePath(await fs.realpath(workspace.root), workspace.root) ||
        !samePath(await fs.realpath(workspace.parent), workspace.parent) ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) fail('qualification_ownership');
    const marker = path.join(workspace.root, 'owner.json');
    if ((await fs.lstat(marker)).isSymbolicLink()) fail('qualification_ownership');
    const owner = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (owner.schemaVersion !== 1 || owner.nonce !== workspace.nonce) fail('qualification_ownership');
  } catch { fail('qualification_ownership'); }
}

export function qualificationEnvironment(workspace, lane, inherited, flagUrl) {
  const root = lanePath(workspace, lane), home = path.join(root, 'home');
  let flags;
  try { flags = new URL(flagUrl); } catch { fail('qualification_flags'); }
  if (flags.protocol !== 'http:' || flags.hostname !== '127.0.0.1' || !flags.port ||
      flags.username || flags.password || flags.search || flags.hash || flags.pathname !== '/flags') fail('qualification_flags');
  const env = {};
  const allowed = /^(?:path|systemroot|systemdrive|windir|comspec|pathext|programdata|programfiles|programw6432|programfiles\(x86\)|processor_architecture|lang|lc_all)$/i;
  for (const [key, value] of Object.entries(inherited)) if (allowed.test(key) && typeof value === 'string' && !value.startsWith('()')) env[key] = value;
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] ?? '');
  Object.assign(env, {
    HOME: home, USERPROFILE: home, HOMEDRIVE: path.parse(home).root.replace(/[\\/]$/, ''),
    HOMEPATH: home.slice(path.parse(home).root.length - (process.platform === 'win32' ? 1 : 0)),
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'), TEMP: path.join(root, 'temp'), TMP: path.join(root, 'temp'), TMPDIR: path.join(root, 'temp'),
    PUPPETEER_CACHE_DIR: path.join(home, '.cache', 'puppeteer'), PUPPETEER_SKIP_DOWNLOAD: 'true',
    DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', DC_FLAG_URL: flags.href,
    npm_config_userconfig: path.join(home, 'user.npmrc'), npm_config_globalconfig: path.join(home, 'global.npmrc'),
    npm_config_cache: path.join(home, 'npm-cache'), npm_config_prefix: path.join(home, 'npm-prefix'),
    npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
  });
  return env;
}

export async function admitInstalledUpstream(workspace, lane, expected) {
  await assertOwnedWorkspace(workspace);
  const install = path.join(lanePath(workspace, lane), 'install');
  const packageRoot = path.join(install, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  const entryPath = path.join(packageRoot, 'dist/index.js'), packagePath = path.join(packageRoot, 'package.json');
  for (const file of [path.join(install, 'package.json'), path.join(install, 'package-lock.json'), packagePath, entryPath]) await unlinked(file, workspace.root);
  const manifest = JSON.parse(await fs.readFile(path.join(install, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(install, 'package-lock.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  const pinned = lock.packages?.['node_modules/@wonderwhy-er/desktop-commander'];
  if (!['0.3.1', '0.3.3'].includes(expected.version) ||
      manifest.dependencies?.['@wonderwhy-er/desktop-commander'] !== expected.version || lock.lockfileVersion !== 3 ||
      lock.packages?.['']?.dependencies?.['@wonderwhy-er/desktop-commander'] !== expected.version ||
      pinned?.version !== expected.version || pinned.integrity !== expected.integrity ||
      pinned.resolved !== `https://registry.npmjs.org/@wonderwhy-er/desktop-commander/-/desktop-commander-${expected.version}.tgz` ||
      pkg.name !== '@wonderwhy-er/desktop-commander' || pkg.version !== expected.version ||
      pkg.bin?.['desktop-commander'] !== 'dist/index.js' || !(await fs.stat(entryPath)).isFile()) fail('qualification_package_mismatch');
  return { entryPath, packagePath, entrySha256: sha256(await fs.readFile(entryPath)),
    manifestSha256: sha256(await fs.readFile(packagePath)), lockSha256: sha256(await fs.readFile(path.join(install, 'package-lock.json'))) };
}

export function compareToolContracts(control, candidate) {
  function inventory(tools) {
    if (!Array.isArray(tools)) fail('qualification_inventory');
    const map = new Map();
    for (const tool of tools) {
      if (!tool || typeof tool.name !== 'string' || map.has(tool.name) || !tool.inputSchema) fail('qualification_inventory');
      map.set(tool.name, tool);
    }
    return map;
  }
  const a = inventory(control), b = inventory(candidate);
  const added = [...b.keys()].filter(name => !a.has(name)).sort(), removed = [...a.keys()].filter(name => !b.has(name)).sort();
  const contractChanges = [], descriptionChanges = [];
  for (const name of [...a.keys()].filter(name => b.has(name)).sort()) {
    const fields = ['inputSchema', 'annotations', 'outputSchema'].filter(key => !isDeepStrictEqual(a.get(name)[key], b.get(name)[key]));
    if (fields.length) contractChanges.push({ name, fields });
    if (a.get(name).description !== b.get(name).description) descriptionChanges.push(name);
  }
  return { added, removed, contractChanges, descriptionChanges,
    controlSha256: sha256(JSON.stringify([...a.values()].sort((x, y) => x.name.localeCompare(y.name)))),
    candidateSha256: sha256(JSON.stringify([...b.values()].sort((x, y) => x.name.localeCompare(y.name)))) };
}
