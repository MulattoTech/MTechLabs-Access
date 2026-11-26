param([Parameter(Mandatory = $true)][string]$ProbePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

# Load top-level definitions only. The stdin-driven executable body is excluded,
# and every process/listener/snapshot read below is a fixture-owned substitute.
$sourceBytes = [IO.File]::ReadAllBytes($ProbePath)
if ($sourceBytes.Length -gt 65536) { throw 'fixture_source_too_large' }
$source = [Text.Encoding]::UTF8.GetString($sourceBytes).TrimStart([char]0xFEFF)
$sha = [Security.Cryptography.SHA256]::Create()
try { $sourceSha256 = ([BitConverter]::ToString($sha.ComputeHash($sourceBytes))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'fixture_source_parse_error' }
$definitions = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
foreach ($name in @('Initialize-RuntimeNative', 'Test-RuntimeInvocation', 'Test-RuntimeCreation', 'Get-RuntimeListenerObservation', 'Get-RuntimeCurrentObservation')) {
    if (@($definitions | Where-Object { $_.Name -eq $name }).Count -ne 1) { throw 'fixture_required_function_missing' }
}
foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) }

$script:sideEffectAttempts = 0
$script:queryFaults = 0
$script:sentinel = 'PRIVATE_RUNTIME_ARGUMENT_MUST_NEVER_BE_REPORTED'
$script:nodePath = 'C:\Program Files\nodejs\node.exe'
$script:entryPath = 'C:\FixtureDev\runtime\admin.mjs'
$script:configPath = 'C:\FixtureDev\state\manager.json'
$script:normal = '"' + $script:nodePath + '" "' + $script:entryPath + '" --config "' + $script:configPath + '"'
$script:baseTime = [datetime]::SpecifyKind([datetime]'2026-11-20T12:34:56', [DateTimeKind]::Utc)
$script:ownerId = 4242
$script:parentId = 34343

function Get-NetTCPConnection {
    param([string]$ErrorAction)
    $script:listenerQueries += 1
    if ($ErrorAction -ne 'Stop' -or $args.Count -ne 0 -or $script:activeCase.kind -eq 'current') {
        $script:queryFaults += 1
        throw 'fixture_unexpected_listener_query'
    }
    $mode = $script:activeCase.listenerMode
    if ($script:listenerQueries -gt 1 -and $script:activeCase.ContainsKey('finalListenerMode')) { $mode = $script:activeCase.finalListenerMode }
    $listener = [pscustomobject]@{ State = 'Listen'; LocalPort = 19741; LocalAddress = '127.0.0.1'; RemotePort = 0; OwningProcess = [uint32]$script:ownerId }
    $connection = [pscustomobject]@{ State = 'Established'; LocalPort = 19741; LocalAddress = '127.0.0.1'; RemotePort = 443; OwningProcess = [uint32]9999 }
    switch ($mode) {
        'throw' { throw 'fixture_listener_query_denied' }
        'none' { return @() }
        'non-loopback' { $listener.LocalAddress = '0.0.0.0' }
        'multiple' { return @($listener, $listener) }
        'other-port' { $listener.LocalPort = 19742 }
        'established' { return @($connection) }
        'mixed' { return @($connection, $listener) }
        'bound' { $listener.State = 'Bound' }
        'null-state' { $listener.State = $null }
        'unknown-state' { $listener.State = 'UnrecognizedFixtureState' }
        'invalid-listen-remote-port' { $listener.RemotePort = 443 }
        'zero-pid' { $listener.OwningProcess = [uint32]0 }
        'changed-pid' { $listener.OwningProcess = [uint32]4243 }
    }
    return @($listener)
}

