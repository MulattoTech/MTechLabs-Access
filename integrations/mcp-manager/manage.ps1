param([ValidateSet('Start','Status','Open')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
$mcpRoot = 'H:\MTechLabs\MCP'
$mcpNode = 'C:\Program Files\nodejs\node.exe'
$mcpEntry = Join-Path $mcpRoot 'runtime\admin.mjs'
$mcpConfig = Join-Path $mcpRoot 'state\manager.json'
$mcpUrl = 'https://m-techlabs.com/admin/mcp'

function Get-OwnedManager {
    # This PC's CIM provider returns a null State. A zero remote port identifies
    # the listener without relying on that provider's State enum.
    $listeners = @(Get-NetTCPConnection -LocalPort 19740 -ErrorAction SilentlyContinue | Where-Object { $_.RemotePort -eq 0 })
    if ($listeners.Count -eq 0) { return $null }
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') {
        throw 'Port 19740 is not an exclusive loopback listener. No process was stopped or changed.'
    }
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0].OwningProcess)"
    if ($owner.ExecutablePath -ne $mcpNode -or $owner.CommandLine -notlike '*H:\MTechLabs\MCP\runtime\admin.mjs*') {
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
