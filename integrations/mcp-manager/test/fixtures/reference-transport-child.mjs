// Disposable hosted qualification helper, never a product entry point.
// Its private stdin/stdout is consumed by the owned PowerShell orchestrator;
// only the orchestrator's filtered decision report reaches the test log.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { syncBuiltinESMExports } from 'node:module';
import childProcess, { execFile } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const code = error => {
  try {
    const value = Object.getOwnPropertyDescriptor(error, 'message')?.value;
    if (typeof value === 'string' && /^[a-z_]{1,80}$/.test(value)) return value;
  } catch { /* Private fixture errors must not become public diagnostics. */ }
  return 'fixture_child_failed';
};
const systemError = error => {
  const own = (value, key) => {
    try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
    catch { return undefined; }
  };
  const rawCode = own(error, 'code'), info = own(error, 'info');
  const rawErrno = own(error, 'errno') ?? own(info, 'errno');
  const rawSyscall = own(error, 'syscall') ?? own(info, 'syscall');
  const allowedCodes = ['EACCES', 'EPERM', 'ENOENT', 'ENOMEM', 'EAGAIN', 'EINVAL', 'ENOTDIR', 'ETIMEDOUT',
    'EPIPE', 'EBADF', 'EEXIST', 'ENOBUFS', 'ERR_SYSTEM_ERROR', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ABORT_ERR'];
  const allowedSyscalls = ['uv_os_get_passwd', 'mkdir', 'open', 'read', 'stat', 'lstat', 'realpath', 'write', 'spawn', 'spawnSync'];
  return {
    code: Number.isSafeInteger(rawCode) && Math.abs(rawCode) <= 2147483648 ? rawCode : allowedCodes.includes(rawCode) ? rawCode : null,
    errno: Number.isSafeInteger(rawErrno) && Math.abs(rawErrno) <= 2147483648 ? rawErrno : null,
    syscall: allowedSyscalls.includes(rawSyscall) ? rawSyscall : null,
  };
};
let identityDiagnostic = null;
const probeTraceMarker = 'MTERM_PROBE_DIAGNOSTIC ';
// Pure deterministic instrumentation of the fixed copied probe, used only
// after a primary identity-capture failure. This is never an acceptance probe.
function buildFailureProbe(source) {
  let derived = source.replace(/\r\n/g, '\n');
  const anchors = [];
  const splice = (name, anchor, replacement) => {
    if (derived.split(anchor).length !== 2) throw new Error('fixture_probe_diagnostic_anchor_invalid');
    derived = derived.replace(anchor, replacement); anchors.push(name);
  };
  splice('compile_begin', "    Add-Type -TypeDefinition @'", "    Write-FixtureProbeStage 20\n    Add-Type -TypeDefinition @'");
  splice('native_clock', '  public sealed class ProcessSnapshot : IDisposable {', `  public sealed class ProcessSnapshot : IDisposable {
    public static long DiagnosticStarted;
    static void Diagnostic(int stage) {
      long elapsed = Math.Min(600000L, Math.Max(0L, (System.Diagnostics.Stopwatch.GetTimestamp() - DiagnosticStarted) * 1000L / System.Diagnostics.Stopwatch.Frequency));
      Console.Error.WriteLine("MTERM_PROBE_DIAGNOSTIC " + stage.ToString(System.Globalization.CultureInfo.InvariantCulture) + " " + elapsed.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }`);
  splice('compile_end', "'@ | Out-Null\n}", "'@ | Out-Null\n    [MTechLabs.DevRuntime.ProcessSnapshot]::DiagnosticStarted = $script:fixtureProbeStarted\n    Write-FixtureProbeStage 21\n}");
  splice('constructor', '    public ProcessSnapshot(int pid) {\n      try {', '    public ProcessSnapshot(int pid) {\n      Diagnostic(30);\n      try {');
  splice('open_process', '        process = OpenProcess(0x00101000, false, pid);', '        Diagnostic(31);\n        process = OpenProcess(0x00101000, false, pid);\n        Diagnostic(32);');
  splice('alive', '        if (process == IntPtr.Zero || !Alive) throw new Exception("process_unavailable");',
    '        Diagnostic(33);\n        if (process == IntPtr.Zero || !Alive) throw new Exception("process_unavailable");\n        Diagnostic(34);');
  splice('image', '        if (!QueryFullProcessImageNameW(process, 0, image, ref length)) throw new Exception("image_unavailable");',
    '        Diagnostic(35);\n        if (!QueryFullProcessImageNameW(process, 0, image, ref length)) throw new Exception("image_unavailable");\n        Diagnostic(36);');
  splice('times', '        if (!GetProcessTimes(process, out created, out exited, out kernel, out user)) throw new Exception("time_unavailable");',
    '        Diagnostic(37);\n        if (!GetProcessTimes(process, out created, out exited, out kernel, out user)) throw new Exception("time_unavailable");\n        Diagnostic(38);');
  splice('token', '        if (!OpenProcessToken(process, 8, out token)) throw new Exception("token_unavailable");',
    '        Diagnostic(39);\n        if (!OpenProcessToken(process, 8, out token)) throw new Exception("token_unavailable");\n        Diagnostic(40);');
  splice('sid', '        using (var identity = new WindowsIdentity(token)) { Sid = identity.User.Value; }',
    '        Diagnostic(41);\n        using (var identity = new WindowsIdentity(token)) { Sid = identity.User.Value; }\n        Diagnostic(42);');
  splice('profile', '        if (!GetUserProfileDirectoryW(token, profile, ref length)) throw new Exception("profile_unavailable");',
    '        Diagnostic(43);\n        if (!GetUserProfileDirectoryW(token, profile, ref length)) throw new Exception("profile_unavailable");\n        Diagnostic(44);');
  splice('constructor_end', '        if (!Alive) throw new Exception("process_exited");',
    '        if (!Alive) throw new Exception("process_exited");\n        Diagnostic(45);');
  splice('constructor_rejection', '      } catch { Dispose(); throw; }', '      } catch { Diagnostic(48); Dispose(); Diagnostic(49); throw; }');
  splice('dispose_begin', '    public void Dispose() {', '    public void Dispose() {\n      Diagnostic(46);');
  splice('dispose_end', '      if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }',
    '      if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }\n      Diagnostic(47);');
  splice('own_cim', '        $self = Get-RuntimeProcess $PID', '        Write-FixtureProbeStage 10\n        $self = Get-RuntimeProcess $PID\n        Write-FixtureProbeStage 11');
  splice('parent_cim', '        $parent = Get-RuntimeProcess $ParentId', '        Write-FixtureProbeStage 12\n        $parent = Get-RuntimeProcess $ParentId\n        Write-FixtureProbeStage 13');
  splice('cim_command', '    $rows = @(Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop)',
    '    Write-FixtureProbeStage 16\n    $rows = @(Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop)\n    Write-FixtureProbeStage 17');
  splice('snapshot', '        $snapshot = Get-RuntimeNativeSnapshot $ParentId', '        Write-FixtureProbeStage 14\n        $snapshot = Get-RuntimeNativeSnapshot $ParentId\n        Write-FixtureProbeStage 15\n        Write-FixtureProbeStage 50');
  splice('validation_end', "        return @{ status = 'observed'; pid = $ParentId; sid = $snapshot.Sid; profileDirectory = $snapshot.Profile;", "        Write-FixtureProbeStage 51\n        return @{ status = 'observed'; pid = $ParentId; sid = $snapshot.Sid; profileDirectory = $snapshot.Profile;");
  const currentStart = derived.indexOf('function Get-RuntimeCurrentObservation {');
  const currentEnd = derived.indexOf('\n\ntry {', currentStart);
  if (currentStart < 0 || currentEnd <= currentStart) throw new Error('fixture_probe_diagnostic_anchor_invalid');
  const current = derived.slice(currentStart, currentEnd);
  const catchAnchor = "    } catch { return @{ status = 'unverified' } }";
  const finallyAnchor = '    finally { if ($null -ne $snapshot) { $snapshot.Dispose() } }';
  if (current.split(catchAnchor).length !== 2 || current.split(finallyAnchor).length !== 2) throw new Error('fixture_probe_diagnostic_anchor_invalid');
  splice('current_rejection_and_cleanup', current, current.replace(catchAnchor, "    } catch { Write-FixtureProbeStage 56; return @{ status = 'unverified' } }")
    .replace(finallyAnchor, '    finally { Write-FixtureProbeStage 57; if ($null -ne $snapshot) { $snapshot.Dispose() }; Write-FixtureProbeStage 58 }'));
  splice('input_encoding_initialization', '    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)',
    '    Write-FixtureProbeStage 70\n    $fixtureProbeInputEncoding = [System.Text.UTF8Encoding]::new($false, $true)\n    Write-FixtureProbeStage 71\n    Write-FixtureProbeStage 72\n    [Console]::InputEncoding = $fixtureProbeInputEncoding\n    Write-FixtureProbeStage 73');
  splice('output_encoding_initialization', '    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '    Write-FixtureProbeStage 74\n    $fixtureProbeOutputEncoding = [System.Text.UTF8Encoding]::new($false)\n    Write-FixtureProbeStage 75\n    Write-FixtureProbeStage 76\n    [Console]::OutputEncoding = $fixtureProbeOutputEncoding\n    Write-FixtureProbeStage 77');
  splice('buffer_initialization', '    $buffer = [char[]]::new(16385)',
    '    Write-FixtureProbeStage 78\n    $buffer = [char[]]::new(16385)\n    Write-FixtureProbeStage 79');
  splice('utility_bootstrap_control', '    Write-FixtureProbeStage 78\n    $buffer = [char[]]::new(16385)',
    `    Write-FixtureProbeStage 82
    $fixtureProbeTypedBuffer = [char[]]::new(16385)
    if ($fixtureProbeTypedBuffer -isnot [char[]] -or $fixtureProbeTypedBuffer.Length -ne 16385 -or
        [int]($fixtureProbeTypedBuffer[0]) -ne 0 -or [int]($fixtureProbeTypedBuffer[16384]) -ne 0) {
        throw 'fixture_probe_diagnostic_array_control_failed'
    }
    $fixtureProbeTypedBuffer = $null
    Write-FixtureProbeStage 83
    Write-FixtureProbeStage 84
    Microsoft.PowerShell.Core\\Import-Module -Name 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
    Write-FixtureProbeStage 85
    Write-FixtureProbeStage 78
    $buffer = [char[]]::new(16385)`);
  splice('length_initialization', '    $length = 0',
    '    Write-FixtureProbeStage 80\n    $length = 0\n    Write-FixtureProbeStage 81');
  splice('stdin_begin', '    while ($length -lt $buffer.Length) {', '    Write-FixtureProbeStage 2\n    while ($length -lt $buffer.Length) {');
  splice('stdin_read', '        $read = [Console]::In.Read($buffer, $length, $buffer.Length - $length)',
    '        Write-FixtureProbeStage 7\n        $read = [Console]::In.Read($buffer, $length, $buffer.Length - $length)\n        Write-FixtureProbeStage 8');
  splice('stdin_end', "    if ($length -gt 16384) { throw 'input_too_large' }", "    Write-FixtureProbeStage 3\n    if ($length -gt 16384) { throw 'input_too_large' }");
  splice('parse', '    $inputData = $raw | ConvertFrom-Json', '    Write-FixtureProbeStage 4\n    $inputData = $raw | ConvertFrom-Json\n    Write-FixtureProbeStage 5');
  splice('output', '    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress))',
    '    Write-FixtureProbeStage 60\n    $fixtureProbeSerialized = $result | ConvertTo-Json -Depth 5 -Compress\n    Write-FixtureProbeStage 61\n    Write-FixtureProbeStage 62\n    [Console]::Out.WriteLine($fixtureProbeSerialized)\n    Write-FixtureProbeStage 63');
  splice('outer_error', "    [Console]::Error.WriteLine('runtime_observation_failed')", "    Write-FixtureProbeStage 64\n    [Console]::Error.WriteLine('runtime_observation_failed')");
  const prefix = `$script:fixtureProbeStarted = [Diagnostics.Stopwatch]::GetTimestamp()
function Write-FixtureProbeStage([int]$StageId) {
    $elapsed = [long](([Diagnostics.Stopwatch]::GetTimestamp() - $script:fixtureProbeStarted) * 1000 / [Diagnostics.Stopwatch]::Frequency)
    $elapsed = [Math]::Min(600000, [Math]::Max(0, $elapsed))
    [Console]::Error.WriteLine('MTERM_PROBE_DIAGNOSTIC ' + $StageId.ToString([Globalization.CultureInfo]::InvariantCulture) + ' ' + $elapsed.ToString([Globalization.CultureInfo]::InvariantCulture))
}
Write-FixtureProbeStage 1
`;
  return { source: prefix + derived, anchors };
}
function observeStdin(child) {
  const observation = { finished: false, closed: false, errored: false, systemError: { code: null, errno: null, syscall: null } };
  child.stdin.once('finish', () => { observation.finished = true; });
  child.stdin.once('close', () => { observation.closed = true; });
  child.stdin.once('error', error => { observation.errored = true; observation.systemError = systemError(error); });
  return observation;
}
async function failureProbeDiagnostic(originalExecFile) {
  const record = { kind: 'failure-only-instrumented-probe', acceptanceEvidence: false, invocations: 0,
    deadlineMilliseconds: 15000, rolesEmpty: true, sameNodeParent: true,
    originalSourceSha256: null, normalizedSourceSha256: null, derivativeSourceSha256: null,
    sourceNormalization: 'CRLF-to-LF', originalSourceAfterSha256: null, originalSourceUnchanged: false,
    anchorCount: 0, anchorsMatched: false, stages: [], malformedTrace: false, traceOverflow: false,
    otherStderrLines: 0, outcome: null, stdin: null, temporaryFileCreated: false, temporaryFileRemoved: false, failureCode: null };
  let filename, created = false;
  try {
    const original = await fs.readFile(path.join(root, 'windows-runtime-probe.ps1'));
    if (original.length > 1048576) throw new Error('fixture_probe_diagnostic_source_limit');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(original);
    record.originalSourceSha256 = hash(original); record.normalizedSourceSha256 = hash(text.replace(/\r\n/g, '\n'));
    if (record.normalizedSourceSha256 !== '650e96e36ed0c6cc95139f5422fce1840f66b5308a16a0cf7442cc7da8d26322') {
      throw new Error('fixture_probe_diagnostic_source_mismatch');
    }
    const derivative = buildFailureProbe(text);
    record.derivativeSourceSha256 = hash(derivative.source); record.anchorCount = derivative.anchors.length; record.anchorsMatched = true;
    if (record.anchorCount !== 32 || record.derivativeSourceSha256 !== '19960fe28dbb8ab9c6138cd4de3662e6a1ba48e955766608d6e7f020b760affe') {
      throw new Error('fixture_probe_diagnostic_derivative_mismatch');
    }
    filename = path.join(process.cwd(), 'reference-probe-diagnostic-' + randomBytes(12).toString('hex') + '.ps1');
    await fs.writeFile(filename, derivative.source, { flag: 'wx' });
    created = true; record.temporaryFileCreated = true;
    if (hash(await fs.readFile(filename)) !== record.derivativeSourceSha256) throw new Error('fixture_probe_diagnostic_copy_mismatch');
    const started = performance.now();
    await new Promise(resolve => {
      record.invocations = 1;
      const child = originalExecFile('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', filename], {
          windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 32768,
          env: { ...process.env, PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' },
        }, (error, stdout, stderr) => {
          const output = String(stdout ?? '').replace(/\r\n/g, '\n');
          const diagnostic = String(stderr ?? '').replace(/\r\n/g, '\n');
          let signal = null, killed = false;
          try {
            const observedSignal = Object.getOwnPropertyDescriptor(error, 'signal')?.value;
            if (typeof observedSignal === 'string' && /^SIG[A-Z]{1,12}$/.test(observedSignal)) signal = observedSignal;
            killed = Object.getOwnPropertyDescriptor(error, 'killed')?.value === true;
          } catch { /* No raw error values are exposed. */ }
          record.outcome = { failed: Boolean(error), systemError: systemError(error), signal, killed,
            elapsedMilliseconds: Math.min(600000, Math.max(0, Math.floor(performance.now() - started))),
            stdoutDecodedBytes: Buffer.byteLength(output), stdoutDecodedSha256: hash(output),
            stderrDecodedBytes: Buffer.byteLength(diagnostic), stderrDecodedSha256: hash(diagnostic) };
          for (const line of diagnostic.split('\n').filter(Boolean)) {
            if (!line.startsWith(probeTraceMarker)) { record.otherStderrLines = Math.min(1024, record.otherStderrLines + 1); continue; }
            const match = /^MTERM_PROBE_DIAGNOSTIC ([0-9]{1,2}) ([0-9]{1,6})$/.exec(line);
            if (!match || ![1,2,3,4,5,7,8,10,11,12,13,14,15,16,17,20,21,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,56,57,58,60,61,62,63,64,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85].includes(Number(match?.[1])) || Number(match?.[2]) > 600000) {
              record.malformedTrace = true; continue;
            }
            if (record.stages.length >= 128) { record.traceOverflow = true; continue; }
            record.stages.push({ id: Number(match[1]), elapsedMilliseconds: Number(match[2]) });
          }
          resolve();
        });
      record.stdin = observeStdin(child);
      child.stdin.end(JSON.stringify({ currentProcessId: process.pid, currentImage: process.execPath }));
    });
  } catch (error) { record.failureCode = code(error); }
  finally {
    if (created) {
      try { await fs.unlink(filename); record.temporaryFileRemoved = true; }
      catch { record.failureCode ??= 'fixture_probe_diagnostic_cleanup_failed'; }
    }
    try {
      record.originalSourceAfterSha256 = hash(await fs.readFile(path.join(root, 'windows-runtime-probe.ps1')));
      record.originalSourceUnchanged = record.originalSourceAfterSha256 === record.originalSourceSha256;
    } catch { record.failureCode ??= 'fixture_probe_diagnostic_source_readback_failed'; }
  }
  return record;
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const input = lines[Symbol.asyncIterator]();
const canonical = value => path.win32.resolve(value).toLowerCase();
const within = (directory, filename) => {
  const relative = path.win32.relative(canonical(directory), canonical(filename));
  return relative === '' || (!path.win32.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'));
};
async function requestText(handle, mode = 'ordinary') {
  const { productionControlCommitment } = await import('../../lib/production-reference.mjs');
  const nonce = randomBytes(32).toString('base64url'), issuedAt = Date.now();
  return JSON.stringify({ schemaVersion: 1, purpose: 'mterm-dev-production-reference',
    registrationSha256: handle.registrationSha256, instanceId: handle.instanceId, nonce,
    issuedAt, expiresAt: issuedAt + 30000, configSha256: hash('fixture-' + mode),
    planSha256: hash('transport mechanism plan v1'),
    controlsSha256: productionControlCommitment(nonce, hash('transport mechanism private snapshot v1')) });
}
function disposable() {
  if (process.platform !== 'win32' || process.env.MTERM_DISPOSABLE_REFERENCE_QUALIFICATION !== '1' ||
      process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      process.env.RUNNER_OS !== 'Windows') throw new Error('fixture_disposable_host_required');
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('fixture_preload_rejected');
}
async function firstInput() {
  const item = await input.next();
  if (item.done || Buffer.byteLength(item.value) > 65536) throw new Error('fixture_input_invalid');
  return JSON.parse(item.value);
}
async function timeout(promise, ms = 40000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('fixture_operation_timeout')), ms);
  })]); } finally { clearTimeout(timer); }
}
async function identity() {
  identityDiagnostic = { phase: 'load_native_capture', nativeStatus: null, pidMatched: null,
    profileMatched: null, administratorProbeCompleted: false, administrator: null,
    nativeInvocations: [], nativeInvocationOverflow: false, failureProbeDiagnostic: null };
  const originalExecFile = childProcess.execFile;
  // Observe the callbacks of the existing invocations only. No arguments,
  // environment, limits, result, retry or additional probe is introduced.
  childProcess.execFile = function (filename, args, options, callback) {
    const started = performance.now(), phase = identityDiagnostic.phase;
    let stdin;
    const child = originalExecFile(filename, args, options, (error, stdout, stderr) => {
      if (identityDiagnostic.nativeInvocations.length < 4) {
        const output = String(stdout ?? '').replace(/\r\n/g, '\n');
        const diagnostic = String(stderr ?? '').replace(/\r\n/g, '\n');
        let signal = null, killed = false;
        try {
          const observedSignal = Object.getOwnPropertyDescriptor(error, 'signal')?.value;
          if (typeof observedSignal === 'string' && /^SIG[A-Z]{1,12}$/.test(observedSignal)) signal = observedSignal;
          killed = Object.getOwnPropertyDescriptor(error, 'killed')?.value === true;
        } catch { /* Null or hostile throwable metadata stays unobserved. */ }
        identityDiagnostic.nativeInvocations.push({ phase, failed: Boolean(error), systemError: systemError(error), signal, killed, stdin,
          elapsedMilliseconds: Math.min(600000, Math.max(0, Math.floor(performance.now() - started))),
          stdoutDecodedBytes: Buffer.byteLength(output), stdoutDecodedSha256: hash(output),
          stderrDecodedBytes: Buffer.byteLength(diagnostic), stderrDecodedSha256: hash(diagnostic) });
      } else identityDiagnostic.nativeInvocationOverflow = true;
      callback(error, stdout, stderr);
    });
    stdin = observeStdin(child);
    return child;
  };
  syncBuiltinESMExports();
  try {
    const { captureWindowsRuntime, WINDOWS_POWERSHELL } = await import('../../lib/runtime-identity.mjs');
    identityDiagnostic.phase = 'native_capture';
    const report = await captureWindowsRuntime();
    identityDiagnostic.nativeStatus = ['observed', 'unverified'].includes(report.current?.status) ? report.current.status : 'unexpected';
    identityDiagnostic.phase = 'administrator_check';
    const admin = await new Promise((resolve, reject) => execFile(WINDOWS_POWERSHELL,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        '$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());[Console]::Out.Write($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator).ToString().ToLowerInvariant())'],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => {
        if (error || stderr || !['true', 'false'].includes(stdout)) reject(new Error('fixture_identity_unavailable'));
        else resolve(stdout === 'true');
      }));
    identityDiagnostic.administratorProbeCompleted = true; identityDiagnostic.administrator = admin;
    identityDiagnostic.phase = 'compare_identity';
    if (report.current?.status === 'observed') {
      identityDiagnostic.pidMatched = report.current.pid === process.pid;
      if (identityDiagnostic.pidMatched) {
        identityDiagnostic.profileMatched = canonical(report.current.profileDirectory) === canonical(os.userInfo().homedir);
      }
    }
    if (report.current?.status !== 'observed' || !identityDiagnostic.pidMatched || !identityDiagnostic.profileMatched) {
      throw new Error('fixture_identity_unavailable');
    }
    identityDiagnostic.phase = 'complete';
    return { sid: report.current.sid, profile: report.current.profileDirectory, pid: process.pid,
      isAdministrator: admin, realCurrentProcessMatched: true, osProfileMatchesNative: true };
  } catch (error) {
    // Preserve the primary failure and its original nativeInvocations. The
    // derivative is a separate, non-acceptance observation at a later time.
    if (identityDiagnostic.phase === 'native_capture' && identityDiagnostic.nativeInvocations.length === 1) {
      try { identityDiagnostic.failureProbeDiagnostic = await failureProbeDiagnostic(originalExecFile); }
      catch { identityDiagnostic.failureProbeDiagnostic = { kind: 'failure-only-instrumented-probe', acceptanceEvidence: false,
        failureCode: 'fixture_probe_diagnostic_unavailable' }; }
    }
    throw error;
  } finally {
    childProcess.execFile = originalExecFile; syncBuiltinESMExports();
  }
}
async function profile(settings) {
  // os.userInfo uses the current token's OS profile. This bootstrap performs
  // no Add-Type or product import before the account owns its compiler temp.
  const directory = os.userInfo().homedir;
  if (!path.win32.isAbsolute(directory) || !/^[a-f0-9]{32}$/.test(settings.fixtureId)) {
    throw new Error('fixture_profile_unavailable');
  }
  const temporary = path.join(directory, 'AppData', 'Local', 'Temp', 'mterm-reference-' + settings.fixtureId);
  await fs.mkdir(temporary, { recursive: true });
  process.chdir(temporary);
  for (const key of ['TEMP', 'TMP']) process.env[key] = temporary;
  process.env.USERPROFILE = directory;
  return { profile: directory, temporary, createdByOwnedUser: true, noNativeCompilation: true };
}
async function provision(settings) {
  const { REFERENCE_SOURCE_FILES, validateReferenceTrust } = await import('../../lib/reference-bootstrap.mjs');
  const { createProductionReferenceRegistration } = await import('../../lib/dev-runtime-reference.mjs');
  const { validateConfig } = await import('../../lib/config.mjs');
  const make = async name => {
    const state = path.join(root, name + '-state'); await fs.mkdir(state);
    const runtime = path.join(root, name + '-runtime'); await fs.mkdir(runtime);
    const config = validateConfig({ schemaVersion: 1, nodePath: process.execPath,
      serverPath: path.join(runtime, 'never-executed.mjs'),
      serverPackageJsonPath: path.join(runtime, 'upstream-package.json'), stateDirectory: state,
      policyPath: path.join(state, 'policy.json'), tokenPath: path.join(state, 'admin-token'),
      inventoryPath: path.join(state, 'inventory.json'), minimumFreeMemoryMiB: 256, minimumFreeDiskMiB: 256 });
    await fs.writeFile(config.serverPath, '// Inert file identity fixture; no SDK, tool, or model execution.\n');
    await fs.writeFile(config.serverPackageJsonPath, JSON.stringify({ version: '0.3.1' }));
    await fs.writeFile(config.policyPath, JSON.stringify({ enabled: true, readOnly: true, maxInflight: 1 }));
    await fs.writeFile(config.tokenPath, 'sha256:' + hash('reference transport isolated token v1\n' + name));
    await fs.writeFile(config.inventoryPath, JSON.stringify({ generatedAt: '2026-11-20T00:00:00Z', entries: [] }));
    const entry = path.join(runtime, 'admin.mjs'); await fs.writeFile(entry, '// Inert declared manager; never started.\n');
    return { config, configPath: path.join(state, 'manager.json'), entry, state, runtime };
  };
  const production = await make('production'), development = await make('development');
  development.config = validateConfig({ ...development.config, instance: { kind: 'dev', id: 'dev-reference-fixture',
    port: 19741, productionConfigPath: production.configPath } });
  await fs.writeFile(production.configPath, JSON.stringify(production.config));
  await fs.writeFile(development.configPath, JSON.stringify(development.config));
  const role = (which, sid, profile, prod) => ({ principalSid: sid, profileDirectory: profile,
    manager: { nodePath: process.execPath, entryPath: which.entry, configPath: which.configPath, port: prod ? 19740 : 19741 },
    routing: { resource: 'https://' + (prod ? 'production' : 'development') + '-resource.example.test/mcp',
      origin: 'https://' + (prod ? 'production' : 'development') + '-origin.example.test/mcp',
      backendId: prod ? 'production-reference-fixture' : 'development-reference-fixture',
      accessAppId: (prod ? '1' : '2').repeat(8) + '-1111-4111-8111-111111111111',
      audience: hash('reference transport fixture audience v1\n' + (prod ? 'production' : 'development')),
      connectorAppId: 'asdk_app_' + (prod ? '1' : '2').repeat(32), originHostHeader: '127.0.0.1:' + (prod ? 19740 : 19741) } });
  const plan = { schemaVersion: 1, platform: 'win32', instanceId: 'dev-reference-fixture', authorizationMode: 'owner-only',
    production: role(production, settings.authority.sid, settings.authority.profile, true),
    development: role(development, settings.development.sid, settings.development.profile, false) };
  const planPath = path.join(development.state, 'dev-runtime-plan.json'); await fs.writeFile(planPath, JSON.stringify(plan));
  const registration = { id: 'disposable-reference', generation: 1, productionConfigPath: production.configPath,
    developmentConfigPath: development.configPath, planPath, production: production.config, development: development.config, plan };
  const handle = createProductionReferenceRegistration(registration), pair = generateKeyPairSync('ed25519');
  const sourceSha256 = {};
  for (const name of REFERENCE_SOURCE_FILES) sourceSha256[name] = hash(await fs.readFile(path.join(root, name)));
  const trust = validateReferenceTrust({ schemaVersion: 1, instanceId: plan.instanceId, generation: 1,
    authoritySid: settings.authority.sid, developmentSid: settings.development.sid,
    registrationSha256: handle.sha256, publicKeySpki: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    developmentConfigPath: development.configPath, planPath, nodePath: process.execPath,
    nodeSha256: hash(await fs.readFile(process.execPath)), sourceSha256 });
  const bootstrapRoot = path.join(root, 'reference-bootstrap'), authorityRoot = path.join(bootstrapRoot, 'authority');
  await fs.mkdir(authorityRoot, { recursive: true });
  await fs.writeFile(path.join(bootstrapRoot, 'trust.json'), JSON.stringify(trust));
  await fs.writeFile(path.join(authorityRoot, 'registration.json'), JSON.stringify(registration));
  await fs.writeFile(path.join(authorityRoot, 'signing-key.pk8'), pair.privateKey.export({ type: 'pkcs8', format: 'der' }));
  return { production, development, planPath, bootstrapRoot, authorityRoot, registrationSha256: handle.sha256,
    productionConfigSha256: hash(await fs.readFile(production.configPath)), publicTrustSha256: hash(JSON.stringify(trust)) };
}
async function inspect(settings, expectFailure = false) {
  const { inspectRegisteredDevRuntime } = await import('../../lib/reference-bootstrap.mjs');
  const productionTargets = [settings.productionState, settings.productionRuntime, settings.productionProfile, settings.authorityRoot];
  const counters = { nodeProductionPathAttempts: 0, nodeFilesystemWrites: 0 };
  const restore = [];
  for (const method of ['open', 'readFile', 'lstat', 'stat', 'realpath', 'opendir', 'readdir']) {
    const original = fs[method]; restore.push(() => { fs[method] = original; });
    fs[method] = async (...args) => {
      if (typeof args[0] === 'string' && productionTargets.some(target => within(target, args[0]))) {
        counters.nodeProductionPathAttempts++; throw new Error('fixture_production_read_forbidden');
      }
      return original(...args);
    };
  }
  for (const method of ['writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rmdir', 'rename', 'copyFile', 'truncate', 'chmod', 'chown', 'link', 'symlink']) {
    const original = fs[method]; restore.push(() => { fs[method] = original; });
    fs[method] = async () => { counters.nodeFilesystemWrites++; throw new Error('fixture_writer_forbidden'); };
  }
  syncBuiltinESMExports();
  try {
    let report;
    try { report = await inspectRegisteredDevRuntime(settings.options ?? {}); }
    catch (error) {
      if (!expectFailure) throw error;
      return { rejected: true, error: code(error), counters };
    }
    if (expectFailure) throw new Error('fixture_expected_rejection_missing');
    if (report.qualified !== false || report.upstreamEnabled !== false || report.productionReference?.evidence !== 'authenticated-point-in-time') {
      throw new Error('fixture_report_invalid');
    }
    return { report, counters };
  } finally { for (const fn of restore.reverse()) fn(); syncBuiltinESMExports(); }
}
async function server(settings) {
  const bootstrap = await import('../../lib/reference-bootstrap.mjs');
  const { serveReferenceTransport } = await import('../../lib/reference-transport.mjs');
  const handle = await bootstrap.loadReferenceBootstrap('authority');
  const registered = settings.registered === true ? bootstrap.createBootstrappedReferenceAuthority(handle) : null;
  const held = new Map(), counters = { invocations: 0, settled: 0, aborted: 0, active: 0, maximumActive: 0 };
  const callback = async (request, { signal } = {}) => {
    const id = ++counters.invocations; counters.active++; counters.maximumActive = Math.max(counters.maximumActive, counters.active);
    const onAbort = () => { counters.aborted++; }; signal?.addEventListener('abort', onAbort, { once: true });
    emit({ event: 'callback', id, counters: { ...counters } });
    try {
      if (registered) return await registered(request, { signal });
      const fingerprint = JSON.parse(request).configSha256;
      if (fingerprint === hash('fixture-hold')) await new Promise(resolve => held.set(id, resolve));
      if (fingerprint === hash('fixture-hostile-error')) throw new Proxy(new Error('PRIVATE-FIXTURE-THROWABLE'), {
        get() { throw new Error('PRIVATE-FIXTURE-ACCESSOR'); },
        getOwnPropertyDescriptor() { throw new Error('PRIVATE-FIXTURE-DESCRIPTOR'); },
      });
      if (fingerprint === hash('fixture-oversized-response')) return 'x'.repeat(8193);
      return JSON.stringify({ fixtureResponse: true, requestSha256: hash(request) });
    } finally {
      held.delete(id); signal?.removeEventListener('abort', onAbort); counters.active--; counters.settled++;
      emit({ event: 'settled', id, counters: { ...counters } });
    }
  };
  const service = serveReferenceTransport(handle, callback);
  if (!Object.isFrozen(service) || !(service.ready instanceof Promise) || !(service.closed instanceof Promise)) {
    throw new Error('fixture_service_contract_invalid');
  }
  await timeout(service.ready); emit({ event: 'ready', registered: Boolean(registered), counters });
  for await (const line of input) {
    const command = JSON.parse(line);
    if (command.action === 'release') {
      for (const resolve of [...held.values()]) resolve();
    } else if (command.action === 'stats') emit({ event: 'stats', counters: { ...counters } });
    else if (command.action === 'close') {
      const first = service.close(), second = service.close();
      if (first !== second) throw new Error('fixture_close_not_idempotent');
      emit({ event: 'closing', counters: { ...counters } });
      first.then(() => emit({ event: 'closed', counters: { ...counters } }));
    } else throw new Error('fixture_server_command_invalid');
  }
  for (const resolve of [...held.values()]) resolve();
  await timeout(service.close()); await service.closed;
  if (registered) {
    const { waitForProductionReferenceAuthorityIdle } = await import('../../lib/production-reference.mjs');
    await timeout(waitForProductionReferenceAuthorityIdle(registered));
  }
  return { counters, drained: counters.active === 0 };
}

