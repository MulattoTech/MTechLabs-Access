#!/usr/bin/env python3
"""R38 disposable negative tests for a NON-EXECUTING staging design validator."""
from copy import deepcopy
from importlib.machinery import SourceFileLoader
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE=Path(__file__).parent
checker=SourceFileLoader("access46_r38_staging_policy",
    str(HERE/"read-only-staging-policy.py")).load_module()

def plan():
    return json.loads((HERE/"proposed-scriptless-staging-policy.json").read_text(encoding="utf-8"))

def rejects(change,reason):
    x=plan()
    change(x)
    report=checker.assess(x)
    if reason not in report["unqualifiedByKind"]:
        raise AssertionError("Expected rejection "+reason+"; got "+repr(report["unqualifiedByKind"]))
    if report["staticDesignValidated"]:
        raise AssertionError("Invalid source-only plan was validated")
    return report

class StagePolicyTests(unittest.TestCase):
    def test_valid_structural_plan_never_authorizes_work(self):
        r=checker.assess(plan())
        self.assertTrue(r["staticDesignValidated"])
        self.assertEqual(r["outstandingEvidenceGateCount"],9)
        self.assertFalse(r["stagingOperationAuthorized"])
        self.assertFalse(r["devActivationAuthorized"])
        self.assertFalse(r["osEgressActuallyEnforced"])

    def test_repeated_plan_hash_stable(self):
        a,hash_a,err_a=checker.read_plan()
        b,hash_b,err_b=checker.read_plan()
        self.assertIsNone(err_a)
        self.assertIsNone(err_b)
        self.assertEqual(hash_a,hash_b)
        self.assertEqual(a,b)

    def test_no_scripts_flag_required(self):
        rejects(lambda x:x["proposedNpmStep"]["argumentVector"].remove("--ignore-scripts"),
                "npm_script_disabled_offline_args_unqualified")

    def test_offline_flag_required(self):
        rejects(lambda x:x["proposedNpmStep"]["argumentVector"].remove("--offline"),
                "npm_script_disabled_offline_args_unqualified")

    def test_no_audit_flag_required(self):
        rejects(lambda x:x["proposedNpmStep"]["argumentVector"].remove("--no-audit"),
                "npm_script_disabled_offline_args_unqualified")

    def test_no_fund_flag_required(self):
        rejects(lambda x:x["proposedNpmStep"]["argumentVector"].remove("--no-fund"),
                "npm_script_disabled_offline_args_unqualified")

    def test_rebuild_instead_of_ci_rejected(self):
        rejects(lambda x:x["proposedNpmStep"]["argumentVector"].__setitem__(0,"rebuild"),
                "npm_script_disabled_offline_args_unqualified")

    def test_dangerously_allow_scripts_rejected(self):
        rejects(lambda x:x["proposedNpmStep"]["argumentVector"].append(
                    "--dangerously-allow-all-scripts"),
                "npm_script_disabled_offline_args_unqualified")

    def test_shell_invocation_not_allowed(self):
        rejects(lambda x:x["proposedNpmStep"].__setitem__("shellInvocation",True),
                "shell_execution_not_disabled")

    def test_executable_other_than_npm_refused(self):
        rejects(lambda x:x["proposedNpmStep"].__setitem__("executable","npx"),
                "npm_program_unqualified")

    def test_execute_toggle_cannot_be_true(self):
        rejects(lambda x:x["proposedNpmStep"].__setitem__("executeInThisCheckpoint",True),
                "execution_not_forbidden")

    def test_unknown_command_field_rejected(self):
        rejects(lambda x:x["proposedNpmStep"].__setitem__("scriptShell","powershell"),
                "npm_step_schema_invalid")

    def test_inherited_egress_control_cannot_be_disabled(self):
        rejects(lambda x:x["mandatoryDesignControls"].__setitem__(
                    "osNetworkEgressDenialRequired",False),
                "required_control_missing_or_false")

    def test_secret_mount_control_cannot_be_disabled(self):
        rejects(lambda x:x["mandatoryDesignControls"].__setitem__(
                    "privateTokensAndUserProfilesNotMounted",False),
                "required_control_missing_or_false")

    def test_mutable_h_tree_reuse_forbidden(self):
        rejects(lambda x:x["mandatoryDesignControls"].__setitem__(
                    "existingHNodeModulesReuseForbidden",False),
                "required_control_missing_or_false")

    def test_real_dev_token_gate_cannot_be_removed(self):
        rejects(lambda x:x["mandatoryDesignControls"].pop(
                    "protectedParentAclAndRealTokenCanariesRequired"),
                "design_control_set_unqualified")

    def test_root_production_directory_not_accepted_as_extra_field(self):
        rejects(lambda x:x.__setitem__(
                    "stageHere","H:\\MTechLabs\\MCP"),
                "policy_keys_unqualified")

    def test_unreviewed_source_fingerprint_change_rejected(self):
        rejects(lambda x:x["observedCheckpoint"].__setitem__(
                    "lifecycleFingerprintSha256","f"*64),
                "r37_observed_hook_anchor_changed")

    def test_evidence_cannot_be_self_asserted_as_verified(self):
        def forged(x):
            x["evidenceState"]={k:"verified" for k in x["evidenceState"]}
        r=rejects(forged,"unverified_evidence_checkpoint_altered")
        self.assertFalse(r["stagingOperationAuthorized"])

    def test_operational_approval_cannot_be_claimed(self):
        rejects(lambda x:x["evidenceState"].__setitem__(
                    "separateOperationalApproval","granted"),
                "unverified_evidence_checkpoint_altered")

    def test_pr45_hosted_acceptance_not_faked(self):
        rejects(lambda x:x["evidenceState"].__setitem__(
                    "hostedPR45CandidateChecks","passed"),
                "unverified_evidence_checkpoint_altered")

    def test_status_cannot_change_to_live(self):
        rejects(lambda x:x.__setitem__(
                    "status","APPROVED_FOR_EXECUTION"),
                "operational_status_not_design_only")

    def test_disabled_operation_list_cannot_shrink(self):
        rejects(lambda x:x["disabledOperations"].remove("dev-activation"),
                "disabled_actions_unqualified")

    def test_schema_version_must_not_be_boolean(self):
        rejects(lambda x:x.__setitem__("schemaVersion",True),
                "schema_unqualified")

    def test_nonobject_plan_fails(self):
        r=checker.assess(["fake","plan"])
        self.assertFalse(r["staticDesignValidated"])
        self.assertFalse(r["stagingOperationAuthorized"])

    def test_bad_policy_json_rejected(self):
        with tempfile.TemporaryDirectory(prefix="r38-policy-") as td:
            file=Path(td)/"policy.json"
            file.write_text("{broken",encoding="utf-8")
            _,_,error=checker.read_plan(file)
            self.assertEqual(error,"policy_unreadable_or_invalid")

    def test_duplicate_json_keys_rejected(self):
        with tempfile.TemporaryDirectory(prefix="r38-policy-") as td:
            file=Path(td)/"policy.json"
            file.write_text('{"schemaVersion":1,"schemaVersion":2}',encoding="utf-8")
            _,_,error=checker.read_plan(file)
            self.assertEqual(error,"policy_unreadable_or_invalid")

    def test_large_policy_file_rejected(self):
        with tempfile.TemporaryDirectory(prefix="r38-policy-") as td:
            file=Path(td)/"policy.json"
            file.write_bytes(b"x"*(checker.MAX_POLICY_BYTES+1))
            _,_,error=checker.read_plan(file)
            self.assertEqual(error,"policy_oversized")

    def test_missing_policy_rejected(self):
        with tempfile.TemporaryDirectory(prefix="r38-policy-") as td:
            _,_,error=checker.read_plan(Path(td)/"missing.json")
            self.assertEqual(error,"policy_unreadable_or_invalid")

    def test_input_read_cannot_execute_npm(self):
        obj,sha,error=checker.read_plan()
        self.assertIsNone(error)
        r=checker.assess(obj,sha)
        self.assertTrue(r["staticDesignValidated"])
        for field in (
            "npmInstallOrAnyOtherProcessExecuted",
            "lifecycleHooksExecuted",
            "osEgressActuallyEnforced",
            "packageArchivesIndependentlyAuthenticated",
            "protectedRootsAndRealDevTokenVerified",
            "rollbackExecuted",
            "hostedPR45AcceptanceVerified",
            "stagingOperationAuthorized",
            "productionCutoverAuthorized",
            "devActivationAuthorized"
        ):
            self.assertFalse(r[field])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(StagePolicyTests)
    out=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({"schemaVersion":1,
      "suite":"offline-script-disabled-staging-design-guard",
      "tests":out.testsRun,
      "passed":out.testsRun-len(out.failures)-len(out.errors),
      "failed":len(out.failures)+len(out.errors),
      "onlyDisposableFixtureWrites":True,
      "npmExecuted":False,
      "productionModified":False,
      "devActivationAuthorized":False
    },separators=(",",":")))
    if not out.wasSuccessful():
        for t,trace in out.failures+out.errors:
            print(str(t)+": "+trace[-1100:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
