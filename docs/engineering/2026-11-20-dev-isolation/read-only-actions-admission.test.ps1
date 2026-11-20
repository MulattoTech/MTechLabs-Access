# Access #46 — offline GitHub Actions admission metadata classification tests.
# Pure synthetic metadata; no gh CLI, network, production, or account changes.
#requires -Version 7.0
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$file=Join-Path $PSScriptRoot 'read-only-actions-admission.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
if(@($errors).Count){throw 'admission_source_syntax_invalid'}
$definitions=@($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Get-AdmissionReport'
},$true))
if($definitions.Count -ne 1){throw 'admission_helper_not_unique'}
$helper=$definitions[0].Extent.Text

& {
    param([string]$definition)
    . ([scriptblock]::Create($definition))
    $id=[long]44742255585
    $sha='f0855c1227aacc49071581bb52ba5566bc07ffce'
    $required=@{
        'test'=@('Run npm test','Run npm run check','Run npm run build',
            'Check generated UI matches its sources')
        'managed-mcp'=@('Run npm test')
        'managed-mcp-windows'=@('Run npm test')
        'Upstream qualification / ubuntu-latest / Node 24'=@(
            'Verify manager and qualification guards on this platform',
            'Compare real pinned upstream packages in disposable stores')
        'Upstream qualification / windows-latest / Node 24'=@(
            'Verify manager and qualification guards on this platform',
            'Compare real pinned upstream packages in disposable stores')
    }
    $names=@('test','managed-mcp','managed-mcp-windows',
        'Upstream qualification / ubuntu-latest / Node 24',
        'Upstream qualification / windows-latest / Node 24')
    function New-Pr {
        return @{
            number=45
            headRefOid='f0855c1227aacc49071581bb52ba5566bc07ffce'
            baseRefOid='15e851b11984592803d37599b639772e51e5c8c0'
            state='OPEN'
            isDraft=$true
            mergedAt=$null
        }
    }
    function New-Run {
        $jobs=@(foreach($name in $names){
            $steps=@(foreach($label in $required[$name]){
                @{name=$label;status='completed';conclusion='success'}
            })
            @{name=$name;status='completed';conclusion='success';steps=$steps}
        })
        return @{
            databaseId=[long]44742255585
            headSha='f0855c1227aacc49071581bb52ba5566bc07ffce'
            attempt=2
            event='pull_request'
            workflowName='Verify access controls and code monitoring'
            status='completed'
            conclusion='success'
            jobs=$jobs
        }
    }
    function Check(
        [string]$name,[hashtable]$run,
        [bool]$admission,[bool]$workflowSuccess,[bool]$requiredObserved,
        [string]$reason,[int]$jobsWithSteps,[int]$stagesObserved,
        [hashtable]$pr=$null,[bool]$expectCurrentPr=$true
    ){
        if($null -eq $pr){$pr=New-Pr}
        $r=Get-AdmissionReport -Run $run -Pr $pr -Id $id -PrNumber 45 -ExpectedSha $sha -ExpectedBase '15e851b11984592803d37599b639772e51e5c8c0'
        if($r.admissionObserved -ne $admission -or
           $r.workflowReportedSuccess -ne $workflowSuccess -or
           $r.requiredTestStagesObserved -ne $requiredObserved -or
           $r.reason -cne $reason -or
           $r.completedWithSteps -ne $jobsWithSteps -or
           $r.observedRequiredStages -ne $stagesObserved -or
           $r.currentPrCandidateMatched -ne $expectCurrentPr -or
           $r.independentlyVerified -ne $false -or
           $r.actualMainAccepted -ne $false -or
           $r.devActivationAuthorized -ne $false) {
            throw ('admission_case_mismatch:' + $name)
        }
        return $true
    }
    $passed=0
    $run=New-Run
    if(Check 'all_expected_steps_success' $run $true $true $true 'metadata_reports_success_artifacts_not_reviewed' 5 10){$passed++}

    $run=New-Run;$run.jobs[0].steps[0].conclusion='failure'
    $run.jobs[0].conclusion='failure';$run.conclusion='failure'
    if(Check 'real_test_step_failed' $run $true $false $true 'required_stages_observed_but_tests_not_all_successful' 5 10){$passed++}

    $run=New-Run;$run.jobs[1].conclusion='failure';$run.conclusion='failure'
    if(Check 'job_result_failed' $run $true $false $true 'required_stages_observed_but_tests_not_all_successful' 5 10){$passed++}

    $run=New-Run;$run.jobs[0].steps[0].conclusion='failure'
    if(Check 'run_success_but_test_step_failed' $run $true $false $true 'required_stages_observed_but_tests_not_all_successful' 5 10){$passed++}

    $run=New-Run
    foreach($job in $run.jobs){$job.steps=@();$job.conclusion='failure'}
    $run.conclusion='failure'
    if(Check 'billing_prestart_zero_steps' $run $false $false $false 'jobs_have_no_executed_steps' 0 0){$passed++}

    $run=New-Run;$run.jobs[0].steps=@()
    if(Check 'one_job_no_steps' $run $false $false $false 'jobs_have_no_executed_steps' 4 6){$passed++}

    $run=New-Run;$run.jobs[0].steps[0].conclusion='skipped'
    if(Check 'required_step_skipped' $run $true $false $false 'required_test_stages_not_observed' 5 9){$passed++}

    $run=New-Run
    foreach($job in $run.jobs){
        $job.steps=@(@{name='Set up job';status='completed';conclusion='success'})
    }
    if(Check 'only_runner_setup_steps' $run $true $false $false 'required_test_stages_not_observed' 5 0){$passed++}

    $run=New-Run;$run.jobs[0].steps=@(@{name='Run npm test';status='completed';conclusion='success'})
    if(Check 'root_test_but_no_check_or_build' $run $true $false $false 'required_test_stages_not_observed' 5 7){$passed++}

    $run=New-Run;$run.jobs[3].steps=@($run.jobs[3].steps|Select-Object -First 1)
    if(Check 'upstream_manager_tests_but_no_qualify_upstream' $run $true $false $false 'required_test_stages_not_observed' 5 9){$passed++}

    $run=New-Run;$run.jobs[0].steps+=@{name='Run npm test';status='completed';conclusion='success'}
    if(Check 'duplicate_required_step_ambiguous' $run $true $false $false 'required_test_stages_not_observed' 5 9){$passed++}

    $run=New-Run;$run.event='push'
    if(Check 'wrong_event' $run $false $false $false 'run_event_mismatch' 0 0){$passed++}

    $run=New-Run;$run.workflowName='Untrusted workflow'
    if(Check 'wrong_workflow_name' $run $false $false $false 'workflow_identity_mismatch' 0 0){$passed++}

    $run=New-Run;$run.headSha='0000000000000000000000000000000000000000'
    if(Check 'wrong_head_sha' $run $false $false $false 'run_identity_mismatch' 0 0){$passed++}

    $run=New-Run;$run.databaseId=[long]444
    if(Check 'wrong_run_id' $run $false $false $false 'run_identity_mismatch' 0 0){$passed++}

    $run=New-Run;$run.jobs[0].name=$run.jobs[1].name
    if(Check 'duplicate_jobs' $run $false $false $false 'five_job_identity_mismatch' 0 0){$passed++}

    $run=New-Run;$run.jobs=@($run.jobs|Select-Object -Skip 1)
    if(Check 'missing_job' $run $false $false $false 'five_job_identity_mismatch' 0 0){$passed++}

    $run=New-Run;$run.jobs+=@(@{name='extra';status='completed';conclusion='success';steps=@()})
    if(Check 'extra_job' $run $false $false $false 'five_job_identity_mismatch' 0 0){$passed++}

    $run=New-Run;$run.status='in_progress';$run.conclusion=''
    if(Check 'run_not_complete' $run $false $false $false 'run_not_completed' 5 10){$passed++}

    $run=New-Run;$run.jobs[0].steps=$null
    if(Check 'missing_step_metadata' $run $false $false $false 'jobs_have_no_executed_steps' 4 6){$passed++}

    $run=@{}
    if(Check 'missing_metadata' $run $false $false $false 'metadata_unverified' 0 0){$passed++}

    $run=New-Run;$pr=New-Pr;$pr.headRefOid='0000000000000000000000000000000000000000'
    if(Check 'pr_current_head_advanced' $run $false $false $false 'current_pr_head_mismatch' 0 0 $pr $false){$passed++}

    $run=New-Run;$pr=New-Pr;$pr.baseRefOid='0000000000000000000000000000000000000000'
    if(Check 'pr_base_advanced' $run $false $false $false 'current_pr_base_mismatch' 0 0 $pr $false){$passed++}

    $run=New-Run;$pr=New-Pr;$pr.number=46
    if(Check 'wrong_pr_number' $run $false $false $false 'current_pr_state_unqualified' 0 0 $pr $false){$passed++}

    $run=New-Run;$pr=New-Pr;$pr.state='CLOSED'
    if(Check 'closed_pr' $run $false $false $false 'current_pr_state_unqualified' 0 0 $pr $false){$passed++}

    $run=New-Run;$pr=New-Pr;$pr.isDraft=$false
    if(Check 'not_draft_pr' $run $false $false $false 'current_pr_state_unqualified' 0 0 $pr $false){$passed++}

    $run=New-Run;$pr=New-Pr;$pr.mergedAt='2026-11-20T12:00:00Z'
    if(Check 'merged_pr' $run $false $false $false 'current_pr_state_unqualified' 0 0 $pr $false){$passed++}

    $run=New-Run;$pr=@{}
    if(Check 'missing_pr_fields' $run $false $false $false 'metadata_unverified' 0 0 $pr $false){$passed++}

    $run=New-Run;$pr=New-Pr;$pr.headRefOid=''
    if(Check 'blank_current_pr_head' $run $false $false $false 'current_pr_head_mismatch' 0 0 $pr $false){$passed++}

    [pscustomobject]@{
        schemaVersion=1
        suite='offline-actions-admission-and-required-stage-classification'
        passed=$passed
        failed=0
        expectedJobCount=5
        expectedRequiredStageCount=10
        pinnedCurrentPrIdentityChecked=$true
        githubQueried=$false
        productionQueried=$false
        independentlyVerified=$false
        devActivationAuthorized=$false
    }|ConvertTo-Json -Compress
} $helper
