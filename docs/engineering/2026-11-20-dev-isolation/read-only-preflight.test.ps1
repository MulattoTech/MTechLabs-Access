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

# Synthetic namespace changes: an unchanged ACL is not sufficient when
# the filesystem object changes type or acquires a reparse point.
$reparsed = (& {
    function Get-Item {
        [CmdletBinding()]
        param([string]$LiteralPath, [switch]$Force)
        if ($LiteralPath -eq 'H:\MTechLabs\MCP') {
            return [pscustomobject]@{PSIsContainer=$true;Attributes=(
                [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)}
        }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $reparsed 'reparse_substitution'
if ($reparsed.paths[2].reparse -ne $true -or
    $reparsed.baseline.status -ne 'drift' -or
    @($reparsed.blockers | Where-Object {$_ -eq 'baseline-not-matched'}).Count -ne 1 -or
    @($reparsed.blockers | Where-Object {$_ -eq 'reparse-ancestor:hProduction'}).Count -ne 1) {
    throw 'reparse_substitution_not_rejected'
}

$typeChanged = (& {
    function Get-Item {
        [CmdletBinding()]
        param([string]$LiteralPath, [switch]$Force)
        if ($LiteralPath -eq 'H:\MTechLabs\MCP') {
            return [pscustomobject]@{PSIsContainer=$false;Attributes=[IO.FileAttributes]::Normal}
        }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $typeChanged 'type_substitution'
if ($typeChanged.baseline.status -ne 'drift' -or
    @($typeChanged.blockers | Where-Object {$_ -eq 'baseline-not-matched'}).Count -ne 1) {
    throw 'filesystem_type_substitution_not_rejected'
}

$metadataDenied = (& {
    function Get-Item {
        [CmdletBinding()]
        param([string]$LiteralPath, [switch]$Force)
        if ($LiteralPath -eq 'H:\MTechLabs\MCP') { throw 'synthetic_metadata_access_denied' }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $metadataDenied 'item_metadata_denied'
if ($metadataDenied.paths[2].status -ne 'unverified' -or
    $metadataDenied.baseline.status -ne 'unverified' -or
    @($metadataDenied.blockers | Where-Object {$_ -eq 'acl-unverified:hProduction'}).Count -ne 1 -or
    @($metadataDenied.blockers | Where-Object {$_ -eq 'baseline-not-matched'}).Count -ne 1) {
    throw 'item_metadata_denial_not_rejected'
}

# A verified baseline must be parsed from the same captured bytes that were
# hashed. Neither of the former independent file-reader cmdlets is allowed to
# influence its result now, even when both are deliberately made unavailable.
$separateReadersDenied = (& {
    function Get-FileHash { throw 'synthetic_first_baseline_open_denied' }
    function Get-Content { throw 'synthetic_second_baseline_open_denied' }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $separateReadersDenied 'separate_readers_denied'
if ($separateReadersDenied.baseline.status -ne 'matched' -or
    $separateReadersDenied.baseline.matchingPaths -ne 9 -or
    @($separateReadersDenied.blockers | Where-Object {$_ -eq 'baseline-not-matched'}).Count -ne 0) {
    throw 'baseline_verification_depends_on_separate_file_reads'
}

# AST source check complements, but does not replace, the runtime scenario.
# Byte-length bound, strict decoding, and a single FileStream must be visible.
if (@($commands | Where-Object {$_ -in @('Get-FileHash','Get-Content')}).Count -ne 0 -or
    $rawSource -notmatch 'FileStream\]::new' -or
    $rawSource -notmatch '\$file\.Length -gt 65536' -or
    $rawSource -notmatch 'UTF8Encoding\]::new\(\$false, \$true\)' -or
    $rawSource -notmatch '\$sha\.ComputeHash\(\$bytes\)') {
    throw 'baseline_same_bytes_read_contract_missing'
}

# An unfamiliar SID may be a nested group or localized well-known principal.
# A mutable allow ACE must be visible even with the same synthetic SDDL.
$unknownWriterText = & {
    function Get-Acl {
        [CmdletBinding()]
        param([string]$LiteralPath)
        $real = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
        if ($LiteralPath -ne 'H:\MTechLabs\MCP') { return $real }
        $sid = [Security.Principal.SecurityIdentifier]::new('S-1-5-21-1111-2222-3333-4444')
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,
            [Security.AccessControl.FileSystemRights]::Modify,
            [Security.AccessControl.InheritanceFlags]::ContainerInherit,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)
        return [pscustomobject]@{Owner=$real.Owner;Sddl=$real.Sddl;
            AreAccessRulesProtected=$real.AreAccessRulesProtected;Access=@($real.Access)+@($rule)}
    }
    & $source
}
$unknownWriter = $unknownWriterText | ConvertFrom-Json -AsHashtable
Assert-Inactive $unknownWriter 'unfamiliar_writer'
if ($unknownWriter.paths[2].status -ne 'observed' -or
    $unknownWriter.paths[2].unclassifiedMutationAllowCount -ne 1 -or
    $unknownWriter.paths[2].inheritableUnclassifiedMutationCount -ne 1 -or
    @($unknownWriter.blockers | Where-Object {$_ -eq 'unclassified-ancestor-mutation:hProduction'}).Count -ne 1 -or
    $unknownWriterText.Contains('S-1-5-21-1111-2222-3333-4444')) {
    throw 'unfamiliar_mutable_ace_not_reported_or_exposed'
}

# An inherit-only unfamiliar mutable ACE affects descendants but must not be
# mistaken for an active right on the current directory itself.
$unknownInheritedText = & {
    function Get-Acl {
        [CmdletBinding()]
        param([string]$LiteralPath)
        $real = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
        if ($LiteralPath -ne 'H:\MTechLabs\MCP') { return $real }
        $sid = [Security.Principal.SecurityIdentifier]::new('S-1-5-21-1111-2222-3333-5555')
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,
            [Security.AccessControl.FileSystemRights]::Modify,
            [Security.AccessControl.InheritanceFlags]::ContainerInherit,
            [Security.AccessControl.PropagationFlags]::InheritOnly,
            [Security.AccessControl.AccessControlType]::Allow)
        return [pscustomobject]@{Owner=$real.Owner;Sddl=$real.Sddl;
            AreAccessRulesProtected=$real.AreAccessRulesProtected;Access=@($real.Access)+@($rule)}
    }
    & $source
}
$unknownInherited = $unknownInheritedText | ConvertFrom-Json -AsHashtable
Assert-Inactive $unknownInherited 'unfamiliar_inherited_writer'
if ($unknownInherited.paths[2].status -ne 'observed' -or
    $unknownInherited.paths[2].unclassifiedMutationAllowCount -ne 0 -or
    $unknownInherited.paths[2].inheritableUnclassifiedMutationCount -ne 1 -or
    @($unknownInherited.blockers | Where-Object {$_ -eq 'unclassified-ancestor-mutation:hProduction'}).Count -ne 1 -or
    $unknownInheritedText.Contains('S-1-5-21-1111-2222-3333-5555')) {
    throw 'unfamiliar_inherit_only_ace_not_reported_or_exposed'
}

# Windows account names must not prove trusted privilege: only a translated
# well-known SID may classify an ACE as SYSTEM or Administrators. This replaces
# the previously reproduced blind spot with non-destructive synthetic rules.
foreach ($fake in @(
    @{ name='TEST_UNTRUSTED\Administrators'; label='fake_administrator_name' },
    @{ name='TEST_UNTRUSTED\SYSTEM'; label='fake_system_name' }
)) {
    $spoofText = & {
        param([string]$accountText)
        function Get-Acl {
            [CmdletBinding()]param([string]$LiteralPath)
            $real = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
            if ($LiteralPath -ne 'H:\MTechLabs\MCP') { return $real }
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.NTAccount]::new($accountText),
                [Security.AccessControl.FileSystemRights]::Modify,
                [Security.AccessControl.InheritanceFlags]::ContainerInherit,
                [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow)
            return [pscustomobject]@{Owner=$real.Owner;Sddl=$real.Sddl;
                AreAccessRulesProtected=$real.AreAccessRulesProtected;Access=@($real.Access)+@($rule)}
        }
        & $source
    } $fake.name
    $spoof = $spoofText | ConvertFrom-Json -AsHashtable
    Assert-Inactive $spoof $fake.label
    if ($spoof.paths[2].status -ne 'observed' -or
        $spoof.paths[2].unclassifiedMutationAllowCount -ne 1 -or
        $spoof.paths[2].inheritableUnclassifiedMutationCount -ne 1 -or
        @($spoof.blockers | Where-Object {$_ -eq 'unclassified-ancestor-mutation:hProduction'}).Count -ne 1 -or
        $spoofText.Contains('TEST_UNTRUSTED')) {
        throw ('untrusted_privileged_name_bypassed_sid_check_' + $fake.label)
    }
}

# A real well-known SID should still classify as privileged even when it arrives
# as an NTAccount, so resolution doesn't misclassify the actual local SYSTEM.
$knownSidText = & {
    function Get-Acl {
        [CmdletBinding()]param([string]$LiteralPath)
        $real = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
        if ($LiteralPath -ne 'H:\MTechLabs\MCP') { return $real }
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.NTAccount]::new('NT AUTHORITY','SYSTEM'),
            [Security.AccessControl.FileSystemRights]::Modify,
            [Security.AccessControl.InheritanceFlags]::ContainerInherit,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)
        return [pscustomobject]@{Owner=$real.Owner;Sddl=$real.Sddl;
            AreAccessRulesProtected=$real.AreAccessRulesProtected;Access=@($real.Access)+@($rule)}
    }
    & $source
}
$knownSid = $knownSidText | ConvertFrom-Json -AsHashtable
Assert-Inactive $knownSid 'real_well_known_sid'
if ($knownSid.paths[2].unclassifiedMutationAllowCount -ne 0 -or
    $knownSid.paths[2].inheritableUnclassifiedMutationCount -ne 0 -or
    @($knownSid.blockers | Where-Object {$_ -eq 'unclassified-ancestor-mutation:hProduction'}).Count -ne 0) {
    throw 'real_well_known_sid_not_recognized'
}

# A proposed DEV port already occupied before provisioning is a concrete
# blocker, not just an observation with no consequence.
$occupiedDev = (& {
    function Get-NetTCPConnection {
        [CmdletBinding()]param([string]$State)
        $actual = @(NetTCPIP\Get-NetTCPConnection -State Listen -ErrorAction Stop)
        $actual + [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=19741;State='Listen'}
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $occupiedDev 'dev_listener_occupied'
if ($occupiedDev.listeners.development -ne 'listener-present' -or
    @($occupiedDev.blockers | Where-Object {$_ -eq 'dev-listener-unexpected'}).Count -ne 1) {
    throw 'occupied_dev_listener_not_blocked'
}

$portsUnverified = (& {
    function Get-NetTCPConnection { throw 'synthetic_tcp_inventory_denied' }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $portsUnverified 'tcp_inventory_unverified'
if ($portsUnverified.listeners.development -ne 'unverified' -or
    @($portsUnverified.blockers | Where-Object {$_ -eq 'dev-listener-unverified'}).Count -ne 1 -or
    @($portsUnverified.blockers | Where-Object {$_ -eq 'production-listener-unverified'}).Count -ne 1) {
    throw 'uncertain_tcp_inventory_not_blocked'
}

# A reference directory with broad writes and a junction flag must never be
# mistaken for an installed and qualified authority.
$unsafeReference = (& {
    function Test-Path {
        [CmdletBinding()]param([string]$LiteralPath,[string]$PathType)
        if ($LiteralPath -eq 'C:\ProgramData\MTechLabs\ReferenceManager') { return $true }
        if ($PathType) {Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType}
        else {Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath}
    }
    function Get-Item {
        [CmdletBinding()]param([string]$LiteralPath,[switch]$Force)
        if ($LiteralPath -eq 'C:\ProgramData\MTechLabs\ReferenceManager') {
            return [pscustomobject]@{PSIsContainer=$true;Attributes=(
                [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)}
        }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
    }
    function Get-Acl {
        [CmdletBinding()]param([string]$LiteralPath)
        if ($LiteralPath -eq 'C:\ProgramData\MTechLabs\ReferenceManager') {
            return (Microsoft.PowerShell.Security\Get-Acl -LiteralPath 'H:\MTechLabs\MCP')
        }
        Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $unsafeReference 'unsafe_reference_directory'
if ($unsafeReference.paths[10].status -ne 'observed' -or
    $unsafeReference.paths[10].reparse -ne $true -or
    $unsafeReference.paths[10].broadMutationAllowCount -lt 1 -or
    @($unsafeReference.blockers | Where-Object {$_ -eq 'reference-installation-unqualified'}).Count -ne 1 -or
    @($unsafeReference.blockers | Where-Object {$_ -eq 'reference-root-reparse'}).Count -ne 1 -or
    @($unsafeReference.blockers | Where-Object {$_ -eq 'reference-root-broad-mutation'}).Count -ne 1) {
    throw 'unsafe_reference_directory_not_blocked'
}

# Even a narrow ACL is not proof of signing key ownership, source pins or an
# operational broker. Presence must remain explicitly unqualified.
$unqualifiedReference = (& {
    function Test-Path {
        [CmdletBinding()]param([string]$LiteralPath,[string]$PathType)
        if ($LiteralPath -eq 'C:\ProgramData\MTechLabs\ReferenceManager') { return $true }
        if ($PathType) {Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType}
        else {Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath}
    }
    function Get-Item {
        [CmdletBinding()]param([string]$LiteralPath,[switch]$Force)
        if ($LiteralPath -eq 'C:\ProgramData\MTechLabs\ReferenceManager') {
            return [pscustomobject]@{PSIsContainer=$true;Attributes=[IO.FileAttributes]::Directory}
        }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
    }
    function Get-Acl {
        [CmdletBinding()]param([string]$LiteralPath)
        if ($LiteralPath -eq 'C:\ProgramData\MTechLabs\ReferenceManager') {
            return (Microsoft.PowerShell.Security\Get-Acl -LiteralPath 'H:\MTechLabs\MCP\state')
        }
        Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $unqualifiedReference 'unqualified_reference_directory'
if ($unqualifiedReference.paths[10].status -ne 'observed' -or
    $unqualifiedReference.paths[10].reparse -ne $false -or
    $unqualifiedReference.paths[10].broadMutationAllowCount -ne 0 -or
    @($unqualifiedReference.blockers | Where-Object {$_ -eq 'reference-installation-unqualified'}).Count -ne 1 -or
    @($unqualifiedReference.blockers | Where-Object {$_ -eq 'reference-root-broad-mutation'}).Count -ne 0) {
    throw 'mere_reference_presence_promoted_to_qualified'
}

# Proposed installation roots must not become trusted merely by existing.
# Unsafe candidate code root: mocked junction and inherited broad writes.
$unsafeCandidate = (& {
    function Test-Path {
        [CmdletBinding()]param([string]$LiteralPath,[string]$PathType)
        if($LiteralPath -eq 'C:\Program Files\MTechLabs'){return $true}
        if($PathType){Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType}
        else{Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath}
    }
    function Get-Item {
        [CmdletBinding()]param([string]$LiteralPath,[switch]$Force)
        if($LiteralPath -eq 'C:\Program Files\MTechLabs'){
            return [pscustomobject]@{PSIsContainer=$true;Attributes=(
                [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)}
        }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
    }
    function Get-Acl {
        [CmdletBinding()]param([string]$LiteralPath)
        if($LiteralPath -eq 'C:\Program Files\MTechLabs'){
            return Microsoft.PowerShell.Security\Get-Acl -LiteralPath 'H:\MTechLabs\MCP'
        }
        Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $unsafeCandidate 'unsafe_candidate_root'
if($unsafeCandidate.paths[7].status -ne 'observed' -or
   $unsafeCandidate.paths[7].reparse -ne $true -or
   $unsafeCandidate.paths[7].broadMutationAllowCount -lt 1 -or
   @($unsafeCandidate.blockers|Where-Object{$_ -eq 'candidate-root-unqualified:candidateProtectedCode'}).Count -ne 1 -or
   @($unsafeCandidate.blockers|Where-Object{$_ -eq 'candidate-root-reparse:candidateProtectedCode'}).Count -ne 1 -or
   @($unsafeCandidate.blockers|Where-Object{$_ -eq 'candidate-root-broad-mutation:candidateProtectedCode'}).Count -ne 1){
    throw 'unsafe_candidate_root_not_blocked'
}

# A narrow-looking state root still lacks operational ownership validation.
$narrowCandidate = (& {
    function Test-Path {
        [CmdletBinding()]param([string]$LiteralPath,[string]$PathType)
        if($LiteralPath -eq 'C:\ProgramData\MTechLabs'){return $true}
        if($PathType){Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType}
        else{Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath}
    }
    function Get-Item {
        [CmdletBinding()]param([string]$LiteralPath,[switch]$Force)
        if($LiteralPath -eq 'C:\ProgramData\MTechLabs'){
            return [pscustomobject]@{PSIsContainer=$true;Attributes=[IO.FileAttributes]::Directory}
        }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
    }
    function Get-Acl {
        [CmdletBinding()]param([string]$LiteralPath)
        if($LiteralPath -eq 'C:\ProgramData\MTechLabs'){
            return Microsoft.PowerShell.Security\Get-Acl -LiteralPath 'H:\MTechLabs\MCP\state'
        }
        Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $narrowCandidate 'narrow_candidate_root'
if($narrowCandidate.paths[8].status -ne 'observed' -or
   @($narrowCandidate.blockers|Where-Object{$_ -eq 'candidate-root-unqualified:candidateProtectedState'}).Count -ne 1 -or
   @($narrowCandidate.blockers|Where-Object{$_ -eq 'candidate-root-broad-mutation:candidateProtectedState'}).Count -ne 0) {
    throw 'mere_candidate_root_presence_promoted'
}

# An unreadable proposed DEV-on-H: root must not be reported as absent/qualified.
$deniedCandidate = (& {
    function Test-Path {
        [CmdletBinding()]param([string]$LiteralPath,[string]$PathType)
        if($LiteralPath -eq 'H:\MTechLabs\MCP-DEV'){return $true}
        if($PathType){Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType}
        else{Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath}
    }
    function Get-Acl {
        [CmdletBinding()]param([string]$LiteralPath)
        if($LiteralPath -eq 'H:\MTechLabs\MCP-DEV'){throw 'synthetic_acl_read_denied'}
        Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $deniedCandidate 'unverified_candidate_root'
if($deniedCandidate.paths[9].status -ne 'unverified' -or
   @($deniedCandidate.blockers|Where-Object{$_ -eq 'candidate-root-unverified:proposedDevH'}).Count -ne 1) {
    throw 'unverified_candidate_root_not_blocked'
}

# Intentionally absent candidate paths are expected before provisioning, not
# an evidence claim about identity, effective rights or future names.
$absentCandidates = (& {
    function Test-Path {
        [CmdletBinding()]param([string]$LiteralPath,[string]$PathType)
        if($LiteralPath -in @('C:\Program Files\MTechLabs','C:\ProgramData\MTechLabs','H:\MTechLabs\MCP-DEV')){return $false}
        if($PathType){Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType}
        else{Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath}
    }
    & $source
}) | ConvertFrom-Json -AsHashtable
Assert-Inactive $absentCandidates 'absent_candidate_roots'
if(@($absentCandidates.paths|Where-Object{$_.id -in @('candidateProtectedCode','candidateProtectedState','proposedDevH') -and $_.status -ne 'absent'}).Count -ne 0 -or
   @($absentCandidates.blockers|Where-Object{$_ -like 'candidate-root-*'}).Count -ne 0){
    throw 'absent_candidate_roots_misreported'
}

# The production listener must be the sole listener anywhere on port 19740.
# These scenarios alter ONLY the PowerShell inventory returned to this process,
# never network adapters, binding state or any production service.
foreach($scenario in @(
    @{name='second_ipv4_wildcard';kind='extra-ipv4';status='listener-nonexclusive';blocker='production-listener-nonexclusive'},
    @{name='second_ipv6_wildcard';kind='extra-ipv6';status='listener-nonexclusive';blocker='production-listener-nonexclusive'},
    @{name='duplicate_loopback';kind='duplicate-loopback';status='listener-nonexclusive';blocker='production-listener-nonexclusive'},
    @{name='only_wildcard';kind='only-wildcard';status='listener-nonexclusive';blocker='production-listener-nonexclusive'},
    @{name='no_production_listener';kind='no-production';status='listener-absent';blocker='production-listener-unverified'},
    @{name='unrelated_extra_listener';kind='unrelated-listener';status='listener-present';blocker=$null}
)){
    $output = & {
        param([string]$kind)
        function Get-NetTCPConnection {
            [CmdletBinding()]
            param([string]$State)
            $existing = @(NetTCPIP\Get-NetTCPConnection -State Listen -ErrorAction Stop)
            $other = @($existing | Where-Object {$_.LocalPort -ne 19740})
            switch($kind) {
                'extra-ipv4' {
                    return @($existing) + @([pscustomobject]@{LocalAddress='0.0.0.0';LocalPort=19740;State='Listen'})
                }
                'extra-ipv6' {
                    return @($existing) + @([pscustomobject]@{LocalAddress='::';LocalPort=19740;State='Listen'})
                }
                'duplicate-loopback' {
                    return @($existing) + @([pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=19740;State='Listen'})
                }
                'only-wildcard' {
                    return @($other) + @([pscustomobject]@{LocalAddress='0.0.0.0';LocalPort=19740;State='Listen'})
                }
                'no-production' { return $other }
                'unrelated-listener' {
                    return @($existing) + @([pscustomobject]@{LocalAddress='0.0.0.0';LocalPort=19742;State='Listen'})
                }
                default { throw 'unknown_synthetic_listener_case' }
            }
        }
        & $source
    } $scenario.kind
    $observation = $output | ConvertFrom-Json -AsHashtable
    Assert-Inactive $observation $scenario.name
    $matched = @($observation.blockers | Where-Object {
        $_ -eq 'production-listener-unverified' -or $_ -eq 'production-listener-nonexclusive'
    })
    if($observation.listeners.production -ne $scenario.status -or
       ($null -eq $scenario.blocker -and $matched.Count -ne 0) -or
       ($null -ne $scenario.blocker -and ($matched.Count -ne 1 -or $matched[0] -ne $scenario.blocker))){
        throw ('production_port_exclusivity_failed_' + $scenario.name)
    }
}

$after = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($before -cne $after) { throw 'preflight_source_mutated_during_test' }

# No raw account/profile/SDDL data or command lines in emitted test evidence.
[pscustomobject]@{
    schemaVersion = 1
    scope = 'read-only-preflight-negative-controls'
    passed = 36
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
    reparseSubstitutionFailsClosed = $true
    typeSubstitutionFailsClosed = $true
    metadataDenialFailsClosed = $true
    noSeparateBaselineReaderDependencies = $true
    sameBytesBoundAndEncodingGuardsPresent = $true
    unknownMutablePrincipalFailsClosed = $true
    unknownInheritOnlyPrincipalFailsClosed = $true
    privilegedNameSpoofingFailsClosed = $true
    genuineBuiltinSidRecognized = $true
    unexpectedDevListenerBlocked = $true
    unknownListenerStateBlocked = $true
    unsafeReferenceRootBlocked = $true
    referencePresenceNotQualified = $true
    unsafeCandidateRootBlocked = $true
    candidateRootPresenceUnqualified = $true
    candidateRootUnreadableBlocked = $true
    absentCandidatesRemainUnclaimed = $true
    productionPortExclusiveBindingChecked = $true
    sourceHashStable = $true
    activationAuthorized = $false
} | ConvertTo-Json -Compress