function Get-CimInstance {
    param([string]$ClassName, [string]$Filter, [string]$ErrorAction)
    $script:cimQueries += 1
    $expectedId = $script:ownerId
    if ($script:activeCase.kind -eq 'current') {
        $expectedId = $script:parentId
        if ($script:cimQueries -eq 1) { $expectedId = $PID }
    }
    if ($ClassName -ne 'Win32_Process' -or $Filter -ne ('ProcessId = ' + $expectedId) -or $ErrorAction -ne 'Stop' -or $args.Count -ne 0) {
        $script:queryFaults += 1
        throw 'fixture_unexpected_process_query'
    }
    $created = $script:baseTime
    $parent = 0
    $mode = $script:activeCase.ownerMode
    if ($script:activeCase.kind -eq 'current') {
        if ($script:cimQueries -eq 1) {
            $mode = $script:activeCase.selfMode
            $parent = $script:parentId
            $created = $script:baseTime.AddSeconds(1)
        }
    } elseif ($script:cimQueries -gt 1 -and $script:activeCase.ContainsKey('afterOwnerMode')) {
        $mode = $script:activeCase.afterOwnerMode
    }
    if ($mode -eq 'throw') { throw 'fixture_process_query_denied' }
    if ($mode -eq 'missing') { return @() }
    $command = $script:normal
    if ($script:activeCase.ContainsKey('command')) { $command = $script:activeCase.command }
    $executable = $script:nodePath
    if ($script:activeCase.ContainsKey('ownerImage')) { $executable = $script:activeCase.ownerImage }
    $row = [pscustomobject]@{ ProcessId = [uint32]$expectedId; ParentProcessId = [uint32]$parent; CreationDate = $created; ExecutablePath = $executable; CommandLine = $command }
    switch ($mode) {
        'multiple' { return @($row, $row) }
        'wrong-pid' { $row.ProcessId = [uint32]($expectedId + 1) }
        'missing-time' { $row.CreationDate = $null }
        'changed-time' { $row.CreationDate = $created.AddTicks(10) }
        'changed-command' { $row.CommandLine = $script:normal + ' --private ' + $script:sentinel }
        'parent-after-helper' { $row.CreationDate = $script:baseTime.AddSeconds(2) }
    }
    return @($row)
}

function Get-RuntimeNativeSnapshot {
    param([int]$ProcessId)
    $script:nativeQueries += 1
    $expectedId = $script:ownerId
    if ($script:activeCase.kind -eq 'current') { $expectedId = $script:parentId }
    if ($ProcessId -ne $expectedId -or $args.Count -ne 0) {
        $script:queryFaults += 1
        throw 'fixture_unexpected_native_query'
    }
    if ($script:activeCase.nativeThrows) { throw 'fixture_native_query_denied' }
    return $script:fixtureSnapshot
}

function Start-Process { $script:sideEffectAttempts += 1; throw 'fixture_process_start_forbidden' }
function Stop-Process { $script:sideEffectAttempts += 1; throw 'fixture_process_stop_forbidden' }
function Start-Service { $script:sideEffectAttempts += 1; throw 'fixture_service_change_forbidden' }
function Stop-Service { $script:sideEffectAttempts += 1; throw 'fixture_service_change_forbidden' }
function Restart-Service { $script:sideEffectAttempts += 1; throw 'fixture_service_change_forbidden' }
function Invoke-CimMethod { $script:sideEffectAttempts += 1; throw 'fixture_unexpected_cim_method' }
function Invoke-WebRequest { $script:sideEffectAttempts += 1; throw 'fixture_network_forbidden' }
function Invoke-RestMethod { $script:sideEffectAttempts += 1; throw 'fixture_network_forbidden' }
function Set-Content { $script:sideEffectAttempts += 1; throw 'fixture_file_write_forbidden' }
function Add-Content { $script:sideEffectAttempts += 1; throw 'fixture_file_write_forbidden' }
function Out-File { $script:sideEffectAttempts += 1; throw 'fixture_file_write_forbidden' }
function Remove-Item { $script:sideEffectAttempts += 1; throw 'fixture_file_change_forbidden' }
function New-Item { $script:sideEffectAttempts += 1; throw 'fixture_file_change_forbidden' }
function Copy-Item { $script:sideEffectAttempts += 1; throw 'fixture_file_change_forbidden' }
function Move-Item { $script:sideEffectAttempts += 1; throw 'fixture_file_change_forbidden' }
function New-LocalUser { $script:sideEffectAttempts += 1; throw 'fixture_account_change_forbidden' }
function Set-Acl { $script:sideEffectAttempts += 1; throw 'fixture_permission_change_forbidden' }

