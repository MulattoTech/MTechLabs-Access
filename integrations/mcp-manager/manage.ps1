param([ValidateSet('Start','Status','Open')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
$mcpRoot = 'H:\MTechLabs\MCP'
$mcpNode = 'C:\Program Files\nodejs\node.exe'
$mcpEntry = Join-Path $mcpRoot 'runtime\admin.mjs'
$mcpConfig = Join-Path $mcpRoot 'state\manager.json'
$mcpUrl = 'https://m-techlabs.com/admin/mcp'

# 2026-11-20: require the supported invocation, not entry-path text elsewhere in
# another Node command. Native parsing preserves Windows quoting semantics.
function Get-ManagerArguments {
    param([string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine) -or $CommandLine.Length -gt 32767 -or
        $CommandLine.IndexOf([char]0) -ge 0) { return $null }
    if (-not ('MTechLabs.McpManager.WindowsCommandLine' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace MTechLabs.McpManager {
    public static class WindowsCommandLine {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
        [DllImport("kernel32.dll", ExactSpelling = true)]
        public static extern IntPtr LocalFree(IntPtr memory);
    }
}
'@ -ErrorAction Stop
    }
    $nativeArguments = [IntPtr]::Zero
    try {
        $argumentCount = 0
        $nativeArguments = [MTechLabs.McpManager.WindowsCommandLine]::CommandLineToArgvW($CommandLine, [ref]$argumentCount)
        if ($nativeArguments -eq [IntPtr]::Zero -or $argumentCount -ne 4) { return $null }
        $managerArguments = New-Object 'string[]' 4
        for ($index = 0; $index -lt 4; $index++) {
            $address = [Runtime.InteropServices.Marshal]::ReadIntPtr($nativeArguments, $index * [IntPtr]::Size)
            $managerArguments[$index] = [Runtime.InteropServices.Marshal]::PtrToStringUni($address)
        }
        return ,$managerArguments
    } finally {
        if ($nativeArguments -ne [IntPtr]::Zero -and
            [MTechLabs.McpManager.WindowsCommandLine]::LocalFree($nativeArguments) -ne [IntPtr]::Zero) {
            throw 'manager_argument_cleanup_failed'
        }
    }
}

function Test-ManagerPath {
    param([string]$Actual, [string]$Expected)
    # The supported launcher uses absolute drive paths. Do not guess a foreign
    # process's working directory or expand environment variables and aliases.
    if ($Actual -notmatch '^[A-Za-z]:[\\/]' -or $Expected -notmatch '^[A-Za-z]:[\\/]') { return $false }
    return [string]::Equals([IO.Path]::GetFullPath($Actual), [IO.Path]::GetFullPath($Expected),
        [StringComparison]::OrdinalIgnoreCase)
}

function Test-ManagerInvocation {
    param($Owner, [uint32]$ExpectedProcessId)
    try {
        $owners = @($Owner)
        if ($owners.Count -ne 1 -or $null -eq $owners[0]) { return $false }
        $candidate = $owners[0]
        if ($candidate.ProcessId -ne $ExpectedProcessId -or
            -not (Test-ManagerPath $candidate.ExecutablePath $mcpNode)) { return $false }
        $managerArguments = Get-ManagerArguments $candidate.CommandLine
        if ($null -eq $managerArguments -or $managerArguments.Count -ne 4) { return $false }
        return (Test-ManagerPath $managerArguments[0] $mcpNode) -and
            (Test-ManagerPath $managerArguments[1] $mcpEntry) -and
            [string]::Equals($managerArguments[2], '--config', [StringComparison]::Ordinal) -and
            (Test-ManagerPath $managerArguments[3] $mcpConfig)
    } catch {
        # Missing/invalid process metadata or parsing failure is not ownership.
        # Never echo a different process's potentially sensitive command line.
        return $false
    }
}

function Get-OwnedManager {
    # This PC's CIM provider returns a null State. A zero remote port identifies
    # the listener without relying on that provider's State enum.
    $listeners = @(Get-NetTCPConnection -LocalPort 19740 -ErrorAction SilentlyContinue | Where-Object { $_.RemotePort -eq 0 })
    if ($listeners.Count -eq 0) { return $null }
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') {
        throw 'Port 19740 is not an exclusive loopback listener. No process was stopped or changed.'
    }
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0].OwningProcess)"
    if (-not (Test-ManagerInvocation $owner $listeners[0].OwningProcess)) {
        throw 'Port 19740 is owned by another process. It was not stopped or changed.'
    }
    return $owner.ProcessId
}

$mcpMutex = $null
$mcpLocked = $false
try {
    if (-not (Test-Path -LiteralPath $mcpNode -PathType Leaf) -or
        -not (Test-Path -LiteralPath $mcpEntry -PathType Leaf) -or
        -not (Test-Path -LiteralPath $mcpConfig -PathType Leaf)) {
        throw 'MCP Manager installation is incomplete. No process was started.'
    }
    # Two shortcut clicks or sign-in plus a manual launch must not race to bind.
    $mcpSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mcpMutex = New-Object Threading.Mutex($false, ('Local\MTechLabs.McpManager.Launch.' + $mcpSid))
    try { $mcpLocked = $mcpMutex.WaitOne(10000) }
    catch [Threading.AbandonedMutexException] { $mcpLocked = $true }
    if (-not $mcpLocked) { throw 'Another manager launch is still in progress. Check Status before retrying.' }
    $mcpPid = Get-OwnedManager
    if (-not $mcpPid) {
        if ($Action -eq 'Status') {
            Write-Output 'MCP Manager is not running. Open the desktop shortcut or use manage.ps1 -Action Start. Windows sign-in also starts it.'
            exit 1
        }
        $mcpProcess = Start-Process -FilePath $mcpNode -ArgumentList @(
            ('"' + $mcpEntry + '"'), '--config', ('"' + $mcpConfig + '"')
        ) -WorkingDirectory $mcpRoot -WindowStyle Hidden -PassThru
        for ($mcpAttempt=0; $mcpAttempt -lt 10; $mcpAttempt++) {
            Start-Sleep -Milliseconds 500
            $mcpProcess.Refresh()
            if ($mcpProcess.HasExited) { throw 'MCP Manager exited during startup. Existing services were not modified.' }
            $mcpPid = Get-OwnedManager
            if ($mcpPid -eq $mcpProcess.Id) { break }
        }
        if ($mcpPid -ne $mcpProcess.Id) {
            throw 'The new process has not verified its loopback listener. It was not killed; inspect Status before retrying.'
        }
        Write-Output "Started MCP Manager (PID $mcpPid)."
    } else {
        Write-Output "MCP Manager is running (PID $mcpPid)."
    }
    if ($Action -eq 'Open') { Start-Process $mcpUrl }
    Write-Output "Manage it at $mcpUrl"
} finally {
    if ($mcpLocked) { $mcpMutex.ReleaseMutex() }
    if ($mcpMutex) { $mcpMutex.Dispose() }
}
