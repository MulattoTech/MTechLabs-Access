#!/usr/bin/env python3
"""R49/R50 disposable negative tests for read-only stacked-PR structural gate."""
import copy
from importlib.machinery import SourceFileLoader
import io
import json
from pathlib import Path
import unittest
from unittest import mock

HERE=Path(__file__).parent
gate=SourceFileLoader("access46_r49",str(HERE/"read-only-stacked-pr-preflight.py")).load_module()

def snapshot():
    return {
        "candidateLocalHead":gate.CAND_SHA,
        "candidateLocalBranch":gate.CAND_BRANCH,
        "candidateDirty":False,
        "remoteCandidateHead":gate.CAND_SHA,
        "remotePrHead":gate.PR_HEAD,
        "ancestorMatched":True,
        "gitBlob":{
            "workflow":gate.WF_BLOB,
            "probe":gate.CAND_PROBE_BLOB,
            "fixture":gate.CAND_FIXTURE_BLOB
        },
        "account":{"login":gate.OWNER},
        "pr":{
            "number":gate.PR_NUMBER,
            "state":"open","draft":True,"merged":False,
            "headRef":gate.PR_BRANCH,"headSha":gate.PR_HEAD,
            "baseRef":"main","baseSha":gate.PR_BASE
        },
        "openPRs":[{"number":45,"headRef":gate.PR_BRANCH,"baseRef":"main"}],
        "permissions":{"enabled":True,"allowed_actions":"all"},
        "latestRuns":[{"id":gate.OLD_RUN,"status":"completed","conclusion":"failure",
                       "headSha":gate.PR_HEAD}],
        "historicalJobs":[{"name":n,"status":"completed","conclusion":"failure",
                           "stepCount":0} for n in sorted(gate.EXPECTED_JOBS)]
    }

def reject(mutate,reason):
    data=snapshot()
    mutate(data)
    result=gate.evaluate(data)
    if reason not in result["unqualifiedReasons"]:
        raise AssertionError(f"Expected rejection {reason}; got {result['unqualifiedReasons']}")
    if result["structuralPreflightMatched"] or result["createDraftPRCurrentlyAuthorized"]:
        raise AssertionError("unsafe evidence accepted")
    return result

