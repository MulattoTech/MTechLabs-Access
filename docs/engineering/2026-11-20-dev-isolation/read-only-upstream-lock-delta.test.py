#!/usr/bin/env python3
"""R40 disposable source-pinned 0.3.1/0.3.3 npm lock-delta tests.

All files are generated inside TemporaryDirectory fixtures. The installed
production package tree is never read or modified by this test suite.
"""
from contextlib import contextmanager
import hashlib
from importlib.machinery import SourceFileLoader
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE=Path(__file__).parent
checker=SourceFileLoader("access46_r40",str(HERE/"read-only-upstream-lock-delta.py")).load_module()
UPSTREAM="node_modules/@wonderwhy-er/desktop-commander"
CONTROL_OLD="node_modules/@wonderwhy-er/desktop-commander/node_modules/old-bundled"
CANDIDATE_NEW="node_modules/mqtt"
COMMON="node_modules/shared"

def baseline():
    def lock(version):
        return {
            "name":"mtechlabs-local-mcp-runtime",
            "version":"1.0.0",
            "lockfileVersion":3,
            "packages":{
                "":{"name":"mtechlabs-local-mcp-runtime","version":"1.0.0",
                    "dependencies":{"@wonderwhy-er/desktop-commander":version}},
                UPSTREAM:{"version":version,
                    "resolved":"https://example.invalid/desktop-commander-"+version+".tgz",
                    "integrity":"sha512-synthetic-"+version,
                    "dependencies":{"shared":"1.0.0"}},
                COMMON:{"version":"1.0.0",
                    "resolved":"https://example.invalid/shared.tgz",
                    "integrity":"sha512-shared"}
            }
        }
    control=lock("0.3.1")
    candidate=lock("0.3.3")
    control["packages"][CONTROL_OLD]={"version":"0.1.1","inBundle":True}
    candidate["packages"][CANDIDATE_NEW]={
        "version":"5.16.0","resolved":"https://example.invalid/mqtt.tgz",
        "integrity":"sha512-mqtt"
    }
    return control,candidate

def write(path,obj):
    path.write_text(json.dumps(obj,sort_keys=True,indent=2)+"\n",encoding="utf-8")

def pins(root):
    names={"control":root/"control.json","candidate":root/"candidate.json"}
    return {key:{
        "repoPath":"synthetic/"+key,
        "bytes":p.stat().st_size,
        "blob":checker.git_blob(p.read_bytes()),
        "sha256":hashlib.sha256(p.read_bytes()).hexdigest()
    } for key,p in names.items()}

@contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix="access46-r40-lock-delta-") as tmp:
        root=Path(tmp)
        control,candidate=baseline()
        write(root/"control.json",control)
        write(root/"candidate.json",candidate)
        yield root,pins(root)

def audit(root,pin):
    return checker.audit(root/"control.json",root/"candidate.json",pin)

def mutate(root,label,callback):
    p=root/(label+".json")
    v=json.loads(p.read_text(encoding="utf-8"))
    callback(v)
    write(p,v)

def rejected(result,reason):
    return result["unqualifiedByKind"].get(reason,0)>0

