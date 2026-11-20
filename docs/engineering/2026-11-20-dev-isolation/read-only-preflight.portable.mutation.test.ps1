# Access #46 — portable ACL fixture sensitivity controls.
# Runs only on disposable copies of reviewed source. Never executes preflight top level.
#requires -Version 7.0
[CmdletBinding()]
param(
    # Bounded child-runner execution; defaults to 30 seconds per disposable
    # helper fixture. Reducing this threshold is useful only in failure tests.
    [ValidateRange(1000, 60000)][int]$ChildTimeoutMs = 30000
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourcePath = Join-Path $PSScriptRoot 'read-only-preflight.ps1'
$testPath = Join-Path $PSScriptRoot 'read-only-preflight.portable.test.ps1'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $testPath -PathType Leaf)) {
    throw 'portable_mutation_source_missing'
}
$source = Get-Content -LiteralPath $sourcePath -Raw
$portable = Get-Content -LiteralPath $testPath -Raw
$sourceHashBefore = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$testHashBefore = (Get-FileHash -LiteralPath $testPath -Algorithm SHA256).Hash

# Pin the host's actual pwsh command. Child processes read only synthetic ACL
# helpers; each is restricted by test source design, not an OS sandbox.
$childShell = (Get-Command pwsh -CommandType Application -ErrorAction Stop).Source
$mutations = @(
    @{name='mutation-rights-skipped'; expectedFailure='fixture_mismatch:authenticated-modify-active:broadMutationAllowCount';
      old='if (($bits -band $danger) -eq 0) {continue}';
      replacement='if ($true) {continue}'},
    @{name='inherit-only-misclassified'; expectedFailure='fixture_mismatch:authenticated-inherit-only:broadMutationAllowCount';
      old='$inheritOnly = [bool]($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)';
      replacement='$inheritOnly = $false'},
    @{name='builtin-system-disowned'; expectedFailure='fixture_mismatch:no-write-aces:ownerKind';
      old="'S-1-5-18' { return 'system' }";
      replacement="'S-1-5-18' { return 'other' }"},
    @{name='unknown-sid-trusted'; expectedFailure='fixture_mismatch:custom-sid-modify:inheritableUnclassifiedMutationCount';
      old="default { return 'other' }";
      replacement="default { return 'administrators' }"},
    @{name='broad-grant-underreported'; expectedFailure='fixture_mismatch:authenticated-modify-active:broadMutationAllowCount';
      old='$isBroad = $principal -in @(''authenticated-users'',''everyone'',''builtin-users'')';
      replacement='$isBroad = $false'},
    @{name='reparse-point-ignored'; expectedFailure='fixture_mismatch:reparse-detected:reparse';
      old='$result.reparse = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)';
      replacement='$result.reparse = $false'},
    @{name='denied-path-reported-observed'; expectedFailure='case_status_mismatch:path-denied';
      old='$result.status = ''unverified''';
      replacement='$result.status = ''observed'''}
)
if($mutations.Count -ne 7) { throw 'mutation_catalog_incorrect' }

$scratchRoot=Join-Path ([IO.Path]::GetTempPath()) (
    'MTerm46-PortableFixture-Mutations-' + [guid]::NewGuid().ToString('N'))
