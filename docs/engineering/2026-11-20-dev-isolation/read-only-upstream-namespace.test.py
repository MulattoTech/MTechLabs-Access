#!/usr/bin/env python3
"""Access #46 R35: disposable installed-package namespace and launcher tests.

All fixture writes happen in disposable TemporaryDirectory locations.
No production files, packages, accounts, permissions or runtime changed.
"""
from contextlib import contextmanager
from importlib.machinery import SourceFileLoader
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = Path(__file__).parent
checker = SourceFileLoader("access46_r35_namespace", str(HERE / "read-only-upstream-namespace.py")).load_module()
fixtures = SourceFileLoader("access46_r35_fixture", str(HERE / "read-only-upstream-lock-structure.test.py")).load_module()

@contextmanager
def root_fixture():
    with fixtures.fixture() as root:
        yield root

def save(root, rel, content=b"test"):
    p = root / rel
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_bytes(content)
    return p

def reason(data, key):
    return data["unqualifiedByKind"].get(key, 0) > 0

class NamespaceTests(unittest.TestCase):
    def test_empty_bin_qualified_base(self):
        with root_fixture() as root:
            outcome=checker.audit(root)
            self.assertTrue(outcome["completeNamespaceAccounted"])
            self.assertEqual(outcome["declaredPackageDirectories"],3)
            self.assertEqual(outcome["observedPackageDirectories"],3)
            self.assertEqual(outcome["allNodeModulesFilesSeen"],4)
            self.assertEqual(outcome["previouslyHashedPackageFiles"],3)
            self.assertEqual(outcome["installedTreeLockfilesSeen"],1)
            self.assertEqual(outcome["additionalBinLaunchersHashed"],0)

    def test_three_launcher_formats_counted_and_hashed(self):
        with root_fixture() as root:
            for rel in (".bin/example",".bin/example.cmd",".bin/example.ps1"):
                save(root,rel,b"echo example")
            result=checker.audit(root)
            self.assertTrue(result["completeNamespaceAccounted"])
            self.assertEqual(result["additionalBinLaunchersHashed"],3)
            self.assertEqual(result["allNodeModulesFilesSeen"],7)

    def test_repeat_namespace_fingerprint_stable(self):
        with root_fixture() as root:
            save(root,".bin/check.cmd",b"first")
            a=checker.audit(root)
            b=checker.audit(root)
            self.assertTrue(a["completeNamespaceAccounted"])
            self.assertEqual(a["namespaceFingerprintSha256"],b["namespaceFingerprintSha256"])

    def test_launcher_content_mutation_changes_fingerprint(self):
        with root_fixture() as root:
            p=save(root,".bin/check.ps1",b"one")
            a=checker.audit(root)
            p.write_bytes(b"TWO")
            b=checker.audit(root)
            self.assertTrue(a["completeNamespaceAccounted"])
            self.assertTrue(b["completeNamespaceAccounted"])
            self.assertNotEqual(a["namespaceFingerprintSha256"],b["namespaceFingerprintSha256"])

    def test_added_launcher_changes_fingerprint(self):
        with root_fixture() as root:
            a=checker.audit(root)
            save(root,".bin/check.cmd",b"three")
            b=checker.audit(root)
            self.assertNotEqual(a["namespaceFingerprintSha256"],b["namespaceFingerprintSha256"])
            self.assertEqual(b["additionalBinLaunchersHashed"],1)

    def test_removed_launcher_changes_fingerprint(self):
        with root_fixture() as root:
            p=save(root,".bin/check.cmd",b"three")
            a=checker.audit(root)
            p.unlink()
            b=checker.audit(root)
            self.assertNotEqual(a["namespaceFingerprintSha256"],b["namespaceFingerprintSha256"])

    def test_unknown_root_file_is_rejected(self):
        with root_fixture() as root:
            save(root,"unaccounted.ps1",b"unsafe")
            result=checker.audit(root)
            self.assertFalse(result["completeNamespaceAccounted"])
            self.assertTrue(reason(result,"file_outside_qualified_package_or_bin"))
            self.assertEqual(result["otherUnqualifiedFiles"],1)

    def test_undeclared_root_package_is_reported(self):
        with root_fixture() as root:
            save(root,"rogue/package.json",b'{"name":"rogue"}')
            result=checker.audit(root)
            self.assertFalse(result["completeNamespaceAccounted"])
            self.assertEqual(result["undeclaredPackageDirectories"],1)

    def test_undeclared_empty_root_package_is_reported(self):
        with root_fixture() as root:
            (root/"unused").mkdir()
            result=checker.audit(root)
            self.assertFalse(result["completeNamespaceAccounted"])
            self.assertEqual(result["undeclaredPackageDirectories"],1)

    def test_undeclared_nested_package_caught(self):
        with root_fixture() as root:
            save(root,"a/node_modules/rogue/index.js",b"export default 1")
            result=checker.audit(root)
            self.assertFalse(result["completeNamespaceAccounted"])
            self.assertEqual(result["undeclaredPackageDirectories"],1)

    def test_extra_scoped_package_detected(self):
        with root_fixture() as root:
            save(root,"@unknown/example/package.json",b'{"name":"@unknown/example"}')
            result=checker.audit(root)
            self.assertFalse(result["completeNamespaceAccounted"])
            self.assertEqual(result["undeclaredPackageDirectories"],1)

    def test_unexpected_bin_extension_refused(self):
        with root_fixture() as root:
            save(root,".bin/extra.exe",b"not allowed")
            result=checker.audit(root)
            self.assertTrue(reason(result,"launcher_extension_unqualified"))

    def test_bin_directory_nested_refused(self):
        with root_fixture() as root:
            (root/".bin"/"nested").mkdir(parents=True)
            result=checker.audit(root)
            self.assertTrue(reason(result,"bin_subdirectory_unqualified"))

    def test_unexpected_hidden_root_dir_refused(self):
        with root_fixture() as root:
            (root/".unknown").mkdir()
            result=checker.audit(root)
            self.assertTrue(reason(result,"unexpected_root_hidden_directory"))

    def test_launcher_count_cap(self):
        with root_fixture() as root:
            for n in range(3):
                save(root,f".bin/tool{n}.cmd",b"x")
            with mock.patch.object(checker,"MAX_LAUNCHERS",2):
                result=checker.audit(root)
            self.assertTrue(reason(result,"launcher_cap_hit"))

    def test_total_launcher_byte_cap(self):
        with root_fixture() as root:
            save(root,".bin/example.cmd",b"x"*12)
            with mock.patch.object(checker,"MAX_TOTAL_LAUNCHER_BYTES",6):
                result=checker.audit(root)
            self.assertTrue(reason(result,"total_launcher_bytes_cap_hit"))

    def test_single_launcher_byte_cap(self):
        with root_fixture() as root:
            save(root,".bin/example.cmd",b"x"*12)
            with mock.patch.object(checker,"MAX_LAUNCHER_BYTES",6):
                result=checker.audit(root)
            self.assertTrue(reason(result,"launcher_cap_hit"))

    def test_total_file_cap(self):
        with root_fixture() as root:
            with mock.patch.object(checker,"MAX_FILES",2):
                result=checker.audit(root)
            self.assertTrue(reason(result,"file_cap_hit"))

    def test_directory_count_cap(self):
        with root_fixture() as root:
            with mock.patch.object(checker,"MAX_DIRECTORIES",2):
                result=checker.audit(root)
            self.assertTrue(reason(result,"directory_cap_hit"))

    def test_synthetic_reparse_bin_file_rejected(self):
        with root_fixture() as root:
            p=save(root,".bin/example.cmd",b"one")
            normal_lstat=os.lstat
            def fake_lstat(path):
                info=normal_lstat(path)
                if Path(path)==p:
                    members={k:getattr(info,k,0) for k in ("st_mode","st_dev","st_ino","st_size","st_mtime_ns","st_ctime_ns")}
                    members["st_file_attributes"]=0x400
                    return SimpleNamespace(**members)
                return info
            with mock.patch.object(checker.os,"lstat",side_effect=fake_lstat):
                result=checker.audit(root)
            self.assertFalse(result["completeNamespaceAccounted"])
            self.assertTrue(reason(result,"file_not_plain_regular"))

    def test_missing_hidden_lock_does_not_qualify(self):
        with root_fixture() as root:
            (root/".package-lock.json").unlink()
            result=checker.audit(root)
            self.assertFalse(result["completeNamespaceAccounted"])
            self.assertTrue(reason(result,"prior_byte_inventory_unqualified"))

    def test_prior_byte_inventory_failure_propagated(self):
        with root_fixture() as root:
            lock_file=root.parent/"package-lock.json"
            data=json.loads(lock_file.read_text(encoding="utf-8"))
            data["packages"]["node_modules/a"]["version"]="999.0.0"
            lock_file.write_text(json.dumps(data),encoding="utf-8")
            result=checker.audit(root)
            self.assertTrue(reason(result,"prior_byte_inventory_unqualified"))
            self.assertIsNone(result["namespaceFingerprintSha256"])

    def test_namespace_observations_do_not_authorize_activation(self):
        with root_fixture() as root:
            r=checker.audit(root)
            for k in ("trustedCodeProvenanceEstablished",
                      "actualLoadedCommandGraphAttested",
                      "effectiveWindowsAclVerified",
                      "devActivationAuthorized"):
                self.assertFalse(r[k])

    def test_scoped_package_path_is_recognized(self):
        with root_fixture() as root:
            (root/"@vendor"/"some-package").mkdir(parents=True)
            found=checker.package_candidates_in_directory(root,root/"@vendor",["some-package"])
            self.assertEqual(found,["@vendor/some-package"])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(NamespaceTests)
    output=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({
        "schemaVersion":1,
        "suite":"offline-installed-namespace-and-bin-launchers",
        "tests":output.testsRun,
        "passed":output.testsRun-len(output.failures)-len(output.errors),
        "failed":len(output.failures)+len(output.errors),
        "temporaryFixturesOnly":True,
        "installedPackagesModified":False,
        "installedPackageExecuted":False,
        "devActivationAuthorized":False
    },separators=(",",":")))
    if not output.wasSuccessful():
        for test,trace in output.failures+output.errors:
            print(str(test)+": "+trace[-1000:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
