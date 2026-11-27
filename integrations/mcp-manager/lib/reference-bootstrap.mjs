import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { windowsPath } from './dev-runtime-plan.mjs';
import { WINDOWS_POWERSHELL } from './runtime-identity.mjs';
import { createProductionReferenceRegistration, createRegisteredProductionReferenceAuthority,
  inspectDevRuntimeWithReference } from './dev-runtime-reference.mjs';
import { createProductionReferenceClient } from './production-reference.mjs';
import { createReferenceExchange } from './reference-transport.mjs';

export const REFERENCE_SOURCE_FILES = Object.freeze([
  'package.json', 'inspect-dev-runtime.mjs', 'reference-server.mjs', 'manage-dev.ps1',
  'windows-reference.ps1', 'windows-reference-native.cs', 'windows-runtime-probe.ps1',
  'lib/reference-bootstrap.mjs', 'lib/reference-transport.mjs', 'lib/production-reference.mjs',
  'lib/dev-runtime-reference.mjs', 'lib/runtime-files.mjs', 'lib/runtime-identity.mjs',
  'lib/dev-runtime-plan.mjs', 'lib/dev-instance.mjs', 'lib/config.mjs', 'lib/token.mjs',
]);
const KEYS = ['schemaVersion', 'instanceId', 'generation', 'authoritySid', 'developmentSid',
  'registrationSha256', 'publicKeySpki', 'developmentConfigPath', 'planPath', 'nodePath', 'nodeSha256', 'sourceSha256'];
const bootstraps = new WeakMap();
const root = fileURLToPath(new URL('../', import.meta.url));
const helper = path.join(root, 'windows-reference.ps1');
const fail = (code = 'runtime_reference_bootstrap_invalid') => { throw new Error(code); };
const text = (value, pattern) => typeof value === 'string' && !/[^\x21-\x7e]/.test(value) && pattern.test(value);
const hex = value => text(value, /^[a-f0-9]{64}$/);
function record(value, keys, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (keys.some(key => !Object.hasOwn(descriptors, key)) || actual.some(key => typeof key !== 'string' ||
      ![...keys, ...optional].includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail();
  const result = Object.create(null);
  for (const key of actual) result[key] = descriptors[key].value;
  return result;
}
function sid(value) {
  return text(value, /^S-1-5-21-(?:0|[1-9]\d{0,9})-(?:0|[1-9]\d{0,9})-(?:0|[1-9]\d{0,9})-(?:0|[1-9]\d{0,9})$/) &&
    value.split('-').slice(4).every(part => Number(part) <= 4294967295);
}
function publicKey(value) {
  if (!text(value, /^[A-Za-z0-9_-]+$/) || value.length > 128) fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) fail();
  const key = createPublicKey({ key: bytes, type: 'spki', format: 'der' });
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519' ||
      !key.export({ type: 'spki', format: 'der' }).equals(bytes)) fail();
  return key;
}

/** Portable declarations only: this returns no protected-bootstrap capability. */
export function validateReferenceTrust(input) {
  try {
    const value = record(input, KEYS), sources = record(value.sourceSha256, REFERENCE_SOURCE_FILES);
    if (value.schemaVersion !== 1 || !text(value.instanceId, /^dev(?:-[a-z0-9]+)*$/) || value.instanceId.length > 48 ||
        !Number.isSafeInteger(value.generation) || value.generation < 1 || !sid(value.authoritySid) ||
        !sid(value.developmentSid) || value.authoritySid === value.developmentSid ||
        !hex(value.registrationSha256) || !hex(value.nodeSha256)) fail();
    publicKey(value.publicKeySpki);
    for (const name of ['developmentConfigPath', 'planPath', 'nodePath']) windowsPath(value[name]);
    const sourceSha256 = {};
    for (const name of REFERENCE_SOURCE_FILES) {
      if (!hex(sources[name])) fail();
      sourceSha256[name] = sources[name];
    }
    const result = {};
    for (const name of KEYS) result[name] = name === 'sourceSha256' ? Object.freeze(sourceSha256) : value[name];
    return Object.freeze(result);
  } catch { fail(); }
}

function supported() {
  if (process.platform !== 'win32') fail('dev_runtime_platform_unsupported');
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) fail('node_preload_environment_rejected');
}