$rootCreated=$false
$positivePassed=$false
$rejected=0
$receipts=[Collections.Generic.List[object]]::new()
$PSNativeCommandUseErrorActionPreference=$false
try {
    [IO.Directory]::CreateDirectory($scratchRoot) | Out-Null
    $rootCreated=$true

    function Invoke-Fixture([string]$caseName,[string]$sourceText) {
        # No source or result files are ever written outside the new scratch
        # root. This is a disposable copy; the original repo is never edited.
        $path=Join-Path $scratchRoot $caseName
        [IO.Directory]::CreateDirectory($path) | Out-Null
        $srcFile=Join-Path $path 'read-only-preflight.ps1'
        $testFile=Join-Path $path 'read-only-preflight.portable.test.ps1'
        [IO.File]::WriteAllText($srcFile,$sourceText,[Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($testFile,$portable,[Text.UTF8Encoding]::new($false))

        $tokens=$null
        $errors=$null
        [Management.Automation.Language.Parser]::ParseFile(
            $srcFile,[ref]$tokens,[ref]$errors) | Out-Null
        if(@($errors).Count -ne 0) {throw 'mutation_source_parse_failed'}
        # Never let an intentionally broken child block this runner forever.
        # Use .NET Process with separate async pipe drains to avoid stdout/stderr
        # deadlocks, and terminate only the child process tree we started.
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $childShell
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        foreach($arg in @('-NoLogo','-NoProfile','-NonInteractive','-File',$testFile)){
            [void]$start.ArgumentList.Add($arg)
        }
        $process = [Diagnostics.Process]::new()
        $process.StartInfo = $start
        try {
            if(-not $process.Start()) { throw 'portable_child_start_failed' }
            # Stream fixed-size chunks from both redirected pipes. ReadToEndAsync
            # would buffer unbounded output until the child exits; the cap must
            # be enforced DURING collection to bound memory on a noisy fixture.
            $maxChars = 65536
            $stdoutText = [Text.StringBuilder]::new()
            $stderrText = [Text.StringBuilder]::new()
            $stdoutBuffer = [char[]]::new(2048)
            $stderrBuffer = [char[]]::new(2048)
            $outDone = $false
            $errDone = $false
            $outTask = $process.StandardOutput.ReadAsync($stdoutBuffer,0,$stdoutBuffer.Length)
            $errTask = $process.StandardError.ReadAsync($stderrBuffer,0,$stderrBuffer.Length)
            $clock = [Diagnostics.Stopwatch]::StartNew()
            while($true) {
                $remaining = $ChildTimeoutMs - [int]$clock.ElapsedMilliseconds
                if($remaining -le 0) { throw ('portable_fixture_timed_out:' + $caseName) }
                $pending = @()
                if(-not $outDone) { $pending += $outTask }
                if(-not $errDone) { $pending += $errTask }
                if($pending.Count -eq 0) {
                    if($process.WaitForExit([Math]::Min(100,$remaining))) { break }
                    continue
                }
                $index = [Threading.Tasks.Task]::WaitAny(
                    [Threading.Tasks.Task[]]$pending,[Math]::Min(100,$remaining))
                if($index -eq -1) { continue }
                $completed = $pending[$index]
                if(-not $outDone -and [object]::ReferenceEquals($completed,$outTask)) {
                    $count = [int]$outTask.GetAwaiter().GetResult()
                    if($count -eq 0) {
                        $outDone = $true
                    } else {
                        [void]$stdoutText.Append($stdoutBuffer,0,$count)
                        if($stdoutText.Length + $stderrText.Length -gt $maxChars) {
                            throw ('portable_child_output_exceeded_limit:' + $caseName)
                        }
                        $outTask = $process.StandardOutput.ReadAsync($stdoutBuffer,0,$stdoutBuffer.Length)
                    }
                } elseif(-not $errDone -and [object]::ReferenceEquals($completed,$errTask)) {
                    $count = [int]$errTask.GetAwaiter().GetResult()
                    if($count -eq 0) {
                        $errDone = $true
                    } else {
                        [void]$stderrText.Append($stderrBuffer,0,$count)
                        if($stdoutText.Length + $stderrText.Length -gt $maxChars) {
                            throw ('portable_child_output_exceeded_limit:' + $caseName)
                        }
                        $errTask = $process.StandardError.ReadAsync($stderrBuffer,0,$stderrBuffer.Length)
                    }
                } else {
                    throw ('portable_child_output_task_unknown:' + $caseName)
                }
            }
            $captured = $stdoutText.ToString() + [Environment]::NewLine + $stderrText.ToString()
            return [pscustomobject]@{exitCode=$process.ExitCode;output=$captured}
        } finally {
            if(-not $process.HasExited) {
                try { $process.Kill($true) } catch {}
                [void]$process.WaitForExit(5000)
            }
            $process.Dispose()
        }
    }

    $baseline=Invoke-Fixture 'control' $source
    if($baseline.exitCode -ne 0) {throw 'unmutated_portable_fixture_did_not_pass'}
    $parsed = $baseline.output | ConvertFrom-Json -AsHashtable
    if($parsed.passed -ne 15 -or $parsed.failed -ne 0 -or
       $parsed.activationAuthorized -ne $false) {
        throw 'unmutated_portable_fixture_contract_failed'
    }
    $positivePassed=$true

    foreach($mutation in $mutations) {
        $old=[string]$mutation.old
        $replace=[string]$mutation.replacement
        # Every mutation must be a unique, intentional single-source change.
        if([string]::IsNullOrEmpty($old) -or $source.Split(@($old),[StringSplitOptions]::None).Count -ne 2) {
            throw ('nonunique_mutation_anchor:' + $mutation.name)
        }
        $mutated=$source.Replace($old,$replace)
        if($mutated -ceq $source) {throw ('mutation_did_not_change_source:' + $mutation.name)}
        $result=Invoke-Fixture ([string]$mutation.name) $mutated

        # Only the precise, causally expected first fixture assertion counts
        # as a killed mutant. A generic unrelated fixture failure is not proof.
        $firstFailure=[regex]::Match(
            $result.output,
            '(?:fixture_mismatch|case_status_mismatch):[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?')
        if($result.exitCode -eq 0 -or -not $firstFailure.Success -or
           $firstFailure.Value -cne [string]$mutation.expectedFailure){
            throw ('portable_fixture_unexpected_mutant_failure:' + $mutation.name)
        }
        $rejected++
        $receipts.Add([pscustomobject]@{name=$mutation.name;rejected=$true})
    }
} finally {
    # Remove only the freshly-created GUID-scoped scratch directory.
    if($rootCreated -and (Test-Path -LiteralPath $scratchRoot)){
        [IO.Directory]::Delete($scratchRoot,$true)
    }
}
# A claimed cleanup/source integrity status must be verified, not hardcoded.
$scratchGone = -not (Test-Path -LiteralPath $scratchRoot)
$sourceUnchanged = ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ceq $sourceHashBefore)
$testUnchanged = ((Get-FileHash -LiteralPath $testPath -Algorithm SHA256).Hash -ceq $testHashBefore)
if (-not $scratchGone -or -not $sourceUnchanged -or -not $testUnchanged) {
    throw 'portable_mutation_cleanup_or_source_integrity_failed'
}
[pscustomobject]@{
    schemaVersion=1
    suite='portable-acl-fixture-sensitivity'
    unmodifiedControlPassed=$positivePassed
    mutantsRejected=$rejected
    mutantTotal=$mutations.Count
    mutations=$receipts.ToArray()
    ownerBaselineUsed=$false
    productionRuntimeQueried=$false
    originalSourceModified=(-not ($sourceUnchanged -and $testUnchanged))
    scratchRemoved=$scratchGone
    exactFailureClassification=$true
    activationAuthorized=$false
} | ConvertTo-Json -Depth 4 -Compress
