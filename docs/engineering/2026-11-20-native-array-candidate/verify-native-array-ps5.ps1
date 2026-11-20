# R43 disposable static source and intrinsic-array check (Windows PowerShell 5.1).
# This script DOES NOT invoke the runtime probe or query any account/process.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$probe = Join-Path $root 'integrations\mcp-manager\windows-runtime-probe.ps1'
if (-not (Test-Path -LiteralPath $probe -PathType Leaf)) { throw 'candidate_probe_not_found' }
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($probe, [ref]$tokens, [ref]$parseErrors)
if ($null -eq $ast -or @($parseErrors).Count -ne 0) { throw 'candidate_probe_ps_parse_error' }
$source = [System.IO.File]::ReadAllText($probe)
$typedCount = [regex]::Matches($source, [regex]::Escape('$buffer = [char[]]::new(16385)')).Count
$oldCount = [regex]::Matches($source, [regex]::Escape('$buffer = New-Object char[] 16385')).Count
if ($typedCount -ne 1 -or $oldCount -ne 0) { throw 'candidate_array_command_changed' }
$buffer = [char[]]::new(16385)
if ($buffer -isnot [char[]] -or $buffer.Length -ne 16385 -or
    [int]$buffer[0] -ne 0 -or [int]$buffer[16384] -ne 0) {
    throw 'candidate_array_contract_failed'
}
([pscustomobject]@{
    schemaVersion = 1
    suite = 'source-only-windows-powershell-array-constructor'
    sourceParsedSuccessfully = $true
    parserErrorCount = 0
    type = 'System.Char[]'
    elementCount = $buffer.Length
    initiallyZeroed = $true
    probeExecuted = $false
    realWindowsTokenOrAclQualified = $false
    hostedNativeFixtureQualified = $false
    productionModified = $false
    devActivationAuthorized = $false
}) | ConvertTo-Json -Compress