async function controlledExchange(settings, mutateSignal = false) {
  const { loadReferenceBootstrap } = await import('../../lib/reference-bootstrap.mjs');
  const { createReferenceExchange } = await import('../../lib/reference-transport.mjs');
  const handle = await loadReferenceBootstrap('client'), exchange = createReferenceExchange(handle);
  let getterCalls = 0, accessorRejected = false;
  if (mutateSignal) {
    const options = Object.defineProperty({}, 'signal', { enumerable: true, get() { getterCalls++; return new AbortController().signal; } });
    try { await exchange(await requestText(handle), options); }
    catch (error) { accessorRejected = code(error) === 'runtime_reference_invalid'; }
    if (!accessorRejected || getterCalls !== 0) throw new Error('fixture_accessor_signal_admitted');
  }
  const original = new AbortController(), replacement = new AbortController(), options = { signal: original.signal };
  let settled = false;
  const pending = exchange(await requestText(handle, settings.requestMode), options)
    .then(response => ({ accepted: true, response }), error => ({ accepted: false, error: code(error) }))
    .then(value => { settled = true; return value; });
  if (mutateSignal) { options.signal = replacement.signal; replacement.abort(); }
  emit({ event: 'exchange_started', accessorRejected, getterCalls, replacementAborted: replacement.signal.aborted });
  while (true) {
    const next = await input.next();
    if (next.done) throw new Error('fixture_exchange_command_invalid');
    const action = JSON.parse(next.value).action;
    if (action === 'state') { emit({ event: 'exchange_state', settled, originalAborted: original.signal.aborted }); continue; }
    if (action !== 'abort') throw new Error('fixture_exchange_command_invalid');
    break;
  }
  original.abort();
  const result = await timeout(pending);
  return { ...result, accessorRejected, getterCalls, replacementAborted: replacement.signal.aborted,
    originalAborted: original.signal.aborted };
}

