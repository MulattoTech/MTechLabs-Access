# Access #46 — portable ACL fixture sensitivity controls.
# Runs only on disposable copies of reviewed source. Never executes preflight top level.
#requires -Version 7.0
[CmdletBinding()]
param()
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
    @{name='unknown-sid-trusted'; expectedFailure='fixture_mismatch:custom-sid-modify:unclassifiedMutationAllowCount';
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
        $captured=(& $childShell -NoLogo -NoProfile -NonInteractive -File $testFile 2>&1 | Out-String)
        $exitCode=$LASTEXITCODE
        return [pscustomobject]@{exitCode=$exitCode;output=$captured}
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
