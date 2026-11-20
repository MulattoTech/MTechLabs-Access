#!/usr/bin/env python3
"""R39 disposable exact-source-blob pin negative regressions; no production edits."""
from contextlib import contextmanager
from importlib.machinery import SourceFileLoader
import io
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE=Path(__file__).parent
checker=SourceFileLoader(
 "access46_r39",str(HERE/"read-only-pr45-control-lock-pin.py")
).load_module()

def strict_payloads():
    name="mtechlabs-local-mcp-runtime"
    deps={"@wonderwhy-er/desktop-commander":"0.3.1"}
    manifest={"name":name,"version":"1.0.0","private":True,
              "dependencies":deps}
    lock={"name":name,"version":"1.0.0","lockfileVersion":3,
          "packages":{
            "":{"name":name,"version":"1.0.0","dependencies":deps},
            "node_modules/@wonderwhy-er/desktop-commander":{
              "version":"0.3.1","integrity":"synthetic-placeholder"
            }
          }}
    return manifest,lock

def write(path,obj):
    path.write_text(json.dumps(obj,indent=2)+"\n",encoding="utf-8")

def pins(root):
    p={}
    for name in ("package.json","package-lock.json"):
        raw=(root/name).read_bytes()
        p[name]={
            "repoPath":"synthetic/"+name,
            "blobSha1":checker.git_blob(raw),
            "sha256":hashlib.sha256(raw).hexdigest(),
            "bytes":len(raw),
        }
    return p

@contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix="access46-r39-pin-") as temp:
        root=Path(temp)
        m,l=strict_payloads()
        write(root/"package.json",m)
        write(root/"package-lock.json",l)
        yield root,pins(root)

def fail(result,reason):
    return result["unqualifiedByKind"].get(reason,0)>0

class PinTests(unittest.TestCase):
    def test_control_fixture_exact(self):
        with fixture() as (root,expected):
            result=checker.audit(root,expected)
            self.assertTrue(result["exactControlMetadataSourcePinMatched"])
            self.assertEqual(result["metadataFilesRead"],2)
            self.assertFalse(result["prodCutoverAuthorized"])

    def test_repeat_exact_hash(self):
        with fixture() as (root,expected):
            a,b=checker.audit(root,expected),checker.audit(root,expected)
            self.assertEqual(a["metadataFileFingerprints"],b["metadataFileFingerprints"])
            self.assertTrue(b["exactControlMetadataSourcePinMatched"])

    def test_truncated_manifest_fails(self):
        with fixture() as (root,expected):
            (root/"package.json").write_bytes(b"{")
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"metadata_json_invalid"))
            self.assertTrue(fail(out,"expected_byte_size_mismatch"))

    def test_manifest_value_drift_fails(self):
        with fixture() as (root,expected):
            p=root/"package.json"
            data=json.loads(p.read_text())
            data["dependencies"]["@wonderwhy-er/desktop-commander"]="0.3.3"
            write(p,data)
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"control_root_manifest_semantics_changed"))
            self.assertTrue(fail(out,"frozen_sha256_mismatch"))

    def test_same_length_byte_substitution_fails(self):
        with fixture() as (root,expected):
            p=root/"package.json"
            raw=p.read_bytes().replace(b"1.0.0",b"2.0.0")
            self.assertEqual(len(raw),expected["package.json"]["bytes"])
            p.write_bytes(raw)
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"github_blob_identity_mismatch"))
            self.assertTrue(fail(out,"frozen_sha256_mismatch"))

    def test_lock_package_version_drift_fails(self):
        with fixture() as (root,expected):
            p=root/"package-lock.json"
            data=json.loads(p.read_text())
            data["packages"]["node_modules/@wonderwhy-er/desktop-commander"]["version"]="0.3.3"
            write(p,data)
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"control_lock_semantics_changed"))

    def test_manifest_missing_fails(self):
        with fixture() as (root,expected):
            (root/"package.json").unlink()
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"file_unavailable"))
            self.assertFalse(out["exactControlMetadataSourcePinMatched"])

    def test_lock_missing_fails(self):
        with fixture() as (root,expected):
            (root/"package-lock.json").unlink()
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"file_unavailable"))

    def test_untrusted_external_pins_cannot_assert_release_acceptance(self):
        with fixture() as (root,expected):
            out=checker.audit(root,expected)
            for k in (
                "currentPrHeadIndependentlyRecheckedByThisScript",
                "installedTarballIntegrityVerified",
                "npmRegistryPublisherVerified",
                "runtimeLoadedCodeVerified",
                "hostWriteIsolationVerified",
                "npmOrPackageCodeExecuted",
                "filesModified",
                "prodCutoverAuthorized",
                "devActivationAuthorized"
            ):
                self.assertFalse(out[k])

    def test_root_private_true_required(self):
        with fixture() as (root,expected):
            p=root/"package.json"
            data=json.loads(p.read_text())
            data["private"]="true"
            write(p,data)
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"control_root_manifest_semantics_changed"))

    def test_lock_schema_v3_required(self):
        with fixture() as (root,expected):
            p=root/"package-lock.json"
            data=json.loads(p.read_text())
            data["lockfileVersion"]=2
            write(p,data)
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"control_lock_semantics_changed"))

    def test_lock_no_packages_map_rejected(self):
        with fixture() as (root,expected):
            p=root/"package-lock.json"
            data=json.loads(p.read_text())
            data["packages"]=[]
            write(p,data)
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"control_lock_semantics_changed"))

    def test_json_duplicate_property_rejected(self):
        with fixture() as (root,expected):
            p=root/"package.json"
            p.write_text('{"name":"a","name":"b"}',encoding="utf-8")
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"metadata_json_invalid"))

    def test_bounded_file_size_refusal(self):
        with fixture() as (root,expected), mock.patch.object(checker,"MAX_META_BYTES",12):
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"metadata_file_too_large"))

    def test_missing_pin_spec_fails(self):
        with fixture() as (root,expected):
            expected["package.json"].pop("sha256")
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"source_pin_definition_invalid"))

    def test_wrong_git_sha_refused(self):
        with fixture() as (root,expected):
            expected["package-lock.json"]["blobSha1"]="f"*40
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"github_blob_identity_mismatch"))

    def test_wrong_sha256_refused(self):
        with fixture() as (root,expected):
            expected["package-lock.json"]["sha256"]="f"*64
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"frozen_sha256_mismatch"))

    def test_declared_bytes_constraint_checked(self):
        with fixture() as (root,expected):
            expected["package.json"]["bytes"]+=1
            out=checker.audit(root,expected)
            self.assertTrue(fail(out,"expected_byte_size_mismatch"))

    def test_git_blob_hash_algorithm(self):
        data=b"abc"
        result=checker.git_blob(data)
        self.assertEqual(result,hashlib.sha1(b"blob 3\x00abc").hexdigest())

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(PinTests)
    run=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({
        "schemaVersion":1,"suite":"offline-pr45-source-controlled-control-manifest-bytes",
        "tests":run.testsRun,
        "passed":run.testsRun-len(run.failures)-len(run.errors),
        "failed":len(run.failures)+len(run.errors),
        "syntheticFixturesOnly":True,
        "githubQueried":False,"npmOrCodeExecuted":False,
        "productionModified":False,"devActivationAuthorized":False
    },separators=(",",":")))
    if not run.wasSuccessful():
        for test,tb in run.errors+run.failures:
            print(str(test)+": "+tb[-1000:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
