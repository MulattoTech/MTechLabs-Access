#!/usr/bin/env python3
"""Access #46 R41: read-only, source-bound PDF-control rejection triage.

Reads exact PR45 git objects from the local checkout using git show (no fetch)
and checks the frozen R6 PDF-rejection record against the still-pinned test
source. Cannot determine the timeout's cause or establish source acceptance.
Never invokes upstream tools, npm, PDF generation or GitHub Actions.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from collections import Counter

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parent.parent.parent
EXACT_HEAD = "f0855c1227aacc49071581bb52ba5566bc07ffce"
R6_PATH = "docs/engineering/2026-11-20-reference-transport/r6-linux-upstream-rejection-review.json"
R6_GIT_BLOB = "b4473fd7310967d05729c459117b285c9c19c864"
SOURCE_PINS = {
    ".github/workflows/check.yml": (
        "57d513da584bee4d8a074691beb510c0f64f22d06a6c28ace71cdf0649f9235e", 3191
    ),
    "integrations/mcp-manager/qualify-upstream.mjs": (
        "1f4dd1e08a784e98b34b3644b73618a5588130ce7f0bdf17b46df17ed066fab6", 23557
    ),
    "integrations/mcp-manager/lib/upstream-qualification.mjs": (
        "09742f7104cee024ed5274a094a8ddc756f70707bad4f79a4b0e430e30006e84", 17419
    ),
    "integrations/mcp-manager/verify-clients.mjs": (
        "2417a878c2171b051271efa907e28d9422a987a4be5505be688936e319cfb982", 20371
    ),
}
PDF_PATTERNS = {
    "pdf_stage_present": r"stageRun\('pdf_create_and_read_fidelity',\s*async",
    "write_pdf_timeout_90000": r"call\('write_pdf',\s*\{\s*path:\s*pdf,\s*content:[^\n]+\},\s*90000\)",
    "read_pdf_timeout_90000": r"call\('read_file',\s*\{\s*path:\s*pdf\s*\},\s*90000\)",
    "pdf_signature_check": r"assert\.equal\(bytes\.subarray\(0,\s*5\)\.toString\(\),\s*'%PDF-'\)",
    "pdf_text_fidelity_check": r"assert\.match\(resultText\(await call\('read_file',\s*\{\s*path:\s*pdf\s*\},\s*90000\)\),\s*/MTERM PDF FIXTURE/",
    "capture_pdf_tool_error": r"report\.pdfFailure\s*=\s*\{\s*tool:\s*name,\s*stage,\s*fixture:\s*'owned-fixed-markdown-v1'",
    "reject_pdf_is_error": r"assert\.notEqual\(response\.isError,\s*true,\s*name\s*\+\s*'_tool_error'\)",
    "fail_closed_stage_result": r"report\.pass\s*=\s*report\.initialized\s*&&\s*!report\.failedStage",
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git_blob(data):
    return hashlib.sha1(b"blob "+str(len(data)).encode("ascii")+b"\x00"+data).hexdigest()

def read_exact(repo, path):
    if path not in SOURCE_PINS and path != R6_PATH:
        raise ValueError("unallowlisted_exact_source_path")
    try:
        proc=subprocess.run(
            ["git","-C",str(repo),"show",EXACT_HEAD+":"+path],
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
            timeout=15,check=True
        )
    except (OSError,subprocess.SubprocessError):
        raise ValueError("exact_pr45_object_unavailable")
    if len(proc.stdout)>200000:
        raise ValueError("exact_source_object_oversized")
    return proc.stdout

def stage_invariants(source_bytes):
    errors=[]
    if not isinstance(source_bytes,bytes):
        return ["pdf_source_not_bytes"],{}
    try:
        source=source_bytes.decode("utf-8")
    except UnicodeError:
        return ["pdf_source_not_utf8"],{}
    counts={}
    for name,pattern in PDF_PATTERNS.items():
        n=len(re.findall(pattern,source,re.S))
        counts[name]=n
        if n!=1:
            errors.append("pdf_contract_"+name+"_unqualified")
    return errors,counts

def historical_evidence(report):
    errors=[]
    if not isinstance(report,dict):
        return ["historical_report_not_object"]
    if report.get("schemaVersion")!=1 or report.get("status")!="REJECTED_LINUX_UPSTREAM_CONTROL_PDF":
        errors.append("historical_status_changed")
    if report.get("run")!=44740386851 or report.get("job")!=136302296697 or report.get("attempt")!=1:
        errors.append("historical_run_identity_changed")
    expected_source=report.get("sourceFilesUnchangedFromRevision5")
    if not isinstance(expected_source,dict):
        errors.append("historical_source_pin_map_missing")
    else:
        for path,(sha,size) in SOURCE_PINS.items():
            item=expected_source.get(path)
            if not isinstance(item,dict) or item.get("sha256")!=sha or item.get("bytes")!=size:
                errors.append("historical_"+path.rsplit("/",1)[-1]+"_pin_changed")
    control=report.get("control")
    candidate=report.get("candidate")
    decision=report.get("decision")
    if not isinstance(control,dict) or not isinstance(candidate,dict) or not isinstance(decision,dict):
        errors.append("historical_lanes_or_decision_missing")
        return errors
    failure=control.get("pdfFailure")
    if not isinstance(failure,dict):
        errors.append("historical_pdf_failure_missing")
    else:
        if (failure.get("tool")!="write_pdf"
            or failure.get("stage")!="pdf_create_and_read_fidelity"
            or failure.get("fixture")!="owned-fixed-markdown-v1"
            or failure.get("isError") is not True
            or "timeout" not in (failure.get("signals") or [])):
            errors.append("historical_pdf_failure_signal_changed")
    if (control.get("version")!="0.3.1" or control.get("completedPassingStages")!=8
        or control.get("failedStage")!="pdf_create_and_read_fidelity"
        or control.get("failureCode")!="write_pdf_tool_error"):
        errors.append("historical_control_rejection_changed")
    if (candidate.get("version")!="0.3.3"
        or candidate.get("completedPassingStages")!=10
        or not isinstance(candidate.get("pdfBytes"),int) or candidate["pdfBytes"]<=1000
        or not isinstance(candidate.get("pdfSha256"),str) or len(candidate["pdfSha256"])!=64):
        errors.append("historical_candidate_observation_changed")
    if (decision.get("accepted") is not False
        or decision.get("retryPerformed") is not False
        or decision.get("timeoutRelaxed") is not False):
        errors.append("historical_decision_not_rejected")
    return errors

def analyze(source_blobs,report_blob):
    errors=[]
    source_hashes={}
    if not isinstance(source_blobs,dict):
        source_blobs={}
        errors.append("source_blobs_missing")
    for path,(expected_sha,size) in SOURCE_PINS.items():
        raw=source_blobs.get(path)
        if not isinstance(raw,bytes):
            errors.append("source_file_missing")
            continue
        source_hashes[path]={"sha256":digest(raw),"bytes":len(raw)}
        if digest(raw)!=expected_sha or len(raw)!=size:
            errors.append("source_changed_since_r6")
    inv,counts=stage_invariants(source_blobs.get("integrations/mcp-manager/qualify-upstream.mjs",b""))
    errors.extend(inv)
    if not isinstance(report_blob,bytes):
        errors.append("historical_report_bytes_missing")
        report={}
    else:
        if git_blob(report_blob)!=R6_GIT_BLOB:
            errors.append("historical_report_blob_changed")
        try:
            report=json.loads(report_blob.decode("utf-8"))
        except (ValueError,UnicodeError):
            errors.append("historical_report_unreadable")
            report={}
    errors.extend(historical_evidence(report))
    bykind=Counter(errors)
    candidate=report.get("candidate",{}) if isinstance(report,dict) else {}
    if not isinstance(candidate,dict):
        candidate={}
    return {
        "schemaVersion":1,
        "scope":"read-only exact-head frozen PDF test and R6 rejection evidence invariants",
        "sourceHead":EXACT_HEAD,
        "frozenSourceFilesCompared":len(source_hashes),
        "frozenSourceIdentity":source_hashes,
        "pdfGateInvariantCounts":counts,
        "historicalControlVersion":"0.3.1",
        "historicalControlFailedStage":"pdf_create_and_read_fidelity",
        "historicalControlFailureSignal":"timeout",
        "historicalCandidateVersion":"0.3.3",
        "historicalCandidatePdfStagePassed":candidate.get("completedPassingStages")==10,
        "historicalRunId":44740386851,
        "unqualifiedCount":len(errors),
        "unqualifiedByKind":dict(sorted(bykind.items())),
        "sourceAndRejectionEvidenceConsistent":not errors,
        "historicalRunStillRejected":True,
        "pdfRootCauseDetermined":False,
        "newHostedCIExecuted":False,
        "controlPdfAccepted":False,
        "candidatePdfAcceptedAsWholeSource":False,
        "independentSourceReviewCompleted":False,
        "productionFilesChanged":False,
        "devActivationAuthorized":False,
    }

def main():
    import sys
    if len(sys.argv)!=1:
        raise SystemExit("unsupported_arguments")
    try:
        blobs={path:read_exact(REPOSITORY,path) for path in SOURCE_PINS}
        historical=read_exact(REPOSITORY,R6_PATH)
    except ValueError as error:
        print(json.dumps({"sourceAndRejectionEvidenceConsistent":False,
                          "reason":str(error),"devActivationAuthorized":False}))
        raise SystemExit(1)
    result=analyze(blobs,historical)
    print(json.dumps(result,separators=(",",":"),ensure_ascii=True))
    if not result["sourceAndRejectionEvidenceConsistent"]:
        raise SystemExit(1)

if __name__=="__main__":
    main()
