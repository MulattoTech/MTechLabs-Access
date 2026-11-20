# Access #46 — read-only GitHub Actions job-admission report.
# This is NOT an acceptance verifier, CI rerunner, production tool, or DEV activator.
#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateRange(1, [long]::MaxValue)]
    [long]$RunId = 44742255585,
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string]$ExpectedHeadSha = 'f0855c1227aacc49071581bb52ba5566bc07ffce'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-AdmissionReport {
    [CmdletBinding()]
    param([hashtable]$Run, [long]$Id, [string]$ExpectedSha)
    $expectedNames = @(
        'test',
        'managed-mcp',
        'managed-mcp-windows',
        'Upstream qualification / ubuntu-latest / Node 24',
        'Upstream qualification / windows-latest / Node 24'
    )
    $report = [ordered]@{
        schemaVersion=1
        scope='GitHub Actions metadata admission only — no hosted acceptance'
        runId=$Id
        expectedHeadSha=$ExpectedSha
        runAttempt=$null
        runStatus='unverified'
        runConclusion='unverified'
        jobCount=0
        expectedJobSetObserved=$false
        completedWithSteps=0
        jobs=@()
        admissionObserved=$false
        workflowReportedSuccess=$false
        independentlyVerified=$false
        actualMainAccepted=$false
        devActivationAuthorized=$false
        reason='metadata_unverified'
    }
    if($null -eq $Run) { return [pscustomobject]$report }
    try {
        $report.runStatus=[string]$Run.status
        $report.runConclusion=[string]$Run.conclusion
        $report.runAttempt=[int]$Run.attempt
        if([long]$Run.databaseId -ne $Id -or [string]$Run.headSha -cne $ExpectedSha){
            $report.reason='run_identity_mismatch'
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
            $summaries += [pscustomobject]@{
                name=[string]$job.name
                status=[string]$job.status
                conclusion=[string]$job.conclusion
                stepCount=$steps.Count
                completedSteps=$completeSteps
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
            $report.admissionObserved=$true
            $report.workflowReportedSuccess=($report.runConclusion -eq 'success' -and
                @($summaries | Where-Object{$_.conclusion -eq 'success'}).Count -eq 5)
            $report.reason=if($report.workflowReportedSuccess){
                'metadata_reports_success_artifacts_not_reviewed'
            }else{
                'jobs_executed_but_tests_not_all_successful'
            }
        }
    } catch {
        # A partially parsable or redacted API response is not admission proof.
        $report.admissionObserved=$false
        $report.workflowReportedSuccess=$false
        $report.reason='metadata_unverified'
    }
    return [pscustomobject]$report
}

try {
    $json=& gh run view $RunId --repo MulattoTech/MTechLabs-Access --json databaseId,attempt,status,conclusion,headSha,jobs 2>$null
    if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($json -join ''))){
        throw 'github_run_metadata_unavailable'
    }
    $run=($json -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable
    $result=Get-AdmissionReport -Run $run -Id $RunId -ExpectedSha $ExpectedHeadSha
} catch {
    $result=Get-AdmissionReport -Run @{} -Id $RunId -ExpectedSha $ExpectedHeadSha
    $result.reason='github_run_metadata_unavailable'
}
$result | ConvertTo-Json -Depth 6 -Compress
if(-not $result.admissionObserved) { exit 1 }
