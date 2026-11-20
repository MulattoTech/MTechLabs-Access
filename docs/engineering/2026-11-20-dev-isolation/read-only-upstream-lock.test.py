#!/usr/bin/env python3
"""Offline disposable R32 npm lock consistency tests; never modify production."""
from contextlib import contextmanager
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "access46_r32_lock", HERE / "read-only-upstream-lock.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)

KEYS = [
    "node_modules/@wonderwhy-er/desktop-commander",
    "node_modules/a",
    "node_modules/b",
]
TOP = "package-lock.json"
HIDDEN = "node_modules/.package-lock.json"

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")

def entries():
    return {
        KEYS[0]: {"version":"1.2.3","resolved":"https://example.invalid/start.tgz","integrity":"sha512-START"},
        KEYS[1]: {"version":"1.0.1","resolved":"https://example.invalid/a.tgz","integrity":"sha512-A"},
        KEYS[2]: {"version":"1.0.0","inBundle":True},
    }

@contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix="mterm-r32-lock-") as temp:
        project = Path(temp)
        nm = project / "node_modules"
        for rel, name, version, deps, optional in [
            ("@wonderwhy-er/desktop-commander","@wonderwhy-er/desktop-commander",
             "1.2.3",{"a":"^1","b":"^1"},{"optional-os":"*"}),
            ("a","a","1.0.1",{},{}),
            ("b","b","1.0.0",{},{}),
        ]:
            write_json(nm / rel / "package.json", {
                "name":name, "version":version,
                "dependencies":deps, "optionalDependencies":optional
            })
        pkg = entries()
        write_json(project / TOP, {"lockfileVersion":3,"packages":{"":{"name":"test-root"},**copy.deepcopy(pkg)}})
        write_json(project / HIDDEN, {"lockfileVersion":3,"packages":copy.deepcopy(pkg)})
        yield nm

def edit(nm, which, fn):
    p = nm.parent / (TOP if which == "top" else HIDDEN)
    obj = json.loads(p.read_text(encoding="utf-8"))
    fn(obj)
    write_json(p, obj)

def reason(r, name):
    return r["unqualifiedByKind"].get(name,0)>0

