#!/usr/bin/env python3
"""Offline synthetic regression tests for Access #46 package metadata auditors.

No installed package content imported or executed. All fixture files are
created only in temporary directories and automatically cleaned up.
"""
from contextlib import contextmanager
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE=Path(__file__).parent
def import_file(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

closure=import_file("mterm_access_r30_closure","read-only-upstream-closure.py")
native=import_file("mterm_access_r30_native","read-only-upstream-native.py")

def put_package(root:Path,rel:str,deps=None,optional=None,peers=None,invalid=False):
    p=root/rel
    p.mkdir(parents=True,exist_ok=True)
    data={
       "name":rel.rsplit("/",1)[-1] if rel != "@wonderwhy-er/desktop-commander" else "@wonderwhy-er/desktop-commander",
       "version":"1.2.3",
       "dependencies":deps or {},
       "optionalDependencies":optional or {},
       "peerDependencies":peers or {}
    }
    (p/"package.json").write_text("{bad" if invalid else json.dumps(data),encoding="utf-8")
    return p

@contextmanager
def tree():
    with tempfile.TemporaryDirectory(prefix="mterm-closure-r30-") as temp:
        root=Path(temp)/"node_modules"
        start=put_package(root,"@wonderwhy-er/desktop-commander",
            deps={"a":"1","b":"2"},optional={"optional-os":"*","optional-present":"*"},
            peers={"peer-not-traversed":"*"})
        a=put_package(root,"a",deps={"c":"3"})
        put_package(root,"b")
        put_package(root,"optional-present")
        put_package(root,"a/node_modules/c")
        yield root,start,a

class AuditTests(unittest.TestCase):
    def test_complete_fixture(self):
        with tree() as (root,start,_):
            report=closure.inventory(root,start)
            self.assertEqual(report["manifestFilesRead"],5)
            self.assertEqual(report["requiredDependencyEdges"],3)
            self.assertEqual(report["optionalDependencyEdges"],2)
            self.assertEqual(report["declaredPeerDependencyEdgesNotRecursed"],1)
            self.assertEqual(report["unresolvedOptionalCount"],1)
            self.assertEqual(report["requiredOrMetadataUnqualifiedCount"],0)
            self.assertFalse(report["capsHit"])
            self.assertEqual(report["queueUnfinished"],0)
            self.assertEqual(report["maxTraversalDepth"],2)

    def test_fingerprint_deterministic(self):
        with tree() as (root,start,_):
            left=closure.inventory(root,start)
            right=closure.inventory(root,start)
            self.assertEqual(left["metadataFingerprintSha256"],right["metadataFingerprintSha256"])
            self.assertRegex(left["metadataFingerprintSha256"],r"^[0-9a-f]{64}$")

    def test_manifest_edit_changes_fingerprint(self):
        with tree() as (root,start,_):
            old=closure.inventory(root,start)["metadataFingerprintSha256"]
            p=root/"a"/"package.json"
            obj=json.loads(p.read_text(encoding="utf-8"));obj["version"]="1.2.4"
            p.write_text(json.dumps(obj),encoding="utf-8")
            new=closure.inventory(root,start)["metadataFingerprintSha256"]
            self.assertNotEqual(old,new)

    def test_missing_required_fails_closed(self):
        with tree() as (root,start,_):
            (root/"b"/"package.json").unlink()
            report=closure.inventory(root,start)
            self.assertEqual(report["requiredOrMetadataUnqualifiedCount"],1)
            self.assertEqual(report["requiredOrMetadataUnqualifiedByKind"]["missing"],1)

    def test_unresolved_required_name(self):
        with tree() as (root,start,_):
            p=start/"package.json"
            d=json.loads(p.read_text());d["dependencies"]["missing-required"]="1"
            p.write_text(json.dumps(d),encoding="utf-8")
            report=closure.inventory(root,start)
            self.assertEqual(report["requiredOrMetadataUnqualifiedByKind"]["required_not_found_in_known_roots"],1)

    def test_missing_optional_not_required_failure(self):
        with tree() as (root,start,_):
            report=closure.inventory(root,start)
            self.assertEqual(report["unresolvedOptionalCount"],1)
            self.assertEqual(report["requiredOrMetadataUnqualifiedCount"],0)

    def test_nonexistent_start(self):
        with tree() as (root,start,_):
            (start/"package.json").unlink()
            report=closure.inventory(root,start)
            self.assertGreater(report["requiredOrMetadataUnqualifiedCount"],0)

    def test_invalid_manifest(self):
        with tree() as (root,start,_):
            (root/"b"/"package.json").write_text("{oops",encoding="utf-8")
            r=closure.inventory(root,start)
            self.assertEqual(r["requiredOrMetadataUnqualifiedByKind"]["manifest_unreadable_or_invalid"],1)

    def test_invalid_dependency_names(self):
        with tree() as (root,start,_):
            p=start/"package.json"
            obj=json.loads(p.read_text())
            obj["dependencies"]["../../another-file"]="*"
            p.write_text(json.dumps(obj),encoding="utf-8")
            r=closure.inventory(root,start)
            self.assertIn("invalid_dependency_fields",r["requiredOrMetadataUnqualifiedByKind"])

    def test_size_limit(self):
        with tree() as (root,start,_):
            (root/"b"/"package.json").write_bytes(b"x"*(closure.MAX_MANIFEST_BYTES+1))
            r=closure.inventory(root,start)
            self.assertIn("manifest_size_or_type",r["requiredOrMetadataUnqualifiedByKind"])

    def test_caps_fail_closed(self):
        with tree() as (root,start,_):
            saved=closure.MAX_PACKAGES
            try:
                closure.MAX_PACKAGES=2
                r=closure.inventory(root,start)
                self.assertTrue(r["capsHit"])
                self.assertGreater(r["queueUnfinished"],0)
            finally:
                closure.MAX_PACKAGES=saved

    def test_wrong_start_refused(self):
        with tree() as (root,start,_):
            with self.assertRaisesRegex(ValueError,"start_package_not_pinned"):
                closure.inventory(root,root/"a")

    def test_relative_path_outside_root(self):
        with tree() as (root,start,_):
            safe,why=closure.relative_safe(root,root.parent/"outside")
            self.assertFalse(safe)
            self.assertEqual(why,"outside_root")

    def test_native_types_and_count(self):
        with tree() as (root,start,_):
            file_specs={"dist/index.node":b"node","dist/rg.exe":b"exe",
                "bin/helper.dll":b"dll","dist/sharp.wasm":b"wasm"}
            for rel,b in file_specs.items():
                p=start/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
            saved_root=native.ROOT
            try:
                native.ROOT=root
                r=native.audit()
                self.assertEqual(r["nativeOrHelperCandidates"],4)
                self.assertFalse(r["scanCapped"])
                self.assertEqual(r["types"],{".dll":1,".exe":1,".node":1,".wasm":1})
            finally:
                native.ROOT=saved_root

    def test_native_fingerprint_stable(self):
        with tree() as (root,start,_):
            p=start/"dist"/"x.node";p.parent.mkdir(parents=True);p.write_bytes(b"x")
            saved=native.ROOT
            try:
                native.ROOT=root
                a=native.audit()
                b=native.audit()
                self.assertEqual(a["candidateMetadataSha256"],b["candidateMetadataSha256"])
            finally:
                native.ROOT=saved

    def test_native_cap_is_visible(self):
        with tree() as (root,start,_):
            saved_root,saved_limit=native.ROOT,native.MAX_FILES
            try:
                native.ROOT=root;native.MAX_FILES=1
                r=native.audit()
                self.assertTrue(r["scanCapped"])
            finally:
                native.ROOT=saved_root;native.MAX_FILES=saved_limit

    def test_optional_overlap_not_double_counted_required(self):
        with tree() as (root,start,_):
            p=start/"package.json";obj=json.loads(p.read_text())
            obj["dependencies"]["optional-present"]="*"
            p.write_text(json.dumps(obj),encoding="utf-8")
            report=closure.inventory(root,start)
            self.assertEqual(report["requiredDependencyEdges"],3)

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(AuditTests)
    stream=io.StringIO()
    outcome=unittest.TextTestRunner(stream=stream,verbosity=0).run(suite)
    receipt={"schemaVersion":1,"suite":"offline-synthetic-upstream-dependency-closure",
        "tests":outcome.testsRun,
        "passed":outcome.testsRun-len(outcome.failures)-len(outcome.errors),
        "failed":len(outcome.failures)+len(outcome.errors),
        "networkQueried":False,"productionPackageModified":False,
        "userConfigFilesRead":False,"installedPackageExecuted":False,
        "testScratchCleaned":True,"devActivationAuthorized":False}
    print(json.dumps(receipt,separators=(",",":")))
    if not outcome.wasSuccessful():
        raise SystemExit(1)

if __name__=="__main__":
    main()
