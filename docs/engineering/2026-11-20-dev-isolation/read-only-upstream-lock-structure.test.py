#!/usr/bin/env python3
"""Access #46 R33: disposable tests for complete npm lockfile metadata structure."""
import base64
from contextlib import contextmanager
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

checker = load("access46_r33_struct", "read-only-upstream-lock-structure.py")
old = load("access46_r33_old_tests", "read-only-upstream-lock.test.py")
GOOD_SRI = "sha512-" + base64.b64encode(bytes([23])*64).decode("ascii")

def write_json(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")

def edit_lock(root, role, mutate):
    p = root.parent / "package-lock.json" if role == "project" else root / ".package-lock.json"
    x = json.loads(p.read_text(encoding="utf-8"))
    mutate(x)
    write_json(p, x)

def both(root, fn):
    for role in ("project", "installed"):
        edit_lock(root, role, fn)

def failing(result, kind):
    return result["unqualifiedByKind"].get(kind,0)>0

def optional_record():
    return {
        "version":"4.0.0", "integrity":GOOD_SRI,
        "resolved":"https://example.invalid/pkg.tgz","optional":True,
    }

@contextmanager
def fixture():
    with old.fixture() as root:
        # The older R32 fixture intentionally uses placeholder integrity text;
        # replace it with correct SRI while keeping production entirely untouched.
        for role in ("project", "installed"):
            edit_lock(root, role, lambda x: [
                x["packages"][k].update(
                    {"integrity":GOOD_SRI,"resolved":"https://example.invalid/download.tgz"}
                )
                for k in (old.KEYS[0],old.KEYS[1])
            ])
        # Add the root package.json and a project-only optional platform archive.
        write_json(root.parent / "package.json",{
            "name":"test-root","version":"1.0.0",
            "dependencies":{"@wonderwhy-er/desktop-commander":"1.2.3"},
        })
        edit_lock(root,"project",lambda x: x.update({"name":"test-root","version":"1.0.0"}))
        edit_lock(root,"project",lambda x: x["packages"][""].update({
            "name":"test-root","version":"1.0.0",
            "dependencies":{"@wonderwhy-er/desktop-commander":"1.2.3"},
        }))
        edit_lock(root,"project",lambda x: x["packages"].update({
            "node_modules/optional-os":optional_record(),
        }))
        yield root

class R33Tests(unittest.TestCase):
    def test_complete_control(self):
        with fixture() as root:
            r=checker.audit(root)
            self.assertTrue(r["lockStructureQualified"])
            self.assertEqual(r["projectLockEntryCount"],5)
            self.assertEqual(r["installedLockEntryCount"],3)
            self.assertEqual(r["projectOnlyOptionalEntryCount"],1)
            self.assertEqual(r["recordsWithValidSRIFormat"],5)
            self.assertEqual(r["bundledEntriesWithoutArchiveIntegrity"],2)

    def test_scope_package_path_valid(self):
        self.assertIsNone(checker.validate_key("node_modules/@scope/alpha/node_modules/beta"))
        self.assertIsNone(checker.validate_key("node_modules/string-width-cjs"))

    def test_parent_traversal_key_rejected(self):
        self.assertIsNotNone(checker.validate_key("node_modules/../outside"))

    def test_absolute_drive_key_rejected(self):
        self.assertIsNotNone(checker.validate_key("C:/node_modules/x"))

    def test_backslash_key_rejected(self):
        self.assertIsNotNone(checker.validate_key("node_modules\\a"))

    def test_double_slash_and_incomplete_package_rejected(self):
        self.assertIsNotNone(checker.validate_key("node_modules//bad"))
        self.assertIsNotNone(checker.validate_key("node_modules/@scope"))

    def test_scoped_key_without_package_rejected(self):
        self.assertIsNotNone(checker.validate_key("node_modules/@scope/node_modules"))

    def test_valid_sha256(self):
        value="sha256-"+base64.b64encode(b"x"*32).decode("ascii")
        self.assertIsNone(checker.validate_integrity(value))

    def test_valid_sha512(self):
        self.assertIsNone(checker.validate_integrity(GOOD_SRI))

    def test_sha1_is_not_qualified_as_modern_integrity(self):
        self.assertIsNotNone(checker.validate_integrity("sha1-"+base64.b64encode(b"x"*20).decode()))

    def test_base64_garbage_rejected(self):
        self.assertIsNotNone(checker.validate_integrity("sha512-++not-base64!"))

    def test_incorrect_digest_length_rejected(self):
        self.assertEqual(checker.validate_integrity("sha512-"+base64.b64encode(b"x"*32).decode()),
                         "integrity_digest_length_mismatch")

    def test_unpadded_base64_not_silently_accepted(self):
        self.assertIsNotNone(checker.validate_integrity(GOOD_SRI.rstrip("=")))

    def test_multiple_integrity_tokens_rejected(self):
        self.assertIsNotNone(checker.validate_integrity(GOOD_SRI+" "+GOOD_SRI))

    def test_https_url_valid(self):
        self.assertIsNone(checker.validate_resolved("https://example.invalid/download.tgz"))

    def test_http_url_rejected(self):
        self.assertIsNotNone(checker.validate_resolved("http://example.invalid/pkg.tgz"))

    def test_embedded_url_credentials_rejected(self):
        self.assertIsNotNone(checker.validate_resolved("https://user:pass@example.invalid/pkg.tgz"))

    def test_url_fragment_rejected(self):
        self.assertIsNotNone(checker.validate_resolved("https://example.invalid/pkg.tgz#private"))

    def test_unqualified_project_only_optional_flag(self):
        with fixture() as root:
            edit_lock(root,"project",lambda x:x["packages"]["node_modules/optional-os"].update({"optional":False}))
            self.assertTrue(failing(checker.audit(root),"project_only_entry_not_optional"))

    def test_project_only_invalid_archive_integrity(self):
        with fixture() as root:
            edit_lock(root,"project",lambda x:x["packages"]["node_modules/optional-os"].update({"integrity":"sha512-FAKE"}))
            self.assertTrue(failing(checker.audit(root),"project_integrity_digest_length_mismatch"))

    def test_project_only_parent_escape_detected(self):
        with fixture() as root:
            edit_lock(root,"project",lambda x:x["packages"].update({
                "node_modules/../outside":optional_record()
            }))
            self.assertTrue(failing(checker.audit(root),"project_invalid_package_name"))

    def test_project_only_insecure_http_detected(self):
        with fixture() as root:
            edit_lock(root,"project",lambda x:x["packages"]["node_modules/optional-os"].update({
                "resolved":"http://example.invalid/pkg.tgz"
            }))
            self.assertTrue(failing(checker.audit(root),"project_resolved_not_qualified_https"))

    def test_project_only_duplicate_json_keys_rejected(self):
        with fixture() as root:
            p = root.parent / "package-lock.json"
            s=p.read_text(encoding="utf-8")
            s=s.replace('"lockfileVersion": 3', '"lockfileVersion": 3, "lockfileVersion": 3',1)
            p.write_text(s,encoding="utf-8")
            self.assertTrue(failing(checker.audit(root),"project_lock_unreadable_or_invalid"))

    def test_project_only_casefold_path_collision(self):
        with fixture() as root:
            edit_lock(root,"project",lambda x:x["packages"].update({
                "node_modules/OPTIONAL-OS":optional_record()
            }))
            self.assertTrue(failing(checker.audit(root),"project_casefold_collision"))

    def test_unexpected_installed_package_not_in_project(self):
        with fixture() as root:
            edit_lock(root,"installed",lambda x:x["packages"].update({
                "node_modules/extra-surprise":optional_record()
            }))
            self.assertTrue(failing(checker.audit(root),"installed_entries_not_in_project_lock"))

    def test_project_root_name_substitution_rejected(self):
        with fixture() as root:
            edit_lock(root,"project",lambda x:x["packages"][""].update({"name":"another-project"}))
            self.assertTrue(failing(checker.audit(root),"project_root_identity_unqualified"))

    def test_project_root_dependencies_drift_rejected(self):
        with fixture() as root:
            edit_lock(root,"project",lambda x:x["packages"][""].update({"dependencies":{"wrong":"1.0"}}))
            self.assertTrue(failing(checker.audit(root),"project_root_dependency_declarations_changed"))

    def test_installed_noncanonical_key_rejected(self):
        with fixture() as root:
            edit_lock(root,"installed",lambda x:x["packages"].update({
                "node_modules\\evil":optional_record()
            }))
            self.assertTrue(failing(checker.audit(root),"installed_entries_not_in_project_lock"))

    def test_missing_bundled_integrity_allowed_only_with_true_flag(self):
        with fixture() as root:
            for role in ("project","installed"):
                edit_lock(root,role,lambda x:x["packages"][old.KEYS[2]].update({"inBundle":False}))
            self.assertTrue(failing(checker.audit(root),"project_integrity_missing_or_invalid_type"))

    def test_no_network_and_repeat_consistency(self):
        with fixture() as root:
            a,b=checker.audit(root),checker.audit(root)
            self.assertTrue(a["lockStructureQualified"])
            self.assertEqual(a["projectLockSha256"],b["projectLockSha256"])
            self.assertEqual(a["rootManifestSha256"],b["rootManifestSha256"])
            self.assertFalse(a["archiveBytesVerified"])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(R33Tests)
    report=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({
        "schemaVersion":1,"suite":"offline-full-lockfile-namespace-and-sri",
        "cases":report.testsRun,"passed":report.testsRun-len(report.failures)-len(report.errors),
        "failed":len(report.failures)+len(report.errors),
        "onlyTemporaryFixtureFilesModified":True,
        "installedPackagesExecuted":False,"devActivationAuthorized":False,
    },separators=(",",":")))
    if not report.wasSuccessful():
        for case, trace in report.failures+report.errors:
            print(str(case)+": "+trace[-800:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
