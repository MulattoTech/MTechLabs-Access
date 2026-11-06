$ErrorActionPreference = 'Stop'
$mcpRoot = 'H:\MTechLabs\MCP'
$mcpLauncher = Join-Path $mcpRoot 'runtime\manage.ps1'
$mcpShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $mcpLauncher -PathType Leaf)) { throw 'Managed launcher is missing.' }
$mcpStartup = Join-Path ([Environment]::GetFolderPath('Startup')) 'M-TechLabs Local MCP.lnk'
$mcpDesktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'M-TechLabs MCP Manager.lnk'
$mcpLinks = @(
    @{ Path=$mcpStartup; Action='Start'; Description='Start the owner-managed local MCP service at sign-in.' },
    @{ Path=$mcpDesktop; Action='Open'; Description='Open M-TechLabs local MCP controls in the default browser.' }
)
$mcpCom = New-Object -ComObject WScript.Shell
foreach ($mcpLink in $mcpLinks) {
    $mcpArguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $mcpLauncher + '" -Action ' + $mcpLink.Action
    $mcpShortcut = $mcpCom.CreateShortcut($mcpLink.Path)
    if (Test-Path -LiteralPath $mcpLink.Path) {
        if ($mcpShortcut.TargetPath -ne $mcpShell -or $mcpShortcut.Arguments -ne $mcpArguments) {
            throw ('A different shortcut already exists at ' + $mcpLink.Path + '; it was not overwritten.')
        }
    } else {
        $mcpShortcut.TargetPath = $mcpShell
        $mcpShortcut.Arguments = $mcpArguments
        $mcpShortcut.WorkingDirectory = $mcpRoot
        $mcpShortcut.Description = $mcpLink.Description
        $mcpShortcut.WindowStyle = 7
        $mcpShortcut.Save()
    }
    [pscustomobject]@{ Shortcut=$mcpLink.Path; Action=$mcpLink.Action; UserScoped=$true }
}
# This changes no machine-wide execution policy, task, firewall rule, or service.
& $mcpShell -NoProfile -ExecutionPolicy RemoteSigned -File $mcpLauncher -Action Start
if ($LASTEXITCODE -ne 0) { throw 'The local service did not start.' }
