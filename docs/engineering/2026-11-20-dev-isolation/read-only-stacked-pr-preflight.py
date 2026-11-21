#!/usr/bin/env python3
"""Access #44/#46 R49/R50/R55: READ-ONLY preflight for a *future* stacked draft PR.

Checks only exact, fixed GitHub GET endpoints and git metadata in a caller-
supplied existing candidate checkout. No PR creation, billing mutation,
workflow dispatch, checkout, fetch, installed scripts or production changes.

Structural source readiness is NOT GitHub Actions billing eligibility.
A valid report always keeps createPrAuthorized/hostedAccepted/DEV false.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

REPO="MulattoTech/MTechLabs-Access"
OWNER="MulattoTech"
PR_NUMBER=45
PR_HEAD="f0855c1227aacc49071581bb52ba5566bc07ffce"
PR_BASE="15e851b11984592803d37599b639772e51e5c8c0"
PR_BRANCH="feat/dev-reference-transport-20261120"
CAND_SHA="0da3a5f74453cfbed82e2d1d4f61e1bae64efe9b"
CAND_BRANCH="fix/access44-r43-native-array-candidate-20261120"
WF_BLOB="7f099d79967aaaf612e575aa1d2a814dc88a8006"
CAND_PROBE_BLOB="1b429f4cbcb3d888dd739ab5330ebf040faeb2f3"
CAND_FIXTURE_BLOB="03caeac1ac20d0b96affe1b5ae665be7f9f99d79"
OLD_RUN=44742255585
EXPECTED_JOBS={
    "test",
    "managed-mcp",
    "managed-mcp-windows",
    "Upstream qualification / ubuntu-latest / Node 24",
    "Upstream qualification / windows-latest / Node 24"
}
MAX_READ=150000

def blob_sha(raw):
    return hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\x00"+raw).hexdigest()

def run(argv,allowed_exits=(0,)):
    # Absolute explicit argv only. No shell, no dynamic code or secret output.
    result=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                          stdin=subprocess.DEVNULL,timeout=25,check=False)
    if result.returncode not in allowed_exits or len(result.stdout)>MAX_READ:
        raise ValueError("metadata_command_unavailable")
    return result.stdout,result.returncode

def git(repo,*args,exits=(0,)):
    data,code=run(["git","-C",str(repo),*args],allowed_exits=exits)
    return data.decode("utf-8","strict").strip(),code

def gh(endpoint,jq):
    raw,_=run(["gh","api","-X","GET",endpoint,"--jq",jq])
    return json.loads(raw.decode("utf-8","strict"))

def load_live(repo):
    # Always exact ref names. No /user settings, billing, secrets or write API.
    path=Path(repo)
    if not path.is_dir(): raise ValueError("candidate_checkout_unavailable")
    head,_=git(path,"rev-parse","HEAD")
    branch,_=git(path,"branch","--show-current")
    dirty,_=git(path,"status","--porcelain","--untracked-files=normal")
    remotepr,_=git(path,"ls-remote","origin","refs/heads/"+PR_BRANCH)
    remotecand,_=git(path,"ls-remote","origin","refs/heads/"+CAND_BRANCH)
    ancestry,exitcode=git(path,"merge-base","--is-ancestor",PR_HEAD,CAND_SHA,exits=(0,1))
    # Test source objects by Git blob ID, not by printed contents.
    _,_ = git(path,"cat-file","-t",CAND_SHA)
    controls={}
    for key,source in {
      "workflow":".github/workflows/check.yml",
      "probe":"integrations/mcp-manager/windows-runtime-probe.ps1",
      "fixture":"integrations/mcp-manager/test/fixtures/reference-transport-child.mjs"
    }.items():
        data,_=run(["git","-C",str(path),"show",CAND_SHA+":"+source])
        controls[key]=blob_sha(data)
    account=gh("/user","{login:.login}")
    pr=gh("/repos/"+REPO+"/pulls/45",
          "{number:.number,state:.state,draft:.draft,merged:.merged,headRef:.head.ref,headSha:.head.sha,baseRef:.base.ref,baseSha:.base.sha}")
    prs=gh("/repos/"+REPO+"/pulls?state=open&per_page=100",
           "[.[] | {number:.number,headRef:.head.ref,baseRef:.base.ref}]")
    permissions=gh("/repos/"+REPO+"/actions/permissions",
                   "{enabled:.enabled,allowed_actions:.allowed_actions}")
    latest=gh("/repos/"+REPO+"/actions/runs?per_page=10",
              "[.workflow_runs[] | {id:.id,status:.status,conclusion:.conclusion,headSha:.head_sha}]")
    historical=gh("/repos/"+REPO+"/actions/runs/44742255585",
                  "{id:.id,status:.status,conclusion:.conclusion,headSha:.head_sha}")
    jobs=gh("/repos/"+REPO+"/actions/runs/44742255585/jobs?per_page=100",
            "[.jobs[] | {name:.name,status:.status,conclusion:.conclusion,stepCount:(.steps|length)}]")
    return {
      "candidateLocalHead":head,"candidateLocalBranch":branch,"candidateDirty":bool(dirty),
      "remotePrHead":remotepr.split("\t",1)[0] if "\t" in remotepr else None,
      "remoteCandidateHead":remotecand.split("\t",1)[0] if "\t" in remotecand else None,
      "ancestorMatched":exitcode==0,
      "gitBlob":controls,
      "account":account,"pr":pr,"openPRs":prs,
      "permissions":permissions,"latestRuns":latest,
      "historicalRun":historical,"historicalJobs":jobs
    }

def evaluate(v):
    reasons=[]
    if not isinstance(v,dict):
        v={}
        reasons.append("snapshot_not_object")
    if v.get("candidateLocalHead")!=CAND_SHA or v.get("candidateLocalBranch")!=CAND_BRANCH:
        reasons.append("candidate_checkout_moved")
    if v.get("candidateDirty") is not False:
        reasons.append("candidate_checkout_dirty_or_unverified")
    if v.get("remoteCandidateHead")!=CAND_SHA:
        reasons.append("remote_candidate_changed")
    if v.get("remotePrHead")!=PR_HEAD:
        reasons.append("feature_branch_changed")
    if v.get("ancestorMatched") is not True:
        reasons.append("candidate_ancestry_unverified")
    if v.get("gitBlob")!={
        "workflow":WF_BLOB,
        "probe":CAND_PROBE_BLOB,
        "fixture":CAND_FIXTURE_BLOB
    }:
        reasons.append("source_blob_ids_mismatch")
    owner=v.get("account")
    if not isinstance(owner,dict) or owner.get("login")!=OWNER:
        reasons.append("unexpected_github_identity")
    pr=v.get("pr")
    if not isinstance(pr,dict) or any((
      type(pr.get("number")) is not int or pr.get("number")!=PR_NUMBER,
      pr.get("state")!="open",
      pr.get("draft") is not True,
      pr.get("merged") is not False,
      pr.get("headRef")!=PR_BRANCH,
      pr.get("headSha")!=PR_HEAD,
      pr.get("baseRef")!="main",
      pr.get("baseSha")!=PR_BASE
    )):
        reasons.append("pr45_reviewed_ref_or_state_changed")
    opened=v.get("openPRs")
    # Unrelated PRs are allowed. A duplicate PR45, candidate/feature branch
    # alias, or any stacked PR against the feature branch is NOT allowed.
    open_valid=isinstance(opened,list) and 0<len(opened)<100
    seen_numbers=set()
    seen_pr45=False
    if open_valid:
        for item in opened:
            if not isinstance(item,dict):
                open_valid=False
                break
            number=item.get("number")
            head=item.get("headRef")
            base=item.get("baseRef")
            if (type(number) is not int or number<=0 or
                not isinstance(head,str) or not head or
                not isinstance(base,str) or not base or number in seen_numbers):
                open_valid=False
                break
            seen_numbers.add(number)
            if number==PR_NUMBER:
                seen_pr45=head==PR_BRANCH and base=="main"
                if not seen_pr45: open_valid=False
            elif head in (PR_BRANCH,CAND_BRANCH) or base==PR_BRANCH:
                open_valid=False
            if not open_valid: break
    if not open_valid or not seen_pr45:
        reasons.append("open_pr_conflict_or_pagination_unverified")
    permissions=v.get("permissions")
    if not isinstance(permissions,dict) or permissions.get("enabled") is not True:
        reasons.append("repository_actions_disabled_or_unknown")
    elif permissions.get("allowed_actions")!="all":
        # Workflow checks out pinned external GitHub actions. Local-only or
        # selected policies require independent action-by-action review.
        reasons.append("repository_actions_policy_unqualified")
    # Even a fully permitted repository policy is NOT account billing proof.
    historical=v.get("historicalRun")
    if (not isinstance(historical,dict) or
        type(historical.get("id")) is not int or historical["id"]!=OLD_RUN or
        historical.get("status")!="completed" or
        historical.get("conclusion")!="failure" or
        historical.get("headSha")!=PR_HEAD):
        reasons.append("historical_r7_run_metadata_changed")
    history=v.get("latestRuns")
    valid_recent=isinstance(history,list) and 0<len(history)<=10
    if valid_recent:
        ids=set()
        for item in history:
            if (not isinstance(item,dict) or
                type(item.get("id")) is not int or item["id"]<=0 or
                item["id"] in ids or
                not isinstance(item.get("status"),str) or not item["status"] or
                (item.get("conclusion") is not None and
                 not isinstance(item["conclusion"],str)) or
                not isinstance(item.get("headSha"),str) or
                re.fullmatch(r"[0-9a-f]{40}",item["headSha"]) is None):
                valid_recent=False
                break
            ids.add(item["id"])
    if not valid_recent:
        reasons.append("recent_actions_run_metadata_unavailable")
    elif any(item["id"]!=OLD_RUN and
             item["headSha"] in (PR_HEAD,CAND_SHA) for item in history):
        # A new protected-head run needs independent test-evidence review,
        # even when it reports success. Never infer acceptance here.
        reasons.append("new_protected_head_run_requires_review")
    jobs=v.get("historicalJobs")
    # Every job must be a completed failure with a literal integer zero
    # recorded steps. A boolean False must not count as integer zero.
    historical_zero_steps=(
        isinstance(jobs,list) and len(jobs)==5
        and all(isinstance(j,dict) for j in jobs)
        and {j.get("name") for j in jobs}==EXPECTED_JOBS
        and all(j.get("status")=="completed" and
                type(j.get("stepCount")) is int and j["stepCount"]==0 and
                j.get("conclusion")=="failure" for j in jobs)
    )
    if not historical_zero_steps:
        reasons.append("historical_r7_job_metadata_changed")
    return {
      "schemaVersion":1,
      "scope":"read-only pre-PR exact source and account metadata (no billing attestation)",
      "reviewedPR45Head":PR_HEAD,
      "reviewedCandidateHead":CAND_SHA,
      "expectedStackedBase":PR_BRANCH,
      "expectedStackedHead":CAND_BRANCH,
      "structuralPreflightMatched":not reasons,
      "unqualifiedReasons":reasons,
      "unqualifiedCount":len(reasons),
      "repositoryActionsEnabled":isinstance(permissions,dict) and permissions.get("enabled") is True,
      "repositoryActionsPolicyQualified":(
          isinstance(permissions,dict) and permissions.get("enabled") is True
          and permissions.get("allowed_actions")=="all"),
      "historicalJobStepCountZero":historical_zero_steps,
      "accountBillingEligibility":"UNVERIFIED",
      "hostedRunnerAdmissionVerified":False,
      "completeNativeAndUpstreamAcceptance":False,
      "createDraftPRCurrentlyAuthorized":False,
      "ciRerunAuthorized":False,
      "sourceMergeAuthorized":False,
      "productionModified":False,
      "devActivationAuthorized":False
    }

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--candidate-checkout",required=True,type=Path)
    args=p.parse_args()
    try:
        data=load_live(args.candidate_checkout)
        report=evaluate(data)
    except (OSError,ValueError,UnicodeError,subprocess.TimeoutExpired,TypeError):
        report=evaluate({})
        report["unqualifiedReasons"].append("read_only_metadata_lookup_failed")
        report["unqualifiedCount"]=len(report["unqualifiedReasons"])
        report["structuralPreflightMatched"]=False
    print(json.dumps(report,separators=(",",":"),ensure_ascii=True))
    if not report["structuralPreflightMatched"]:
        raise SystemExit(1)
