# Access #46 — read-only GitHub Actions job-admission report.
# This is NOT an acceptance verifier, CI rerunner, production tool, or DEV activator.
#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateRange(1, [long]::MaxValue)]
    [long]$RunId = 44742255585,
    [ValidateRange(1, 999999)]
    [int]$PullRequestNumber = 45,
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string]$ExpectedHeadSha = 'f0855c1227aacc49071581bb52ba5566bc07ffce',
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string]$ExpectedBaseSha = '15e851b11984592803d37599b639772e51e5c8c0'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-AdmissionReport {
    [CmdletBinding()]
    param([hashtable]$Run, [hashtable]$Pr, [long]$Id,
          [int]$PrNumber, [string]$ExpectedSha, [string]$ExpectedBase)
    $expectedNames = @(
        'test',
        'managed-mcp',
        'managed-mcp-windows',
        'Upstream qualification / ubuntu-latest / Node 24',
        'Upstream qualification / windows-latest / Node 24'
    )
    # Names are the actual workflow step labels in PR45's frozen check.yml.
    # Completed setup/checkout alone is not evidence that required test stages
    # were reached; maintain those as separate metadata classifications.
    $requiredStages = @{
        'test' = @('Run npm test', 'Run npm run check', 'Run npm run build',
            'Check generated UI matches its sources')
        'managed-mcp' = @('Run npm test')
        'managed-mcp-windows' = @('Run npm test')
        'Upstream qualification / ubuntu-latest / Node 24' = @(
            'Verify manager and qualification guards on this platform',
            'Compare real pinned upstream packages in disposable stores')
        'Upstream qualification / windows-latest / Node 24' = @(
            'Verify manager and qualification guards on this platform',
            'Compare real pinned upstream packages in disposable stores')
    }
    $report = [ordered]@{
        schemaVersion=1
        scope='GitHub Actions metadata admission only — no hosted acceptance'
        runId=$Id
        expectedHeadSha=$ExpectedSha
        expectedBaseSha=$ExpectedBase
        prNumber=$PrNumber
        prState='unverified'
        prHeadSha='unverified'
        prBaseSha='unverified'
        currentPrCandidateMatched=$false
        runEvent='unverified'
        workflowName='unverified'
        runAttempt=$null
        runStatus='unverified'
        runConclusion='unverified'
        jobCount=0
        expectedJobSetObserved=$false
        completedWithSteps=0
        requiredStageCount=0
        observedRequiredStages=0
        requiredStagesSucceeded=0
        requiredTestStagesObserved=$false
        jobs=@()
        admissionObserved=$false
        workflowReportedSuccess=$false
        independentlyVerified=$false
        actualMainAccepted=$false
        devActivationAuthorized=$false
        reason='metadata_unverified'
    }
    if($null -eq $Pr) { return [pscustomobject]$report }
    try {
        $report.prState=[string]$Pr.state
        $report.prHeadSha=[string]$Pr.headRefOid
        $report.prBaseSha=[string]$Pr.baseRefOid
        if([int]$Pr.number -ne $PrNumber -or
           $report.prState -cne 'OPEN' -or
           [bool]$Pr.isDraft -ne $true -or
           $null -ne $Pr.mergedAt) {
            $report.reason='current_pr_state_unqualified'
            return [pscustomobject]$report
        }
        if($report.prHeadSha -cne $ExpectedSha) {
            $report.reason='current_pr_head_mismatch'
            return [pscustomobject]$report
        }
        if($report.prBaseSha -cne $ExpectedBase) {
            $report.reason='current_pr_base_mismatch'
            return [pscustomobject]$report
        }
        $report.currentPrCandidateMatched=$true
        if($null -eq $Run) {
            $report.reason='run_metadata_unverified'
            return [pscustomobject]$report
        }
        $report.runStatus=[string]$Run.status
        $report.runConclusion=[string]$Run.conclusion
        $report.runAttempt=[int]$Run.attempt
        $report.runEvent=[string]$Run.event
        $report.workflowName=[string]$Run.workflowName
        if([long]$Run.databaseId -ne $Id -or [string]$Run.headSha -cne $ExpectedSha){
            $report.reason='run_identity_mismatch'
            return [pscustomobject]$report
        }
        if($report.runEvent -cne 'pull_request'){
            $report.reason='run_event_mismatch'
            return [pscustomobject]$report
        }
        if($report.workflowName -cne 'Verify access controls and code monitoring'){
            $report.reason='workflow_identity_mismatch'
            return [pscustomobject]$report
        }
        $jobs=@($Run.jobs)
        $report.jobCount=$jobs.Count
        $names=@($jobs | ForEach-Object { [string]$_.name })
        $distinctNames=@($names | Sort-Object -Unique)
        $actualSorted=@($names | Sort-Object)
        $expectedSorted=@($expectedNames | Sort-Object)
        if($jobs.Count -ne 5 -or $distinctNames.Count -ne 5 -or
            ($actualSorted -join [char]31) -cne ($expectedSorted -join [char]31)){
            $report.reason='five_job_identity_mismatch'
            return [pscustomobject]$report
        }
        $report.expectedJobSetObserved=$true
        $summaries=@()
        foreach($job in ($jobs | Sort-Object -Property name)){
            $steps=@($job.steps | Where-Object { $null -ne $_ })
            $completeSteps=@($steps | Where-Object { $_.status -eq 'completed' }).Count
            $required=@($requiredStages[[string]$job.name])
            $reached=0
            $succeeded=0
            foreach($requiredName in $required) {
                # If a duplicated step label exists, the metadata is ambiguous:
                # neither copy can count toward the required frozen sequence.
                $matching=@($steps | Where-Object { $_.name -ceq $requiredName })
                if($matching.Count -eq 1 -and
                   $matching[0].status -eq 'completed' -and
                   $matching[0].conclusion -in @('success','failure')) {
                    $reached++
                    if($matching[0].conclusion -eq 'success') { $succeeded++ }
                }
            }
            $report.requiredStageCount += $required.Count
            $report.observedRequiredStages += $reached
            $report.requiredStagesSucceeded += $succeeded
            $summaries += [pscustomobject]@{
                name=[string]$job.name
                status=[string]$job.status
                conclusion=[string]$job.conclusion
                stepCount=$steps.Count
                completedSteps=$completeSteps
                requiredStageCount=$required.Count
                observedRequiredStages=$reached
                requiredStagesSucceeded=$succeeded
            }
        }
        $report.jobs=@($summaries)
        $report.completedWithSteps=@($summaries | Where-Object{
            $_.status -eq 'completed' -and $_.completedSteps -gt 0
        }).Count
        if($report.runStatus -ne 'completed'){
            $report.reason='run_not_completed'
        } elseif($report.completedWithSteps -ne 5){
            $report.reason='jobs_have_no_executed_steps'
        } else {
            # Runner admission does not establish any test command executed.
            $report.admissionObserved=$true
            $report.requiredTestStagesObserved=($report.requiredStageCount -eq 10 -and
                $report.observedRequiredStages -eq $report.requiredStageCount)
            if(-not $report.requiredTestStagesObserved){
                $report.reason='required_test_stages_not_observed'
            } else {
                $report.workflowReportedSuccess=($report.runConclusion -eq 'success' -and
                    @($summaries | Where-Object{$_.conclusion -eq 'success'}).Count -eq 5 -and
                    $report.requiredStagesSucceeded -eq $report.requiredStageCount)
                $report.reason=if($report.workflowReportedSuccess){
                    'metadata_reports_success_artifacts_not_reviewed'
                }else{
                    'required_stages_observed_but_tests_not_all_successful'
                }
            }
        }
    } catch {
        # A partially parsable or redacted API response is not admission proof.
        $report.admissionObserved=$false
        $report.workflowReportedSuccess=$false
        # Preserve the independently checked current-PR status even if the
        # subsequent historical run metadata is unavailable.
        $report.reason='metadata_unverified'
    }
    return [pscustomobject]$report
}

