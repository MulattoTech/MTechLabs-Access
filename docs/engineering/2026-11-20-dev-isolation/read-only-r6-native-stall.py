#!/usr/bin/env python3
"""Access #46 R42: source-bound triage of *rejected* R6 Windows native fixture.

Checks only sanitized fields extracted from two historical GitHub Actions job
logs and the exact original/current PR git objects already available locally.
No network, native fixture execution, Windows accounts, IPC, or production
access. Concordant traces narrow a stalled operation; they do NOT prove its
causal mechanism or qualify a proposed source fix.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess

HERE=Path(__file__).resolve().parent
REPO=HERE.parent.parent.parent
RECEIPT=HERE/"sanitized-r6-windows-native-stall-20261120.json"
CURRENT="f0855c1227aacc49071581bb52ba5566bc07ffce"
HISTORICAL="9d29623f45a079eb3430466eceb44aac864becd9"
PROBE="integrations/mcp-manager/windows-runtime-probe.ps1"
CHILD="integrations/mcp-manager/test/fixtures/reference-transport-child.mjs"
BLOBS={
    "r6Probe":(HISTORICAL,PROBE,"485b9a76e818d899a6bde9c34b9139652c53ed56"),
    "currentProbe":(CURRENT,PROBE,"485b9a76e818d899a6bde9c34b9139652c53ed56"),
    "r6Child":(HISTORICAL,CHILD,"2aab4bdcd07a8f37f5e32d5dd8105e36749662b6"),
    "currentChild":(CURRENT,CHILD,"1291e3031c2cb437b04915afaedb516507aed321")
}
WINDOWS_JOBS={"upstream_windows":136302296741,"manager_windows":136302296679}
PROBE_SHA="f288c56bc06647c920ee4de335d0df368e98ff426469a8e44af896214995b64d"
PROBE_GIT_NORMALIZED_SHA="7dc933d63876199fdfce8cdbf856f914163a9ff30d85b03f5c0fbc6be5bca0ca"
MAX_JSON_BYTES=20000
MAX_ERRORS=20

def git_blob(raw):
    return hashlib.sha1(b"blob "+str(len(raw)).encode("ascii")+b"\x00"+raw).hexdigest()

def source_bytes(repo=REPO):
    blobs={}
    for label,(rev,path,blob) in BLOBS.items():
        try:
            done=subprocess.run(["git","-C",str(repo),"show",rev+":"+path],
                stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=True,timeout=20)
        except (OSError,subprocess.SubprocessError):
            raise ValueError("exact_source_git_object_unavailable")
        if len(done.stdout)>100000 or git_blob(done.stdout)!=blob:
            raise ValueError("exact_source_blob_unqualified")
        blobs[label]=done.stdout
    return blobs

def load_receipt(path=RECEIPT):
    try:
        raw=path.read_bytes()
        if len(raw)>MAX_JSON_BYTES:
            raise ValueError("receipt_oversized")
        def unique(pairs):
            d={}
            for k,v in pairs:
                if k in d: raise ValueError("duplicate_json")
                d[k]=v
            return d
        data=json.loads(raw.decode("utf-8-sig"),object_pairs_hook=unique)
        if not isinstance(data,dict):
            raise ValueError("receipt_not_object")
        return data
    except (OSError,ValueError,UnicodeError):
        raise ValueError("receipt_unavailable_or_unqualified")

def classify(data,blobs):
    problems=[]
    if not isinstance(data,dict):
        data={}
        problems.append("receipt_not_object")
    if (data.get("schemaVersion")!=1 or data.get("runId")!=44740386851
        or data.get("attempt")!=1 or data.get("r6Head")!=HISTORICAL
        or data.get("pr45CurrentHeadAtReview")!=CURRENT
        or data.get("hostedAcceptancePending") is not True or data.get("rootCauseProven") is not False
        or data.get("hostedAcceptable") is not False or data.get("devActivated") is not False):
        problems.append("historical_rejection_receipt_status_unqualified")
    source_ok=False
    if not isinstance(blobs,dict):
        problems.append("source_missing")
    else:
        for label,(_,_,sha) in BLOBS.items():
            raw=blobs.get(label)
            if not isinstance(raw,bytes) or git_blob(raw)!=sha:
                problems.append("exact_source_blob_mismatch")
        if not problems:
            probe=blobs["currentProbe"].decode("utf-8")
            r6=blobs["r6Child"].decode("utf-8")
            latest=blobs["currentChild"].decode("utf-8")
            if (blobs["r6Probe"]!=blobs["currentProbe"]
                or hashlib.sha256(blobs["currentProbe"]).hexdigest()!=PROBE_GIT_NORMALIZED_SHA
                or hashlib.sha256(blobs["currentProbe"].replace(b"\n",b"\r\n")).hexdigest()!=PROBE_SHA):
                problems.append("production_probe_source_changed_from_r6")
            if probe.count("$buffer = New-Object char[] 16385")!=1:
                problems.append("current_native_buffer_control_changed")
            if ("anchorCount !== 31" not in r6 or "utility_bootstrap_control" in r6
                or "Write-FixtureProbeStage 78" not in r6
                or "Write-FixtureProbeStage 79" not in r6):
                problems.append("historical_failure_diagnostic_source_changed")
            if ("anchorCount !== 32" not in latest
                or "utility_bootstrap_control" not in latest
                or "[char[]]::new(16385)" not in latest):
                problems.append("new_failure_only_diagnostic_source_changed")
            source_ok=not problems

    rows=data.get("failures")
    bykind={}
    if not isinstance(rows,list) or len(rows)!=2:
        problems.append("historical_windows_job_set_invalid")
        rows=[]
    for row in rows:
        if not isinstance(row,dict):
            problems.append("job_report_not_object")
            continue
        role=row.get("jobKind")
        if role not in WINDOWS_JOBS or role in bykind or row.get("jobId")!=WINDOWS_JOBS.get(role):
            problems.append("historical_job_identity_mismatch")
            continue
        bykind[role]=row
        if (row.get("fixture")!="protected-reference-transport"
            or row.get("sourceUnchanged") is not True
            or row.get("probeSourceSha256")!=PROBE_SHA
            or row.get("failedStage")!="real_identity_controls"
            or row.get("failureCode")!="fixture_child_exit_wrong"
            or row.get("completedCaseCount")!=0
            or row.get("startedChildCount")!=2
            or row.get("fixtureQualified") is not False
            or row.get("controllerExitCode")!=1):
            problems.append("native_fixture_failure_record_mismatch")
        progress=row.get("identityProgress",{})
        if (not isinstance(progress,dict) or progress.get("authorityProfile") is not True
            or progress.get("authorityToken") is not False
            or progress.get("authorityIdentity") is not False
            or progress.get("unauthorizedProfile") is not False
            or progress.get("developmentProfile") is not False):
            problems.append("first_identity_control_progress_mismatch")
        child=row.get("identityChild",{})
        native=child.get("nativeInvocation",{}) if isinstance(child,dict) else {}
        if (not isinstance(child,dict) or child.get("mode")!="node-identity"
            or child.get("expectedExit")!=0 or child.get("actualExit")!=1
            or child.get("errorIdentifier")!="runtime_observation_unavailable"
            or child.get("phase")!="native_capture"
            or child.get("nativeStatus") is not None
            or not isinstance(native,dict) or native.get("phase")!="native_capture"
            or native.get("killed") is not True or native.get("signal")!="SIGTERM"
            or native.get("stdoutBytes")!=0 or native.get("stderrBytes")!=0
            or type(native.get("elapsedMs")) is not int
            or not 14000<=native["elapsedMs"]<=16000):
            problems.append("native_capture_timeout_record_mismatch")
        diagnostic=row.get("diagnosticProbe",{})
        trace=diagnostic.get("stages") if isinstance(diagnostic,dict) else None
        if (not isinstance(diagnostic,dict)
            or diagnostic.get("kind")!="failure-only-instrumented-probe"
            or diagnostic.get("acceptanceEvidence") is not False
            or diagnostic.get("invocations")!=1
            or diagnostic.get("deadlineMs")!=15000
            or diagnostic.get("anchorCount")!=31
            or diagnostic.get("anchorsMatched") is not True
            or diagnostic.get("originalSourceUnchanged") is not True
            or diagnostic.get("sourceSha256")!=PROBE_SHA
            or diagnostic.get("lastStageId")!=78
            or not isinstance(trace,list) or not trace
            or trace[-1]!=78 or 79 in trace or 82 in trace
            or diagnostic.get("failureCode") is not None):
            problems.append("failure_only_probe_boundary_mismatch")
        outcome=diagnostic.get("outcome",{}) if isinstance(diagnostic,dict) else {}
        if (not isinstance(outcome,dict) or outcome.get("killed") is not True
            or outcome.get("signal")!="SIGTERM"
            or outcome.get("stdoutBytes")!=0
            or type(outcome.get("elapsedMs")) is not int
            or not 14000<=outcome["elapsedMs"]<=16000):
            problems.append("derivative_probe_timeout_record_mismatch")
        if row.get("fixtureCleanupErrorCount")!=0:
            problems.append("fixture_cleanup_errors_observed")
    if set(bykind)!=set(WINDOWS_JOBS):
        problems.append("incomplete_windows_job_evidence")
    counts=Counter(problems)
    return {
        "schemaVersion":1,
        "scope":"frozen two-job R6 native_capture timeout boundary and unchanged PR45 executable probe",
        "historicalRunId":44740386851,
        "sourcePrHead":CURRENT,
        "historicalR6Head":HISTORICAL,
        "distinctWindowsJobsConfirmed":len(bykind),
        "sourceIdentityQualified":source_ok,
        "observedStallMarker":78,
        "unqualifiedCount":len(problems),
        "unqualifiedByKind":dict(sorted(counts.items())),
        "unqualifiedSample":problems[:MAX_ERRORS],
        "sourceAndHistoricalFailuresConsistent":not problems,
        "nativeExecutionFailureSourceAreaNarrowed":not problems,
        "nodeNewObjectHangMechanismProven":False,
        "observedDerivativeProbeIsAcceptanceEvidence":False,
        "intrinsicArrayRemediationProven":False,
        "nativeWindowsFixtureAccepted":False,
        "hostedPr45Accepted":False,
        "pr45SourceModified":False,
        "productionModified":False,
        "devActivationAuthorized":False,
    }

def main():
    import sys
    if len(sys.argv)!=1:
        raise SystemExit("unsupported_arguments")
    try:
        obj=load_receipt()
        blobs=source_bytes()
    except ValueError as error:
        print(json.dumps({"sourceAndHistoricalFailuresConsistent":False,
            "reason":str(error),"devActivationAuthorized":False}))
        raise SystemExit(1)
    result=classify(obj,blobs)
    print(json.dumps(result,separators=(",",":"),ensure_ascii=True))
    if not result["sourceAndHistoricalFailuresConsistent"]:
        raise SystemExit(1)

if __name__=="__main__":
    main()
