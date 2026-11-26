param([string]$LauncherPath, [string]$LauncherSourceBase64)
$ErrorActionPreference = 'Stop'

# Load definitions, never the launcher's executable body. The optional in-memory
# source input permits the identical fixture to run without writing on a device.
if ([bool]$LauncherPath -eq [bool]$LauncherSourceBase64) { throw 'fixture_source_required' }
if ($LauncherSourceBase64) {
    $sourceBytes = [Convert]::FromBase64String($LauncherSourceBase64)
} else {
    $sourceBytes = [IO.File]::ReadAllBytes($LauncherPath)
}
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
if (@($definitions | Where-Object { $_.Name -eq 'Get-OwnedManager' }).Count -ne 1) {
    throw 'fixture_owner_function_missing'
}
foreach ($definition in $definitions) {
    . ([scriptblock]::Create($definition.Extent.Text))
}

# These values describe the supported existing invocation, not files to open.
$mcpNode = 'C:\Program Files\nodejs\node.exe'
$mcpEntry = 'H:\MTechLabs\MCP\runtime\admin.mjs'
$mcpConfig = 'H:\MTechLabs\MCP\state\manager.json'
$normal = '"' + $mcpNode + '" "' + $mcpEntry + '" --config "' + $mcpConfig + '"'
$sentinel = 'UNRELATED_PRIVATE_ARGUMENT_SENTINEL'
$script:sideEffectAttempts = 0
$script:queryFaults = 0

function Get-NetTCPConnection {
    param([int]$LocalPort, [string]$ErrorAction)
    $script:listenerQueries += 1
    if ($LocalPort -ne 19740 -or $ErrorAction -ne 'SilentlyContinue') {
        $script:queryFaults += 1
        throw 'fixture_unexpected_listener_query'
    }
    return $script:fixtureListeners
}
function Get-CimInstance {
    param([string]$ClassName, [string]$Filter)
    $script:cimQueries += 1
    if ($ClassName -ne 'Win32_Process' -or $Filter -ne 'ProcessId = 4242') {
        $script:queryFaults += 1
        throw 'fixture_unexpected_process_query'
    }
    return $script:fixtureOwner
}
function Start-Process { $script:sideEffectAttempts += 1; throw 'fixture_process_start_forbidden' }
function Stop-Process { $script:sideEffectAttempts += 1; throw 'fixture_process_stop_forbidden' }
function Start-Service { $script:sideEffectAttempts += 1; throw 'fixture_service_change_forbidden' }
function Stop-Service { $script:sideEffectAttempts += 1; throw 'fixture_service_change_forbidden' }
function Restart-Service { $script:sideEffectAttempts += 1; throw 'fixture_service_change_forbidden' }
function Invoke-WebRequest { $script:sideEffectAttempts += 1; throw 'fixture_network_forbidden' }
function Invoke-RestMethod { $script:sideEffectAttempts += 1; throw 'fixture_network_forbidden' }
function Set-Content { $script:sideEffectAttempts += 1; throw 'fixture_file_write_forbidden' }
function Add-Content { $script:sideEffectAttempts += 1; throw 'fixture_file_write_forbidden' }
function Out-File { $script:sideEffectAttempts += 1; throw 'fixture_file_write_forbidden' }
function Remove-Item { $script:sideEffectAttempts += 1; throw 'fixture_file_change_forbidden' }
function New-Item { $script:sideEffectAttempts += 1; throw 'fixture_file_change_forbidden' }
function Copy-Item { $script:sideEffectAttempts += 1; throw 'fixture_file_change_forbidden' }
function Move-Item { $script:sideEffectAttempts += 1; throw 'fixture_file_change_forbidden' }

