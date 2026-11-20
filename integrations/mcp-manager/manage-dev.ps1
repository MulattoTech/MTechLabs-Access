param(
    [ValidateSet('Inspect','Status','Start','Install','Open')][string]$Action = 'Inspect',
    [string]$NodePath,
    [string]$ConfigPath,
    [string]$PlanPath
)
$ErrorActionPreference = 'Stop'
function Assert-ReferenceSource([string]$File) {
    $target = [IO.Path]::GetFullPath($File)
    if ($target -notmatch '^[A-Za-z]:[\\/]' -or [IO.DriveInfo]::new([IO.Path]::GetPathRoot($target)).DriveType -ne [IO.DriveType]::Fixed) { throw 'runtime_reference_bootstrap_untrusted' }
    $paths = [Collections.Generic.List[string]]::new()
    $walk = $target
    while ($walk) {
        $paths.Add($walk)
        $parent = [IO.Path]::GetDirectoryName($walk)
        if ($parent -eq $walk) { break }
        $walk = $parent
    }
    foreach ($name in $paths) {
        $attributes = [IO.File]::GetAttributes($name)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'runtime_reference_bootstrap_untrusted' }
        $acl = if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
            [IO.Directory]::GetAccessControl($name)
        } else { [IO.File]::GetAccessControl($name) }
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        $system = ($name -eq [IO.Path]::GetPathRoot($name)) -or $name.StartsWith('C:\Windows\', [StringComparison]::OrdinalIgnoreCase) -or $name -eq 'C:\Windows' -or $name.StartsWith('C:\Program Files\', [StringComparison]::OrdinalIgnoreCase) -or $name -eq 'C:\Program Files' -or $name.StartsWith('C:\Program Files (x86)\', [StringComparison]::OrdinalIgnoreCase) -or $name -eq 'C:\Program Files (x86)'
        $allowed = @('S-1-5-18','S-1-5-32-544')
        if ($system) { $allowed += 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464' }
        if ($owner -notin $allowed) { throw 'runtime_reference_bootstrap_untrusted' }
        $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
        if ($null -eq $raw.DiscretionaryAcl) { throw 'runtime_reference_bootstrap_untrusted' }
        $danger = if ($name -eq $target) { 0x500D0116 } else { 0x500D0140 }
        foreach ($ace in $raw.DiscretionaryAcl) {
            if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback) { throw 'runtime_reference_bootstrap_untrusted' }
            if (($ace.AceFlags -band [Security.AccessControl.AceFlags]::InheritOnly) -ne 0) { continue }
            if ($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
                $ace.SecurityIdentifier.Value -notin $allowed -and ($ace.AccessMask -band $danger) -ne 0) {
                throw 'runtime_reference_bootstrap_untrusted'
            }
        }
    }
}
function Get-ReferenceBytes([string]$File, [int]$Maximum) {
    $stream = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -lt 0 -or $stream.Length -gt $Maximum) { throw 'runtime_reference_bootstrap_untrusted' }
        $buffer = [byte[]]::new($Maximum + 1)
        $total = 0
        while ($total -lt $buffer.Length) {
            $read = $stream.Read($buffer, $total, $buffer.Length - $total)
            if ($read -eq 0) { break }
            $total += $read
        }
        if ($total -gt $Maximum -or $total -ne $stream.Length) { throw 'runtime_reference_bootstrap_untrusted' }
        $result = [byte[]]::new($total)
        [Buffer]::BlockCopy($buffer, 0, $result, 0, $total)
        return ,$result
    } finally { $stream.Dispose() }
}
function Get-ReferenceHash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

try {
    # Never start Node with a preload that could run before the JS checks.
    if ($env:NODE_OPTIONS -or $env:NODE_PATH) { throw 'node_preload_environment_rejected' }
    if ($Action -notin @('Inspect', 'Status')) { throw 'dev_activation_not_qualified' }
    # The protected helper selects and validates Node before it can execute.
    # Config/plan values are comparisons only, never privileged target selectors.
    $env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
    $guard = [IO.Path]::Combine($PSScriptRoot, 'windows-reference.ps1')
    $nativeFile = [IO.Path]::Combine($PSScriptRoot, 'windows-reference-native.cs')
    $trustFile = [IO.Path]::Combine($PSScriptRoot, 'reference-bootstrap', 'trust.json')
    Assert-ReferenceSource $PSCommandPath
    Assert-ReferenceSource $guard
    Assert-ReferenceSource $nativeFile
    Assert-ReferenceSource $trustFile
    $trustBytes = (Get-ReferenceBytes $trustFile 32768)
    if ($trustBytes.Length -gt 32768) { throw 'runtime_reference_bootstrap_untrusted' }
    $pins = ([Text.UTF8Encoding]::new($false, $true).GetString($trustBytes) | ConvertFrom-Json).sourceSha256
    foreach ($pair in @(@($guard, 'windows-reference.ps1'), @($nativeFile, 'windows-reference-native.cs'))) {
        $bytes = (Get-ReferenceBytes $pair[0] 1048576)
        if ($bytes.Length -gt 1048576 -or (Get-ReferenceHash $bytes) -cne [string]$pins.($pair[1])) { throw 'runtime_reference_bootstrap_untrusted' }
    }
    $raw = & 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoLogo -NoProfile -NonInteractive -File $guard -Mode Bootstrap -Role Client 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'runtime_reference_bootstrap_untrusted' }
    $observed = $raw | ConvertFrom-Json
    $trust = $observed.trust | ConvertFrom-Json
    foreach ($pair in @(@($NodePath, $observed.nodePath), @($ConfigPath, $trust.developmentConfigPath), @($PlanPath, $trust.planPath))) {
        if ($pair[0] -and (-not [string]::Equals([IO.Path]::GetFullPath($pair[0]), [IO.Path]::GetFullPath($pair[1]), [StringComparison]::OrdinalIgnoreCase))) {
            throw 'runtime_reference_bootstrap_untrusted'
        }
    }
    $checker = Join-Path $PSScriptRoot 'inspect-dev-runtime.mjs'
    & $observed.nodePath $checker --config $trust.developmentConfigPath --plan $trust.planPath
    exit $LASTEXITCODE
} catch {
    # No raw exception/command line/private path forwarding.
    $code = $_.Exception.Message
    if ($code -notin @('node_preload_environment_rejected', 'dev_activation_not_qualified')) { $code = 'runtime_reference_bootstrap_untrusted' }
    [Console]::Error.WriteLine((@{ error = $code; qualified = $false; upstreamEnabled = $false } | ConvertTo-Json -Compress))
    exit 1
}