try {
    # Re-read current PR identity before classifying a historical run. Neither
    # caller input nor run metadata establishes the still-current PR head.
    $prJson=& gh pr view $PullRequestNumber --repo MulattoTech/MTechLabs-Access --json number,headRefOid,baseRefOid,state,isDraft,mergedAt 2>$null
    if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($prJson -join ''))) {
        throw 'github_pr_metadata_unavailable'
    }
    $pr=($prJson -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable
    $json=& gh run view $RunId --repo MulattoTech/MTechLabs-Access --json databaseId,attempt,event,workflowName,status,conclusion,headSha,jobs 2>$null
    if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($json -join ''))){
        throw 'github_run_metadata_unavailable'
    }
    $run=($json -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable
    $result=Get-AdmissionReport -Run $run -Pr $pr -Id $RunId -PrNumber $PullRequestNumber -ExpectedSha $ExpectedHeadSha -ExpectedBase $ExpectedBaseSha
} catch {
    $result=Get-AdmissionReport -Run @{} -Pr @{} -Id $RunId -PrNumber $PullRequestNumber -ExpectedSha $ExpectedHeadSha -ExpectedBase $ExpectedBaseSha
    $result.reason='github_read_metadata_unavailable'
}
$result | ConvertTo-Json -Depth 6 -Compress
if(-not $result.admissionObserved) { exit 1 }