# Compile the source's real CommandLineToArgvW parser. Its process-snapshot
# constructor is never invoked: Get-RuntimeNativeSnapshot has been replaced.
Initialize-RuntimeNative

# Query counts are listener, CIM, native snapshot, and Dispose, respectively.
$cases = @(
    @{ name = 'exact quoted listener invocation'; expected = 'observed'; queries = @(2, 2, 1, 1) }
    @{ name = 'case variants preserve exact Windows paths'; expected = 'observed'; command = $script:normal.ToUpperInvariant().Replace('--CONFIG', '--config'); ownerImage = $script:nodePath.ToUpperInvariant(); queries = @(2, 2, 1, 1) }
    @{ name = 'tab separators use the native argument parser'; expected = 'observed'; command = '"' + $script:nodePath + '"' + [char]9 + '"' + $script:entryPath + '"' + [char]9 + '--config' + [char]9 + '"' + $script:configPath + '"'; queries = @(2, 2, 1, 1) }
    @{ name = 'Unicode entry and config use the native argument parser'; expected = 'observed'; unicode = $true; queries = @(2, 2, 1, 1) }
    @{ name = 'native executable mismatch is unverified'; expected = 'unverified'; nativeImage = 'C:\Other\node.exe'; queries = @(1, 1, 1, 1) }
    @{ name = 'CIM executable mismatch is unverified'; expected = 'unverified'; ownerImage = 'C:\Other\node.exe'; queries = @(1, 1, 1, 1) }
    @{ name = 'entry suffix lookalike is unverified'; expected = 'unverified'; command = $script:normal.Replace('admin.mjs', 'admin.mjs.bak'); queries = @(1, 1, 1, 1) }
    @{ name = 'config suffix lookalike is unverified'; expected = 'unverified'; command = $script:normal.Replace('manager.json', 'manager.json.bak'); queries = @(1, 1, 1, 1) }
    @{ name = 'relative executable is unverified'; expected = 'unverified'; command = $script:normal.Replace('"' + $script:nodePath + '"', 'node.exe'); queries = @(1, 1, 1, 1) }
    @{ name = 'relative config is unverified'; expected = 'unverified'; command = $script:normal.Replace($script:configPath, 'state\manager.json'); queries = @(1, 1, 1, 1) }
    @{ name = 'extra private argument is rejected without disclosure'; expected = 'unverified'; command = $script:normal + ' --private ' + $script:sentinel; queries = @(1, 1, 1, 1) }
    @{ name = 'literal config flag remains case sensitive'; expected = 'unverified'; command = $script:normal.Replace('--config', '--CONFIG'); queries = @(1, 1, 1, 1) }
    @{ name = 'Node preload flag is not the supported invocation'; expected = 'unverified'; command = '"' + $script:nodePath + '" --require injected.mjs "' + $script:entryPath + '" --config "' + $script:configPath + '"'; queries = @(1, 1, 1, 1) }
    @{ name = 'missing command line is unverified'; expected = 'unverified'; command = $null; queries = @(1, 1, 1, 1) }
    @{ name = 'NUL command line is unverified'; expected = 'unverified'; command = $script:normal + [char]0; queries = @(1, 1, 1, 1) }
    @{ name = 'oversize command line is unverified'; expected = 'unverified'; command = ('x' * 32768); queries = @(1, 1, 1, 1) }
    @{ name = 'wrong returned process PID is unverified'; expected = 'unverified'; ownerMode = 'wrong-pid'; queries = @(1, 1, 0, 0) }
    @{ name = 'ambiguous CIM process rows are unverified'; expected = 'unverified'; ownerMode = 'multiple'; queries = @(1, 1, 0, 0) }
    @{ name = 'missing CIM creation time is unverified'; expected = 'unverified'; ownerMode = 'missing-time'; queries = @(1, 1, 0, 0) }
    @{ name = 'process query access failure is unverified'; expected = 'unverified'; ownerMode = 'throw'; queries = @(1, 1, 0, 0) }
    @{ name = 'native token or profile access failure is unverified'; expected = 'unverified'; nativeThrows = $true; queries = @(1, 1, 1, 0) }
    @{ name = 'native and CIM creation identities must agree'; expected = 'unverified'; nativeTimeOffset = 10; queries = @(1, 1, 1, 1) }
    @{ name = 'malformed native creation time is unverified'; expected = 'unverified'; nativeTimeInvalid = $true; queries = @(1, 1, 1, 1) }
    @{ name = 'FILETIME submicrosecond remainder is accepted'; expected = 'observed'; nativeTimeOffset = 9; queries = @(2, 2, 1, 1) }
    @{ name = 'process creation change during inspection is unverified'; expected = 'unverified'; afterOwnerMode = 'changed-time'; queries = @(2, 2, 1, 1) }
    @{ name = 'command change during inspection is unverified'; expected = 'unverified'; afterOwnerMode = 'changed-command'; queries = @(2, 2, 1, 1) }
    @{ name = 'process disappearance disposes its retained snapshot'; expected = 'unverified'; afterOwnerMode = 'missing'; queries = @(1, 2, 1, 1) }
    @{ name = 'exited native process is unverified'; expected = 'unverified'; nativeAlive = $false; queries = @(2, 2, 1, 1) }
    @{ name = 'no listener is absent'; expected = 'absent'; listenerMode = 'none'; queries = @(1, 0, 0, 0) }
    @{ name = 'listener query failure is not absence'; expected = 'unverified'; listenerMode = 'throw'; queries = @(1, 0, 0, 0) }
    @{ name = 'wildcard listener is unverified'; expected = 'unverified'; listenerMode = 'non-loopback'; queries = @(1, 0, 0, 0) }
    @{ name = 'multiple listeners are unverified'; expected = 'unverified'; listenerMode = 'multiple'; queries = @(1, 0, 0, 0) }
    @{ name = 'another local port is absent'; expected = 'absent'; listenerMode = 'other-port'; queries = @(1, 0, 0, 0) }
    @{ name = 'established connection is not a listener'; expected = 'absent'; listenerMode = 'established'; queries = @(1, 0, 0, 0) }
    @{ name = 'established connection does not hide a listener'; expected = 'observed'; listenerMode = 'mixed'; queries = @(2, 2, 1, 1) }
    @{ name = 'Bound state is not a listener'; expected = 'absent'; listenerMode = 'bound'; queries = @(1, 0, 0, 0) }
    @{ name = 'null connection state is unverified'; expected = 'unverified'; listenerMode = 'null-state'; queries = @(1, 0, 0, 0) }
    @{ name = 'unknown connection state is unverified'; expected = 'unverified'; listenerMode = 'unknown-state'; queries = @(1, 0, 0, 0) }
    @{ name = 'Listen with a remote port is unverified'; expected = 'unverified'; listenerMode = 'invalid-listen-remote-port'; queries = @(1, 0, 0, 0) }
    @{ name = 'zero listener PID is unverified'; expected = 'unverified'; listenerMode = 'zero-pid'; queries = @(1, 0, 0, 0) }
    @{ name = 'changed final listener owner is unverified'; expected = 'unverified'; finalListenerMode = 'changed-pid'; queries = @(2, 2, 1, 1) }
    @{ name = 'disappearing final listener is unverified'; expected = 'unverified'; finalListenerMode = 'none'; queries = @(2, 2, 1, 1) }
    @{ name = 'ambiguous final listener disposes its snapshot'; expected = 'unverified'; finalListenerMode = 'multiple'; queries = @(2, 2, 1, 1) }
    @{ name = 'final listener query failure disposes its snapshot'; expected = 'unverified'; finalListenerMode = 'throw'; queries = @(2, 2, 1, 1) }
    @{ name = 'current identity is the actual helper parent'; kind = 'current'; expected = 'observed'; queries = @(0, 2, 1, 1) }
    @{ name = 'unrelated requested parent is unverified'; kind = 'current'; expected = 'unverified'; requestedParent = 34344; queries = @(0, 1, 0, 0) }
    @{ name = 'zero requested parent is unverified'; kind = 'current'; expected = 'unverified'; requestedParent = 0; queries = @(0, 1, 0, 0) }
    @{ name = 'missing helper process is unverified'; kind = 'current'; expected = 'unverified'; selfMode = 'missing'; queries = @(0, 1, 0, 0) }
    @{ name = 'missing parent process is unverified'; kind = 'current'; expected = 'unverified'; ownerMode = 'missing'; queries = @(0, 2, 0, 0) }
    @{ name = 'parent PID reused after helper creation is unverified'; kind = 'current'; expected = 'unverified'; ownerMode = 'parent-after-helper'; nativeTimeOffset = 20000000; queries = @(0, 2, 1, 1) }
    @{ name = 'parent native and CIM creation identities must agree'; kind = 'current'; expected = 'unverified'; nativeTimeOffset = 10; queries = @(0, 2, 1, 1) }
    @{ name = 'parent executable mismatch is unverified'; kind = 'current'; expected = 'unverified'; nativeImage = 'C:\Other\node.exe'; queries = @(0, 2, 1, 1) }
    @{ name = 'exited parent is unverified and disposed'; kind = 'current'; expected = 'unverified'; nativeAlive = $false; queries = @(0, 2, 1, 1) }
    @{ name = 'unavailable parent token is unverified'; kind = 'current'; expected = 'unverified'; nativeThrows = $true; queries = @(0, 2, 1, 0) }
)