// Constant bootstrap code is passed directly to the fixed Windows PowerShell,
// rather than trusting an editable helper to approve its own source. It checks
// replacement/control rights on ancestors and content rights on selected files
// before loading any on-disk PowerShell or C# helper. The native helper repeats
// these checks against held handles, exact source hashes and link identities.
const PRELUDE = String.raw`
$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
function Assert-ReferenceSource([string]$File) {
    $target = [IO.Path]::GetFullPath($File)
    if ($target -notmatch '^[A-Za-z]:[\\/]' -or [IO.DriveInfo]::new([IO.Path]::GetPathRoot($target)).DriveType -ne [IO.DriveType]::Fixed) { throw 'runtime_reference_bootstrap_untrusted' }
    $paths = [Collections.Generic.List[string]]::new()
    $walk = $target
    while ($walk) {
        $paths.Add($walk)
        $parent = [IO.Path]::GetDirectoryName($walk)
        if ($parent -eq $walk) { break }
        $walk = $parent
    }
    foreach ($name in $paths) {
        $attributes = [IO.File]::GetAttributes($name)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'runtime_reference_bootstrap_untrusted' }
        $acl = if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
            [IO.Directory]::GetAccessControl($name)
        } else { [IO.File]::GetAccessControl($name) }
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        $system = ($name -eq [IO.Path]::GetPathRoot($name)) -or $name.StartsWith('C:\Windows\', [StringComparison]::OrdinalIgnoreCase) -or $name -eq 'C:\Windows' -or $name.StartsWith('C:\Program Files\', [StringComparison]::OrdinalIgnoreCase) -or $name -eq 'C:\Program Files' -or $name.StartsWith('C:\Program Files (x86)\', [StringComparison]::OrdinalIgnoreCase) -or $name -eq 'C:\Program Files (x86)'
        $allowed = @('S-1-5-18','S-1-5-32-544')
        if ($system) { $allowed += 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464' }
        if ($owner -notin $allowed) { throw 'runtime_reference_bootstrap_untrusted' }
        $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
        if ($null -eq $raw.DiscretionaryAcl) { throw 'runtime_reference_bootstrap_untrusted' }
        $danger = if ($name -eq $target) { 0x500D0116 } else { 0x500D0140 }
        foreach ($ace in $raw.DiscretionaryAcl) {
            if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback) { throw 'runtime_reference_bootstrap_untrusted' }
            if (($ace.AceFlags -band [Security.AccessControl.AceFlags]::InheritOnly) -ne 0) { continue }
            if ($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
                $ace.SecurityIdentifier.Value -notin $allowed -and ($ace.AccessMask -band $danger) -ne 0) {
                throw 'runtime_reference_bootstrap_untrusted'
            }
        }
    }
}
function Get-ReferenceBytes([string]$File, [int]$Maximum) {
    $stream = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -lt 0 -or $stream.Length -gt $Maximum) { throw 'runtime_reference_bootstrap_untrusted' }
        $buffer = [byte[]]::new($Maximum + 1)
        $total = 0
        while ($total -lt $buffer.Length) {
            $read = $stream.Read($buffer, $total, $buffer.Length - $total)
            if ($read -eq 0) { break }
            $total += $read
        }
        if ($total -gt $Maximum -or $total -ne $stream.Length) { throw 'runtime_reference_bootstrap_untrusted' }
        $result = [byte[]]::new($total)
        [Buffer]::BlockCopy($buffer, 0, $result, 0, $total)
        return ,$result
    } finally { $stream.Dispose() }
}
function Get-ReferenceHash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

`;
function helperArguments(mode, role) {
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const trustFile = path.join(root, 'reference-bootstrap', 'trust.json');
  const nativeFile = path.join(root, 'windows-reference-native.cs');
  const invocation = `${PRELUDE}\ntry { Assert-ReferenceSource ${quote(helper)}; Assert-ReferenceSource ${quote(nativeFile)}; Assert-ReferenceSource ${quote(trustFile)}; ` +
    `$trustBytes=(Get-ReferenceBytes ${quote(trustFile)} 32768); if($trustBytes.Length -gt 32768){throw 'runtime_reference_bootstrap_untrusted'}; ` +
    `$pins=([Text.UTF8Encoding]::new($false,$true).GetString($trustBytes) | ConvertFrom-Json).sourceSha256; ` +
    `foreach($pair in @(@(${quote(helper)},'windows-reference.ps1'),@(${quote(nativeFile)},'windows-reference-native.cs'))){ ` +
    `$bytes=(Get-ReferenceBytes $pair[0] 1048576); if($bytes.Length -gt 1048576 -or (Get-ReferenceHash $bytes) -cne [string]$pins.($pair[1])){throw 'runtime_reference_bootstrap_untrusted'} }; ` +
    `& ${quote(helper)} -Mode ${mode}${role ? ' -Role ' + role : ''}; exit $LASTEXITCODE } catch { [Console]::Error.WriteLine('runtime_reference_bootstrap_untrusted'); exit 1 }`;
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(invocation, 'utf16le').toString('base64')];
}
function nativeBootstrap(role) {
  return new Promise((resolve, reject) => {
    const child = execFile(WINDOWS_POWERSHELL, helperArguments('Bootstrap', role === 'authority' ? 'Authority' : 'Client'), {
      windowsHide: true, encoding: 'utf8', timeout: 25000, maxBuffer: 196608,
    }, (error, stdout, stderr) => {
      try {
        if (error || stderr.trim() || Buffer.byteLength(stdout) > 196608) throw new Error();
        resolve(JSON.parse(stdout.replace(/^\uFEFF/, '')));
      } catch { reject(new Error('runtime_reference_bootstrap_untrusted')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end();
  });
}

export async function loadReferenceBootstrap(role) {
  supported();
  try {
    if (!['authority', 'client'].includes(role)) fail();
    const observed = await nativeBootstrap(role);
    if (!observed || observed.schemaVersion !== 1 || typeof observed.trust !== 'string' ||
        Buffer.byteLength(observed.trust) > 32768 || !hex(observed.snapshotSha256)) fail();
    const trust = validateReferenceTrust(JSON.parse(observed.trust));
    if (JSON.stringify(trust) !== observed.trust || windowsPath(process.execPath) !== windowsPath(observed.nodePath) ||
        observed.sid !== (role === 'authority' ? trust.authoritySid : trust.developmentSid) ||
        (role === 'client' && (observed.standardUser !== true || observed.administratorGroup !== false || observed.elevated !== false))) fail();
    let registration, privateKey;
    if (role === 'authority') {
      if (typeof observed.registration !== 'string' || Buffer.byteLength(observed.registration) > 65536 ||
          typeof observed.privateKey !== 'string' || observed.privateKey.length > 5500) fail();
      const declared = JSON.parse(observed.registration);
      registration = createProductionReferenceRegistration(declared);
      if (registration.sha256 !== trust.registrationSha256 || registration.instanceId !== trust.instanceId ||
          declared.generation !== trust.generation || declared.plan.production.principalSid !== trust.authoritySid ||
          declared.plan.development.principalSid !== trust.developmentSid ||
          windowsPath(declared.developmentConfigPath) !== windowsPath(trust.developmentConfigPath) ||
          windowsPath(declared.planPath) !== windowsPath(trust.planPath) ||
          windowsPath(declared.plan.development.manager.nodePath) !== windowsPath(trust.nodePath)) fail();
      const bytes = Buffer.from(observed.privateKey, 'base64');
      if (bytes.toString('base64') !== observed.privateKey) fail();
      privateKey = createPrivateKey({ key: bytes, type: 'pkcs8', format: 'der' });
      if (privateKey.asymmetricKeyType !== 'ed25519' || !privateKey.export({ type: 'pkcs8', format: 'der' }).equals(bytes) ||
          createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64url') !== trust.publicKeySpki) fail();
      bytes.fill(0);
    } else if (observed.registration !== null || observed.privateKey !== null) fail();
    const handle = Object.freeze({ instanceId: trust.instanceId, registrationSha256: trust.registrationSha256 });
    bootstraps.set(handle, { role, trust, registration, privateKey, snapshotSha256: observed.snapshotSha256, authority: null });
    return handle;
  } catch { fail('runtime_reference_bootstrap_untrusted'); }
}

// Internal cross-module capability check: it exposes neither keys nor targets.
export function assertReferenceBootstrap(handle, role) {
  if (bootstraps.get(handle)?.role !== role) fail('runtime_reference_bootstrap_untrusted');
}
// The only native transport selectors are fixed by the branded bootstrap role.
export function startReferenceTransportHelper(handle, mode) {
  const role = mode === 'Server' ? 'authority' : mode === 'Exchange' ? 'client' : null;
  assertReferenceBootstrap(handle, role);
  supported();
  const child = spawn(WINDOWS_POWERSHELL, helperArguments(mode), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return { child, snapshotSha256: bootstraps.get(handle).snapshotSha256 };
}
export function createBootstrappedReferenceAuthority(handle) {
  assertReferenceBootstrap(handle, 'authority');
  const state = bootstraps.get(handle);
  if (!state.authority) state.authority = createRegisteredProductionReferenceAuthority(state.registration, state.privateKey);
  return state.authority;
}
export async function inspectRegisteredDevRuntime(options = {}) {
  supported();
  try {
    const selected = record(options, [], ['configPath', 'planPath']);
    const handle = await loadReferenceBootstrap('client'), state = bootstraps.get(handle);
    for (const [option, field] of [['configPath', 'developmentConfigPath'], ['planPath', 'planPath']]) {
      if (selected[option] !== undefined && windowsPath(selected[option]) !== windowsPath(state.trust[field])) fail();
    }
    const client = createProductionReferenceClient({ publicKey: publicKey(state.trust.publicKeySpki),
      registrationSha256: state.trust.registrationSha256, instanceId: state.trust.instanceId });
    return await inspectDevRuntimeWithReference(state.trust.developmentConfigPath, state.trust.planPath,
      client, createReferenceExchange(handle));
  } catch { fail('runtime_reference_bootstrap_untrusted'); }
}
