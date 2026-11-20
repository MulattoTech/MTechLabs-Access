#!/usr/bin/env python3
"""Access #46 R41 offline negative controls for frozen PDF rejection review.

All fixtures are synthesized in memory. Never imports upstream Node packages,
starts PDF engines, contacts GitHub, reads production or mutates source files.
"""
from contextlib import contextmanager
import copy
import hashlib
from importlib.machinery import SourceFileLoader
import io
import json
from pathlib import Path
import unittest
from unittest import mock

HERE=Path(__file__).parent
checker=SourceFileLoader("access46_r41_gate",str(HERE/"read-only-pdf-control-gate.py")).load_module()

SCRIPT=b"""await stageRun('pdf_create_and_read_fidelity', async () => {
 const pdf = 'fixture.pdf';
 await call('write_pdf', { path: pdf, content: 'fixed-fixture' }, 90000);
 assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
 assert.match(resultText(await call('read_file', { path: pdf }, 90000)), /MTERM PDF FIXTURE/);
});
if (response.isError === true) {
 report.pdfFailure = { tool: name, stage, fixture: 'owned-fixed-markdown-v1', ...observeToolFailure(response) };
}
assert.notEqual(response.isError, true, name + '_tool_error');
report.pass = report.initialized && !report.failedStage && cleanup;
"""
FILES={
 ".github/workflows/check.yml":b"name: synth-workflow\n",
 "integrations/mcp-manager/qualify-upstream.mjs":SCRIPT,
 "integrations/mcp-manager/lib/upstream-qualification.mjs":b"export function fixture(){}\n",
 "integrations/mcp-manager/verify-clients.mjs":b"export const verified=false;\n"
}

def stable_bytes(value):
    return json.dumps(value,sort_keys=True,separators=(",",":")).encode("utf-8")

def report_fixture(pins):
    return {
        "schemaVersion":1,
        "status":"REJECTED_LINUX_UPSTREAM_CONTROL_PDF",
        "run":44740386851,"job":136302296697,"attempt":1,
        "sourceFilesUnchangedFromRevision5":{
            name:{"sha256":checksum,"bytes":size}
            for name,(checksum,size) in pins.items()
        },
        "control":{
            "version":"0.3.1","completedPassingStages":8,
            "failedStage":"pdf_create_and_read_fidelity",
            "failureCode":"write_pdf_tool_error",
            "pdfFailure":{
                "tool":"write_pdf","stage":"pdf_create_and_read_fidelity",
                "fixture":"owned-fixed-markdown-v1","isError":True,
                "signals":["timeout"]
            }
        },
        "candidate":{
            "version":"0.3.3","completedPassingStages":10,
            "pdfBytes":13242,"pdfSha256":"a"*64
        },
        "decision":{"accepted":False,"retryPerformed":False,"timeoutRelaxed":False}
    }

@contextmanager
def fixture():
    blobs=dict(FILES)
    pins={k:(checker.digest(v),len(v)) for k,v in blobs.items()}
    review=report_fixture(pins)
    raw=stable_bytes(review)
    with mock.patch.object(checker,"SOURCE_PINS",pins),mock.patch.object(
        checker,"R6_GIT_BLOB",checker.git_blob(raw)
    ):
        yield blobs, review, raw

def classified(blobs,review):
    return checker.analyze(blobs,stable_bytes(review))

def contains(result,kind):
    return result["unqualifiedByKind"].get(kind,0)>0

