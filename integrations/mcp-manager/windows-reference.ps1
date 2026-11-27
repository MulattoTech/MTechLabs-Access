param(
    [ValidateSet('Bootstrap','Server','Exchange','Authority')][string]$Mode = 'Bootstrap',
    [ValidateSet('Authority','Client')][string]$Role = 'Client'
)
$ErrorActionPreference = 'Stop'
$bootstrap = $null

# This pre-compiler guard is deliberately independent of the C# it validates.
# The Node entry also embeds this initial ACL check before loading this script.
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
    if ($env:NODE_OPTIONS -or $env:NODE_PATH) { throw 'node_preload_environment_rejected' }
    $env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $source = [IO.Path]::Combine($PSScriptRoot, 'windows-reference-native.cs')
    $trustFile = [IO.Path]::Combine($PSScriptRoot, 'reference-bootstrap', 'trust.json')
    Assert-ReferenceSource $PSCommandPath
    Assert-ReferenceSource $source
    Assert-ReferenceSource $trustFile
    $trustBytes = (Get-ReferenceBytes $trustFile 32768)
    if ($trustBytes.Length -gt 32768) { throw 'runtime_reference_bootstrap_untrusted' }
    $trust = [Text.UTF8Encoding]::new($false, $true).GetString($trustBytes) | ConvertFrom-Json
    $compiledSource = $null
    foreach ($name in @('windows-reference.ps1', 'windows-reference-native.cs')) {
        $file = [IO.Path]::Combine($PSScriptRoot, $name)
        $bytes = (Get-ReferenceBytes $file 1048576)
        if ($bytes.Length -gt 1048576 -or [string]$trust.sourceSha256.$name -cnotmatch '^[a-f0-9]{64}$' -or
            (Get-ReferenceHash $bytes) -cne [string]$trust.sourceSha256.$name) { throw 'runtime_reference_bootstrap_untrusted' }
        if ($name -eq 'windows-reference-native.cs') { $compiledSource = [Text.UTF8Encoding]::new($false, $true).GetString($bytes) }
    }
    Add-Type -TypeDefinition $compiledSource -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Web.Extensions.dll') -ErrorAction Stop | Out-Null
    $nativeRole = if ($Mode -eq 'Server' -or $Mode -eq 'Authority') { 'Authority' } elseif ($Mode -eq 'Exchange') { 'Client' } else { $Role }
    $bootstrap = [MTechLabs.ReferenceTransport.Native+Bootstrap]::new($PSScriptRoot, $nativeRole)
    switch ($Mode) {
        'Bootstrap' { [Console]::Out.WriteLine($bootstrap.JsonValue()) }
        'Server' { [MTechLabs.ReferenceTransport.Native]::Serve($bootstrap) }
        'Exchange' { [MTechLabs.ReferenceTransport.Native]::Exchange($bootstrap) }
        'Authority' {
            # Native guard has already checked this Node file, complete source
            # graph, private bootstrap and ancestors before any Node execution.
            & $bootstrap.NodePath ([IO.Path]::Combine($PSScriptRoot, 'reference-server.mjs'))
            exit $LASTEXITCODE
        }
    }
} catch {
    $code = if ($_.Exception.Message -eq 'node_preload_environment_rejected') { 'node_preload_environment_rejected' } else { 'runtime_reference_bootstrap_untrusted' }
    [Console]::Error.WriteLine($code)
    exit 1
} finally {
    if ($null -ne $bootstrap) { $bootstrap.Dispose() }
}