$cases = @(
    @{ name = 'supported quoted invocation'; command = $normal; expected = 'owned' }
    @{ name = 'unquoted entry and configuration without spaces'; command = '"' + $mcpNode + '" ' + $mcpEntry + ' --config ' + $mcpConfig; expected = 'owned' }
    @{ name = 'Windows path case variants'; command = '"' + $mcpNode.ToUpperInvariant() + '" "' + $mcpEntry.ToLowerInvariant() + '" --config "' + $mcpConfig.ToUpperInvariant() + '"'; executable = $mcpNode.ToUpperInvariant(); expected = 'owned' }
    @{ name = 'tab argument separators'; command = '"' + $mcpNode + '"' + [char]9 + '"' + $mcpEntry + '"' + [char]9 + '--config' + [char]9 + '"' + $mcpConfig + '"'; expected = 'owned' }
    @{ name = 'different configuration'; command = $normal.Replace('state\manager.json', 'state\other.json'); expected = 'rejected' }
    @{ name = 'configuration suffix lookalike'; command = $normal.Replace('manager.json', 'manager.json.backup'); expected = 'rejected' }
    @{ name = 'missing configuration argument'; command = '"' + $mcpNode + '" "' + $mcpEntry + '"'; expected = 'rejected' }
    @{ name = 'duplicate configuration argument'; command = $normal + ' --config "' + $mcpConfig + '"'; expected = 'rejected' }
    @{ name = 'extra trailing argument'; command = $normal + ' --client other'; expected = 'rejected' }
    @{ name = 'entry suffix lookalike'; command = $normal.Replace('admin.mjs', 'admin.mjs.backup'); expected = 'rejected' }
    @{ name = 'expected entry appears only in unrelated argument'; command = '"' + $mcpNode + '" H:\unrelated.mjs "' + $mcpEntry + '" --config "' + $mcpConfig + '"'; expected = 'rejected' }
    @{ name = 'expected entry appears in eval text'; command = '"' + $mcpNode + '" --eval "' + $mcpEntry + '"'; expected = 'rejected' }
    @{ name = 'unsupported Node flag'; command = '"' + $mcpNode + '" --inspect "' + $mcpEntry + '" --config "' + $mcpConfig + '"'; expected = 'rejected' }
    @{ name = 'literal config flag is case sensitive'; command = $normal.Replace('--config', '--CONFIG'); expected = 'rejected' }
    @{ name = 'relative executable argument'; command = $normal.Replace('"' + $mcpNode + '"', 'node.exe'); expected = 'rejected' }
    @{ name = 'unavailable command line'; command = $null; expected = 'rejected' }
    @{ name = 'empty command line'; command = ''; expected = 'rejected' }
    @{ name = 'different executable'; command = $normal; executable = 'C:\Other\node.exe'; expected = 'rejected' }
    @{ name = 'returned process PID differs from listener'; command = $normal; processId = 4243; expected = 'rejected' }
    @{ name = 'process disappeared before query'; command = $normal; noProcess = $true; expected = 'rejected' }
    @{ name = 'no listener'; command = $normal; listenerMode = 'none'; expected = 'absent'; expectedCimQueries = 0 }
    @{ name = 'non-loopback listener'; command = $normal; listenerMode = 'non-loopback'; expected = 'rejected'; expectedCimQueries = 0 }
    @{ name = 'multiple listeners'; command = $normal; listenerMode = 'multiple'; expected = 'rejected'; expectedCimQueries = 0 }
    @{ name = 'established connection is not a listener'; command = $normal; listenerMode = 'established'; expected = 'absent'; expectedCimQueries = 0 }
    @{ name = 'established connection does not hide the listener'; command = $normal; listenerMode = 'mixed'; expected = 'owned' }
    @{ name = 'foreign private argument stays out of diagnostics'; command = $normal + ' --unrelated ' + $sentinel; expected = 'rejected' }
)
$observations = @()
foreach ($case in $cases) {
    $script:listenerQueries = 0
    $script:cimQueries = 0
    $listener = [pscustomobject]@{ LocalAddress = '127.0.0.1'; RemotePort = 0; OwningProcess = [uint32]4242 }
    $connection = [pscustomobject]@{ LocalAddress = '127.0.0.1'; RemotePort = 443; OwningProcess = [uint32]9999 }
    $script:fixtureListeners = @($listener)
    switch ($case.listenerMode) {
        'none' { $script:fixtureListeners = @() }
        'non-loopback' { $listener.LocalAddress = '0.0.0.0' }
        'multiple' { $script:fixtureListeners = @($listener, $listener) }
        'established' { $script:fixtureListeners = @($connection) }
        'mixed' { $script:fixtureListeners = @($connection, $listener) }
    }
    $exe = $mcpNode
    if ($case.ContainsKey('executable')) { $exe = $case.executable }
    $ownerId = 4242
    if ($case.ContainsKey('processId')) { $ownerId = $case.processId }
    $script:fixtureOwner = [pscustomobject]@{ ExecutablePath = $exe; CommandLine = $case.command; ProcessId = [uint32]$ownerId }
    if ($case.noProcess) { $script:fixtureOwner = $null }
    $actual = 'unknown'
    $returnedPid = $null
    $errorKind = $null
    $privateArgumentLeaked = $false
    try {
        $returned = @(Get-OwnedManager)
        if ($returned.Count -eq 0 -or ($returned.Count -eq 1 -and $null -eq $returned[0])) {
            $actual = 'absent'
        } elseif ($returned.Count -eq 1 -and ($returned[0] -is [int] -or $returned[0] -is [uint32]) -and $returned[0] -gt 0) {
            $actual = 'owned'
            $returnedPid = $returned[0]
        } else { $actual = 'invalid-return' }
    } catch {
        $message = $_.Exception.Message
        $privateArgumentLeaked = $message.Contains($sentinel)
        if ($message -eq 'Port 19740 is owned by another process. It was not stopped or changed.') {
            $actual = 'rejected'
            $errorKind = 'other_process'
        } elseif ($message -eq 'Port 19740 is not an exclusive loopback listener. No process was stopped or changed.') {
            $actual = 'rejected'
            $errorKind = 'nonexclusive_listener'
        } else {
            $actual = 'unexpected-error'
            $errorKind = 'unrecognized_error_redacted'
        }
    }
    $expectedCimQueries = 1
    if ($case.ContainsKey('expectedCimQueries')) { $expectedCimQueries = $case.expectedCimQueries }
    $observations += [ordered]@{
        name = $case.name; expected = $case.expected; actual = $actual
        returnedPid = $returnedPid; errorKind = $errorKind
        listenerQueries = $script:listenerQueries; cimQueries = $script:cimQueries
        expectedCimQueries = $expectedCimQueries; privateArgumentLeaked = $privateArgumentLeaked
    }
}

