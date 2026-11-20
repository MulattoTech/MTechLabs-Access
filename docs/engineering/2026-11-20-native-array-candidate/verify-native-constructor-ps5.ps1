# R45: synthetic constructor parity only. No Windows identity/token, ACL,
# production process, runtime probe, or native fixture is launched.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$probe = Join-Path $root 'integrations\mcp-manager\windows-runtime-probe.ps1'
$parseTokens = $null
$parseErrors = $null
$sourceAst = [Management.Automation.Language.Parser]::ParseFile($probe, [ref]$parseTokens, [ref]$parseErrors)
if ($null -eq $sourceAst -or @($parseErrors).Count -ne 0) { throw 'probe_parse_failed' }
$source = [IO.File]::ReadAllText($probe)
$want = 'return [MTechLabs.DevRuntime.ProcessSnapshot]::new($ProcessId)'
if ([regex]::Matches($source,[regex]::Escape($want)).Count -ne 1) { throw 'typed_constructor_missing' }
if ([regex]::IsMatch($source,'(?i)\bNew-Object\b')) { throw 'remaining_New_Object_command' }
if ($source -notmatch 'public ProcessSnapshot\(int pid\)') { throw 'exact_native_constructor_missing' }

$ns = @'
using System;
namespace MTechLabs.R45Review {
    public sealed class SyntheticSnapshot : IDisposable {
        public readonly int Pid;
        public bool Disposed;
        public SyntheticSnapshot(int pid) { Pid=pid; Disposed=false; }
        public void Dispose() { Disposed=true; }
    }
}
'@
Add-Type -TypeDefinition $ns -ErrorAction Stop
$typed = [MTechLabs.R45Review.SyntheticSnapshot]::new(4242)
$legacy = New-Object -TypeName MTechLabs.R45Review.SyntheticSnapshot -ArgumentList 4242
if ($typed -isnot [MTechLabs.R45Review.SyntheticSnapshot] -or
    $legacy -isnot [MTechLabs.R45Review.SyntheticSnapshot] -or
    $typed.Pid -ne $legacy.Pid -or $typed.Pid -ne 4242) {
    throw 'constructor_type_or_argument_drift'
}
try {
    if ($typed.Disposed -or $legacy.Disposed) { throw 'unexpected_constructor_disposed_state' }
} finally {
    $typed.Dispose()
    $legacy.Dispose()
}
if (-not $typed.Disposed -or -not $legacy.Disposed) { throw 'constructor_cleanup_contract_drift' }
$old = $PSModuleAutoLoadingPreference
try {
    $PSModuleAutoLoadingPreference = 'None'
    $noAutoload = [MTechLabs.R45Review.SyntheticSnapshot]::new(2311)
    if ($noAutoload.Pid -ne 2311) { throw 'no_autoload_constructor_drift' }
    $noAutoload.Dispose()
} finally {
    $PSModuleAutoLoadingPreference = $old
}
([pscustomobject]@{
  schemaVersion=1
  suite='synthetic-PowerShell-native-ctor-parity-no-runtime-observation'
  probeParsed=$true
  syntheticType='MTechLabs.R45Review.SyntheticSnapshot'
  constructorIntArgumentMatched=$true
  disposalSemanticsMatched=$true
  typedConstructorWorksWithAutoloadDisabled=$true
  executableProbeInvoked=$false
  WindowsTokenOrAclQueried=$false
  hostedSecurityVerified=$false
  productionModified=$false
  devActivationAuthorized=$false
}) | ConvertTo-Json -Compress