class PdfGateTests(unittest.TestCase):
    def test_frozen_rejection_is_consistent_not_accepted(self):
        with fixture() as (blobs,review,raw):
            r=checker.analyze(blobs,raw)
            self.assertTrue(r["sourceAndRejectionEvidenceConsistent"])
            self.assertTrue(r["historicalRunStillRejected"])
            self.assertEqual(r["frozenSourceFilesCompared"],4)
            self.assertEqual(len(r["pdfGateInvariantCounts"]),8)
            self.assertTrue(all(v==1 for v in r["pdfGateInvariantCounts"].values()))
            for key in ("pdfRootCauseDetermined","newHostedCIExecuted",
                        "controlPdfAccepted","candidatePdfAcceptedAsWholeSource",
                        "independentSourceReviewCompleted","devActivationAuthorized"):
                self.assertFalse(r[key])

    def test_pdf_source_fixed_after_replay(self):
        with fixture() as (blobs,review,raw):
            r1=checker.analyze(blobs,raw)
            r2=checker.analyze(blobs,raw)
            self.assertEqual(r1,r2)
            self.assertTrue(r2["sourceAndRejectionEvidenceConsistent"])

    def test_modified_source_hash_refused(self):
        with fixture() as (blobs,review,raw):
            blobs["integrations/mcp-manager/lib/upstream-qualification.mjs"]+=b"// modified\n"
            self.assertTrue(contains(checker.analyze(blobs,raw),"source_changed_since_r6"))

    def test_changed_workflow_rejected(self):
        with fixture() as (blobs,review,raw):
            blobs[".github/workflows/check.yml"]+=b"skip: true\n"
            self.assertTrue(contains(checker.analyze(blobs,raw),"source_changed_since_r6"))

    def test_missing_source_refused(self):
        with fixture() as (blobs,review,raw):
            del blobs["integrations/mcp-manager/verify-clients.mjs"]
            self.assertTrue(contains(checker.analyze(blobs,raw),"source_file_missing"))

    def test_pdf_write_timeout_relaxation_detected(self):
        with fixture() as (blobs,review,raw):
            key="integrations/mcp-manager/qualify-upstream.mjs"
            blobs[key]=blobs[key].replace(b"90000",b"120000",1)
            self.assertTrue(contains(checker.analyze(blobs,raw),"pdf_contract_write_pdf_timeout_90000_unqualified"))

    def test_pdf_read_timeout_relaxation_detected(self):
        with fixture() as (blobs,review,raw):
            key="integrations/mcp-manager/qualify-upstream.mjs"
            blobs[key]=blobs[key].replace(b"}, 90000)),",b"}, 120000)),")
            self.assertTrue(contains(checker.analyze(blobs,raw),"pdf_contract_read_pdf_timeout_90000_unqualified"))

    def test_skip_pdf_stage_detected(self):
        with fixture() as (blobs,review,raw):
            key="integrations/mcp-manager/qualify-upstream.mjs"
            blobs[key]=blobs[key].replace(b"pdf_create_and_read_fidelity",b"disabled_pdf_stage",1)
            self.assertTrue(contains(checker.analyze(blobs,raw),"pdf_contract_pdf_stage_present_unqualified"))

    def test_remove_pdf_signature_check_detected(self):
        with fixture() as (blobs,review,raw):
            key="integrations/mcp-manager/qualify-upstream.mjs"
            blobs[key]=blobs[key].replace(b"assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');",b"")
            self.assertTrue(contains(checker.analyze(blobs,raw),"pdf_contract_pdf_signature_check_unqualified"))

    def test_remove_pdf_text_fidelity_detected(self):
        with fixture() as (blobs,review,raw):
            key="integrations/mcp-manager/qualify-upstream.mjs"
            blobs[key]=blobs[key].replace(b"/MTERM PDF FIXTURE/",b"/any-content/")
            self.assertTrue(contains(checker.analyze(blobs,raw),"pdf_contract_pdf_text_fidelity_check_unqualified"))

    def test_missing_error_capture_rejected(self):
        with fixture() as (blobs,review,raw):
            key="integrations/mcp-manager/qualify-upstream.mjs"
            blobs[key]=blobs[key].replace(b"owned-fixed-markdown-v1",b"unknown")
            self.assertTrue(contains(checker.analyze(blobs,raw),"pdf_contract_capture_pdf_tool_error_unqualified"))

    def test_tool_error_suppression_rejected(self):
        with fixture() as (blobs,review,raw):
            key="integrations/mcp-manager/qualify-upstream.mjs"
            blobs[key]=blobs[key].replace(b"assert.notEqual(response.isError, true, name + '_tool_error');",b"// ignored")
            self.assertTrue(contains(checker.analyze(blobs,raw),"pdf_contract_reject_pdf_is_error_unqualified"))

    def test_report_pass_ignoring_failed_stage_rejected(self):
        with fixture() as (blobs,review,raw):
            key="integrations/mcp-manager/qualify-upstream.mjs"
            blobs[key]=blobs[key].replace(b"report.initialized && !report.failedStage",b"report.initialized && true")
            self.assertTrue(contains(checker.analyze(blobs,raw),"pdf_contract_fail_closed_stage_result_unqualified"))

    def test_historical_report_blob_tampering_detected(self):
        with fixture() as (blobs,review,raw):
            modified=raw+b" "
            self.assertTrue(contains(checker.analyze(blobs,modified),"historical_report_blob_changed"))

    def test_historical_control_failure_rebranded_rejected(self):
        with fixture() as (blobs,review,raw):
            review["control"]["failureCode"]="success"
            self.assertTrue(contains(classified(blobs,review),"historical_control_rejection_changed"))

    def test_historical_timeout_signal_removed_rejected(self):
        with fixture() as (blobs,review,raw):
            review["control"]["pdfFailure"]["signals"]=[]
            self.assertTrue(contains(classified(blobs,review),"historical_pdf_failure_signal_changed"))

    def test_historical_fixture_changed_rejected(self):
        with fixture() as (blobs,review,raw):
            review["control"]["pdfFailure"]["fixture"]="other"
            self.assertTrue(contains(classified(blobs,review),"historical_pdf_failure_signal_changed"))

    def test_historical_decision_falsely_accepted_rejected(self):
        with fixture() as (blobs,review,raw):
            review["decision"]["accepted"]=True
            self.assertTrue(contains(classified(blobs,review),"historical_decision_not_rejected"))

    def test_historical_timeout_relaxed_claim_rejected(self):
        with fixture() as (blobs,review,raw):
            review["decision"]["timeoutRelaxed"]=True
            self.assertTrue(contains(classified(blobs,review),"historical_decision_not_rejected"))

    def test_historical_run_identity_changed_rejected(self):
        with fixture() as (blobs,review,raw):
            review["run"]=44742255585
            self.assertTrue(contains(classified(blobs,review),"historical_run_identity_changed"))

    def test_historical_source_pin_map_changed_rejected(self):
        with fixture() as (blobs,review,raw):
            review["sourceFilesUnchangedFromRevision5"][".github/workflows/check.yml"]["sha256"]="f"*64
            self.assertTrue(contains(classified(blobs,review),"historical_check.yml_pin_changed"))

    def test_candidate_not_equivalent_to_control_acceptance(self):
        with fixture() as (blobs,review,raw):
            review["candidate"]["completedPassingStages"]=9
            self.assertTrue(contains(classified(blobs,review),"historical_candidate_observation_changed"))

    def test_source_not_bytes_fails_closed(self):
        with fixture() as (blobs,review,raw):
            blobs["integrations/mcp-manager/qualify-upstream.mjs"]=None
            r=checker.analyze(blobs,raw)
            self.assertFalse(r["sourceAndRejectionEvidenceConsistent"])
            self.assertTrue(contains(r,"pdf_source_not_bytes"))

    def test_candidate_wrong_shape_fails_closed(self):
        with fixture() as (blobs,review,raw):
            review["candidate"]=[]
            r=classified(blobs,review)
            self.assertFalse(r["sourceAndRejectionEvidenceConsistent"])
            self.assertTrue(contains(r,"historical_lanes_or_decision_missing"))

    def test_corrupt_historical_json_fails(self):
        with fixture() as (blobs,review,raw):
            self.assertTrue(contains(checker.analyze(blobs,b"{bad-json"),"historical_report_unreadable"))

    def test_prohibit_unlisted_git_path(self):
        with fixture() as (blobs,review,raw):
            with self.assertRaisesRegex(ValueError,"unallowlisted_exact_source_path"):
                checker.read_exact(HERE,".git/config")

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(PdfGateTests)
    result=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({"schemaVersion":1,
        "suite":"offline-frozen-r6-pdf-control-rejection-guard",
        "tests":result.testsRun,
        "passed":result.testsRun-len(result.failures)-len(result.errors),
        "failed":len(result.failures)+len(result.errors),
        "syntheticFixturesInMemoryOnly":True,
        "npmOrPdfOrPackageExecuted":False,
        "githubQueried":False,
        "productionModified":False,
        "devActivationAuthorized":False},separators=(",",":")))
    if not result.wasSuccessful():
        for case,tb in result.failures+result.errors:
            print(str(case)+": "+tb[-900:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