# Finish every observation before evaluating the matrix.
$failed = @($observations | Where-Object {
    $_.actual -ne $_.expected -or ($_.actual -eq 'owned' -and $_.returnedPid -ne 4242) -or
    $_.listenerQueries -ne 1 -or $_.cimQueries -ne $_.expectedCimQueries -or $_.privateArgumentLeaked
}).Count
$report = [ordered]@{
    schemaVersion = 1; fixture = 'manager-launcher-identity'
    sourceSha256 = $sourceSha256; sourceBytes = $sourceBytes.Length
    powerShellVersion = $PSVersionTable.PSVersion.ToString(); powerShellEdition = $PSVersionTable.PSEdition
    platform = [Environment]::OSVersion.Platform.ToString()
    loadMode = 'top-level-function-definitions-only'
    loadedFunctions = @($definitions | ForEach-Object { $_.Name })
    listenerAndCimData = 'simulated'; launchBodySelection = 'excluded-by-AST'
    blockedSideEffectAttempts = $script:sideEffectAttempts; queryFaults = $script:queryFaults
    cases = $observations; total = $observations.Count; passed = $observations.Count - $failed; failed = $failed
}
[Console]::Out.WriteLine(($report | ConvertTo-Json -Depth 8 -Compress))
if ($script:sideEffectAttempts -ne 0 -or $script:queryFaults -ne 0) { exit 2 }
if ($failed -ne 0) { exit 1 }
exit 0
