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

$listener = [ordered]@{production='unverified';development='unverified';productionInvocation='unverified';productionSocketRecheck='not-run'}
try {
    $sockets = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    # An exclusive loopback binding requires one listener on the entire port.
    # Counting only 127.0.0.1 would miss a second 0.0.0.0, :: or alternate
    # address listener and falsely report the expected binding as exclusive.
    $prodPort = @($sockets | Where-Object {$_.LocalPort -eq 19740})
    $dev = @($sockets | Where-Object {$_.LocalPort -eq 19741})
    $listener.production = if ($prodPort.Count -eq 0) {
        'listener-absent'
    } elseif ($prodPort.Count -eq 1 -and $prodPort[0].LocalAddress -eq '127.0.0.1') {
        'listener-present'
    } else {
        'listener-nonexclusive'
    }
    $listener.development = if ($dev.Count -eq 0) {'listener-absent'} else {'listener-present'}
    if ($listener.production -eq 'listener-present') {
        try {
            # The address/port alone cannot prove which executable owns the
            # endpoint. Read but never return the process command line.
            $ownerPid = [long]$prodPort[0].OwningProcess
            if ($ownerPid -lt 1 -or $ownerPid -gt [int]::MaxValue) {
                throw 'production_owner_pid_invalid'
            }
            $process = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $ownerPid) -ErrorAction Stop
            if ($null -eq $process -or [long]$process.ProcessId -ne $ownerPid) {
                throw 'production_owner_lookup_unverified'
            }
            $exe = 'C:\Program Files\nodejs\node.exe'
            $entry = 'H:\MTechLabs\MCP\runtime\admin.mjs'
            $config = 'H:\MTechLabs\MCP\state\manager.json'
            $text = [string]$process.CommandLine
            $exeRegex = '(?i)^\s*(?:"' + [regex]::Escape($exe) + '"|' + [regex]::Escape($exe) + ')(?=\s|$)'
            $entryRegex = '(?i)(?<!\S)(?:"' + [regex]::Escape($entry) + '"|' + [regex]::Escape($entry) + ')(?!\S)'
            $configRegex = '(?i)(?<!\S)--config\s+(?:"' + [regex]::Escape($config) + '"|' + [regex]::Escape($config) + ')(?!\S)'
            $flagRegex = '(?i)(?<!\S)--config(?=\s|$)'
            $match = ($process.ExecutablePath -ieq $exe -and
                [regex]::IsMatch($text, $exeRegex) -and
                [regex]::Matches($text, $entryRegex).Count -eq 1 -and
                [regex]::Matches($text, $configRegex).Count -eq 1 -and
                [regex]::Matches($text, $flagRegex).Count -eq 1)
            # Narrow the socket/process TOCTOU window. Re-observe the entire
            # production port after the CIM lookup. The same PID, sole binding,
            # and address must still be present; two matching samples are not
            # an immutable handle or proof against a later owner transition.
            $afterSocket = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
                Where-Object { $_.LocalPort -eq 19740 })
            $sameOwner = $false
            if ($afterSocket.Count -eq 1 -and
                $afterSocket[0].LocalAddress -eq '127.0.0.1') {
                try {
                    $sameOwner = ([long]$afterSocket[0].OwningProcess -eq $ownerPid)
                } catch { $sameOwner = $false }
            }
            if (-not $sameOwner) {
                $listener.productionSocketRecheck = 'changed'
                throw 'production_socket_binding_or_owner_changed'
            }
            $listener.productionSocketRecheck = 'matched'
            $listener.productionInvocation = if ($match) {'invocation-fields-match'} else {'invocation-mismatch'}
        } catch {
            $listener.productionInvocation = 'unverified'
        }
    }
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
if ($listener.production -eq 'listener-nonexclusive') {
    $blockers += 'production-listener-nonexclusive'
} elseif ($listener.production -ne 'listener-present') {
    $blockers += 'production-listener-unverified'
}
if ($listener.productionSocketRecheck -eq 'changed') {
    $blockers += 'production-owner-binding-drift'
}
if ($listener.productionInvocation -eq 'invocation-mismatch') {
    $blockers += 'production-invocation-mismatch'
} elseif ($listener.productionInvocation -ne 'invocation-fields-match') {
    $blockers += 'production-invocation-unverified'
}
# This is a pre-provisioning diagnostic. A DEV port being occupied before
# authorization can mask another process or stale deployment.
if ($listener.development -eq 'listener-present') {
    $blockers += 'dev-listener-unexpected'
} elseif ($listener.development -ne 'listener-absent') {
    $blockers += 'dev-listener-unverified'
}
$reference = $records.protectedReference
if ($reference.status -eq 'absent') {
    $blockers += 'reference-installation-absent'
} elseif ($reference.status -ne 'observed') {
    $blockers += 'reference-installation-unverified'
} else {
    # Present is not proof of a protected bootstrap, proper authority key
    # access or OS effective rights. That requires a separate identity-qualified
    # operational acceptance; do not silently remove the reference blocker.
    $blockers += 'reference-installation-unqualified'
    if ($reference.reparse) { $blockers += 'reference-root-reparse' }
    if ($reference.broadMutationAllowCount -gt 0 -or
        $reference.inheritableBroadMutationCount -gt 0) {
        $blockers += 'reference-root-broad-mutation'
    }
    if ($reference.unclassifiedMutationAllowCount -gt 0 -or
        $reference.inheritableUnclassifiedMutationCount -gt 0) {
        $blockers += 'reference-root-unclassified-mutation'
    }
}
# Candidate roots are proposals, not trusted or reserved installation
# targets. Presence (even with a narrow-looking DACL) needs fresh protected
# namespace/owner/effective-access verification before provisioning.
foreach ($name in @('candidateProtectedCode','candidateProtectedState','proposedDevH')) {
    $candidate = $records[$name]
    if ($candidate.status -eq 'absent') { continue }
    if ($candidate.status -ne 'observed') {
        $blockers += ('candidate-root-unverified:' + $name)
        continue
    }
    $blockers += ('candidate-root-unqualified:' + $name)
    if ($candidate.reparse) {
        $blockers += ('candidate-root-reparse:' + $name)
    }
    if ($candidate.broadMutationAllowCount -gt 0 -or
        $candidate.inheritableBroadMutationCount -gt 0) {
        $blockers += ('candidate-root-broad-mutation:' + $name)
    }
    if ($candidate.unclassifiedMutationAllowCount -gt 0 -or
        $candidate.inheritableUnclassifiedMutationCount -gt 0) {
        $blockers += ('candidate-root-unclassified-mutation:' + $name)
    }
}
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
