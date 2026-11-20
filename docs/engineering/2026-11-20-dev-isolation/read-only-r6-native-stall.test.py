#!/usr/bin/env python3
"""Access #46 R42: offline synthetic negative controls for R6 Windows traces.

Uses sanitized historical records and exact git objects, changing only
in-memory copies for mutations; never touches accounts, services, production
packages, native Windows fixtures or the GitHub-hosted runners.
"""
import copy
from importlib.machinery import SourceFileLoader
import io
import json
from pathlib import Path
import unittest

HERE=Path(__file__).parent
checker=SourceFileLoader("access46_r42",str(HERE/"read-only-r6-native-stall.py")).load_module()

def fresh():
    return checker.load_receipt(),checker.source_bytes()

def rejected(report,source,reason):
    r=checker.classify(report,source)
    if reason not in r["unqualifiedByKind"]:
        raise AssertionError("Expected "+reason+"; got "+str(r["unqualifiedByKind"]))
    if r["sourceAndHistoricalFailuresConsistent"]:
        raise AssertionError("Invalid historical evidence was accepted")
    return r

class NativeStallTests(unittest.TestCase):
    def test_two_real_historical_jobs_consistently_rejected(self):
        data,source=fresh()
        r=checker.classify(data,source)
        self.assertTrue(r["sourceAndHistoricalFailuresConsistent"])
        self.assertEqual(r["distinctWindowsJobsConfirmed"],2)
        self.assertTrue(r["sourceIdentityQualified"])
        self.assertEqual(r["observedStallMarker"],78)
        self.assertTrue(r["nativeExecutionFailureSourceAreaNarrowed"])
        self.assertFalse(r["nodeNewObjectHangMechanismProven"])

    def test_repeat_historical_record_is_stable(self):
        data,source=fresh()
        self.assertEqual(checker.classify(data,source),checker.classify(data,source))

    def test_file_endings_normalized_exactly(self):
        import hashlib
        _,source=fresh()
        original=source["currentProbe"]
        self.assertEqual(hashlib.sha256(original).hexdigest(),
                         checker.PROBE_GIT_NORMALIZED_SHA)
        self.assertEqual(hashlib.sha256(original.replace(b"\n",b"\r\n")).hexdigest(),
                         checker.PROBE_SHA)
        self.assertEqual(source["r6Probe"],original)

    def test_two_independent_jobs_required(self):
        data,src=fresh()
        data["failures"].pop()
        rejected(data,src,"historical_windows_job_set_invalid")

    def test_wrong_job_number_rejected(self):
        data,src=fresh()
        data["failures"][0]["jobId"]+=1
        rejected(data,src,"historical_job_identity_mismatch")

    def test_duplicate_job_kind_rejected(self):
        data,src=fresh()
        data["failures"][1]["jobKind"]=data["failures"][0]["jobKind"]
        rejected(data,src,"historical_job_identity_mismatch")

    def test_wrong_run_id_rejected(self):
        data,src=fresh()
        data["runId"]=44742255585
        rejected(data,src,"historical_rejection_receipt_status_unqualified")

    def test_wrong_r6_source_ref_rejected(self):
        data,src=fresh()
        data["r6Head"]="f"*40
        rejected(data,src,"historical_rejection_receipt_status_unqualified")

    def test_hosted_acceptance_must_remain_pending(self):
        data,src=fresh()
        data["hostedAcceptancePending"]=False
        rejected(data,src,"historical_rejection_receipt_status_unqualified")

    def test_forged_hosted_acceptance_rejected(self):
        data,src=fresh()
        data["hostedAcceptable"]=True
        rejected(data,src,"historical_rejection_receipt_status_unqualified")

    def test_forged_root_cause_rejected(self):
        data,src=fresh()
        data["rootCauseProven"]=True
        rejected(data,src,"historical_rejection_receipt_status_unqualified")

    def test_forged_dev_activated_rejected(self):
        data,src=fresh()
        data["devActivated"]=True
        rejected(data,src,"historical_rejection_receipt_status_unqualified")

    def test_current_probe_drift_detected(self):
        data,src=fresh()
        src["currentProbe"]+=b"# changed\n"
        rejected(data,src,"exact_source_blob_mismatch")

    def test_historical_probe_drift_detected(self):
        data,src=fresh()
        src["r6Probe"]+=b"# changed\n"
        rejected(data,src,"exact_source_blob_mismatch")

    def test_historical_child_drift_detected(self):
        data,src=fresh()
        src["r6Child"]+=b"// changed"
        rejected(data,src,"exact_source_blob_mismatch")

    def test_current_diagnostic_child_drift_detected(self):
        data,src=fresh()
        src["currentChild"]+=b"// changed"
        rejected(data,src,"exact_source_blob_mismatch")

    def test_historical_failure_code_rejected_if_accepted(self):
        data,src=fresh()
        data["failures"][0]["failureCode"]="success"
        rejected(data,src,"native_fixture_failure_record_mismatch")

    def test_historical_failure_stage_rejected_if_changed(self):
        data,src=fresh()
        data["failures"][1]["failedStage"]="accepted_exchange"
        rejected(data,src,"native_fixture_failure_record_mismatch")

    def test_identity_progress_not_successful(self):
        data,src=fresh()
        data["failures"][0]["identityProgress"]["authorityToken"]=True
        rejected(data,src,"first_identity_control_progress_mismatch")

    def test_child_exit_mismatch_rejected(self):
        data,src=fresh()
        data["failures"][1]["identityChild"]["actualExit"]=0
        rejected(data,src,"native_capture_timeout_record_mismatch")

    def test_native_capture_signal_mismatch_rejected(self):
        data,src=fresh()
        data["failures"][0]["identityChild"]["nativeInvocation"]["signal"]=None
        rejected(data,src,"native_capture_timeout_record_mismatch")

    def test_native_capture_overlong_timeout_rejected(self):
        data,src=fresh()
        data["failures"][0]["identityChild"]["nativeInvocation"]["elapsedMs"]=16050
        rejected(data,src,"native_capture_timeout_record_mismatch")

    def test_native_capture_stderr_not_empty_rejected(self):
        data,src=fresh()
        data["failures"][1]["identityChild"]["nativeInvocation"]["stderrBytes"]=52
        rejected(data,src,"native_capture_timeout_record_mismatch")

    def test_forged_stage79_completion_rejected(self):
        data,src=fresh()
        data["failures"][0]["diagnosticProbe"]["stages"].append(79)
        data["failures"][0]["diagnosticProbe"]["lastStageId"]=79
        rejected(data,src,"failure_only_probe_boundary_mismatch")

    def test_forged_new_derivative_stage_rejected(self):
        data,src=fresh()
        data["failures"][0]["diagnosticProbe"]["stages"].append(82)
        data["failures"][0]["diagnosticProbe"]["lastStageId"]=82
        rejected(data,src,"failure_only_probe_boundary_mismatch")

    def test_not_acceptance_evidence(self):
        data,src=fresh()
        data["failures"][0]["diagnosticProbe"]["acceptanceEvidence"]=True
        rejected(data,src,"failure_only_probe_boundary_mismatch")

    def test_corrupted_probe_source_hash_rejected(self):
        data,src=fresh()
        data["failures"][1]["diagnosticProbe"]["sourceSha256"]="f"*64
        rejected(data,src,"failure_only_probe_boundary_mismatch")

    def test_missing_probe_trace_rejected(self):
        data,src=fresh()
        data["failures"][0]["diagnosticProbe"]["stages"]=[]
        rejected(data,src,"failure_only_probe_boundary_mismatch")

    def test_derivative_not_killed_rejected(self):
        data,src=fresh()
        data["failures"][0]["diagnosticProbe"]["outcome"]["killed"]=False
        rejected(data,src,"derivative_probe_timeout_record_mismatch")

    def test_fixture_cleanups_not_ignored(self):
        data,src=fresh()
        data["failures"][0]["fixtureCleanupErrorCount"]=1
        rejected(data,src,"fixture_cleanup_errors_observed")

    def test_root_cause_and_operational_authorization_always_false(self):
        data,src=fresh()
        r=checker.classify(data,src)
        for key in (
            "nodeNewObjectHangMechanismProven",
            "observedDerivativeProbeIsAcceptanceEvidence",
            "intrinsicArrayRemediationProven",
            "nativeWindowsFixtureAccepted",
            "hostedPr45Accepted",
            "pr45SourceModified",
            "productionModified",
            "devActivationAuthorized"
        ):
            self.assertFalse(r[key])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(NativeStallTests)
    out=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({
        "schemaVersion":1,"suite":"offline-sanitized-r6-native-capture-failure-boundary",
        "tests":out.testsRun,
        "passed":out.testsRun-len(out.failures)-len(out.errors),
        "failed":len(out.failures)+len(out.errors),
        "inMemoryMutationsOnly":True,"productionModified":False,
        "installedPackagesOrAccountsExecuted":False,"devActivationAuthorized":False
    },separators=(",",":")))
    if not out.wasSuccessful():
        for test,trace in out.failures+out.errors:
            print(str(test)+": "+trace[-850:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