$observations = @()
foreach ($case in $cases) {
    $script:activeCase = $case
    $script:listenerQueries = 0
    $script:cimQueries = 0
    $script:nativeQueries = 0
    $script:disposeQueries = 0
    $expected = @{ nodePath = $script:nodePath; entryPath = $script:entryPath; configPath = $script:configPath; port = 19741 }
    if ($case.unicode) {
        # Code points keep this fixture readable by Windows PowerShell 5.1 even
        # when the checkout is UTF-8 without a BOM.
        $unicodeName = 'Dev-' + [char]0x00E9 + [char]0x6F22
        $expected.entryPath = 'C:\' + $unicodeName + '\admin.mjs'
        $expected.configPath = 'C:\' + $unicodeName + '\manager.json'
        $case.command = '"' + $script:nodePath + '" "' + $expected.entryPath + '" --config "' + $expected.configPath + '"'
    }
    $nativeImage = $script:nodePath
    if ($case.ContainsKey('nativeImage')) { $nativeImage = $case.nativeImage }
    $nativeAlive = $true
    if ($case.ContainsKey('nativeAlive')) { $nativeAlive = $case.nativeAlive }
    $nativeCreated = $script:baseTime.ToFileTimeUtc()
    if ($case.ContainsKey('nativeTimeOffset')) { $nativeCreated += [long]$case.nativeTimeOffset }
    $createdText = $nativeCreated.ToString([Globalization.CultureInfo]::InvariantCulture)
    if ($case.nativeTimeInvalid) { $createdText = 'not-a-filetime' }
    $script:fixtureSnapshot = [pscustomobject]@{ Image = $nativeImage; Sid = 'S-1-5-21-100-200-300-1001'; Profile = 'C:\Users\FixtureDev'; Created = $createdText; Alive = $nativeAlive; DisposeCount = 0 }
    $script:fixtureSnapshot | Add-Member -MemberType ScriptMethod -Name Dispose -Value {
        $this.DisposeCount += 1
        $script:disposeQueries += 1
        if ($this.DisposeCount -ne 1) { $script:queryFaults += 1 }
    }
    $actual = 'unexpected-error'
    $returnedPid = $null
    $identityPreserved = $true
    $privateArgumentLeaked = $false
    $invocationMatched = $null
    try {
        if ($case.kind -eq 'current') {
            $requestedParent = $script:parentId
            if ($case.ContainsKey('requestedParent')) { $requestedParent = $case.requestedParent }
            $returned = @(Get-RuntimeCurrentObservation $requestedParent $script:nodePath)
        } else {
            $returned = @(Get-RuntimeListenerObservation $expected)
        }
        $serialized = $returned | ConvertTo-Json -Depth 5 -Compress
        $privateArgumentLeaked = $serialized.Contains($script:sentinel)
        if ($returned.Count -eq 1 -and $returned[0] -is [Collections.IDictionary]) {
            $result = $returned[0]
            $actual = $result.status
            if ($actual -eq 'observed') {
                $returnedPid = $result.pid
                $invocationMatched = $result.invocationMatched
                $identityPreserved = $result.sid -eq $script:fixtureSnapshot.Sid -and
                    $result.profileDirectory -eq $script:fixtureSnapshot.Profile -and
                    $result.creationFileTime -eq $script:fixtureSnapshot.Created
            } elseif (@($result.Keys).Count -ne 1) {
                $actual = 'unexpected-rejection-fields'
            }
        } else { $actual = 'invalid-return' }
    } catch {
        $privateArgumentLeaked = $_.Exception.Message.Contains($script:sentinel)
    }
    $expectedPid = $script:ownerId
    if ($case.kind -eq 'current') { $expectedPid = $script:parentId }
    $actualQueries = @($script:listenerQueries, $script:cimQueries, $script:nativeQueries, $script:disposeQueries)
    $failed = $actual -ne $case.expected -or $privateArgumentLeaked -or -not $identityPreserved -or
        ($actualQueries -join ',') -ne ($case.queries -join ',') -or
        ($actual -eq 'observed' -and $returnedPid -ne $expectedPid) -or
        ($actual -eq 'observed' -and $case.kind -ne 'current' -and $invocationMatched -ne $true)
    $observations += [ordered]@{
        name = $case.name; expected = $case.expected; actual = $actual; returnedPid = $returnedPid
        expectedPid = $expectedPid; queries = $actualQueries; expectedQueries = $case.queries
        identityPreserved = $identityPreserved; privateArgumentLeaked = $privateArgumentLeaked; failed = [bool]$failed
    }
}

$failedCount = @($observations | Where-Object { $_.failed }).Count
$report = [ordered]@{
    schemaVersion = 1; fixture = 'dev-runtime-identity'; sourceSha256 = $sourceSha256; sourceBytes = $sourceBytes.Length
    powerShellVersion = $PSVersionTable.PSVersion.ToString(); powerShellEdition = $PSVersionTable.PSEdition
    platform = [Environment]::OSVersion.Platform.ToString(); loadMode = 'top-level-function-definitions-only'
    loadedFunctions = @($definitions | ForEach-Object { $_.Name }); executableBody = 'excluded-by-AST'
    listenerAndCimData = 'simulated'; processSnapshots = 'simulated'; argumentParser = 'native-CommandLineToArgvW'
    blockedSideEffectAttempts = $script:sideEffectAttempts; queryFaults = $script:queryFaults
    cases = $observations; total = $observations.Count; passed = $observations.Count - $failedCount; failed = $failedCount
}
[Console]::Out.WriteLine(($report | ConvertTo-Json -Depth 8 -Compress))
if ($script:sideEffectAttempts -ne 0 -or $script:queryFaults -ne 0) { exit 2 }
if ($failedCount -ne 0) { exit 1 }
exit 0
