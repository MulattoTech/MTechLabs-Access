param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{32}$')][string]$FixtureId,
    [string]$SourceRoot,
    [string]$NodeSource,
    [switch]$CleanupOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$fixtureStarted = [Diagnostics.Stopwatch]::StartNew()
$fixtureRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('mterm-reference-fixture-' + $FixtureId)
$fixtureJournalPath = Join-Path $fixtureRoot 'fixture-owner.json'
$fixtureRootOwned = $false
$fixtureAccounts = @{}
$fixtureChildren = [Collections.Generic.List[object]]::new()
$fixtureCases = [Collections.Generic.List[object]]::new()
$fixtureFailure = $null
$fixtureFailureDiagnostic = $null
$fixtureCleanupErrors = [Collections.Generic.List[string]]::new()
$fixtureCleanupDiagnostics = [Collections.Generic.List[object]]::new()
$fixtureStage = 'context'
$fixtureLastOperation = 'context_guards'
$fixtureSetup = @{ exclusiveRootCreated = $false; rootAclApplied = $false; initialJournalSaved = $false;
    sourceFilesCopied = 0; nodeCopied = $false; sourceTreeGuarded = $false }
$fixtureModulePathObservation = $null
$fixtureServer = $null
$fixtureServiceOriginal = $null
$fixtureServiceStarted = $false
$fixtureProvision = $null
$fixtureIdentities = @{}
$fixtureCleanup = @{ accountsRemoved = $false; profilesRemoved = $false; ownedChildrenExited = $false;
    ownedAccountProcessesExited = $false; fixtureTreeRemoved = $false; serviceRestored = $false; forcedChildCleanup = 0 }
$fixtureSourceFiles = @('package.json','inspect-dev-runtime.mjs','reference-server.mjs','manage-dev.ps1',
    'windows-reference.ps1','windows-reference-native.cs','windows-runtime-probe.ps1','lib/reference-bootstrap.mjs',
    'lib/reference-transport.mjs','lib/production-reference.mjs','lib/dev-runtime-reference.mjs','lib/runtime-files.mjs',
    'lib/runtime-identity.mjs','lib/dev-runtime-plan.mjs','lib/dev-instance.mjs','lib/config.mjs','lib/token.mjs')
$fixtureHelpers = @('test/fixtures/reference-transport-child.mjs','test/fixtures/reference-transport-pipe.ps1')
$fixtureHashes = @{}

