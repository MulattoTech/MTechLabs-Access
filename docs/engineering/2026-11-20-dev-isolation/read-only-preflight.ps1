# MTerm / Access #46. Read-only DEV isolation preflight, NOT an activation tool.
# No user/account creation, ACL mutation, file copying, service control or network calls.
#requires -Version 7.0
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PrincipalKind($identity) {
    # Privileged-looking names are not authority. Only the actual SID counts.
    $sid = $null
    try {
        if ($identity -is [Security.Principal.SecurityIdentifier]) {
            $sid = $identity.Value
        } elseif ($identity -is [Security.Principal.NTAccount]) {
            $sid = $identity.Translate([Security.Principal.SecurityIdentifier]).Value
        } elseif ($identity -is [string]) {
            $account = if ($identity -match '^S-1-[0-9-]+$') {
                [Security.Principal.SecurityIdentifier]::new($identity)
            } else {
                [Security.Principal.NTAccount]::new($identity)
            }
            $sid = $account.Translate([Security.Principal.SecurityIdentifier]).Value
        }
    } catch { return 'other' }
    switch -CaseSensitive ($sid) {
        'S-1-5-11' { return 'authenticated-users' }
        'S-1-1-0' { return 'everyone' }
        'S-1-5-32-545' { return 'builtin-users' }
        'S-1-5-18' { return 'system' }
        'S-1-5-32-544' { return 'administrators' }
        default { return 'other' }
    }
}
function Get-PathSummary([string]$id, [string]$absolutePath) {
    $result = [ordered]@{id=$id;status='absent';daclProtected=$null;reparse=$null;
        broadMutationAllowCount=0;inheritableBroadMutationCount=0;
        unclassifiedMutationAllowCount=0;inheritableUnclassifiedMutationCount=0;ownerKind=$null}
    try {
        # An inaccessible Test-Path must not terminate the entire assessment
        # or be silently reported as an absent production ancestor.
        $exists = Test-Path -LiteralPath $absolutePath -ErrorAction Stop
        if (-not $exists) {return [pscustomobject]$result}
        $item = Get-Item -LiteralPath $absolutePath -Force
        $acl = Get-Acl -LiteralPath $absolutePath
        $result.status = 'observed'
        $result.daclProtected = [bool]$acl.AreAccessRulesProtected
        $result.reparse = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
        $result.ownerKind = Get-PrincipalKind $acl.Owner
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {continue}
            $principal = Get-PrincipalKind $rule.IdentityReference
            $bits = [uint32]([int64]$rule.FileSystemRights -band 4294967295L)
            # Dangerous for namespace mutation: DELETE, DELETE_CHILD, WRITE_DATA,
            # APPEND_DATA, WRITE_EA, WRITE_ATTRIBUTES, WRITE_DAC, WRITE_OWNER,
            # generic WRITE and generic ALL.
            $danger = [uint32]0x500D0156
            if (($bits -band $danger) -eq 0) {continue}
            # SYSTEM/Administrators are known privileged authorities. Other
            # identities can be custom groups, localized built-ins, owner
            # accounts, or unresolved SIDs. Do not presume DEV lacks membership
            # before a real restricted-token effective-access qualification.
            if ($principal -in @('system','administrators')) {continue}
            $inheritOnly = [bool]($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)
            $isBroad = $principal -in @('authenticated-users','everyone','builtin-users')
            if ($isBroad) {
                if (-not $inheritOnly) {$result.broadMutationAllowCount++}
                if ($rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::None) {
                    $result.inheritableBroadMutationCount++
                }
            } else {
                if (-not $inheritOnly) {$result.unclassifiedMutationAllowCount++}
                if ($rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::None) {
                    $result.inheritableUnclassifiedMutationCount++
                }
            }
        }
    } catch {
        $result.status = 'unverified'
        $result.daclProtected = $null
        $result.reparse = $null
        $result.ownerKind = $null
        $result.broadMutationAllowCount = 0
        $result.inheritableBroadMutationCount = 0
        $result.unclassifiedMutationAllowCount = 0
        $result.inheritableUnclassifiedMutationCount = 0
    }
    return [pscustomobject]$result
}
$paths = [ordered]@{
    hRoot='H:\'
    hMTechLabs='H:\MTechLabs'
    hProduction='H:\MTechLabs\MCP'
    productionRuntime='H:\MTechLabs\MCP\runtime'
    productionState='H:\MTechLabs\MCP\state'
    cProgramFiles='C:\Program Files'
    cProgramData='C:\ProgramData'
    candidateProtectedCode='C:\Program Files\MTechLabs'
    candidateProtectedState='C:\ProgramData\MTechLabs'
    proposedDevH='H:\MTechLabs\MCP-DEV'
    protectedReference='C:\ProgramData\MTechLabs\ReferenceManager'
}
$records = [ordered]@{}
foreach ($name in $paths.Keys) { $records[$name] = Get-PathSummary $name $paths[$name] }

