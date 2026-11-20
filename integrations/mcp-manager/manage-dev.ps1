param(
    [ValidateSet('Inspect','Status','Start','Install','Open')][string]$Action = 'Inspect',
    [string]$NodePath,
    [string]$ConfigPath,
    [string]$PlanPath
)
$ErrorActionPreference = 'Stop'
try {
    # Never start Node with a preload that could run before the JS checks.
    if ($env:NODE_OPTIONS -or $env:NODE_PATH) { throw 'node_preload_environment_rejected' }
    if ($Action -notin @('Inspect', 'Status')) { throw 'dev_activation_not_qualified' }
    foreach ($candidate in @($NodePath, $ConfigPath, $PlanPath)) {
        if ([string]::IsNullOrEmpty($candidate) -or $candidate -notmatch '^[A-Za-z]:[\\/]' -or
            -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'absolute_runtime_files_required' }
    }
    $checker = Join-Path $PSScriptRoot 'inspect-dev-runtime.mjs'
    & $NodePath $checker --config $ConfigPath --plan $PlanPath
    exit $LASTEXITCODE
} catch {
    # No raw exception/command line/private path forwarding.
    $code = $_.Exception.Message
    if ($code -notmatch '^[a-z_]{1,80}$') { $code = 'runtime_inspection_failed' }
    [Console]::Error.WriteLine((@{ error = $code; qualified = $false; upstreamEnabled = $false } | ConvertTo-Json -Compress))
    exit 1
}