function Assert-Fixture([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }
function Cleanup-Failure([string]$Code, $Record = $null) {
    $fixtureCleanupErrors.Add($Code)
    if ($null -ne $Record -and $fixtureCleanupDiagnostics.Count -lt 16) { $fixtureCleanupDiagnostics.Add((Error-Diagnostic $Record)) }
    if ($null -eq $script:fixtureFailure) { $script:fixtureFailure = $Code }
}
function Field($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}
function Hash-Text([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}
function Hash-File([string]$Filename) { return (Get-FileHash -LiteralPath $Filename -Algorithm SHA256).Hash.ToLowerInvariant() }
function Error-Diagnostic($Record) {
    # Capture identifiers and numeric locations only. Messages, targets,
    # positions, stack traces, argv and private path strings are never emitted.
    $chain = [Collections.Generic.List[object]]::new()
    $exception = $Record.Exception
    for ($index = 0; $null -ne $exception -and $index -lt 4; $index++) {
        $type = $exception.GetType().FullName
        if ($type -notmatch '^(System|Microsoft)\.[A-Za-z0-9_.]{1,150}$') { $type = 'redacted_exception_type' }
        $nativeCode = if ($exception -is [ComponentModel.Win32Exception]) { [int]$exception.NativeErrorCode } else { $null }
        $chain.Add(@{ type = $type; hresult = [int]$exception.HResult; nativeErrorCode = $nativeCode })
        $exception = $exception.InnerException
    }
    $errorId = [string]$Record.FullyQualifiedErrorId
    $errorIdHash = Hash-Text $errorId
    if ($errorId -notmatch '^[A-Za-z][A-Za-z0-9_.-]{0,127}(?:,(?:System|Microsoft)\.[A-Za-z0-9_.]{1,128})?$' -or
        $errorId -match 'PRIVATE-FIXTURE|S-1-5-21-|mtr[adu][a-f0-9]{11}') { $errorId = 'redacted_error_identifier' }
    $command = 'unknown_command'; $line = 0
    if ($null -ne $Record.InvocationInfo) {
        $line = [int]$Record.InvocationInfo.ScriptLineNumber
        if ($null -ne $Record.InvocationInfo.MyCommand) { $command = [string]$Record.InvocationInfo.MyCommand.Name }
    }
    if ($command -notmatch '^[A-Za-z][A-Za-z0-9_.-]{0,127}$') { $command = 'unknown_command' }
    return @{ stage = $fixtureStage; lastRecordedOperation = $fixtureLastOperation;
        command = $command; line = $line;
        category = $Record.CategoryInfo.Category.ToString(); errorId = $errorId;
        errorIdSha256 = $errorIdHash; exceptionChain = @($chain) }
}
function Module-Path-Observation {
    $value = [Environment]::GetEnvironmentVariable('PSModulePath')
    if ($null -eq $value) { $value = '' }
    $entries = @($value.Split(';') | Where-Object { $_ -ne '' })
    return @{ sha256 = (Hash-Text $value); entryCount = $entries.Count;
        includesWindowsPowerShellSystemModules = @($entries | Where-Object { $_.TrimEnd('\') -ieq 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules' }).Count -gt 0;
        includesPowerShellCoreModules = @($entries | Where-Object { $_.TrimEnd('\') -match '\\PowerShell\\[67](?:[.0-9-]*)\\Modules$' }).Count -gt 0 }
}
function Remaining([int]$Maximum = 40000) {
    $left = 360000 - [int]$fixtureStarted.ElapsedMilliseconds
    Assert-Fixture ($left -gt 0) 'fixture_work_deadline'
    return [Math]::Min($Maximum, $left)
}
function Save-Journal {
    $script:fixtureLastOperation = 'journal_collect_accounts'
    $owned = @($fixtureAccounts.Values | ForEach-Object { @{ name = $_.Name; sid = $_.Sid; role = $_.Role;
        profile = $(if ($fixtureIdentities.ContainsKey($_.Role)) { $fixtureIdentities[$_.Role].profile } else { $null }) } })
    $record = @{ schemaVersion = 1; fixtureId = $FixtureId; users = $owned; serviceOriginal = $fixtureServiceOriginal;
        serviceStarted = $fixtureServiceStarted; children = @($fixtureChildren | ForEach-Object { @{ pid = $_.Process.Id; startTicks = $_.StartTicks } }) }
    $script:fixtureLastOperation = 'journal_serialize'
    $serialized = $record | ConvertTo-Json -Compress -Depth 8
    $script:fixtureLastOperation = 'journal_write'
    [IO.File]::WriteAllText($fixtureJournalPath, $serialized, [Text.UTF8Encoding]::new($false))
}
function Guard-Path([string]$Target, [string[]]$Readers = @(), [string[]]$Writers = @()) {
    $script:fixtureLastOperation = 'acl_directory_probe'
    $isDirectory = [IO.Directory]::Exists($Target)
    $script:fixtureLastOperation = 'acl_construct'
    $acl = if ($isDirectory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $script:fixtureLastOperation = 'acl_protect'
    $acl.SetAccessRuleProtection($true, $false)
    $script:fixtureLastOperation = 'acl_owner'
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $script:fixtureLastOperation = 'acl_inheritance'
    $inherit = if ($isDirectory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
        $script:fixtureLastOperation = 'acl_system_rule'
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),
            [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow))
    }
    foreach ($sid in $Readers) {
        $script:fixtureLastOperation = 'acl_reader_rule'
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),
            [Security.AccessControl.FileSystemRights]::ReadAndExecute, $inherit, [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow))
    }
    foreach ($sid in $Writers) {
        $script:fixtureLastOperation = 'acl_writer_rule'
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),
            [Security.AccessControl.FileSystemRights]::Modify, $inherit, [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow))
    }
    $script:fixtureLastOperation = 'acl_apply'
    Set-Acl -LiteralPath $Target -AclObject $acl
}
function Guard-Tree([string]$Target, [string[]]$Readers = @(), [string[]]$Writers = @()) {
    Guard-Path $Target $Readers $Writers
    foreach ($item in @(Get-ChildItem -LiteralPath $Target -Recurse -Force)) { Guard-Path $item.FullName $Readers $Writers }
}
function Start-Child([string]$Role, [string]$Executable, [string[]]$Arguments, $Payload, [bool]$KeepInput = $false, [hashtable]$ExtraEnvironment = @{}) {
    $null = Remaining
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    # Only fixed fixture modes and checked fixture paths appear in argv. User
    # credentials are passed through ProcessStartInfo's native logon fields.
    foreach ($argument in $Arguments) { Assert-Fixture (-not $argument.Contains('"')) 'fixture_argument_invalid' }
    $start.Arguments = (($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $start.WorkingDirectory = $fixtureRoot
    if ($Role -ne 'controller') {
        $account = $fixtureAccounts[$Role]
        $start.UserName = $account.Name; $start.Domain = [Environment]::MachineName
        $start.Password = $account.Password; $start.LoadUserProfile = $true
    }
    $start.EnvironmentVariables.Clear()
    foreach ($key in @('SystemRoot','WINDIR','COMSPEC','GITHUB_ACTIONS','RUNNER_ENVIRONMENT','RUNNER_OS')) {
        if ($null -ne [Environment]::GetEnvironmentVariable($key)) { $start.EnvironmentVariables[$key] = [Environment]::GetEnvironmentVariable($key) }
    }
    $start.EnvironmentVariables['PATH'] = 'C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0'
    $start.EnvironmentVariables['MTERM_DISPOSABLE_REFERENCE_QUALIFICATION'] = '1'
    $start.EnvironmentVariables['TEMP'] = Join-Path $fixtureRoot ($Role + '-temp')
    $start.EnvironmentVariables['TMP'] = $start.EnvironmentVariables['TEMP']
    if ($fixtureIdentities.ContainsKey($Role)) {
        $start.EnvironmentVariables['USERPROFILE'] = $fixtureIdentities[$Role].profile
        $start.EnvironmentVariables['HOME'] = $fixtureIdentities[$Role].profile
        $start.EnvironmentVariables['APPDATA'] = Join-Path $fixtureIdentities[$Role].profile 'AppData\Roaming'
        $start.EnvironmentVariables['LOCALAPPDATA'] = Join-Path $fixtureIdentities[$Role].profile 'AppData\Local'
        $start.EnvironmentVariables['TEMP'] = $fixtureIdentities[$Role].temporary
        $start.EnvironmentVariables['TMP'] = $fixtureIdentities[$Role].temporary
        $start.WorkingDirectory = $fixtureIdentities[$Role].temporary
    }
    foreach ($key in $ExtraEnvironment.Keys) {
        Assert-Fixture ($key -eq 'PSModulePath') 'fixture_environment_override_invalid'
        $start.EnvironmentVariables[$key] = $ExtraEnvironment[$key]
    }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
    Assert-Fixture ($process.Start()) 'fixture_child_start_failed'
    $record = [pscustomobject]@{ Process = $process; StartTicks = $process.StartTime.ToUniversalTime().Ticks;
        Pending = $null; ErrorTask = $process.StandardError.ReadToEndAsync(); Messages = [Collections.Generic.List[object]]::new() }
    $fixtureChildren.Add($record); Save-Journal
    $process.StandardInput.WriteLine(($Payload | ConvertTo-Json -Compress -Depth 24)); $process.StandardInput.Flush()
    if (-not $KeepInput) { $process.StandardInput.Close() }
    return $record
}
function Send-Child($Record, $Value) {
    $Record.Process.StandardInput.WriteLine(($Value | ConvertTo-Json -Compress -Depth 16)); $Record.Process.StandardInput.Flush()
}
function Read-Message($Record, [string]$Event = 'result', [int]$Budget = 40000) {
    $watch = [Diagnostics.Stopwatch]::StartNew(); $limit = Remaining $Budget
    while ($watch.ElapsedMilliseconds -lt $limit) {
        if ($null -eq $Record.Pending) { $Record.Pending = $Record.Process.StandardOutput.ReadLineAsync() }
        Assert-Fixture ($Record.Pending.Wait([Math]::Max(1, $limit - [int]$watch.ElapsedMilliseconds))) 'fixture_message_timeout'
        $line = $Record.Pending.Result; $Record.Pending = $null
        Assert-Fixture ($null -ne $line -and $line.Length -le 131072) 'fixture_child_output_invalid'
        $value = $line | ConvertFrom-Json; $Record.Messages.Add($value)
        if ($Event -eq 'result' -and $null -ne (Field $value 'ok')) { return $value }
        if ((Field $value 'event') -eq $Event) { return $value }
        if ((Field $value 'status') -eq $Event) { return $value }
        Assert-Fixture ((Field $value 'ok') -ne $false) 'fixture_child_rejected'
    }
    throw 'fixture_message_timeout'
}
function Finish-Child($Record, [int]$ExpectedExit = 0) {
    Assert-Fixture ($Record.Process.WaitForExit((Remaining 40000))) 'fixture_child_exit_timeout'
    Assert-Fixture ($Record.Process.ExitCode -eq $ExpectedExit) 'fixture_child_exit_wrong'
    Assert-Fixture ($Record.ErrorTask.Wait(1000) -and $Record.ErrorTask.Result -eq '') 'fixture_child_stderr'
}
function Node-Call([string]$Role, [string]$Mode, $Payload, [bool]$ExpectOk = $true) {
    $record = Start-Child $Role $fixtureNode @($fixtureChild, $Mode) $Payload
    $result = Read-Message $record
    Finish-Child $record $(if ($ExpectOk) { 0 } else { 1 })
    Assert-Fixture ((Field $result 'ok') -eq $ExpectOk) 'fixture_child_result_wrong'
    return $result
}
function Start-Authority([bool]$Registered) {
    $record = Start-Child 'authority' $fixtureNode @($fixtureChild,'server') @{ registered = $Registered } $true
    $ready = Read-Message $record 'ready'
    Assert-Fixture ($ready.registered -eq $Registered -and $ready.counters.invocations -eq 0) 'fixture_server_ready_invalid'
    return $record
}
function Stop-Authority($Record) {
    Send-Child $Record @{ action = 'release' }; Send-Child $Record @{ action = 'close' }
    $null = Read-Message $Record 'closed'
    $Record.Process.StandardInput.Close(); $last = Read-Message $Record
    Assert-Fixture ($last.ok -and $last.result.drained) 'fixture_server_not_drained'
    Finish-Child $Record
}
function Stats($Record) {
    Send-Child $Record @{ action = 'stats' }
    return (Read-Message $Record 'stats').counters
}
function Wait-Stats($Record, [int]$Invocations, [int]$Active = -1, [int]$Budget = 40000) {
    $watch = [Diagnostics.Stopwatch]::StartNew(); $limit = Remaining $Budget
    do {
        $value = Stats $Record
        if ($value.invocations -eq $Invocations -and ($Active -lt 0 -or $value.active -eq $Active)) { return $value }
        Assert-Fixture ($value.invocations -le $Invocations) 'fixture_unexpected_dispatch'
        Start-Sleep -Milliseconds 20
    } while ($watch.ElapsedMilliseconds -lt $limit)
    throw 'fixture_dispatch_timeout'
}
function Add-Case([string]$Name, [int]$Controls, $Details) {
    $fixtureCases.Add(@{ name = $Name; passed = $true; positiveControls = $Controls; details = $Details })
}
function Registered-Control($Server) {
    $before = (Stats $Server).invocations
    $value = Node-Call 'development' 'inspect' @{ productionState = $fixtureProvision.production.state;
        productionRuntime = $fixtureProvision.production.runtime;
        productionProfile = $fixtureIdentities['authority'].profile; authorityRoot = $fixtureProvision.authorityRoot }
    Assert-Fixture ($value.result.counters.nodeProductionPathAttempts -eq 0 -and $value.result.counters.nodeFilesystemWrites -eq 0) 'fixture_consumer_io'
    Assert-Fixture ($value.result.report.productionReference.evidence -eq 'authenticated-point-in-time' -and
        $value.result.report.fingerprints.productionConfig -eq $fixtureProvision.productionConfigSha256 -and
        $value.result.report.qualified -eq $false -and $value.result.report.upstreamEnabled -eq $false) 'fixture_reference_report_invalid'
    Assert-Fixture ((Stats $Server).invocations -eq $before + 1) 'fixture_registered_dispatch_count'
    return $value.result
}
function Inspect-Denial($Server, $Options = @{}) {
    $before = (Stats $Server).invocations
    $value = (Node-Call 'development' 'inspect-denial' @{ productionState = $fixtureProvision.production.state;
        productionRuntime = $fixtureProvision.production.runtime;
        productionProfile = $fixtureIdentities['authority'].profile; authorityRoot = $fixtureProvision.authorityRoot; options = $Options }).result
    Assert-Fixture ($value.rejected -and $value.error -eq 'runtime_reference_bootstrap_untrusted' -and
        $value.counters.nodeProductionPathAttempts -eq 0 -and $value.counters.nodeFilesystemWrites -eq 0) 'fixture_expected_inspection_denial'
    return @{ result = $value; invocationDelta = (Stats $Server).invocations - $before }
}
function Mechanism-Control($Server) {
    $before = (Stats $Server).invocations
    $result = (Node-Call 'development' 'exchange' @{}).result.response | ConvertFrom-Json
    Assert-Fixture ($result.fixtureResponse -eq $true -and (Stats $Server).invocations -eq $before + 1) 'fixture_mechanism_control_failed'
}
function Frame([byte[]]$Payload) {
    $value = [byte[]]::new($Payload.Length + 4)
    [Buffer]::BlockCopy([BitConverter]::GetBytes([uint32]$Payload.Length),0,$value,0,4)
    [Buffer]::BlockCopy($Payload,0,$value,4,$Payload.Length)
    return [Convert]::ToBase64String($value)
}
function Pipe-Call([string]$Role, [string]$Name, [string]$Bytes) {
    $record = Start-Child $Role $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',$fixturePipeScript,'-Mode','Raw') @{ name = $Name; frame = $Bytes }
    $result = Read-Message $record; Finish-Child $record
    Assert-Fixture $result.ok 'fixture_raw_pipe_failed'
    return $result.result
}
function State-Hash {
    $entries = @()
    foreach ($directory in @($fixtureProvision.production.state,$fixtureProvision.development.state)) {
        foreach ($file in @(Get-ChildItem -LiteralPath $directory -Recurse -File | Sort-Object FullName)) {
            $entries += ($file.FullName + ':' + (Hash-File $file.FullName))
        }
    }
    return Hash-Text ($entries -join "`n")
}
function New-Pipe-Server([string]$Role, [string]$Name, [string]$Sddl, [bool]$First, [bool]$RejectRemote, [bool]$Respond) {
    $record = Start-Child $Role $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',$fixturePipeScript,'-Mode','Create') @{
        name = $Name; sddl = $Sddl; first = $First; rejectRemote = $RejectRemote; respond = $Respond } $true
    $ready = Read-Message $record 'ready'
    Assert-Fixture ($ready.created -eq $true) 'fixture_control_pipe_not_created'
    return $record
}
function Token-Control([string]$Role) {
    $record = Start-Child $Role $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',$fixturePipeScript,'-Mode','Token') @{}
    $result = Read-Message $record; Finish-Child $record
    Assert-Fixture $result.ok 'fixture_token_control_failed'
    return $result.result
}
function Close-Pipe-Server($Record) {
    $Record.Process.StandardInput.Close(); $result = Read-Message $Record; Finish-Child $Record
    Assert-Fixture ($result.ok -and $result.result.created -and $result.result.disposed) 'fixture_pipe_not_disposed'
    return $result.result
}
function Add-Unsafe-Ace([string]$Target, [Security.AccessControl.FileSystemRights]$Rights) {
    $acl = Get-Acl -LiteralPath $Target
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new($fixtureAccounts['development'].Sid), $Rights,
        [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $Target -AclObject $acl
}
function Owned-Account-Processes {
    $found = @()
    foreach ($process in @(Get-Process -IncludeUserName -ErrorAction SilentlyContinue)) {
        foreach ($account in $fixtureAccounts.Values) {
            if ($process.UserName -ieq ([Environment]::MachineName + '\' + $account.Name)) {
                $native = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $process.Id) -ErrorAction SilentlyContinue
                if ($null -eq $native) { continue }
                $owner = Invoke-CimMethod -InputObject $native -MethodName GetOwnerSid
                Assert-Fixture ($owner.ReturnValue -eq 0 -and $owner.Sid -eq $account.Sid) 'fixture_process_owner_changed'
                $found += $process
            }
        }
    }
    return $found
}
function Cleanup-Fixture {
    $cleanupWatch = [Diagnostics.Stopwatch]::StartNew()
    if (-not $fixtureRootOwned) { return }
    foreach ($record in @($fixtureChildren)) {
        try {
            if (-not $record.Process.HasExited) {
                try { $record.Process.StandardInput.Close() } catch { }
                if (-not $record.Process.WaitForExit(500)) { $record.Process.Kill(); $null = $record.Process.WaitForExit(3000); $fixtureCleanup.forcedChildCleanup++ }
            }
        } catch { Cleanup-Failure 'fixture_owned_process_cleanup_failed' $_ }
    }
    $fixtureCleanup.ownedChildrenExited = @($fixtureChildren | Where-Object { -not $_.Process.HasExited }).Count -eq 0
    foreach ($record in @($fixtureChildren)) { try { $record.Process.Dispose() } catch { } }
    # Account SIDs were freshly created and journaled before any later setup.
    # Only processes proven to have one of those exact tokens are considered.
    foreach ($process in @(Owned-Account-Processes)) {
        try { if (-not $process.HasExited) { $process.Kill(); $null = $process.WaitForExit(3000); $fixtureCleanup.forcedChildCleanup++ } }
        finally { $process.Dispose() }
    }
    $fixtureCleanup.ownedAccountProcessesExited = @(Owned-Account-Processes).Count -eq 0
    $profileDirectories = @($fixtureIdentities.Values | ForEach-Object { $_.profile })
    $profileDirectories += @($fixtureAccounts.Values | Where-Object { $_.ContainsKey('Profile') -and $_.Profile } | ForEach-Object { $_.Profile })
    foreach ($account in @($fixtureAccounts.Values)) {
        try {
            Assert-Fixture ($cleanupWatch.ElapsedMilliseconds -lt 50000) 'fixture_cleanup_deadline'
            $user = Get-LocalUser -SID ([Security.Principal.SecurityIdentifier]::new($account.Sid)) -ErrorAction SilentlyContinue
            $namedUser = Get-LocalUser -Name $account.Name -ErrorAction SilentlyContinue
            Assert-Fixture (($null -eq $user -and $null -eq $namedUser) -or
                ($null -ne $user -and $user.Name -eq $account.Name -and $namedUser.SID.Value -eq $account.Sid)) 'fixture_cleanup_identity_changed'
            $profileWatch = [Diagnostics.Stopwatch]::StartNew()
            do {
                $profiles = @(Get-CimInstance Win32_UserProfile -Filter ("SID='" + $account.Sid + "'"))
                if (@($profiles | Where-Object { $_.Loaded }).Count -eq 0) { break }
                Start-Sleep -Milliseconds 100
            } while ($profileWatch.ElapsedMilliseconds -lt 5000)
            foreach ($entry in $profiles) {
                Assert-Fixture (-not $entry.Loaded) 'fixture_owned_profile_still_loaded'
                $profileDirectories += $entry.LocalPath
                $entry | Remove-CimInstance
            }
            if ($null -ne $user) { Remove-LocalUser -SID ([Security.Principal.SecurityIdentifier]::new($account.Sid)) }
            if ($null -ne $account.Password) { $account.Password.Dispose() }
        } catch { Cleanup-Failure 'fixture_owned_identity_cleanup_failed' $_ }
    }
    $fixtureCleanup.accountsRemoved = @($fixtureAccounts.Values | Where-Object { $null -ne (Get-LocalUser -Name $_.Name -ErrorAction SilentlyContinue) }).Count -eq 0
    $fixtureCleanup.profilesRemoved = @($fixtureAccounts.Values | Where-Object { @(Get-CimInstance Win32_UserProfile -Filter ("SID='" + $_.Sid + "'")).Count -ne 0 }).Count -eq 0
    $fixtureCleanup.profileDirectoriesRemoved = @($profileDirectories | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0
    try {
        if ($fixtureServiceStarted -and $fixtureServiceOriginal -eq 'Stopped') {
            Stop-Service LanmanServer; (Get-Service LanmanServer).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(10))
            $script:fixtureServiceStarted = $false
        }
        $fixtureCleanup.serviceRestored = -not $fixtureServiceStarted -and
            ($null -eq $fixtureServiceOriginal -or (Get-Service LanmanServer).Status.ToString() -eq $fixtureServiceOriginal)
    } catch { Cleanup-Failure 'fixture_service_restore_failed' $_ }
    try {
        Assert-Fixture ($fixtureCleanup.accountsRemoved -and $fixtureCleanup.profilesRemoved -and
            $fixtureCleanup.profileDirectoriesRemoved -and $fixtureCleanup.ownedChildrenExited -and
            $fixtureCleanup.ownedAccountProcessesExited -and $fixtureCleanup.serviceRestored) 'fixture_preserve_recovery_journal'
        $binding = [IO.File]::ReadAllText($fixtureJournalPath) | ConvertFrom-Json
        Assert-Fixture ($binding.schemaVersion -eq 1 -and $binding.fixtureId -ceq $FixtureId) 'fixture_cleanup_journal_mismatch'
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
        $fixtureCleanup.fixtureTreeRemoved = -not (Test-Path -LiteralPath $fixtureRoot)
    } catch { Cleanup-Failure 'fixture_tree_cleanup_failed' $_ }
    if (-not $fixtureCleanup.accountsRemoved -or -not $fixtureCleanup.profilesRemoved -or -not $fixtureCleanup.profileDirectoriesRemoved -or
        -not $fixtureCleanup.ownedChildrenExited -or -not $fixtureCleanup.ownedAccountProcessesExited -or
        -not $fixtureCleanup.fixtureTreeRemoved -or -not $fixtureCleanup.serviceRestored) { Cleanup-Failure 'fixture_cleanup_incomplete' }
}

if ($CleanupOnly) {
    try {
        $fixtureStage = 'emergency_cleanup'; $fixtureLastOperation = 'emergency_context_guards'
        Assert-Fixture ($env:MTERM_DISPOSABLE_REFERENCE_QUALIFICATION -eq '1' -and $env:GITHUB_ACTIONS -eq 'true' -and
            $env:RUNNER_ENVIRONMENT -eq 'github-hosted' -and $env:RUNNER_OS -eq 'Windows') 'fixture_disposable_host_required'
        $fixtureLastOperation = 'emergency_root_exists'
        Assert-Fixture (Test-Path -LiteralPath $fixtureRoot -PathType Container) 'fixture_cleanup_root_missing'
        $fixtureLastOperation = 'emergency_root_owner'
        $owner = (Get-Acl -LiteralPath $fixtureRoot).GetOwner([Security.Principal.SecurityIdentifier]).Value
        $fixtureLastOperation = 'emergency_journal_size'
        Assert-Fixture ($owner -eq 'S-1-5-32-544' -and (Get-Item -LiteralPath $fixtureJournalPath).Length -lt 65536) 'fixture_cleanup_owner_invalid'
        $fixtureLastOperation = 'emergency_journal_read'
        $journal = [IO.File]::ReadAllText($fixtureJournalPath) | ConvertFrom-Json
        Assert-Fixture ($journal.schemaVersion -eq 1 -and $journal.fixtureId -ceq $FixtureId) 'fixture_cleanup_journal_mismatch'
        foreach ($owned in @($journal.users)) {
            Assert-Fixture ($owned.role -in @('authority','development','unauthorized') -and
                $owned.name -ceq ('mtr' + $owned.role.Substring(0,1) + $FixtureId.Substring(0,11))) 'fixture_cleanup_user_invalid'
            $user = Get-LocalUser -Name $owned.name -ErrorAction SilentlyContinue
            $bySid = Get-LocalUser -SID ([Security.Principal.SecurityIdentifier]::new($owned.sid)) -ErrorAction SilentlyContinue
            Assert-Fixture (($null -eq $user -and $null -eq $bySid) -or
                ($null -ne $user -and $user.SID.Value -ceq $owned.sid -and $bySid.Name -ceq $owned.name)) 'fixture_cleanup_identity_changed'
            $fixtureAccounts[$owned.role] = @{ Name = $owned.name; Sid = $owned.sid; Password = $null; Role = $owned.role; Profile = $owned.profile }
        }
        foreach ($owned in @($journal.children)) {
            $process = Get-Process -Id $owned.pid -ErrorAction SilentlyContinue
            if ($null -ne $process -and $process.StartTime.ToUniversalTime().Ticks -eq $owned.startTicks) {
                $fixtureChildren.Add([pscustomobject]@{ Process = $process; StartTicks = $owned.startTicks })
            }
        }
        $fixtureServiceOriginal = $journal.serviceOriginal; $fixtureServiceStarted = $journal.serviceStarted
        $fixtureRootOwned = $true
        Cleanup-Fixture
        [Console]::Out.WriteLine((@{ schemaVersion = 1; emergencyCleanup = $true; cleanup = $fixtureCleanup;
            cleanupErrors = @($fixtureCleanupErrors); failure = $fixtureFailure } | ConvertTo-Json -Compress))
        if ($fixtureFailure) { exit 1 } else { exit 0 }
    } catch {
        [Console]::Out.WriteLine((@{ schemaVersion = 1; emergencyCleanup = $true;
            failure = 'fixture_emergency_cleanup_failed'; failureDiagnostic = (Error-Diagnostic $_) } | ConvertTo-Json -Compress -Depth 10))
        exit 1
    }
}

try {
    $fixtureModulePathObservation = Module-Path-Observation
    Assert-Fixture ($env:MTERM_DISPOSABLE_REFERENCE_QUALIFICATION -eq '1' -and $env:GITHUB_ACTIONS -eq 'true' -and
        $env:RUNNER_ENVIRONMENT -eq 'github-hosted' -and $env:RUNNER_OS -eq 'Windows') 'fixture_disposable_host_required'
    Assert-Fixture ([Environment]::Is64BitProcess) 'fixture_native_bitness_required'
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    Assert-Fixture ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'fixture_privilege_required'
    Assert-Fixture (-not $env:NODE_OPTIONS -and -not $env:NODE_PATH) 'fixture_preload_rejected'
    $fixtureStage = 'create_fixture_root'; $fixtureLastOperation = 'root_collision_check'
    Assert-Fixture (-not (Test-Path -LiteralPath $fixtureRoot)) 'fixture_root_collision'
    $fixtureLastOperation = 'root_create'
    $null = New-Item -ItemType Directory -Path $fixtureRoot
    $fixtureRootOwned = $true
    $fixtureSetup.exclusiveRootCreated = $true
    $fixtureStage = 'protect_fixture_root'
    Guard-Path $fixtureRoot @('S-1-5-32-545')
    $fixtureSetup.rootAclApplied = $true
    $fixtureStage = 'write_initial_ownership_journal'
    Save-Journal
    $fixtureSetup.initialJournalSaved = $true
    $fixtureStage = 'select_fixed_fixture_paths'; $fixtureLastOperation = 'fixed_path_join'
    $fixtureNode = Join-Path $fixtureRoot 'runtime\node.exe'
    $fixtureChild = Join-Path $fixtureRoot 'test\fixtures\reference-transport-child.mjs'
    $fixturePipeScript = Join-Path $fixtureRoot 'test\fixtures\reference-transport-pipe.ps1'
    $fixturePowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $fixtureStage = 'copy_source_files'
    foreach ($relative in @($fixtureSourceFiles + $fixtureHelpers)) {
        $fixtureLastOperation = 'copy_source_path_join'
        $source = Join-Path $SourceRoot $relative; $target = Join-Path $fixtureRoot $relative
        $fixtureLastOperation = 'copy_source_directory_create'
        $null = New-Item -ItemType Directory -Path (Split-Path $target) -Force
        $fixtureLastOperation = 'copy_source_file'
        Copy-Item -LiteralPath $source -Destination $target
        $fixtureLastOperation = 'hash_source_file'
        $fixtureHashes[$relative] = Hash-File $source
        $fixtureLastOperation = 'compare_source_copy_hash'
        Assert-Fixture ((Hash-File $target) -eq $fixtureHashes[$relative]) 'fixture_source_copy_mismatch'
        $fixtureSetup.sourceFilesCopied++
    }
    $fixtureStage = 'copy_node_binary'; $fixtureLastOperation = 'copy_node_directory_create'
    $null = New-Item -ItemType Directory -Path (Split-Path $fixtureNode) -Force
    $fixtureLastOperation = 'copy_node_file'
    Copy-Item -LiteralPath $NodeSource -Destination $fixtureNode
    $fixtureLastOperation = 'hash_node_file'
    $fixtureNodeHash = Hash-File $NodeSource
    $fixtureLastOperation = 'compare_node_copy_hash'
    Assert-Fixture ((Hash-File $fixtureNode) -eq $fixtureNodeHash) 'fixture_node_copy_mismatch'
    $fixtureSetup.nodeCopied = $true
    $fixtureStage = 'protect_source_tree'
    Guard-Tree $fixtureRoot @('S-1-5-32-545')
    $fixtureSetup.sourceTreeGuarded = $true
    $fixtureStage = 'create_owned_accounts'
    foreach ($role in @('authority','development','unauthorized')) {
        $name = 'mtr' + $role.Substring(0,1) + $FixtureId.Substring(0,11)
        Assert-Fixture ($null -eq (Get-LocalUser -Name $name -ErrorAction SilentlyContinue)) 'fixture_user_collision'
        $password = [Guid]::NewGuid().ToString('N') + 'aA7!'
        $secure = ConvertTo-SecureString -String $password -AsPlainText -Force; $password = $null
        $user = New-LocalUser -Name $name -Password $secure -AccountNeverExpires -PasswordNeverExpires
        # Retain the successful creation before any later group/setup action can
        # fail, so cleanup cannot mistake a partial setup for an empty scope.
        $fixtureAccounts[$role] = @{ Name = $name; Sid = $user.SID.Value; Password = $secure; Role = $role }
        Save-Journal
        if (@(Get-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')) | Where-Object { $_.SID.Value -eq $user.SID.Value }).Count -eq 0) {
            Add-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')) -Member $user
        }
        $temp = Join-Path $fixtureRoot ($role + '-temp'); $null = New-Item -ItemType Directory -Path $temp
        Guard-Path $temp @() @($user.SID.Value)
    }
    $null = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'controller-temp')
    Guard-Path (Join-Path $fixtureRoot 'controller-temp')
    $fixtureStage = 'real_identity_controls'
    foreach ($role in @('authority','development','unauthorized')) {
        $profile = (Node-Call $role 'profile' @{ fixtureId = $FixtureId }).result
        Assert-Fixture ($profile.createdByOwnedUser -and $profile.noNativeCompilation) 'fixture_profile_temp_not_owned'
        $fixtureIdentities[$role] = $profile
        $identity = (Node-Call $role 'identity' @{}).result
        Assert-Fixture ($identity.sid -eq $fixtureAccounts[$role].Sid -and $identity.isAdministrator -eq $false -and
            $identity.realCurrentProcessMatched -and $identity.osProfileMatchesNative -and $identity.profile -ieq $profile.profile) 'fixture_actual_identity_mismatch'
        $identity | Add-Member -NotePropertyName temporary -NotePropertyValue $profile.temporary
        $fixtureIdentities[$role] = $identity
        $token = Token-Control $role
        Assert-Fixture ($token.usersPresent -and -not $token.administratorPresent -and $token.elevated -eq 0 -and
            $token.elevationType -eq 1 -and $token.prohibitedPrivileges -eq 0) 'fixture_standard_token_invalid'
    }
    Assert-Fixture (@($fixtureIdentities.Values | ForEach-Object { $_.profile.ToLowerInvariant() } | Select-Object -Unique).Count -eq 3) 'fixture_profile_overlap'
    Add-Case 'separate reference accounts have actual standard tokens and independently loaded profiles' 3 @{
        actualSidMatches = 3; standardTokens = 3; distinctProfiles = 3;
        rawTokenGroupsObserved = 3; administratorsMembershipAbsent = 3; usersMembershipPresent = 3;
        defaultElevationType = 3; nonElevatedTokens = 3; prohibitedPrivileges = 0;
        accountOwnedProfileTemps = 3; profileLoadedBeforeNativeCompilation = $true;
        sidSha256 = @($fixtureIdentities.Values | ForEach-Object { Hash-Text $_.sid } | Sort-Object) }
    $fixtureStage = 'protected_bootstrap_setup'
    $fixtureProvision = (Node-Call 'controller' 'provision' @{ authority = $fixtureIdentities['authority']; development = $fixtureIdentities['development'] }).result
    Guard-Tree $fixtureProvision.bootstrapRoot @('S-1-5-32-545')
    Guard-Tree $fixtureProvision.authorityRoot @($fixtureAccounts['authority'].Sid)
    Guard-Tree $fixtureProvision.production.state @() @($fixtureAccounts['authority'].Sid)
    Guard-Tree $fixtureProvision.production.runtime @($fixtureAccounts['authority'].Sid)
    Guard-Tree $fixtureProvision.development.state @($fixtureAccounts['authority'].Sid) @($fixtureAccounts['development'].Sid)
    Guard-Tree $fixtureProvision.development.runtime @($fixtureAccounts['authority'].Sid,$fixtureAccounts['development'].Sid)
    $profileAcl = Get-Acl -LiteralPath $fixtureIdentities['development'].profile
    $profileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new($fixtureAccounts['authority'].Sid),
        [Security.AccessControl.FileSystemRights]'ReadAttributes,ReadPermissions,Traverse,Synchronize',
        [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $fixtureIdentities['development'].profile -AclObject $profileAcl
    $fixtureStateBefore = State-Hash
    $fixturePipeName = '\\.\pipe\mterm-dev-reference-v1-' + $fixtureProvision.registrationSha256
    $fixtureSddl = 'O:' + $fixtureAccounts['authority'].Sid + 'D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;' +
        $fixtureAccounts['authority'].Sid + ')(A;;0x00120183;;;' + $fixtureAccounts['development'].Sid + ')'

    $fixtureStage = 'registered_authority_control'
    $fixtureServer = Start-Authority $true
    $inspected = Registered-Control $fixtureServer
    Add-Case 'actual standard DEV receives a registered signed reference without production reads or writer effects' 1 @{
        registeredAuthorityInvocations = 1; nodeProductionPathAttempts = $inspected.counters.nodeProductionPathAttempts;
        nodeFilesystemWrites = $inspected.counters.nodeFilesystemWrites; productionConfigMatched = $true;
        qualified = $false; upstreamEnabled = $false }

    $fixtureStage = 'public_inspect_status'
    Stop-Authority $fixtureServer; $fixtureServer = $null
    $operational = Start-Child 'authority' $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',
        (Join-Path $fixtureRoot 'windows-reference.ps1'),'-Mode','Authority') @{} $true
    $operationalReady = Read-Message $operational 'reference_ready'
    Assert-Fixture ($operationalReady.qualified -eq $false -and $operationalReady.upstreamEnabled -eq $false) 'fixture_operational_ready_invalid'
    $publicActions = @()
    foreach ($action in @('Inspect','Status')) {
        $record = Start-Child 'development' $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',
            (Join-Path $fixtureRoot 'manage-dev.ps1'),'-Action',$action,'-NodePath',$fixtureNode,
            '-ConfigPath',$fixtureProvision.development.configPath,'-PlanPath',$fixtureProvision.planPath) @{}
        Assert-Fixture ($record.Process.WaitForExit((Remaining 45000))) 'fixture_public_wrapper_timeout'
        $text = $record.Process.StandardOutput.ReadToEnd(); $diagnostic = $record.ErrorTask.Result
        Assert-Fixture ($record.Process.ExitCode -eq 0 -and $diagnostic -eq '') 'fixture_public_wrapper_failed'
        $report = $text | ConvertFrom-Json
        Assert-Fixture ($report.qualified -eq $false -and $report.upstreamEnabled -eq $false -and
            $report.productionReference.evidence -eq 'authenticated-point-in-time') 'fixture_public_report_invalid'
        $publicActions += $action
    }
    $operational.Process.StandardInput.Close(); Finish-Child $operational
    Add-Case 'public Inspect and Status use protected bootstrap and the real cross-account reference' 2 @{
        actions = $publicActions; authenticatedReports = 2; directReaderFallback = $false; activationAuthorized = $false;
        authorityEntry = 'windows-reference.ps1 -Mode Authority'; operationalReadyObserved = $true; stdinShutdownExit = 0;
        callbackInstrumentation = $false; operationalInFlightShutdownObserved = $false }
    $fixtureServer = Start-Authority $true

    $fixtureStage = 'unauthorized_actual_token'
    $request = (Node-Call 'development' 'request' @{}).result.request
    $frame = Frame ([Text.Encoding]::UTF8.GetBytes($request))
    $before = (Stats $fixtureServer).invocations
    $denied = Pipe-Call 'unauthorized' $fixturePipeName $frame
    Assert-Fixture (-not $denied.connected -and $denied.error -eq 5 -and (Stats $fixtureServer).invocations -eq $before) 'fixture_unauthorized_caller_admitted'
    $null = Registered-Control $fixtureServer
    Add-Case 'unauthorized real requester is rejected before any registered authority invocation' 1 @{
        actualUnauthorizedToken = $true; nativeAccessDenied = $true; authorityInvocationDelta = 0 }

    $fixtureStage = 'private_key_and_installer_denials'
    foreach ($readTarget in @((Join-Path $fixtureProvision.authorityRoot 'signing-key.pk8'),
        (Join-Path $fixtureProvision.authorityRoot 'registration.json'))) {
        $access = (Node-Call 'development' 'access' @{ readTarget = $readTarget; writeTarget = (Join-Path $fixtureProvision.bootstrapRoot 'must-not-create') }).result
        Assert-Fixture ($access.readDenied -and $access.writeDenied) 'fixture_private_or_ancestor_access'
    }
    $null = Registered-Control $fixtureServer
    Add-Case 'DEV cannot read private signing material or create replacements in protected bootstrap' 1 @{
        privateKeyReadDenied = $true; privateRegistrationReadDenied = $true; protectedParentWriteDenied = $true }

    $fixtureStage = 'selected_targets_and_pre_node_pins'
    foreach ($options in @(@{ configPath = $fixtureProvision.production.configPath }, @{ planPath = $fixtureProvision.production.configPath })) {
        $denial = Inspect-Denial $fixtureServer $options
        Assert-Fixture ($denial.invocationDelta -eq 0) 'fixture_override_dispatched'
        $null = Registered-Control $fixtureServer
    }
    Stop-Authority $fixtureServer; $fixtureServer = $null
    $entry = Join-Path $fixtureRoot 'reference-server.mjs'
    $entryBytes = [IO.File]::ReadAllBytes($entry)
    $sentinel = Join-Path $fixtureIdentities['authority'].temporary 'pre-node-entry-executed'
    $sentinelStatement = "import {writeFileSync as fixtureSentinelWrite} from 'node:fs';fixtureSentinelWrite(" + ($sentinel | ConvertTo-Json -Compress) + ",'fixture');`n"
    try {
        [IO.File]::WriteAllText($entry, $sentinelStatement + [Text.Encoding]::UTF8.GetString($entryBytes), [Text.UTF8Encoding]::new($false))
        $blocked = Start-Child 'authority' $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',
            (Join-Path $fixtureRoot 'windows-reference.ps1'),'-Mode','Authority') @{}
        Assert-Fixture ($blocked.Process.WaitForExit((Remaining 30000))) 'fixture_pre_node_guard_timeout'
        Assert-Fixture ($blocked.Process.ExitCode -eq 1 -and $blocked.Process.StandardOutput.ReadToEnd() -eq '' -and
            $blocked.ErrorTask.Result.Trim() -eq 'runtime_reference_bootstrap_untrusted' -and -not (Test-Path -LiteralPath $sentinel)) 'fixture_entry_executed_before_pin'
    } finally { [IO.File]::WriteAllBytes($entry, $entryBytes) }
    $fixtureServer = Start-Authority $true; $null = Registered-Control $fixtureServer
    Add-Case 'protected selections and source pins reject overrides before authority or altered entry execution' 3 @{
        rejectedSelectedOverrides = @('config','plan'); overrideAuthorityInvocationDelta = 0;
        sourceHashChanged = $true; alteredOperationalEntrySentinelAbsent = $true; nodeProductionPathAttempts = 0;
        sourceRestored = (Hash-File $entry) -eq $fixtureHashes['reference-server.mjs'] }

    $fixtureStage = 'protected_acl_boundaries'
    $trustPath = Join-Path $fixtureProvision.bootstrapRoot 'trust.json'
    $aclCases = @(
        @{ name = 'public-trust-write'; target = $trustPath; rights = [Security.AccessControl.FileSystemRights]::WriteData },
        @{ name = 'public-trust-owner'; target = $trustPath; owner = $true },
        @{ name = 'bootstrap-ancestor-delete-child'; target = $fixtureProvision.bootstrapRoot; rights = [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles },
        @{ name = 'source-write'; target = (Join-Path $fixtureRoot 'lib\reference-transport.mjs'); rights = [Security.AccessControl.FileSystemRights]::WriteData },
        @{ name = 'private-authority-delete-child'; target = $fixtureProvision.authorityRoot; rights = [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles; authority = $true }
    )
    $aclRejected = @()
    foreach ($fault in $aclCases) {
        $savedAcl = Get-Acl -LiteralPath $fault.target
        $before = (Stats $fixtureServer).invocations
        try {
            if ($fault.ContainsKey('owner')) {
                $changedAcl = Get-Acl -LiteralPath $fault.target
                $changedAcl.SetOwner([Security.Principal.SecurityIdentifier]::new($fixtureAccounts['development'].Sid))
                Set-Acl -LiteralPath $fault.target -AclObject $changedAcl
            } else { Add-Unsafe-Ace $fault.target $fault.rights }
            if ($fault.ContainsKey('authority')) {
                $denied = Node-Call 'authority' 'bootstrap' @{ role = 'authority' } $false
                Assert-Fixture ($denied.error -eq 'runtime_reference_bootstrap_untrusted') 'fixture_private_acl_accepted'
            } else {
                $denial = Inspect-Denial $fixtureServer
                Assert-Fixture ($denial.invocationDelta -eq 0) 'fixture_unsafe_acl_dispatched'
            }
            Assert-Fixture ((Stats $fixtureServer).invocations -eq $before) 'fixture_acl_observer_called'
            $aclRejected += $fault.name
        } finally { Set-Acl -LiteralPath $fault.target -AclObject $savedAcl }
        $null = Registered-Control $fixtureServer
    }
    Add-Case 'unsafe public private and ancestor ACLs fail closed with restored signed controls' 5 @{
        rejected = $aclRejected; authorityInvocationDeltaDuringFaults = 0; privateDeleteChildMask = 64;
        privateAuthorityHandleRejected = $true; nativePrivateReadAuditing = $false }

    $fixtureStage = 'administrators_membership_refusal'
    $devUser = Get-LocalUser -SID ([Security.Principal.SecurityIdentifier]::new($fixtureAccounts['development'].Sid))
    try {
        Add-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')) -Member $devUser
        $adminToken = Token-Control 'development'
        Assert-Fixture $adminToken.administratorPresent 'fixture_admin_membership_not_observed'
        $before = (Stats $fixtureServer).invocations
        $denied = Node-Call 'development' 'bootstrap' @{ role = 'client' } $false
        Assert-Fixture ($denied.error -eq 'runtime_reference_bootstrap_untrusted' -and (Stats $fixtureServer).invocations -eq $before) 'fixture_admin_requester_admitted'
    } finally { Remove-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')) -Member $devUser }
    $restoredToken = Token-Control 'development'
    Assert-Fixture (-not $restoredToken.administratorPresent -and $restoredToken.elevated -eq 0 -and $restoredToken.elevationType -eq 1) 'fixture_standard_membership_not_restored'
    $null = Registered-Control $fixtureServer
    Add-Case 'a fresh DEV logon with Administrators membership is refused then standard access is restored' 1 @{
        administratorsPresent = $adminToken.administratorPresent; observedElevationType = $adminToken.elevationType;
        denyOnlyAdministratorsObserved = $adminToken.administratorDenyOnly; observedElevated = $adminToken.elevated;
        filteredTokenCoverageClaimed = $adminToken.administratorDenyOnly; authorityInvocationDelta = 0; standardMembershipRestored = $true }

    $fixtureStage = 'namespace_and_server_identity'
    $devOwnedSddl = 'O:' + $fixtureAccounts['development'].Sid + $fixtureSddl.Substring($fixtureSddl.IndexOf('D:P'))
    $attempt = Start-Child 'development' $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',$fixturePipeScript,'-Mode','Create') @{
        name = $fixturePipeName; sddl = $devOwnedSddl; first = $false; rejectRemote = $true; respond = $false }
    $attemptResult = Read-Message $attempt; Finish-Child $attempt
    Assert-Fixture ($attemptResult.ok -and -not $attemptResult.result.created -and $attemptResult.result.error -in @(5,231)) 'fixture_second_product_server_created'
    # A separate free-capacity neighbor isolates CREATE_PIPE_INSTANCE rights
    # from the real broker's eight precreated instances.
    $rightsName = $fixturePipeName + '-rights-control'
    $tight = New-Pipe-Server 'authority' $rightsName $fixtureSddl $true $true $false
    $attempt = Start-Child 'development' $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',$fixturePipeScript,'-Mode','Create') @{
        name = $rightsName; sddl = $devOwnedSddl; first = $false; rejectRemote = $true; respond = $false }
    $tightResult = Read-Message $attempt; Finish-Child $attempt
    Assert-Fixture ($tightResult.ok -and -not $tightResult.result.created -and $tightResult.result.error -eq 5) 'fixture_create_instance_not_denied'
    $null = Close-Pipe-Server $tight
    $wideSddl = $fixtureSddl.Replace('0x00120183','0x00120187')
    $wide = New-Pipe-Server 'authority' $rightsName $wideSddl $true $true $false
    $wideChild = New-Pipe-Server 'development' $rightsName ($devOwnedSddl.Replace('0x00120183','0x00120187')) $false $true $false
    $null = Close-Pipe-Server $wideChild; $null = Close-Pipe-Server $wide
    $null = Registered-Control $fixtureServer
    Stop-Authority $fixtureServer; $fixtureServer = $null
    $rogueSddl = 'O:' + $fixtureAccounts['development'].Sid + 'D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;' +
        $fixtureAccounts['authority'].Sid + ')(A;;FA;;;' + $fixtureAccounts['development'].Sid + ')'
    $rogue = New-Pipe-Server 'development' $fixturePipeName $rogueSddl $true $true $false
    $denied = Node-Call 'development' 'exchange' @{} $false
    Assert-Fixture ($denied.error -eq 'runtime_reference_unavailable') 'fixture_rogue_endpoint_accepted'
    $occupied = Node-Call 'authority' 'server' @{ registered = $true } $false
    Assert-Fixture ($occupied.error -in @('runtime_reference_unavailable','runtime_reference_bootstrap_untrusted')) 'fixture_first_instance_not_enforced'
    $rogueResult = Close-Pipe-Server $rogue
    Assert-Fixture ($rogueResult.connected -and $rogueResult.bytesRead -eq 0) 'fixture_request_sent_to_rogue'
    $fixtureServer = Start-Authority $true; $null = Registered-Control $fixtureServer
    Add-Case 'DEV cannot add a pipe server or impersonate the pinned authority endpoint' 3 @{
        productSecondServerDenied = $true; productSecondServerError = $attemptResult.result.error;
        freeCapacityWithoutCreateInstanceDenied = $true; freeCapacityWithCreateInstanceAllowed = $true;
        firstInstanceCollisionRejected = $true; rogueConnected = $true; rogueRequestBytesRead = 0;
        serverOwnerAndDaclRejectedBeforeRequest = $true }

    $fixtureStage = 'remote_client_rejection'
    $service = Get-Service LanmanServer
    $fixtureServiceOriginal = $service.Status.ToString()
    Assert-Fixture ($fixtureServiceOriginal -in @('Running','Stopped')) 'fixture_service_state_unsupported'
    if ($fixtureServiceOriginal -eq 'Stopped') {
        $fixtureServiceStarted = $true; Save-Journal
        Start-Service LanmanServer; (Get-Service LanmanServer).WaitForStatus('Running',[TimeSpan]::FromSeconds(10))
    } else { Save-Journal }
    $remoteName = $fixturePipeName + '-remote-control'
    $remoteServer = New-Pipe-Server 'authority' $remoteName $fixtureSddl $true $false $true
    $request = (Node-Call 'development' 'request' @{}).result.request; $frame = Frame ([Text.Encoding]::UTF8.GetBytes($request))
    $uncPrefix = '\\' + [Environment]::MachineName + '\pipe\'
    $allowedRemote = Pipe-Call 'development' ($uncPrefix + $remoteName.Substring(9)) $frame
    $allowedServer = Close-Pipe-Server $remoteServer
    $expectedRemote = [Text.Encoding]::UTF8.GetBytes('fixture-remote-control')
    $expectedRemoteHash = [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash($expectedRemote))
    Assert-Fixture ($allowedRemote.connected -and $allowedRemote.written -and $allowedRemote.error -eq 0 -and
        $allowedRemote.responseBytes -eq $expectedRemote.Length -and $allowedRemote.responseSha256 -eq $expectedRemoteHash -and
        $allowedServer.clientSid -eq $fixtureAccounts['development'].Sid) 'fixture_remote_control_unavailable'
    $before = (Stats $fixtureServer).invocations
    $deniedRemote = Pipe-Call 'development' ($uncPrefix + $fixturePipeName.Substring(9)) $frame
    Assert-Fixture (-not $deniedRemote.connected -and $deniedRemote.error -ne 0 -and (Stats $fixtureServer).invocations -eq $before) 'fixture_remote_product_client_admitted'
    $null = Registered-Control $fixtureServer
    Add-Case 'actual remote pipe clients are denied beside an authenticated allow-remote control' 2 @{
        remoteControlConnected = $true; remoteControlResponseMatched = $true; remoteControlActualDevSidMatched = $true;
        productRemoteConnected = $false; productRemoteError = $deniedRemote.error; authorityInvocationDelta = 0;
        firewallOrAuthenticationPolicyChanged = $false; serverServiceOriginal = $fixtureServiceOriginal }

    $fixtureStage = 'response_pin_substitution'
    $trustBytes = [IO.File]::ReadAllBytes($trustPath)
    try {
        $changed = Node-Call 'controller' 'change-public-pin' @{}
        Assert-Fixture $changed.result.changedPublicPin 'fixture_pin_not_changed'
        $denial = Inspect-Denial $fixtureServer
        Assert-Fixture ($denial.invocationDelta -eq 1) 'fixture_signature_denial_wrong_stage'
    } finally { [IO.File]::WriteAllBytes($trustPath, $trustBytes) }
    $null = Registered-Control $fixtureServer
    Add-Case 'a substituted public response pin rejects a real signed observation without reader fallback' 1 @{
        validEd25519PinSubstituted = $true; actualRegisteredAuthorityInvocationDelta = 1;
        acceptedProofs = 0; nodeProductionPathAttempts = 0; restoredSignedReference = $true }

    $fixtureStage = 'hostile_module_environment'
    $moduleRoot = Join-Path $fixtureIdentities['development'].temporary 'hostile-modules'
    $moduleDirectory = Join-Path $moduleRoot 'CimCmdlets'; $null = New-Item -ItemType Directory -Path $moduleDirectory
    $moduleSentinel = Join-Path $fixtureIdentities['development'].temporary 'hostile-module-executed'
    [IO.File]::WriteAllText((Join-Path $moduleDirectory 'CimCmdlets.psm1'),
        "[IO.File]::WriteAllText('" + $moduleSentinel.Replace("'","''") + "','fixture')", [Text.UTF8Encoding]::new($false))
    $moduleControlScript = 'Import-Module CimCmdlets;[Console]::Out.WriteLine(''{"ok":true,"result":{"control":true}}'')'
    $unprotected = Start-Child 'development' $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
        [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($moduleControlScript))) @{} $false @{ PSModulePath = $moduleRoot }
    $unprotectedResult = Read-Message $unprotected; Finish-Child $unprotected
    Assert-Fixture ($unprotectedResult.ok -and (Test-Path -LiteralPath $moduleSentinel)) 'fixture_hostile_module_control_missing'
    Remove-Item -LiteralPath $moduleSentinel
    $protected = Start-Child 'development' $fixtureNode @($fixtureChild,'identity') @{} $false @{ PSModulePath = $moduleRoot }
    $protectedResult = Read-Message $protected; Finish-Child $protected
    Assert-Fixture ($protectedResult.ok -and $protectedResult.result.sid -eq $fixtureAccounts['development'].Sid -and
        $protectedResult.result.realCurrentProcessMatched -and -not (Test-Path -LiteralPath $moduleSentinel)) 'fixture_hostile_module_executed'
    Add-Case 'native runtime probes ignore a hostile module search path after a real neighbor executes it' 1 @{
        unguardedModuleControlExecuted = $true; guardedProbeCurrentPidMatched = $true; guardedSentinelAbsent = $true;
        mappedNetworkDriveQualification = $false }

    Stop-Authority $fixtureServer; $fixtureServer = Start-Authority $false
    $fixtureStage = 'strict_single_frame'
    Mechanism-Control $fixtureServer
    $request = (Node-Call 'development' 'request' @{}).result.request
    $validFrame = [Convert]::FromBase64String((Frame ([Text.Encoding]::UTF8.GetBytes($request))))
    $doubleFrame = [byte[]]::new($validFrame.Length * 2)
    [Buffer]::BlockCopy($validFrame,0,$doubleFrame,0,$validFrame.Length); [Buffer]::BlockCopy($validFrame,0,$doubleFrame,$validFrame.Length,$validFrame.Length)
    $extraFrame = [byte[]]::new($validFrame.Length + 1); [Buffer]::BlockCopy($validFrame,0,$extraFrame,0,$validFrame.Length); $extraFrame[$validFrame.Length] = 65
    $truncatedFrame = [byte[]]::new(5); [Buffer]::BlockCopy([BitConverter]::GetBytes([uint32]100),0,$truncatedFrame,0,4); $truncatedFrame[4] = 65
    $frames = @(
        @{ name = 'oversized'; bytes = [BitConverter]::GetBytes([uint32]2049) },
        @{ name = 'invalid-utf8'; bytes = [Convert]::FromBase64String((Frame ([byte[]]@(255)))) },
        @{ name = 'coalesced-second-frame'; bytes = $doubleFrame },
        @{ name = 'coalesced-extra-byte'; bytes = $extraFrame },
        @{ name = 'truncated-frame'; bytes = $truncatedFrame }
    )
    $rejectedFrames = @()
    foreach ($fault in $frames) {
        $before = (Stats $fixtureServer).invocations
        $result = Pipe-Call 'development' $fixturePipeName ([Convert]::ToBase64String($fault.bytes))
        Assert-Fixture ($result.connected -and $result.written -and $result.responseBytes -eq 0 -and $result.error -ne 0) 'fixture_invalid_frame_accepted'
        $null = Wait-Stats $fixtureServer $before 0
        $rejectedFrames += $fault.name
    }
    Mechanism-Control $fixtureServer
    Add-Case 'oversized malformed truncated and coalesced frames are refused before callback dispatch' 2 @{
        rejected = $rejectedFrames; actualAuthenticatedConnections = 5; acceptedResponses = 0; callbackInvocationDelta = 0;
        callbackScope = 'synthetic transport mechanism; not a signed reference' }

    $fixtureStage = 'delayed_extra_byte'
    $request = (Node-Call 'development' 'request' @{ requestMode = 'hold' }).result.request
    $extraBefore = Stats $fixtureServer; $before = $extraBefore.invocations
    $delayed = Start-Child 'development' $fixturePowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',$fixturePipeScript,'-Mode','Delayed') @{
        name = $fixturePipeName; frame = (Frame ([Text.Encoding]::UTF8.GetBytes($request))) } $true
    $null = Read-Message $delayed 'first_written'; $null = Wait-Stats $fixtureServer ($before + 1) 1
    Send-Child $delayed @{ frame = [Convert]::ToBase64String([byte[]]@(65)) }
    $null = Read-Message $delayed 'extra_written'
    $extraWatch = [Diagnostics.Stopwatch]::StartNew(); $extraLimit = Remaining 5000
    do {
        $extraObserved = Stats $fixtureServer
        Assert-Fixture ($extraObserved.invocations -eq $before + 1 -and $extraObserved.active -eq 1) 'fixture_extra_byte_stage_changed'
        if ($extraObserved.aborted -eq $extraBefore.aborted + 1) { break }
        Start-Sleep -Milliseconds 20
    } while ($extraWatch.ElapsedMilliseconds -lt $extraLimit)
    Assert-Fixture ($extraObserved.aborted -eq $extraBefore.aborted + 1) 'fixture_extra_byte_not_observed_before_release'
    Send-Child $fixtureServer @{ action = 'release' }
    $delayed.Process.StandardInput.Close(); $delayedResult = Read-Message $delayed; Finish-Child $delayed
    Assert-Fixture ($delayedResult.ok -and $delayedResult.result.responseBytes -eq 0 -and $delayedResult.result.error -ne 0) 'fixture_delayed_extra_response_accepted'
    $settled = Wait-Stats $fixtureServer ($before + 1) 0
    Assert-Fixture ($settled.aborted -eq $extraBefore.aborted + 1) 'fixture_delayed_extra_not_cancelled'
    Mechanism-Control $fixtureServer
    Add-Case 'an observed delayed extra byte cancels one admitted callback and prevents its response' 1 @{
        firstCallbackAdmitted = $true; extraByteWriteCompletedBeforeRelease = $true; callbackInvocationDelta = 1;
        extraByteCancellationObservedBeforeRelease = $true; acceptedResponses = 0; cancellationObserved = $true;
        privateSchedulerRaceBranchClaimed = $false }

    $fixtureStage = 'captured_signals_and_error_privacy'
    $before = (Stats $fixtureServer).invocations
    $signals = Start-Child 'development' $fixtureNode @($fixtureChild,'signal-options') @{ requestMode = 'hold' } $true
    $signalReady = Read-Message $signals 'exchange_started'
    Assert-Fixture ($signalReady.accessorRejected -and $signalReady.getterCalls -eq 0 -and $signalReady.replacementAborted) 'fixture_signal_setup_invalid'
    $null = Wait-Stats $fixtureServer ($before + 1) 1
    Send-Child $signals @{ action = 'abort' }; $signals.Process.StandardInput.Close()
    $signalResult = Read-Message $signals; Finish-Child $signals
    Assert-Fixture ($signalResult.ok -and -not $signalResult.result.accepted -and
        $signalResult.result.error -eq 'runtime_reference_cancelled' -and $signalResult.result.originalAborted) 'fixture_captured_signal_invalid'
    $null = Wait-Stats $fixtureServer ($before + 1) 1
    Send-Child $fixtureServer @{ action = 'release' }; $null = Wait-Stats $fixtureServer ($before + 1) 0
    foreach ($mode in @('hostile-error','oversized-response')) {
        $before = (Stats $fixtureServer).invocations
        $denied = Node-Call 'development' 'exchange' @{ requestMode = $mode } $false
        Assert-Fixture ($denied.error -in @('runtime_reference_unavailable','runtime_reference_invalid') -and
            (Stats $fixtureServer).invocations -eq $before + 1) 'fixture_private_error_or_response_leaked'
    }
    Mechanism-Control $fixtureServer
    Add-Case 'captured cancellation and hostile callback values preserve bounded errors and real settlement' 1 @{
        signalGetterCalls = 0; accessorRejectedBeforeDispatch = $true; mutatedReplacementAbortIgnored = $true;
        originalAbortObserved = $true; slotRetainedUntilCallbackRelease = $true; hostileProxyErrorSanitized = $true;
        oversizedResponseRejected = $true; publicErrorPrivacy = $true }

    $fixtureStage = 'real_transport_deadline'
    $before = (Stats $fixtureServer).invocations
    $deadlineWatch = [Diagnostics.Stopwatch]::StartNew()
    $expired = Node-Call 'development' 'exchange' @{ requestMode = 'hold' } $false
    $deadlineElapsed = $deadlineWatch.ElapsedMilliseconds
    Assert-Fixture ($expired.error -in @('runtime_reference_expired','runtime_reference_unavailable') -and
        $deadlineWatch.ElapsedMilliseconds -ge 25000 -and $deadlineWatch.ElapsedMilliseconds -lt 45000) 'fixture_transport_deadline_not_observed'
    $null = Wait-Stats $fixtureServer ($before + 1) 1
    Send-Child $fixtureServer @{ action = 'release' }; $null = Wait-Stats $fixtureServer ($before + 1) 0
    Mechanism-Control $fixtureServer
    Add-Case 'a real transport deadline refuses the response while retaining an ignored-abort callback' 1 @{
        nativeDeadlineObserved = $true; elapsedMilliseconds = $deadlineElapsed; acceptedResponses = 0;
        callbackRetainedAfterCallerFailure = $true; callbackReleasedExplicitly = $true }

    $fixtureStage = 'eight_operation_shutdown'
    $capacityStart = Stats $fixtureServer; $before = $capacityStart.invocations; $heldClients = @()
    foreach ($index in 1..8) {
        $heldClients += Start-Child 'development' $fixtureNode @($fixtureChild,'exchange-control') @{ requestMode = 'hold' } $true
    }
    foreach ($client in $heldClients) { $null = Read-Message $client 'exchange_started' }
    $admitted = Wait-Stats $fixtureServer ($before + 8) 8
    Assert-Fixture ($admitted.maximumActive -eq 8) 'fixture_eight_admission_missing'
    $busy = Node-Call 'development' 'exchange' @{} $false
    Assert-Fixture ($busy.error -eq 'runtime_reference_busy' -and (Stats $fixtureServer).invocations -eq $before + 8) 'fixture_ninth_request_admitted'
    Send-Child $heldClients[0] @{ action = 'abort' }; $heldClients[0].Process.StandardInput.Close()
    $cancelled = Read-Message $heldClients[0]; Finish-Child $heldClients[0]
    Assert-Fixture ($cancelled.ok -and $cancelled.result.error -eq 'runtime_reference_cancelled') 'fixture_held_caller_not_cancelled'
    $null = Wait-Stats $fixtureServer ($before + 8) 8
    $busyAfterCancel = Node-Call 'development' 'exchange' @{} $false
    Assert-Fixture ($busyAfterCancel.error -eq 'runtime_reference_busy') 'fixture_cancelled_slot_reused_early'
    foreach ($index in 1..7) { Send-Child $heldClients[$index] @{ action = 'state' } }
    foreach ($index in 1..7) {
        $state = Read-Message $heldClients[$index] 'exchange_state'
        Assert-Fixture (-not $state.settled -and -not $state.originalAborted) 'fixture_callers_ended_before_close'
    }
    $beforeClose = Stats $fixtureServer
    Assert-Fixture ($beforeClose.aborted -eq $capacityStart.aborted + 1) 'fixture_other_connections_cancelled_before_close'
    Send-Child $fixtureServer @{ action = 'close' }; $closing = Read-Message $fixtureServer 'closing'
    Assert-Fixture ($closing.counters.active -eq 8) 'fixture_shutdown_lost_active_callbacks'
    $duringClose = Stats $fixtureServer
    Assert-Fixture ($duringClose.active -eq 8 -and @($fixtureServer.Messages | Where-Object { (Field $_ 'event') -eq 'closed' }).Count -eq 0) 'fixture_shutdown_completed_before_settlement'
    Send-Child $fixtureServer @{ action = 'release' }; $closed = Read-Message $fixtureServer 'closed'
    Assert-Fixture ($closed.counters.active -eq 0) 'fixture_shutdown_active_after_close'
    foreach ($index in 1..7) {
        Send-Child $heldClients[$index] @{ action = 'abort' }; $heldClients[$index].Process.StandardInput.Close()
        $last = Read-Message $heldClients[$index]; Finish-Child $heldClients[$index]
        Assert-Fixture ($last.ok -and -not $last.result.accepted) 'fixture_shutdown_client_response_accepted'
    }
    $fixtureServer.Process.StandardInput.Close(); $last = Read-Message $fixtureServer; Finish-Child $fixtureServer
    Assert-Fixture ($last.ok -and $last.result.drained -and $last.result.counters.active -eq 0) 'fixture_final_drain_missing'
    $fixtureServer = Start-Authority $true; $null = Registered-Control $fixtureServer
    Add-Case 'eight admitted callbacks retain capacity through cancellation and drain after multi-connection shutdown' 1 @{
        admitted = 8; maximumActive = 8; ninthRejected = $true; cancelledSlotReusedBeforeSettlement = $false;
        activeCallbacksAtClose = 8; closePromisePendingBeforeRelease = $true; closeIdempotenceObserved = $true;
        callbacksAfterClose = 0; callersUnsettledImmediatelyBeforeClose = 7; callbacksNotAbortedImmediatelyBeforeClose = 7;
        exactNativeHandleCountClaimed = $false; postDrainRegisteredControl = $true;
        callbackScope = 'synthetic transport mechanism; operational idle is covered separately' }

    $fixtureStage = 'final_state_and_owned_shutdown'
    Assert-Fixture ((State-Hash) -eq $fixtureStateBefore) 'fixture_manager_state_changed'
    Stop-Authority $fixtureServer; $fixtureServer = $null
    Assert-Fixture (@(Owned-Account-Processes).Count -eq 0) 'fixture_account_process_still_running'
    Add-Case 'qualification leaves manager state unchanged and closes all owned account processes' 1 @{
        managerStateBytesUnchanged = $true; ownedAccountProcessesRemaining = 0; modelExecutions = 0; upstreamProcessesStarted = 0;
        nodeFilesystemSpyScope = 'fs/promises calls in the restricted consumer; shared Node excluded';
        nativeCompilerTemporaryActivityNotExcluded = $true }
} catch {
    $fixtureFailureDiagnostic = Error-Diagnostic $_
    $fixtureFailure = if ($_.Exception.Message -match '^[a-z_]{1,80}$') { $_.Exception.Message } else { 'fixture_operation_failed' }
} finally {
    try { Cleanup-Fixture } catch { Cleanup-Failure 'fixture_cleanup_failed' $_ }
}
$fixtureReport = @{ schemaVersion = 1; fixture = 'protected-reference-transport'; scope = 'disposable hosted separate standard Windows identities';
    completedCases = @($fixtureCases); sourceSha256 = $fixtureHashes; cleanup = $fixtureCleanup;
    cleanupErrors = @($fixtureCleanupErrors);
    failureDiagnostic = $fixtureFailureDiagnostic; cleanupDiagnostics = @($fixtureCleanupDiagnostics);
    setupProgress = $fixtureSetup; modulePathObservation = $fixtureModulePathObservation;
    failure = $fixtureFailure; failedStage = $(if ($fixtureFailure) { $fixtureStage } else { $null });
    watchdog = @{ workMilliseconds = 360000; cleanupMilliseconds = 60000; outerMilliseconds = 420000 };
    nativeRuntime = @{ platform = [Environment]::OSVersion.Platform.ToString(); powerShellEdition = $PSVersionTable.PSEdition;
        powerShellVersion = $PSVersionTable.PSVersion.ToString(); is64BitProcess = [Environment]::Is64BitProcess };
    elapsedMilliseconds = $fixtureStarted.ElapsedMilliseconds;
    copiedNodeSha256 = $(if (Get-Variable fixtureNodeHash -ErrorAction SilentlyContinue) { $fixtureNodeHash } else { $null });
    activationAuthorized = $false; qualified = $false; upstreamEnabled = $false;
    nativeCompilerTemporaryActivityNotExcluded = $true; ownerHostTouched = $false;
    mappedNetworkDriveQualification = $false; realProductionAccountQualification = $false;
    cloudflareOrConnectorGrantQualification = $false }
[Console]::Out.WriteLine(($fixtureReport | ConvertTo-Json -Compress -Depth 24))
if ($fixtureFailure) { exit 1 }