class DeltaTests(unittest.TestCase):
    def test_expected_shape(self):
        with fixture() as (root,p):
            result=audit(root,p)
            self.assertTrue(result["sourcePinsAndLockStructuresQualified"])
            self.assertEqual(result["controlLockEntries"],4)
            self.assertEqual(result["candidateLockEntries"],4)
            self.assertEqual(result["unchangedOrChangedCommonEntries"],3)
            self.assertEqual(result["addedLockEntries"],1)
            self.assertEqual(result["removedLockEntries"],1)
            self.assertEqual(result["candidateAddedNonoptionalEntries"],1)
            self.assertEqual(result["candidateAddedInstallScriptFlags"],0)
            self.assertEqual(result["changedCommonEntryCount"],2)

    def test_added_mqtt_name_in_report(self):
        with fixture() as (root,p):
            r=audit(root,p)
            self.assertEqual(r["addedPackageSummaries"][0]["path"],CANDIDATE_NEW)

    def test_removed_bundled_name_in_report(self):
        with fixture() as (root,p):
            r=audit(root,p)
            self.assertEqual(r["removedPackageSummaries"][0]["path"],CONTROL_OLD)

    def test_change_fields_include_archive_identity(self):
        with fixture() as (root,p):
            r=audit(root,p)
            row=next(x for x in r["changedCommonEntrySummaries"] if x["path"]==UPSTREAM)
            self.assertIn("version",row["changedFields"])
            self.assertIn("resolved",row["changedFields"])
            self.assertIn("integrity",row["changedFields"])

    def test_repeat_frozen_inputs_stable(self):
        with fixture() as (root,p):
            self.assertEqual(audit(root,p),audit(root,p))

    def test_source_pin_git_blob_change_rejected(self):
        with fixture() as (root,p):
            p["control"]["blob"]="f"*40
            self.assertTrue(rejected(audit(root,p),"control_source_git_blob_mismatch"))

    def test_source_pin_sha256_change_rejected(self):
        with fixture() as (root,p):
            p["candidate"]["sha256"]="f"*64
            self.assertTrue(rejected(audit(root,p),"candidate_source_sha256_mismatch"))

    def test_control_content_tampering_rejected(self):
        with fixture() as (root,p):
            mutate(root,"control",lambda x:x["packages"][COMMON].update({"version":"9.0.0"}))
            self.assertTrue(rejected(audit(root,p),"control_source_sha256_mismatch"))

    def test_candidate_content_tampering_rejected(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x["packages"][CANDIDATE_NEW].update({"version":"0.0.0"}))
            self.assertTrue(rejected(audit(root,p),"candidate_source_sha256_mismatch"))

    def test_bad_root_package_dependency_with_updated_pin(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x["packages"][""]["dependencies"].update({
                "@wonderwhy-er/desktop-commander":"99.0.0"}))
            p=pins(root)
            self.assertTrue(rejected(audit(root,p),"candidate_root_package_dependency_changed"))

    def test_upstream_version_mismatch_with_updated_pin(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x["packages"][UPSTREAM].update({"version":"0.3.4"}))
            p=pins(root)
            self.assertTrue(rejected(audit(root,p),"candidate_upstream_version_unqualified"))

    def test_added_archive_without_integrity_rejected(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x["packages"][CANDIDATE_NEW].pop("integrity"))
            p=pins(root)
            self.assertTrue(rejected(audit(root,p),"added_lock_package_without_expected_metadata"))

    def test_added_archive_with_nonhttps_url_rejected(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x["packages"][CANDIDATE_NEW].update({
                "resolved":"http://example.invalid/mqtt.tgz"}))
            p=pins(root)
            self.assertTrue(rejected(audit(root,p),"added_lock_package_without_expected_metadata"))

    def test_added_without_version_rejected(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x["packages"][CANDIDATE_NEW].pop("version"))
            p=pins(root)
            self.assertTrue(rejected(audit(root,p),"added_lock_package_without_expected_metadata"))

    def test_added_install_script_flag_is_disclosed(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x["packages"][CANDIDATE_NEW].update({"hasInstallScript":True}))
            p=pins(root)
            r=audit(root,p)
            self.assertTrue(r["sourcePinsAndLockStructuresQualified"])
            self.assertEqual(r["candidateAddedInstallScriptFlags"],1)

    def test_added_optional_package_flag_disclosed(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x["packages"][CANDIDATE_NEW].update({"optional":True}))
            p=pins(root)
            r=audit(root,p)
            self.assertTrue(r["sourcePinsAndLockStructuresQualified"])
            self.assertEqual(r["candidateAddedNonoptionalEntries"],0)

    def test_missing_control_rejected(self):
        with fixture() as (root,p):
            (root/"control.json").unlink()
            self.assertTrue(rejected(audit(root,p),"control_input_unavailable"))

    def test_missing_candidate_rejected(self):
        with fixture() as (root,p):
            (root/"candidate.json").unlink()
            self.assertTrue(rejected(audit(root,p),"candidate_input_unavailable"))

    def test_invalid_source_pin_rejected(self):
        with fixture() as (root,p):
            p["candidate"].pop("bytes")
            self.assertTrue(rejected(audit(root,p),"candidate_invalid_source_pin"))

    def test_lockfile_v2_rejected_even_with_updated_pin(self):
        with fixture() as (root,p):
            mutate(root,"candidate",lambda x:x.update({"lockfileVersion":2}))
            p=pins(root)
            self.assertTrue(rejected(audit(root,p),"candidate_unqualified_npm_v3_lock"))

    def test_duplicate_json_key_rejected(self):
        with fixture() as (root,p):
            file=root/"candidate.json"
            file.write_text('{"lockfileVersion":3,"lockfileVersion":3}',encoding="utf-8")
            p=pins(root)
            self.assertTrue(rejected(audit(root,p),"candidate_invalid_or_duplicate_lock_json"))

    def test_file_size_limit_enforced(self):
        with fixture() as (root,p),mock.patch.object(checker,"MAX_LOCK_BYTES",20):
            self.assertTrue(rejected(audit(root,p),"control_lock_file_oversized"))

    def test_no_runtime_acceptance_claims(self):
        with fixture() as (root,p):
            r=audit(root,p)
            for key in ("registryOrPackageArchiveAccessed","npmOrInstalledCodeExecuted",
                        "currentLivePRHeadRecheckedByThisScript",
                        "networkCapabilityEquivalentToActualEgress",
                        "publisherTrustOrRuntimeClosureAttested",
                        "historicalPdfFailureResolved",
                        "hostedSourceAcceptanceVerified",
                        "prMergeAuthorized","devActivationAuthorized"):
                self.assertFalse(r[key])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(DeltaTests)
    run=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({"schemaVersion":1,
      "suite":"offline-frozen-pr45-upstream-lock-delta",
      "tests":run.testsRun,
      "passed":run.testsRun-len(run.failures)-len(run.errors),
      "failed":len(run.failures)+len(run.errors),
      "syntheticFixturesOnly":True,
      "npmOrPackageCodeExecuted":False,
      "productionModified":False,
      "devActivationAuthorized":False},separators=(",",":")))
    if not run.wasSuccessful():
        for test,tb in run.failures+run.errors:
            print(str(test)+": "+tb[-1000:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