try {
  disposable();
  const settings = await firstInput();
  let result;
  switch (process.argv[2]) {
    case 'profile': result = await profile(settings); break;
    case 'identity': result = await identity(); break;
    case 'provision': result = await provision(settings); break;
    case 'inspect': result = await inspect(settings); break;
    case 'inspect-denial': result = await inspect(settings, true); break;
    case 'server': result = await server(settings); break;
    case 'exchange-control': result = await controlledExchange(settings); break;
    case 'signal-options': result = await controlledExchange(settings, true); break;
    case 'bootstrap': {
      const { loadReferenceBootstrap } = await import('../../lib/reference-bootstrap.mjs');
      const handle = await loadReferenceBootstrap(settings.role);
      result = { opaque: Object.isFrozen(handle) && Object.keys(handle).sort().join(',') === 'instanceId,registrationSha256' };
      break;
    }
    case 'public-key': result = { publicKeySpki: generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64url') }; break;
    case 'change-public-pin': {
      const filename = path.join(root, 'reference-bootstrap', 'trust.json');
      const trust = JSON.parse(await fs.readFile(filename, 'utf8'));
      trust.publicKeySpki = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
      await fs.writeFile(filename, JSON.stringify(trust));
      result = { changedPublicPin: true }; break;
    }
    case 'exchange': {
      const { loadReferenceBootstrap } = await import('../../lib/reference-bootstrap.mjs');
      const { createReferenceExchange } = await import('../../lib/reference-transport.mjs');
      const handle = await loadReferenceBootstrap('client'), exchange = createReferenceExchange(handle);
      const controller = new AbortController();
      const timer = settings.cancelAfterMs === undefined ? null : setTimeout(() => controller.abort(), settings.cancelAfterMs);
      try { result = { response: await exchange(await requestText(handle, settings.requestMode), { signal: controller.signal }) }; }
      finally { clearTimeout(timer); }
      break;
    }
    case 'request': {
      const { loadReferenceBootstrap } = await import('../../lib/reference-bootstrap.mjs');
      result = { request: await requestText(await loadReferenceBootstrap('client'), settings.requestMode) };
      break;
    }
    case 'access': {
      let readDenied = false, writeDenied = false;
      try { await fs.readFile(settings.readTarget); } catch (error) { readDenied = ['EACCES', 'EPERM'].includes(error.code); }
      try { await fs.writeFile(settings.writeTarget, 'fixture-attempt', { flag: 'wx' }); }
      catch (error) { writeDenied = ['EACCES', 'EPERM'].includes(error.code); }
      result = { readDenied, writeDenied }; break;
    }
    default: throw new Error('fixture_mode_invalid');
  }
  emit({ ok: true, result, identityDiagnostic }); lines.close();
} catch (error) { emit({ ok: false, error: code(error), systemError: systemError(error), identityDiagnostic }); lines.close(); process.exitCode = 1; }
