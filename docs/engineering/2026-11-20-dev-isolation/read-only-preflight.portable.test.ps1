# Access #46 — portable ACL-helper tests. Windows PowerShell 7+; no production fixture.
# This file NEVER executes the preflight's top-level script or accesses owner ACL paths.
#requires -Version 7.0
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'read-only-preflight.ps1'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw 'preflight_source_not_found'
}
$tokens = $null
$errors = $null
$syntax = [Management.Automation.Language.Parser]::ParseFile(
    $source, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw 'preflight_syntax_error' }

# Extract *only* the two ACL helper definitions. No dot-sourcing of the actual
# top-level preflight, which contains owner-specific paths and live OS checks.
$names = @('Get-PrincipalKind', 'Get-PathSummary')
$definitions = @($syntax.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -in $names
}, $true))
if ($definitions.Count -ne 2 -or
    @($definitions | Select-Object -ExpandProperty Name -Unique).Count -ne 2) {
    throw 'exact_acl_helpers_not_found'
}
$helperCode = ($definitions | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine

function New-FixtureAce {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [Security.Principal.IdentityReference]$Identity,
        [Security.AccessControl.FileSystemRights]$Rights =
            [Security.AccessControl.FileSystemRights]::Modify,
        [Security.AccessControl.InheritanceFlags]$Inheritance =
            [Security.AccessControl.InheritanceFlags]::ContainerInherit,
        [Security.AccessControl.PropagationFlags]$Propagation =
            [Security.AccessControl.PropagationFlags]::None
    )
    [Security.AccessControl.FileSystemAccessRule]::new(
        $Identity, $Rights, $Inheritance, $Propagation,
        [Security.AccessControl.AccessControlType]::Allow)
}
function Sid([string]$value) {
    [Security.Principal.SecurityIdentifier]::new($value)
}
function Probe-Fixture([hashtable]$scenario, [string]$functions) {
    # Each probe has private mock commands. An unexpected non-mocked filesystem
    # operation would fail since Q: is a deliberately fake test-only path.
    & {
        param($case, [string]$defs)
        . ([scriptblock]::Create($defs))
        $calls = [pscustomobject]@{path=0;item=0;acl=0}
        function Test-Path {
            [CmdletBinding()]
            param([string]$LiteralPath)
            $calls.path++
            if($case.failure -eq 'path') { throw 'simulated_path_access_denied' }
            return $true
        }
        function Get-Item {
            [CmdletBinding()]
            param([string]$LiteralPath, [switch]$Force)
            $calls.item++
            if($case.failure -eq 'item') { throw 'simulated_item_access_denied' }
            $attrs = if($case.reparse) {
                [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint
            } else { [IO.FileAttributes]::Directory }
            [pscustomobject]@{Attributes=$attrs;PSIsContainer=$true}
        }
        function Get-Acl {
            [CmdletBinding()]
            param([string]$LiteralPath)
            $calls.acl++
            if($case.failure -eq 'acl') { throw 'simulated_acl_access_denied' }
            [pscustomobject]@{
                Owner='S-1-5-18'
                AreAccessRulesProtected=$true
                Access=@($case.rules)
            }
        }
        $observation = Get-PathSummary 'synthetic' 'Q:\NONEXISTENT_MTECH_ACL_FIXTURE'
        if($calls.path -ne 1) { throw 'test_path_mock_not_exercised' }
        if($case.failure -notin @('path','item') -and $calls.acl -ne 1) {
            throw 'test_acl_mock_not_exercised'
        }
        return $observation
    } $scenario $functions
}

$knownSystem = Sid 'S-1-5-18'
$knownAdmins = Sid 'S-1-5-32-544'
$knownUsers = Sid 'S-1-5-32-545'
$authenticated = Sid 'S-1-5-11'
$everyone = Sid 'S-1-1-0'
$custom = Sid 'S-1-5-21-1111-2222-3333-4444'
$spoofedAdministrator = [Security.Principal.NTAccount]::new('FAKE_FIXTURE','Administrators')
$spoofedSystem = [Security.Principal.NTAccount]::new('FAKE_FIXTURE','SYSTEM')
$inheritOnly = [Security.AccessControl.PropagationFlags]::InheritOnly
$read = [Security.AccessControl.FileSystemRights]::ReadAndExecute
$noInheritance = [Security.AccessControl.InheritanceFlags]::None

# Explicitly expected counts, independent of owner machine identity and files.
$fixtures = @(
    @{name='no-write-aces';rules=@();expect=@{status='observed';ownerKind='system';broadMutationAllowCount=0;unclassifiedMutationAllowCount=0}},
    @{name='authenticated-modify-active';rules=@(New-FixtureAce -Identity $authenticated -Inheritance $noInheritance);expect=@{broadMutationAllowCount=1;inheritableBroadMutationCount=0}},
    @{name='authenticated-inherit-only';rules=@(New-FixtureAce -Identity $authenticated -Propagation $inheritOnly);expect=@{broadMutationAllowCount=0;inheritableBroadMutationCount=1}},
    @{name='builtin-users-modify';rules=@(New-FixtureAce -Identity $knownUsers);expect=@{broadMutationAllowCount=1;inheritableBroadMutationCount=1}},
    @{name='everyone-readonly';rules=@(New-FixtureAce -Identity $everyone -Rights $read);expect=@{broadMutationAllowCount=0;unclassifiedMutationAllowCount=0}},
    @{name='custom-sid-modify';rules=@(New-FixtureAce -Identity $custom);expect=@{unclassifiedMutationAllowCount=1;inheritableUnclassifiedMutationCount=1}},
    @{name='custom-sid-inherit-only';rules=@(New-FixtureAce -Identity $custom -Propagation $inheritOnly);expect=@{unclassifiedMutationAllowCount=0;inheritableUnclassifiedMutationCount=1}},
    @{name='spoof-admin-name';rules=@(New-FixtureAce -Identity $spoofedAdministrator);expect=@{unclassifiedMutationAllowCount=1;inheritableUnclassifiedMutationCount=1}},
    @{name='spoof-system-name';rules=@(New-FixtureAce -Identity $spoofedSystem);expect=@{unclassifiedMutationAllowCount=1;inheritableUnclassifiedMutationCount=1}},
    @{name='actual-system-sid-modify';rules=@(New-FixtureAce -Identity $knownSystem);expect=@{broadMutationAllowCount=0;unclassifiedMutationAllowCount=0}},
    @{name='actual-admin-sid-modify';rules=@(New-FixtureAce -Identity $knownAdmins);expect=@{broadMutationAllowCount=0;unclassifiedMutationAllowCount=0}},
    @{name='reparse-detected';rules=@();reparse=$true;expect=@{reparse=$true;status='observed'}},
    @{name='path-denied';rules=@();failure='path';expect=@{status='unverified';broadMutationAllowCount=0;unclassifiedMutationAllowCount=0}},
    @{name='item-denied';rules=@();failure='item';expect=@{status='unverified';broadMutationAllowCount=0;unclassifiedMutationAllowCount=0}},
    @{name='acl-denied';rules=@();failure='acl';expect=@{status='unverified';broadMutationAllowCount=0;unclassifiedMutationAllowCount=0}}
)
$passed = 0
foreach ($case in $fixtures) {
    # Explicit defaults avoid StrictMode property-not-found errors; all test
    # cases still provide their expected counts independently.
    if (-not $case.ContainsKey('failure')) { $case['failure'] = '' }
    if (-not $case.ContainsKey('reparse')) { $case['reparse'] = $false }
    $record = Probe-Fixture $case $helperCode
    $expectedStatus = if($case.failure){'unverified'}else{'observed'}
    if($record.status -ne $expectedStatus){throw ('case_status_mismatch:' + $case.name)}
    # Stable ordinal field order is required for mutation sensitivity:
    # PowerShell hashtables do not guarantee assertion iteration order.
    $expectedKeys = [string[]]@($case.expect.Keys)
    [Array]::Sort($expectedKeys, [StringComparer]::Ordinal)
    foreach($property in $expectedKeys){
        $actual=$record.$property
        $expected=$case.expect[$property]
        if($actual -ne $expected){
            throw ('fixture_mismatch:' + $case.name + ':' + $property)
        }
    }
    $serialized = $record | ConvertTo-Json -Compress
    if($serialized.Contains('FAKE_FIXTURE') -or
       $serialized.Contains('S-1-5-21-1111') -or
       $serialized.Contains('Q:\')) {
        throw ('fixture_private_identity_leaked:' + $case.name)
    }
    $passed++
}
# Only aggregate sanitized counters. Source-helper tests are not OS effective
# access qualification, Windows account tests, a hosted security gate or DEV readiness.
[pscustomobject]@{
    schemaVersion=1
    suite='portable-acl-classifier'
    osRequirement='Windows PowerShell 7+'
    passed=$passed
    failed=0
    functionCount=$definitions.Count
    ownerBaselineUsed=$false
    productionServiceQueried=$false
    aclMutated=$false
    activationAuthorized=$false
} | ConvertTo-Json -Compress
