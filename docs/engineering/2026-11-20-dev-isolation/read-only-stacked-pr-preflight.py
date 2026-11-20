#!/usr/bin/env python3
"""Access #44/#46 R49: READ-ONLY preflight for a *future* stacked draft PR.

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
    jobs=gh("/repos/"+REPO+"/actions/runs/44742255585/jobs?per_page=100",
            "[.jobs[] | {name:.name,status:.status,conclusion:.conclusion,stepCount:(.steps|length)}]")
    return {
      "candidateLocalHead":head,"candidateLocalBranch":branch,"candidateDirty":bool(dirty),
      "remotePrHead":remotepr.split("\t",1)[0] if "\t" in remotepr else None,
      "remoteCandidateHead":remotecand.split("\t",1)[0] if "\t" in remotecand else None,
      "ancestorMatched":exitcode==0,
      "gitBlob":controls,
      "account":account,"pr":pr,"openPRs":prs,
      "permissions":permissions,"latestRuns":latest,"historicalJobs":jobs
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
    if (not isinstance(opened,list) or len(opened)>99 or
        len(opened)!=1 or not isinstance(opened[0],dict) or
        opened[0].get("number")!=45 or
        opened[0].get("headRef")!=PR_BRANCH or
        opened[0].get("baseRef")!="main"):
        reasons.append("open_pr_conflict_or_pagination_unverified")
    permissions=v.get("permissions")
    if not isinstance(permissions,dict) or permissions.get("enabled") is not True:
        reasons.append("repository_actions_disabled_or_unknown")
    # An enabled setting does not attest account billing; do not authorize.
    history=v.get("latestRuns")
    if not isinstance(history,list) or not history or len(history)>10:
        reasons.append("recent_actions_run_metadata_unavailable")
    elif (not isinstance(history[0],dict) or
          history[0].get("id")!=OLD_RUN or
          history[0].get("status")!="completed" or
          history[0].get("conclusion")!="failure" or
          history[0].get("headSha")!=PR_HEAD):
        reasons.append("historical_run_is_not_latest_reaudit_required")
    jobs=v.get("historicalJobs")
    if (not isinstance(jobs,list) or len(jobs)!=5 or
        {x.get("name") for x in jobs if isinstance(x,dict)}!=EXPECTED_JOBS or
        any(not isinstance(x,dict) or x.get("stepCount")!=0 or
            x.get("conclusion")!="failure" for x in jobs)):
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
      "historicalJobStepCountZero":not any(x.startswith("historical_r7") for x in reasons),
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