class GateTests(unittest.TestCase):
    def test_good_structural_evidence_is_never_pr_authorization(self):
        result=gate.evaluate(snapshot())
        self.assertTrue(result["structuralPreflightMatched"])
        self.assertEqual(result["unqualifiedCount"],0)
        self.assertEqual(result["accountBillingEligibility"],"UNVERIFIED")
        for key in ("hostedRunnerAdmissionVerified","completeNativeAndUpstreamAcceptance",
                    "createDraftPRCurrentlyAuthorized","ciRerunAuthorized",
                    "sourceMergeAuthorized","devActivationAuthorized"):
            self.assertFalse(result[key])

    def test_repeated_evaluation_is_deterministic(self):
        data=snapshot()
        self.assertEqual(gate.evaluate(data),gate.evaluate(data))

    def test_candidate_local_head_drift(self):
        reject(lambda x:x.__setitem__("candidateLocalHead","f"*40),"candidate_checkout_moved")

    def test_local_branch_moved(self):
        reject(lambda x:x.__setitem__("candidateLocalBranch","main"),"candidate_checkout_moved")

    def test_uncommitted_change_blocks(self):
        reject(lambda x:x.__setitem__("candidateDirty",True),"candidate_checkout_dirty_or_unverified")

    def test_remote_candidate_head_moved(self):
        reject(lambda x:x.__setitem__("remoteCandidateHead","f"*40),"remote_candidate_changed")

    def test_remote_pr45_head_moved(self):
        reject(lambda x:x.__setitem__("remotePrHead","f"*40),"feature_branch_changed")

    def test_wrong_ancestor(self):
        reject(lambda x:x.__setitem__("ancestorMatched",False),"candidate_ancestry_unverified")

    def test_unknown_ancestor(self):
        reject(lambda x:x.__setitem__("ancestorMatched",None),"candidate_ancestry_unverified")

    def test_modified_workflow_rejected(self):
        reject(lambda x:x["gitBlob"].__setitem__("workflow","f"*40),"source_blob_ids_mismatch")

    def test_modified_candidate_probe_rejected(self):
        reject(lambda x:x["gitBlob"].__setitem__("probe","f"*40),"source_blob_ids_mismatch")

    def test_modified_fixture_rejected(self):
        reject(lambda x:x["gitBlob"].__setitem__("fixture","f"*40),"source_blob_ids_mismatch")

    def test_unexpected_github_account(self):
        reject(lambda x:x["account"].__setitem__("login","anotherAccount"),"unexpected_github_identity")

    def test_changed_pr_number(self):
        reject(lambda x:x["pr"].__setitem__("number",44),"pr45_reviewed_ref_or_state_changed")

    def test_closed_pr_not_qualified(self):
        reject(lambda x:x["pr"].__setitem__("state","closed"),"pr45_reviewed_ref_or_state_changed")

    def test_merged_pr_not_qualified(self):
        reject(lambda x:x["pr"].__setitem__("merged",True),"pr45_reviewed_ref_or_state_changed")

    def test_nondraft_pr_not_qualified(self):
        reject(lambda x:x["pr"].__setitem__("draft",False),"pr45_reviewed_ref_or_state_changed")

    def test_changed_pr_head_sha(self):
        reject(lambda x:x["pr"].__setitem__("headSha","f"*40),"pr45_reviewed_ref_or_state_changed")

    def test_changed_pr_base_sha(self):
        reject(lambda x:x["pr"].__setitem__("baseSha","f"*40),"pr45_reviewed_ref_or_state_changed")

    def test_wrong_pr_base_branch(self):
        reject(lambda x:x["pr"].__setitem__("baseRef","release"),"pr45_reviewed_ref_or_state_changed")

    def test_competing_open_pr(self):
        reject(lambda x:x["openPRs"].append({
            "number":46,"headRef":gate.CAND_BRANCH,"baseRef":gate.PR_BRANCH
        }),"open_pr_conflict_or_pagination_unverified")

    def test_pr_pagination_unqualified(self):
        reject(lambda x:x.__setitem__("openPRs",snapshot()["openPRs"]*100),
               "open_pr_conflict_or_pagination_unverified")

    def test_actions_disabled(self):
        reject(lambda x:x["permissions"].__setitem__("enabled",False),
               "repository_actions_disabled_or_unknown")

    def test_actions_selected_policy_requires_review(self):
        r=reject(lambda x:x["permissions"].__setitem__("allowed_actions","selected"),
                 "repository_actions_policy_unqualified")
        self.assertFalse(r["repositoryActionsPolicyQualified"])

    def test_actions_local_only_cannot_claim_pinned_external_actions(self):
        reject(lambda x:x["permissions"].__setitem__("allowed_actions","local_only"),
               "repository_actions_policy_unqualified")

    def test_actions_policy_missing_fails_closed(self):
        reject(lambda x:x["permissions"].pop("allowed_actions"),
               "repository_actions_policy_unqualified")

    def test_historical_job_must_be_completed(self):
        r=reject(lambda x:x["historicalJobs"][0].__setitem__("status","in_progress"),
                 "historical_r7_job_metadata_changed")
        self.assertFalse(r["historicalJobStepCountZero"])

    def test_boolean_false_is_not_an_integer_step_count(self):
        r=reject(lambda x:x["historicalJobs"][1].__setitem__("stepCount",False),
                 "historical_r7_job_metadata_changed")
        self.assertFalse(r["historicalJobStepCountZero"])

    def test_omitted_job_status_cannot_prove_zero_step_run(self):
        r=reject(lambda x:x["historicalJobs"][2].pop("status"),
                 "historical_r7_job_metadata_changed")
        self.assertFalse(r["historicalJobStepCountZero"])

    def test_unchanged_failure_jobs_boolean_remains_true_despite_other_refusal(self):
        r=reject(lambda x:x.__setitem__("remotePrHead","f"*40),
                 "feature_branch_changed")
        self.assertTrue(r["historicalJobStepCountZero"])
        self.assertFalse(r["createDraftPRCurrentlyAuthorized"])

    def test_newer_run_forces_reaudit(self):
        reject(lambda x:x["latestRuns"].insert(0,{
            "id":99999999,"status":"completed","conclusion":"success","headSha":gate.PR_HEAD
        }),"historical_run_is_not_latest_reaudit_required")

    def test_latest_run_missing(self):
        reject(lambda x:x.__setitem__("latestRuns",[]),
               "recent_actions_run_metadata_unavailable")

    def test_r7_real_job_steps_unexpected(self):
        reject(lambda x:x["historicalJobs"][0].__setitem__("stepCount",1),
               "historical_r7_job_metadata_changed")

    def test_r7_wrong_job_set(self):
        reject(lambda x:x["historicalJobs"].pop(),"historical_r7_job_metadata_changed")

    def test_non_dict_root_fails_closed(self):
        result=gate.evaluate(["invalid"])
        self.assertFalse(result["structuralPreflightMatched"])
        self.assertFalse(result["createDraftPRCurrentlyAuthorized"])
        self.assertGreater(result["unqualifiedCount"],0)

    def test_preflight_gh_uses_only_get(self):
        # Exercising actual command construction with wholly synthetic
        # in-memory command outputs avoids any external calls.
        replies={
            "/user":{"login":gate.OWNER},
            "/repos/"+gate.REPO+"/pulls/45":snapshot()["pr"],
            "/repos/"+gate.REPO+"/pulls?state=open&per_page=100":snapshot()["openPRs"],
            "/repos/"+gate.REPO+"/actions/permissions":snapshot()["permissions"],
            "/repos/"+gate.REPO+"/actions/runs?per_page=10":snapshot()["latestRuns"],
            "/repos/"+gate.REPO+"/actions/runs/44742255585/jobs?per_page=100":snapshot()["historicalJobs"]
        }
        commands=[]
        def fake_run(argv,allowed_exits=(0,)):
            commands.append(argv[:])
            if argv[:2]==["gh","api"]:
                if argv[2:4]!=["-X","GET"] or argv[4] not in replies:
                    raise AssertionError("unapproved GitHub command")
                return json.dumps(replies[argv[4]]).encode(),0
            if argv[0]!="git" or argv[1]!="-C":
                raise AssertionError("non-git or non-gh command")
            action=argv[3]
            if action=="rev-parse": return (gate.CAND_SHA+"\n").encode(),0
            if action=="branch": return (gate.CAND_BRANCH+"\n").encode(),0
            if action=="status": return b"",0
            if action=="ls-remote":
                branch=argv[-1]
                if branch.endswith(gate.PR_BRANCH): return (gate.PR_HEAD+"\t"+branch+"\n").encode(),0
                if branch.endswith(gate.CAND_BRANCH): return (gate.CAND_SHA+"\t"+branch+"\n").encode(),0
                raise AssertionError("unrecognized git remote")
            if action=="merge-base": return b"",0
            if action=="cat-file": return b"commit\n",0
            if action=="show": return ("source:"+argv[-1]).encode(),0
            raise AssertionError("unapproved Git operation "+action)
        mapping={
            b"source:"+str(gate.CAND_SHA+":"+".github/workflows/check.yml").encode():gate.WF_BLOB,
            b"source:"+str(gate.CAND_SHA+":"+"integrations/mcp-manager/windows-runtime-probe.ps1").encode():gate.CAND_PROBE_BLOB,
            b"source:"+str(gate.CAND_SHA+":"+"integrations/mcp-manager/test/fixtures/reference-transport-child.mjs").encode():gate.CAND_FIXTURE_BLOB
        }
        with mock.patch.object(gate,"run",side_effect=fake_run),mock.patch.object(
            gate,"blob_sha",side_effect=lambda b:mapping[b]
        ),mock.patch.object(gate.Path,"is_dir",return_value=True):
            data=gate.load_live(Path("C:/fixture"))
        self.assertTrue(gate.evaluate(data)["structuralPreflightMatched"])
        self.assertTrue(all(
            (v[0]=="gh" and v[2:4]==["-X","GET"]) or
            (v[0]=="git" and v[3] in {"rev-parse","branch","status","ls-remote",
                                           "merge-base","cat-file","show"})
            for v in commands
        ))
        self.assertFalse(gate.evaluate(data)["createDraftPRCurrentlyAuthorized"])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(GateTests)
    out=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({"schemaVersion":1,"suite":"R49-R50-offline-stacked-pr-admission-fail-closed",
          "passed":out.testsRun-len(out.errors)-len(out.failures),"tests":out.testsRun,
          "failed":len(out.errors)+len(out.failures),"fakeGitHubAndGitOnly":True,
          "productionTouched":False,"prCreationAuthorized":False},separators=(",",":")))
    if not out.wasSuccessful():
        for item,tb in out.errors+out.failures:
            print(str(item)+": "+tb[-850:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
