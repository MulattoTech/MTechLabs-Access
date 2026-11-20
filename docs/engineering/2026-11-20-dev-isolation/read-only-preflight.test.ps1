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

# A path lookup that fails must be reported as unverified, not terminate the
# entire diagnostic or turn the denied H: ancestor into a false "absent" result.
$lookupDenied = (& {
    function Test-Path {
        [CmdletBinding()]
        param([string]$LiteralPath, [string]$PathType)
        if ($LiteralPath -eq 'H:\') { throw 'synthetic_path_lookup_denied' }
        if ($PathType) { Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType }
        else { Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath }
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $lookupDenied 'path_lookup_denied'
if ($lookupDenied.paths[0].status -ne 'unverified' -or
    @($lookupDenied.blockers | Where-Object {$_ -eq 'acl-unverified:hRoot'}).Count -ne 1) {
    throw 'path_lookup_denial_not_unverified'
}

$baselineLookupDenied = (& {
    function Test-Path {
        [CmdletBinding()]
        param([string]$LiteralPath, [string]$PathType)
        if ($LiteralPath -like '*acl-baseline-20261120.json') { throw 'synthetic_baseline_lookup_denied' }
        if ($PathType) { Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType }
        else { Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath }
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $baselineLookupDenied 'baseline_lookup_denied'
if ($baselineLookupDenied.baseline.status -ne 'unverified' -or
    @($baselineLookupDenied.blockers | Where-Object {$_ -eq 'baseline-not-matched'}).Count -ne 1) {
    throw 'baseline_lookup_denial_not_unverified'
}

$accountDenied = (& {
    function Get-LocalUser {
        [CmdletBinding()]
        param([string]$Name)
        throw 'synthetic_local_account_access_denied'
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $accountDenied 'account_query_denied'
if ($accountDenied.devAccount -ne 'unverified' -or
    @($accountDenied.blockers | Where-Object {$_ -eq 'dev-principal-not-provisioned'}).Count -ne 1) {
    throw 'account_query_denial_misclassified_as_absent'
}

$profileDenied = (& {
    function Test-Path {
        [CmdletBinding()]
        param([string]$LiteralPath, [string]$PathType)
        if ($LiteralPath -eq 'C:\Users\MTermDev') { throw 'synthetic_dev_profile_lookup_denied' }
        if ($PathType) { Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType }
        else { Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath }
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $profileDenied 'dev_profile_lookup_denied'
if ($profileDenied.devProfile -ne 'unverified' -or
    @($profileDenied.blockers | Where-Object {$_ -eq 'dev-principal-not-provisioned'}).Count -ne 1) {
    throw 'dev_profile_denial_misclassified_as_absent'
}

# A missing, relative, or remote LOCALAPPDATA root must neither crash the
# assessment nor cause it to load a baseline from an unexpected filesystem.
# These are process-local environment overrides, always restored in finally.
$originalLocalAppData = $env:LOCALAPPDATA
foreach ($scenario in @(
    @{ name = 'empty'; root = '' },
    @{ name = 'relative'; root = 'relative\not-a-root' },
    @{ name = 'remote'; root = '\\127.0.0.1\never-connect' }
)) {
    try {
        $env:LOCALAPPDATA = $scenario.root
        $untrustedRoot = (& $source) | ConvertFrom-Json -AsHashtable
    } finally {
        $env:LOCALAPPDATA = $originalLocalAppData
    }
    Assert-Inactive $untrustedRoot ('untrusted_appdata_' + $scenario.name)
    if ($untrustedRoot.baseline.status -ne 'unverified' -or
        $untrustedRoot.baseline.matchingPaths -ne 0 -or
        @($untrustedRoot.blockers | Where-Object {$_ -eq 'baseline-not-matched'}).Count -ne 1) {
        throw ('untrusted_appdata_not_rejected_' + $scenario.name)
    }
}

# Public diagnostic output must not include Windows account SIDs or raw paths.
# This only checks current output, not arbitrary future Windows error objects.
if ($positiveText.Contains('S-1-5-') -or $positiveText.Contains('H:\') -or
    $positiveText.Contains('C:\Users\') -or $positiveText.Contains('PRIVATE-FIXTURE')) {
    throw 'diagnostic_output_includes_private_data'
}

$after = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($before -cne $after) { throw 'preflight_source_mutated_during_test' }

# No raw account/profile/SDDL data or command lines in emitted test evidence.
[pscustomobject]@{
    schemaVersion = 1
    scope = 'read-only-preflight-negative-controls'
    passed = 12
    failed = 0
    parseValid = $true
    staticReadOnlyCommands = $true
    ordinaryAssessmentInactive = $true
    missingBaselineFailsClosed = $true
    syntheticAclDenialFailsClosed = $true
    pathLookupDenialFailsClosed = $true
    baselineLookupDenialFailsClosed = $true
    accountQueryDeniedIsUnverified = $true
    devProfileDeniedIsUnverified = $true
    invalidBaselineRootsFailClosed = $true
    publicOutputIsSanitized = $true
    sourceHashStable = $true
    activationAuthorized = $false
} | ConvertTo-Json -Compress
