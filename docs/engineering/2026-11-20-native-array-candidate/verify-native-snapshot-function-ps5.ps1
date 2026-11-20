# R46: execute ONLY the exact 4-line Get-RuntimeNativeSnapshot function
# extracted from the R45 candidate, with a synthetic in-memory type.
# Does not dot-source the full probe, run production code, inspect a real PID,
# invoke any OS identity/token/ACL APIs, or contact external services.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$probe = Join-Path $root 'integrations\mcp-manager\windows-runtime-probe.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($probe,[ref]$tokens,[ref]$errors)
if ($null -eq $ast -or @($errors).Count -ne 0) { throw 'r46_candidate_probe_parse_failed' }
$functions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq 'Get-RuntimeNativeSnapshot'
},$true))
if ($functions.Count -ne 1) { throw 'r46_expected_one_snapshot_function' }
$actual = $functions[0].Extent.Text.Replace(([string][char]13+[string][char]10),[string][char]10).Trim()
$expected = @'
function Get-RuntimeNativeSnapshot {
    param([int]$ProcessId)
    Initialize-RuntimeNative
    return [MTechLabs.DevRuntime.ProcessSnapshot]::new($ProcessId)
}
'@
if ($actual -cne $expected.Trim()) { throw 'r46_snapshot_function_source_changed' }
if ('MTechLabs.DevRuntime.ProcessSnapshot' -as [type]) {
    throw 'r46_synthetic_type_was_predefined'
}

$script:initializeCalls = 0
function Initialize-RuntimeNative {
    $script:initializeCalls += 1
    if ('MTechLabs.DevRuntime.ProcessSnapshot' -as [type]) { return }
    $definition = @'
using System;
namespace MTechLabs.DevRuntime {
    public sealed class ProcessSnapshot : IDisposable {
        public readonly int Pid;
        public bool Disposed;
        public static int Created;
        public ProcessSnapshot(int pid) {
            if (pid <= 0) throw new ArgumentOutOfRangeException("pid");
            Pid = pid;
            Disposed = false;
            Created++;
        }
        public void Dispose() { Disposed=true; }
    }
}
'@
    Add-Type -TypeDefinition $definition -ErrorAction Stop
}
# Dot-source this exactly matched function only. It calls the above synthetic
# Initialize-RuntimeNative stub, not the original Add-Type/Win32 implementation.
. ([scriptblock]::Create($actual))

$first = Get-RuntimeNativeSnapshot -ProcessId 4242
if ($null -eq $first -or $first.Pid -ne 4242 -or
    $first -isnot [MTechLabs.DevRuntime.ProcessSnapshot] -or
    $first.Disposed -or $script:initializeCalls -ne 1 -or
    [MTechLabs.DevRuntime.ProcessSnapshot]::Created -ne 1) {
    throw 'r46_lazy_type_creation_or_pid_forwarding_failed'
}
$first.Dispose()
if (-not $first.Disposed) { throw 'r46_first_disposal_failed' }

$before = $PSModuleAutoLoadingPreference
try {
    $PSModuleAutoLoadingPreference = 'None'
    $second = Get-RuntimeNativeSnapshot -ProcessId 2311
    if ($second.Pid -ne 2311 -or $second.Disposed -or
        $script:initializeCalls -ne 2 -or
        [MTechLabs.DevRuntime.ProcessSnapshot]::Created -ne 2) {
        throw 'r46_autoload_disabled_snapshot_failed'
    }
    $second.Dispose()
    if (-not $second.Disposed) { throw 'r46_second_disposal_failed' }
} finally {
    $PSModuleAutoLoadingPreference = $before
}

$countBefore = [MTechLabs.DevRuntime.ProcessSnapshot]::Created
$rejected = $false
try { $null = Get-RuntimeNativeSnapshot -ProcessId -1 }
catch { $rejected = $true }
if (-not $rejected -or
    [MTechLabs.DevRuntime.ProcessSnapshot]::Created -ne $countBefore) {
    throw 'r46_invalid_synthetic_pid_not_rejected'
}

([pscustomobject]@{
    schemaVersion=1
    suite='R46 exact-native-snapshot-function-with-synthetic-type'
    functionSourceMatched=$true
    candidatePowerShellParsed=$true
    lazyNativeTypeInitializationVerified=$true
    exactIntPidForwardingVerified=$true
    twoSyntheticInstancesDisposed=$true
    typedCallWithModuleAutoLoadingDisabled=$true
    invalidSyntheticPidRejected=$true
    createdSyntheticInstances=[MTechLabs.DevRuntime.ProcessSnapshot]::Created
    runtimeProbeExecuted=$false
    realNativeProcessQueried=$false
    realWindowsAccountTokenOrAclQueried=$false
    networkQueried=$false
    hostedWindowsQualificationPassed=$false
    devActivationAuthorized=$false
}) | ConvertTo-Json -Compress
