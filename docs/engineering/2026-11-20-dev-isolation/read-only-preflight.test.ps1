# Access #46 portable, non-destructive smoke/negative tests for the diagnostic only.
#requires -Version 7.0
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptName = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'read-only-preflight.ps1')) {
    'read-only-preflight.ps1'
} elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dev-isolation-preflight.ps1')) {
    'dev-isolation-preflight.ps1'
} else { throw 'preflight_source_not_found' }
$source = Join-Path $PSScriptRoot $scriptName
$before = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -gt 0) { throw 'preflight_parse_failed' }

# The source must use read-only cmdlets, not mutate Windows state or make network calls.
$commands = @($ast.FindAll({
    param($node) $node -is [System.Management.Automation.Language.CommandAst]
}, $true) | ForEach-Object { $_.GetCommandName() })
$blocked = @(
    'Set-Acl','icacls','New-LocalUser','Set-LocalUser','Remove-LocalUser',
    'New-Item','Remove-Item','Move-Item','Copy-Item','Set-Content',
    'Add-Content','Out-File','Set-Item','Set-ItemProperty','Invoke-WebRequest',
    'Invoke-RestMethod','Invoke-Expression','Start-Process','Start-Service',
    'Stop-Service','Restart-Service','Set-Service','Register-ScheduledTask',
    'New-ScheduledTask','Set-ScheduledTask','Remove-ScheduledTask'
)
if (@($commands | Where-Object {$_ -in $blocked}).Count -gt 0) {
    throw 'mutation_or_network_command_in_source'
}
$rawSource = Get-Content -LiteralPath $source -Raw
if ($rawSource -match '(?i)\.(?:Save|SetAccessRule|AddAccessRule|SetOwner|WriteAllBytes|CreateNew)\s*\(') {
    throw 'mutation_method_in_source'
}

function Assert-Inactive($report, [string]$label) {
    if ($report.schemaVersion -ne 1 -or $report.activationAuthorized -ne $false -or
        $report.provisioned -ne $false -or $report.readyForDevActivation -ne $false) {
        throw ('activation_contract_failed_' + $label)
    }
    if (@($report.paths).Count -ne 11) { throw ('path_count_failed_' + $label) }
    if (@($report.blockers).Count -lt 2) { throw ('blockers_missing_' + $label) }
}

$positiveText = & $source
$positive = $positiveText | ConvertFrom-Json -AsHashtable
Assert-Inactive $positive 'ordinary'

$oldLocalAppData = $env:LOCALAPPDATA
try {
    $env:LOCALAPPDATA = 'C:\__MTermIssue46AbsentBaselineForTest'
    $missing = (& $source) | ConvertFrom-Json -AsHashtable
} finally {
    $env:LOCALAPPDATA = $oldLocalAppData
}
Assert-Inactive $missing 'absent_baseline'
if ($missing.baseline.status -ne 'unavailable' -or
    @($missing.blockers | Where-Object {$_ -eq 'baseline-not-matched'}).Count -ne 1) {
    throw 'missing_baseline_did_not_fail_closed'
}

$denied = (& {
    function Get-Acl { throw 'synthetic_acl_unavailable' }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $denied 'acl_denied'
if ($denied.paths[0].status -ne 'unverified' -or
    @($denied.blockers | Where-Object {$_ -eq 'acl-unverified:hRoot'}).Count -ne 1) {
    throw 'acl_denial_did_not_fail_closed'
}

$after = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($before -cne $after) { throw 'preflight_source_mutated_during_test' }

# No raw account/profile/SDDL data or command lines in emitted test evidence.
[pscustomobject]@{
    schemaVersion = 1
    scope = 'read-only-preflight-negative-controls'
    passed = 4
    failed = 0
    parseValid = $true
    staticReadOnlyCommands = $true
    ordinaryAssessmentInactive = $true
    missingBaselineFailsClosed = $true
    syntheticAclDenialFailsClosed = $true
    sourceHashStable = $true
    activationAuthorized = $false
} | ConvertTo-Json -Compress