$baselineStatus = 'unavailable'
$baselineMatchCount = 0
try {
    # Environment-dependent profile paths may be unavailable, relative, remote,
    # or redirected. Never throw an unsanitized error before the JSON report
    # and never read a baseline from a remote/non-fixed drive.
    $baselineRoot = $env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($baselineRoot) -or $baselineRoot -notmatch '^[A-Za-z]:[\\/]' -or
        [IO.DriveInfo]::new([IO.Path]::GetPathRoot($baselineRoot)).DriveType -ne [IO.DriveType]::Fixed) {
        throw 'baseline_root_unavailable'
    }
    $baselineName = Join-Path $baselineRoot 'MTechLabs\MTermEngineering\Issue46\acl-baseline-20261120.json'
    if (Test-Path -LiteralPath $baselineName -PathType Leaf -ErrorAction Stop) {
        # Read a size-bounded snapshot through one handle. Hash and parse the
        # same bytes; two separate opens would permit a file replacement between
        # verification and JSON consumption. This is not native file-ID proof.
        $file = [IO.FileStream]::new($baselineName, [IO.FileMode]::Open,
            [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
            if ($file.Length -lt 1 -or $file.Length -gt 65536) {
                throw 'baseline_size_invalid'
            }
            $length = [int]$file.Length
            $bytes = [byte[]]::new($length)
            $offset = 0
            while ($offset -lt $length) {
                $read = $file.Read($bytes, $offset, $length - $offset)
                if ($read -le 0) { throw 'baseline_truncated' }
                $offset += $read
            }
            if ($file.ReadByte() -ne -1) { throw 'baseline_grew_during_read' }
        } finally {
            $file.Dispose()
        }
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }
        if ($hash -ne '07053c2a8075e3003f809898632152cc446d16b9b356919f2dad200308c27d9f') {
            $baselineStatus='hash-mismatch'
        } else {
            $baselineText = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
            $data = $baselineText | ConvertFrom-Json -AsHashtable
            $expected = @($data.paths)
            if ($expected.Count -ne 9) { throw 'baseline_shape_invalid' }
            foreach ($p in $expected) {
                # ACL equality is necessary but insufficient. A junction or
                # file/directory replacement may retain identical SDDL while
                # redirecting an approved production namespace.
                $freshItem = Get-Item -LiteralPath $p.path -Force -ErrorAction Stop
                $freshType = if ($freshItem.PSIsContainer) {'directory'} else {'file'}
                $freshReparse = [bool]($freshItem.Attributes -band [IO.FileAttributes]::ReparsePoint)
                $freshSddl = (Get-Acl -LiteralPath $p.path -ErrorAction Stop).Sddl
                if ($freshSddl -ceq $p.sddl -and $freshType -ceq $p.itemType -and
                    $freshReparse -eq [bool]$p.reparse) {
                    $baselineMatchCount++
                }
            }
            $baselineStatus = if ($baselineMatchCount -eq 9) {'matched'} else {'drift'}
        }
    }
 } catch {
    $baselineStatus='unverified'
    $baselineMatchCount = 0
}