class LockTests(unittest.TestCase):
    def test_control_matches_both_locks_and_installed_versions(self):
        with fixture() as nm:
            r=checker.audit(nm)
            self.assertTrue(r["lockConsistencyPassed"])
            self.assertEqual(r["installedManifestRoots"],3)
            self.assertEqual(r["dependencyRecordsCompared"],3)
            self.assertEqual(r["identicalLockAndVersionRecords"],3)
            self.assertEqual(r["recordsWithIntegrityMetadata"],2)
            self.assertEqual(r["bundledRecordsWithoutArchiveIntegrity"],1)

    def test_altered_installed_lock_version_detected(self):
        with fixture() as nm:
            edit(nm,"hidden",lambda x:x["packages"][KEYS[1]].update({"version":"9.9.9"}))
            self.assertTrue(reason(checker.audit(nm),"lock_entry_conflict"))

    def test_altered_project_lock_integrity_detected(self):
        with fixture() as nm:
            edit(nm,"top",lambda x:x["packages"][KEYS[1]].update({"integrity":"sha512-CORRUPT"}))
            self.assertTrue(reason(checker.audit(nm),"lock_entry_conflict"))

    def test_shared_wrong_version_detected_against_manifest(self):
        with fixture() as nm:
            for which in ("top","hidden"):
                edit(nm,which,lambda x:x["packages"][KEYS[1]].update({"version":"9.9.9"}))
            self.assertTrue(reason(checker.audit(nm),"lock_installed_version_conflict"))

    def test_missing_project_entry_detected(self):
        with fixture() as nm:
            edit(nm,"top",lambda x:x["packages"].pop(KEYS[1]))
            self.assertTrue(reason(checker.audit(nm),"lock_entry_missing"))

    def test_missing_installed_entry_detected(self):
        with fixture() as nm:
            edit(nm,"hidden",lambda x:x["packages"].pop(KEYS[0]))
            self.assertTrue(reason(checker.audit(nm),"lock_entry_missing"))

    def test_missing_integrity_unbundled_is_rejected(self):
        with fixture() as nm:
            for which in ("top","hidden"):
                edit(nm,which,lambda x:x["packages"][KEYS[1]].pop("integrity"))
            self.assertTrue(reason(checker.audit(nm),"integrity_unqualified"))

    def test_missing_integrity_with_string_bundle_is_rejected(self):
        with fixture() as nm:
            for which in ("top","hidden"):
                edit(nm,which,lambda x:x["packages"][KEYS[1]].update({"inBundle":"true","integrity":None}))
            self.assertTrue(reason(checker.audit(nm),"integrity_unqualified"))

    def test_bundled_no_integrity_is_recorded_not_hidden(self):
        with fixture() as nm:
            r=checker.audit(nm)
            self.assertEqual(r["bundledRecordsWithoutArchiveIntegrity"],1)

    def test_old_project_lock_version_rejected(self):
        with fixture() as nm:
            edit(nm,"top",lambda x:x.update({"lockfileVersion":2}))
            self.assertTrue(reason(checker.audit(nm),"project_lockfile_v3_required"))

    def test_wrong_hidden_lock_version_rejected(self):
        with fixture() as nm:
            edit(nm,"hidden",lambda x:x.update({"lockfileVersion":4}))
            self.assertTrue(reason(checker.audit(nm),"installed_lockfile_v3_required"))

    def test_package_map_as_list_rejected(self):
        with fixture() as nm:
            edit(nm,"top",lambda x:x.update({"packages":[]}))
            self.assertTrue(reason(checker.audit(nm),"project_lock_package_map_unqualified"))

    def test_project_root_metadata_missing_rejected(self):
        with fixture() as nm:
            edit(nm,"top",lambda x:x["packages"].pop(""))
            self.assertTrue(reason(checker.audit(nm),"project_root_lock_entry_absent"))

    def test_unparseable_hidden_json_rejected(self):
        with fixture() as nm:
            (nm/".package-lock.json").write_text("{bad-json",encoding="utf-8")
            self.assertTrue(reason(checker.audit(nm),"installed_lock_unreadable_or_invalid"))

    def test_oversized_project_lock_rejected_before_parse(self):
        with fixture() as nm:
            p=nm.parent/TOP
            p.write_bytes(b"x"*(checker.MAX_LOCKFILE_BYTES+1))
            self.assertTrue(reason(checker.audit(nm),"project_lock_file_oversized"))

    def test_untrusted_manifest_name_is_rejected_by_prior_gate(self):
        with fixture() as nm:
            p=nm/"a"/"package.json"
            obj=json.loads(p.read_text());obj["name"]="substituted"
            write_json(p,obj)
            self.assertTrue(reason(checker.audit(nm),"prior_identity_audit_unqualified"))

    def test_missing_both_locks_does_not_return_success(self):
        with fixture() as nm:
            (nm.parent/TOP).unlink()
            (nm/".package-lock.json").unlink()
            r=checker.audit(nm)
            self.assertFalse(r["lockConsistencyPassed"])
            self.assertTrue(reason(r,"project_lock_unreadable_or_invalid"))
            self.assertTrue(reason(r,"installed_lock_unreadable_or_invalid"))

    def test_digests_and_success_stable_on_repeat(self):
        with fixture() as nm:
            a=checker.audit(nm)
            b=checker.audit(nm)
            self.assertEqual(a["projectLockSha256"],b["projectLockSha256"])
            self.assertEqual(a["installedLockSha256"],b["installedLockSha256"])
            self.assertTrue(b["lockConsistencyPassed"])

def main():
    tests = unittest.defaultTestLoader.loadTestsFromTestCase(LockTests)
    output = unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(tests)
    print(json.dumps({
      "schemaVersion":1,"suite":"offline-npm-two-lock-consistency",
      "tests":output.testsRun,
      "passed":output.testsRun-len(output.failures)-len(output.errors),
      "failed":len(output.failures)+len(output.errors),
      "installedPackagesExecuted":False,
      "installedPackagesModified":False,
      "testScratchCleaned":True,
      "devActivationAuthorized":False,
    },separators=(",",":")))
    if not output.wasSuccessful():
        for case, trace in output.errors+output.failures:
            print(str(case)+": "+trace[-1000:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
