#!/usr/bin/env python3
"""Access #46 R34: disposable, deterministic installed-byte-fingerprint tests.

Only temporary fixtures are written; no installed package data, live process,
credentials, GitHub Actions, network or Windows ACL is modified or executed.
"""
from contextlib import contextmanager
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = Path(__file__).parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

checker = load("access46_r34_bytehash", "read-only-upstream-bytehash.py")
prior_tests = load("access46_r34_r33_fixture", "read-only-upstream-lock-structure.test.py")

def amended_stat(info, **changes):
    keys = ("st_mode", "st_dev", "st_ino", "st_size", "st_mtime_ns",
            "st_ctime_ns", "st_file_attributes")
    value = {k:getattr(info,k,0) for k in keys}
    value.update(changes)
    return SimpleNamespace(**value)

@contextmanager
def fixture():
    with prior_tests.fixture() as root:
        yield root

def add_file(root, rel, payload):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path

def reason(out, name):
    return out["unqualifiedByKind"].get(name, 0) > 0

class ByteInventoryTests(unittest.TestCase):
    def test_control_has_exact_file_coverage(self):
        with fixture() as root:
            result = checker.audit(root)
            self.assertTrue(result["completeDeclaredClosureFingerprint"])
            self.assertEqual(result["selectedPackageRoots"],3)
            self.assertEqual(result["successfullyHashedFiles"],3)
            self.assertEqual(result["discoveredFiles"],3)
            self.assertEqual(result["visitedDirectories"],3)
            self.assertRegex(result["byteInventorySha256"],"^[0-9a-f]{64}$")

    def test_repeat_digest_stable(self):
        with fixture() as root:
            one=checker.audit(root)
            two=checker.audit(root)
            self.assertTrue(one["completeDeclaredClosureFingerprint"])
            self.assertEqual(one["byteInventorySha256"],two["byteInventorySha256"])

    def test_file_content_change_changes_digest(self):
        with fixture() as root:
            p=add_file(root,"a/example.js",b"before")
            first=checker.audit(root)
            p.write_bytes(b"AFTER!")
            second=checker.audit(root)
            self.assertTrue(first["completeDeclaredClosureFingerprint"])
            self.assertTrue(second["completeDeclaredClosureFingerprint"])
            self.assertNotEqual(first["byteInventorySha256"],second["byteInventorySha256"])

    def test_adding_file_changes_digest_and_count(self):
        with fixture() as root:
            first=checker.audit(root)
            add_file(root,"a/fresh.cjs",b"new file")
            second=checker.audit(root)
            self.assertEqual(second["successfullyHashedFiles"],first["successfullyHashedFiles"]+1)
            self.assertNotEqual(first["byteInventorySha256"],second["byteInventorySha256"])

    def test_renaming_file_changes_digest(self):
        with fixture() as root:
            p=add_file(root,"a/from.js",b"same contents")
            first=checker.audit(root)
            p.rename(p.with_name("to.js"))
            second=checker.audit(root)
            self.assertNotEqual(first["byteInventorySha256"],second["byteInventorySha256"])

    def test_nested_directories_but_no_unrelated_config(self):
        with fixture() as root:
            add_file(root,"@wonderwhy-er/desktop-commander/dist/index.js",b"export default true;")
            r=checker.audit(root)
            self.assertTrue(r["completeDeclaredClosureFingerprint"])
            self.assertEqual(r["successfullyHashedFiles"],4)
            self.assertEqual(r["visitedDirectories"],4)

    def test_total_byte_cap_reports_unqualified(self):
        with fixture() as root, mock.patch.object(checker,"MAX_TOTAL_BYTES",1):
            r=checker.audit(root)
            self.assertFalse(r["completeDeclaredClosureFingerprint"])
            self.assertTrue(reason(r,"total_byte_cap"))

    def test_file_count_cap_reports_unqualified(self):
        with fixture() as root, mock.patch.object(checker,"MAX_FILES",2):
            r=checker.audit(root)
            self.assertFalse(r["completeDeclaredClosureFingerprint"])
            self.assertTrue(reason(r,"file_count_cap"))

    def test_directory_count_cap_reports_unqualified(self):
        with fixture() as root, mock.patch.object(checker,"MAX_DIRECTORIES",1):
            r=checker.audit(root)
            self.assertFalse(r["completeDeclaredClosureFingerprint"])
            self.assertTrue(reason(r,"directory_count_cap"))

    def test_single_file_size_cap(self):
        with tempfile.TemporaryDirectory(prefix="access46-r34-single-") as tmp:
            p=Path(tmp)/"big.js";p.write_bytes(b"abcdefghijk")
            with mock.patch.object(checker,"MAX_FILE_BYTES",10):
                digest,length,error=checker.hash_file(p)
            self.assertEqual(error,"file_size_cap")
            self.assertIsNone(digest)

    def test_nonexistent_file_is_unverified(self):
        with tempfile.TemporaryDirectory(prefix="access46-r34-single-") as tmp:
            _,_,error=checker.hash_file(Path(tmp)/"missing.js")
            self.assertEqual(error,"file_metadata_or_read_unavailable")

    def test_normal_file_sha256(self):
        import hashlib
        with tempfile.TemporaryDirectory(prefix="access46-r34-single-") as tmp:
            p=Path(tmp)/"test.js";p.write_bytes(b"known")
            digest,size,error=checker.hash_file(p)
            self.assertIsNone(error)
            self.assertEqual(size,5)
            self.assertEqual(digest,hashlib.sha256(b"known").hexdigest())

    def test_reparse_file_flag_refused(self):
        with tempfile.TemporaryDirectory(prefix="access46-r34-single-") as tmp:
            p=Path(tmp)/"test.js";p.write_bytes(b"small")
            real_lstat=os.lstat
            with mock.patch.object(checker.os,"lstat",
                  side_effect=lambda path: amended_stat(real_lstat(path),st_file_attributes=0x400)):
                _,_,error=checker.hash_file(p)
            self.assertEqual(error,"file_not_regular_or_link")

    def test_opened_handle_mismatch_refused(self):
        with tempfile.TemporaryDirectory(prefix="access46-r34-single-") as tmp:
            p=Path(tmp)/"test.js";p.write_bytes(b"small")
            real_fstat=os.fstat
            with mock.patch.object(checker.os,"fstat",
                  side_effect=lambda fd: amended_stat(real_fstat(fd),st_size=500)):
                _,_,error=checker.hash_file(p)
            self.assertEqual(error,"file_changed_before_read")

    def test_handle_change_during_read_refused(self):
        with tempfile.TemporaryDirectory(prefix="access46-r34-single-") as tmp:
            p=Path(tmp)/"test.js";p.write_bytes(b"small")
            real_fstat=os.fstat
            n=[0]
            def fake_fstat(fd):
                n[0]+=1
                value=real_fstat(fd)
                if n[0]==2:
                    return amended_stat(value,st_mtime_ns=value.st_mtime_ns+1)
                return value
            with mock.patch.object(checker.os,"fstat",side_effect=fake_fstat):
                _,_,error=checker.hash_file(p)
            self.assertEqual(error,"file_changed_during_read")

    def test_path_ctime_change_after_read_refused(self):
        with tempfile.TemporaryDirectory(prefix="access46-r34-single-") as tmp:
            p=Path(tmp)/"test.js";p.write_bytes(b"small")
            real_lstat=os.lstat
            n=[0]
            def fake_lstat(path):
                n[0]+=1
                value=real_lstat(path)
                if n[0]==2:
                    return amended_stat(value,st_ctime_ns=value.st_ctime_ns+1)
                return value
            with mock.patch.object(checker.os,"lstat",side_effect=fake_lstat):
                _,_,error=checker.hash_file(p)
            self.assertEqual(error,"file_changed_after_read")

    def test_prior_lock_drift_refuses_complete_fingerprint(self):
        with fixture() as root:
            p=root.parent/"package-lock.json"
            obj=json.loads(p.read_text(encoding="utf-8"))
            obj["packages"]["node_modules/a"]["version"]="404.0.0"
            p.write_text(json.dumps(obj),encoding="utf-8")
            r=checker.audit(root)
            self.assertFalse(r["completeDeclaredClosureFingerprint"])
            self.assertTrue(reason(r,"prior_lock_qualification_unverified"))

    def test_walk_error_reports_failed_not_empty(self):
        with fixture() as root:
            def broken_walk(*args,**kwargs):
                kwargs["onerror"](OSError("synthetic_denied"))
                return iter(())
            with mock.patch.object(checker.os,"walk",side_effect=broken_walk):
                r=checker.audit(root)
            self.assertFalse(r["completeDeclaredClosureFingerprint"])
            self.assertTrue(reason(r,"directory_walk_unavailable"))

    def test_duplicate_file_list_does_not_pass(self):
        with fixture() as root:
            def repeated_walk(base,**kwargs):
                return iter([(str(base), [], ["package.json","package.json"])])
            with mock.patch.object(checker.os,"walk",side_effect=repeated_walk):
                r=checker.audit(root)
            self.assertFalse(r["completeDeclaredClosureFingerprint"])
            self.assertTrue(reason(r,"casefold_duplicate_file_path"))

    def test_global_metadata_is_not_security_claim(self):
        with fixture() as root:
            result=checker.audit(root)
            self.assertTrue(result["completeDeclaredClosureFingerprint"])
            for claim in ("trustedSourceProvenanceVerified",
                          "liveRuntimeModuleGraphAttested",
                          "raceFreeFileIdentityVerified",
                          "effectiveWindowsAclVerified","devActivationAuthorized"):
                self.assertFalse(result[claim])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(ByteInventoryTests)
    result=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({
        "schemaVersion":1,"suite":"offline-installed-package-byte-fingerprint",
        "tests":result.testsRun,
        "passed":result.testsRun-len(result.failures)-len(result.errors),
        "failed":len(result.failures)+len(result.errors),
        "scratchOnly":True,"productionPackageChanged":False,
        "packageExecuted":False,"devActivationAuthorized":False
    },separators=(",",":")))
    if not result.wasSuccessful():
        for case, trace in result.failures+result.errors:
            print(str(case)+": "+trace[-900:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