$startup = 'unverified'
try {
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'MTerm-CLI Local MCP.lnk'
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
        $startup = 'absent'
    } else {
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
        $expectedArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "H:\MTechLabs\MCP\runtime\manage.ps1" -Action Start'
        if ($shortcut.TargetPath -ieq 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -and
            $shortcut.Arguments -ceq $expectedArgs -and
            $shortcut.WorkingDirectory -ieq 'H:\MTechLabs\MCP') {
            $startup = 'configured-exact'
        } else { $startup = 'mismatch' }
    }
} catch { $startup = 'unverified' }

$listener = [ordered]@{production='unverified';development='unverified'}
try {
    $sockets = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    $prod = @($sockets | Where-Object {$_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq 19740})
    $dev = @($sockets | Where-Object {$_.LocalPort -eq 19741})
    $listener.production = if ($prod.Count -eq 1) {'listener-present'} else {'absent-or-ambiguous'}
    $listener.development = if ($dev.Count -eq 0) {'listener-absent'} else {'listener-present'}
} catch {}

$devAccount = 'unverified'
try {
    # Only the specific not-found error establishes absence. A denied account
    # query must remain unverified, never become an apparent negative result.
    $user = Get-LocalUser -Name 'MTermDev' -ErrorAction Stop
    $devAccount = if ($null -eq $user) {'unverified'} else {'present-not-qualified'}
} catch {
    if ($_.FullyQualifiedErrorId -like 'UserNotFound,*') { $devAccount = 'absent' }
}
$devProfile = 'unverified'
try {
    $devProfile = if (Test-Path -LiteralPath 'C:\Users\MTermDev' -ErrorAction Stop) {
        'present-not-qualified'
    } else { 'absent' }
} catch {}

$blockers = @()
foreach ($name in @('hRoot','hMTechLabs','hProduction')) {
    $v = $records[$name]
    if ($v.status -ne 'observed') {
        $blockers += ('acl-unverified:' + $name)
    } else {
        if ($v.reparse) { $blockers += ('reparse-ancestor:' + $name) }
        if ($v.broadMutationAllowCount -gt 0 -or $v.inheritableBroadMutationCount -gt 0) {
            $blockers += ('broad-ancestor-mutation:' + $name)
        }
        if ($v.unclassifiedMutationAllowCount -gt 0 -or $v.inheritableUnclassifiedMutationCount -gt 0) {
            $blockers += ('unclassified-ancestor-mutation:' + $name)
        }
    }
}
if ($baselineStatus -ne 'matched') {$blockers += 'baseline-not-matched'}
if ($devAccount -ne 'present-not-qualified' -or $devProfile -ne 'present-not-qualified') {$blockers += 'dev-principal-not-provisioned'}
if ($startup -ne 'configured-exact') {$blockers += 'startup-unverified'}
if ($listener.production -ne 'listener-present') {$blockers += 'production-listener-unverified'}
if ($records.protectedReference.status -ne 'observed') {$blockers += 'reference-installation-absent'}
$blockers += 'github-hosted-source-acceptance-not-verified'
$blockers += 'real-dev-token-and-effective-access-not-verified'

# Diagnostic output omits raw ACLs, SIDs, profile paths, token values and commands.
[pscustomobject]@{
    schemaVersion = 1
    assessment = 'read-only-point-in-time-diagnostic'
    productionChanged = $false
    provisioned = $false
    activationAuthorized = $false
    readyForDevActivation = $false
    baseline = @{status=$baselineStatus;matchingPaths=$baselineMatchCount;expectedPaths=9}
    paths = @($records.Values)
    startup = $startup
    listeners = $listener
    devAccount = $devAccount
    devProfile = $devProfile
    blockers = @($blockers)
} | ConvertTo-Json -Depth 7 -Compress
