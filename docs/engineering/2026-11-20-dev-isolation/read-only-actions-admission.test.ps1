# Access #46 — offline unit tests for read-only Actions admission classification.
# Requires PowerShell 7. Uses only fabricated GitHub metadata; no gh/API calls.
#requires -Version 7.0
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$file=Join-Path $PSScriptRoot 'read-only-actions-admission.ps1'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile(
    $file,[ref]$tokens,[ref]$parseErrors)
if(@($parseErrors).Count){throw 'admission_source_syntax_invalid'}
$def=@($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Get-AdmissionReport'
},$true))
if($def.Count -ne 1){throw 'admission_helper_not_unique'}
$code=$def[0].Extent.Text

& {
 param([string]$definition)
 . ([scriptblock]::Create($definition))
 $id=[long]44742255585
 $sha='f0855c1227aacc49071581bb52ba5566bc07ffce'
 $names=@(
  'test','managed-mcp','managed-mcp-windows',
  'Upstream qualification / ubuntu-latest / Node 24',
  'Upstream qualification / windows-latest / Node 24'
 )
 function Build-Run {
  $jobs=@($names|ForEach-Object{
    @{name=$_;status='completed';conclusion='success';
      steps=@(@{status='completed';conclusion='success'})}
  })
  return @{
    databaseId=[long]44742255585
    headSha='f0855c1227aacc49071581bb52ba5566bc07ffce'
    attempt=2
    status='completed'
    conclusion='success'
    jobs=$jobs
  }
 }
 function Inspect([string]$label,[hashtable]$run,[bool]$admitted,
      [bool]$passing,[string]$reason,[int]$completed){
  $r=Get-AdmissionReport -Run $run -Id $id -ExpectedSha $sha
  if($r.admissionObserved -ne $admitted -or
    $r.workflowReportedSuccess -ne $passing -or
    $r.reason -cne $reason -or
    $r.completedWithSteps -ne $completed -or
    $r.independentlyVerified -ne $false -or
    $r.actualMainAccepted -ne $false -or
    $r.devActivationAuthorized -ne $false){
      throw ('admission_classification_wrong:' + $label)
  }
  return $true
 }
 $passed=0
 $run=Build-Run
 if(Inspect 'all_successful' $run $true $true 'metadata_reports_success_artifacts_not_reviewed' 5){$passed++}
 $run=Build-Run;$run.conclusion='failure';$run.jobs[0].conclusion='failure'
 if(Inspect 'genuine_tests_failed' $run $true $false 'jobs_executed_but_tests_not_all_successful' 5){$passed++}
 $run=Build-Run;foreach($j in $run.jobs){$j.steps=@();$j.conclusion='failure'};$run.conclusion='failure'
 if(Inspect 'prestart_billing_rejection' $run $false $false 'jobs_have_no_executed_steps' 0){$passed++}
 $run=Build-Run;$run.jobs[0].steps=@()
 if(Inspect 'one_job_no_steps' $run $false $false 'jobs_have_no_executed_steps' 4){$passed++}
 $run=Build-Run;$run.jobs[0].steps=@(@{status='skipped';conclusion='skipped'})
 if(Inspect 'only_skipped_step' $run $false $false 'jobs_have_no_executed_steps' 4){$passed++}
 $run=Build-Run;$run.headSha='0000000000000000000000000000000000000000'
 if(Inspect 'wrong_head' $run $false $false 'run_identity_mismatch' 0){$passed++}
 $run=Build-Run;$run.databaseId=[long]12345
 if(Inspect 'wrong_run_id' $run $false $false 'run_identity_mismatch' 0){$passed++}
 $run=Build-Run;$run.jobs[0].name=$run.jobs[1].name
 if(Inspect 'duplicate_job' $run $false $false 'five_job_identity_mismatch' 0){$passed++}
 $run=Build-Run;$run.jobs=@($run.jobs|Select-Object -Skip 1)
 if(Inspect 'missing_job' $run $false $false 'five_job_identity_mismatch' 0){$passed++}
 $run=Build-Run;$run.jobs+=@(@{name='unexpected';status='completed';conclusion='success';steps=@(@{status='completed'})})
 if(Inspect 'extra_job' $run $false $false 'five_job_identity_mismatch' 0){$passed++}
 $run=Build-Run;$run.status='in_progress';$run.conclusion=''
 if(Inspect 'run_incomplete' $run $false $false 'run_not_completed' 5){$passed++}
 $run=Build-Run;$run.jobs[0].steps=$null
 if(Inspect 'missing_steps_data' $run $false $false 'jobs_have_no_executed_steps' 4){$passed++}
 $run=@{}
 if(Inspect 'unparsable_metadata' $run $false $false 'metadata_unverified' 0){$passed++}
 [pscustomobject]@{
  schemaVersion=1
  scope='offline-admission-classifier-unit-tests'
  passed=$passed
  failed=0
  fixtureCount=$names.Count
  githubQueried=$false
  productionQueried=$false
  independentlyVerified=$false
  devActivationAuthorized=$false
 } | ConvertTo-Json -Compress
} $code
