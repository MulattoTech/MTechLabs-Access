param([ValidateSet('Start','Status','Open')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
$mcpRoot = 'H:\MTechLabs\MCP'
$mcpNode = 'C:\Program Files\nodejs\node.exe'
$mcpEntry = Join-Path $mcpRoot 'runtime\admin.mjs'
$mcpConfig = Join-Path $mcpRoot 'state\manager.json'
if ($Action -eq 'Open') {
    Start-Process 'https://m-techlabs.com/admin/mcp'
    exit 0
}
if (-not (Test-Path -LiteralPath $mcpNode -PathType Leaf) -or
    -not (Test-Path -LiteralPath $mcpEntry -PathType Leaf) -or
    -not (Test-Path -LiteralPath $mcpConfig -PathType Leaf)) {
    throw 'MCP Manager installation is incomplete. No process was started.'
}
# This PC's CIM provider returns a null State, so identify listener rows by
# their zero remote port instead of relying on the provider's State enum.
$mcpListener = @(Get-NetTCPConnection -LocalPort 19740 -ErrorAction SilentlyContinue | Where-Object { $_.RemotePort -eq 0 })
if ($mcpListener.Count -gt 0) {
    $mcpPid = $mcpListener[0].OwningProcess
    $mcpProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $mcpPid"
    if ($mcpListener[0].LocalAddress -ne '127.0.0.1' -or
        $mcpProcess.ExecutablePath -ne $mcpNode -or
        $mcpProcess.CommandLine -notlike '*H:\MTechLabs\MCP\runtime\admin.mjs*') {
        throw 'Port 19740 is owned by another process. It was not stopped or changed.'
    }
    Write-Output "MCP Manager is running (PID $mcpPid). Manage it at https://m-techlabs.com/admin/mcp"
    exit 0
}
if ($Action -eq 'Status') {
    Write-Output 'MCP Manager is not running. Use manage.ps1 -Action Start. The Startup shortcut also starts it at Windows sign-in.'
    exit 1
}
$mcpProcess = Start-Process -FilePath $mcpNode -ArgumentList @(
    ('"' + $mcpEntry + '"'), '--config', ('"' + $mcpConfig + '"')
) -WorkingDirectory $mcpRoot -WindowStyle Hidden -PassThru
$mcpBound = $false
for ($mcpAttempt=0; $mcpAttempt -lt 10; $mcpAttempt++) {
    Start-Sleep -Milliseconds 500
    $mcpProcess.Refresh()
    if ($mcpProcess.HasExited) { throw 'MCP Manager exited during startup. Existing services were not modified.' }
    $mcpBound = @(Get-NetTCPConnection -LocalPort 19740 -ErrorAction SilentlyContinue | Where-Object {
        $_.RemotePort -eq 0 -and $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -eq $mcpProcess.Id
    }).Count -gt 0
    if ($mcpBound) { break }
}
if (-not $mcpBound) { throw 'The new process has not verified its loopback listener. It was not killed; inspect status before retrying.' }
Write-Output "Started MCP Manager (PID $($mcpProcess.Id)). Manage it at https://m-techlabs.com/admin/mcp"
