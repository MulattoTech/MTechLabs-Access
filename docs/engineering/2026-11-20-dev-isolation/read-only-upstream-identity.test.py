#!/usr/bin/env python3
"""Isolated synthetic package-identity regressions; no real upstream writes."""
from contextlib import contextmanager
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "mterm_access46_identity", HERE / "read-only-upstream-identity.py"
)
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)

def write_package(root, relative, name=None, deps=None, optional=None, version="1.2.3"):
    p = root / relative
    p.mkdir(parents=True, exist_ok=True)
    if name is None:
        chunks = Path(relative).parts
        name = chunks[-2] + "/" + chunks[-1] if len(chunks) > 1 and chunks[-2].startswith("@") else chunks[-1]
    obj = {"name": name, "version": version,
           "dependencies": deps or {}, "optionalDependencies": optional or {}}
    (p / "package.json").write_text(json.dumps(obj), encoding="utf-8")
    return p

def rewrite(root, relative, transform):
    p = root / relative / "package.json"
    obj = json.loads(p.read_text(encoding="utf-8"))
    transform(obj)
    p.write_text(json.dumps(obj), encoding="utf-8")

@contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix="mterm-identity-r31-") as path:
        root = Path(path) / "node_modules"
        start = write_package(root, "@wonderwhy-er/desktop-commander",
                              deps={"a":"^1", "b":"^1"},
                              optional={"absent-optional":"^1"})
        write_package(root, "a")
        write_package(root, "b")
        yield root, start

def has_reason(result, kind):
    return result["unqualifiedByKind"].get(kind, 0) > 0

class IdentityTests(unittest.TestCase):
    def test_valid_named_dependencies(self):
        with fixture() as (root, _):
            r = identity.audit(root)
            self.assertTrue(r["identityAuditPassed"])
            self.assertEqual(r["packageManifestsInspected"], 3)
            self.assertEqual(r["presentIdentityEdgesMatched"], 2)
            self.assertEqual(r["missingOptionalEdges"], 1)
            self.assertEqual(r["npmAliasIdentityEdgesMatched"], 0)

    def test_valid_npm_alias_has_explicit_target_identity(self):
        with fixture() as (root, _):
            rewrite(root, "@wonderwhy-er/desktop-commander",
                    lambda obj: obj["dependencies"].update({"a":"npm:actual-a@^1.0.0"}))
            rewrite(root, "a", lambda obj: obj.update({"name":"actual-a"}))
            r = identity.audit(root)
            self.assertTrue(r["identityAuditPassed"])
            self.assertEqual(r["npmAliasIdentityEdgesMatched"], 1)

    def test_valid_scoped_npm_alias(self):
        target, alias, reason = identity.expected_target_name(
            "short-name", "npm:@some-scope/real-name@^2.0.0"
        )
        self.assertEqual((target, alias, reason),
                         ("@some-scope/real-name", True, None))

    def test_unexpected_package_substitution_is_rejected(self):
        with fixture() as (root, _):
            rewrite(root, "a", lambda obj: obj.update({"name":"unrelated"}))
            r = identity.audit(root)
            self.assertFalse(r["identityAuditPassed"])
            self.assertTrue(has_reason(r, "resolved_package_identity_mismatch"))

    def test_wrong_real_name_inside_npm_alias_is_rejected(self):
        with fixture() as (root, _):
            rewrite(root, "@wonderwhy-er/desktop-commander",
                    lambda obj: obj["dependencies"].update({"a":"npm:expected-real@^1"}))
            rewrite(root, "a", lambda obj: obj.update({"name":"another-real"}))
            r = identity.audit(root)
            self.assertTrue(has_reason(r, "resolved_package_identity_mismatch"))

    def test_alias_without_version_is_unqualified(self):
        with fixture() as (root, _):
            rewrite(root, "@wonderwhy-er/desktop-commander",
                    lambda obj: obj["dependencies"].update({"a":"npm:real-a"}))
            r = identity.audit(root)
            self.assertTrue(has_reason(r, "invalid_npm_alias_spec"))

    def test_alias_with_unsafe_target_is_unqualified(self):
        with fixture() as (root, _):
            rewrite(root, "@wonderwhy-er/desktop-commander",
                    lambda obj: obj["dependencies"].update({"a":"npm:../outside@^1"}))
            r = identity.audit(root)
            self.assertTrue(has_reason(r, "invalid_npm_alias_target"))

    def test_nonstring_dependency_version_is_unqualified(self):
        with fixture() as (root, _):
            rewrite(root, "@wonderwhy-er/desktop-commander",
                    lambda obj: obj["dependencies"].update({"a":None}))
            r = identity.audit(root)
            self.assertTrue(has_reason(r, "invalid_dependency_spec"))

    def test_wrong_start_name_is_unqualified(self):
        with fixture() as (root, _):
            rewrite(root, "@wonderwhy-er/desktop-commander",
                    lambda obj: obj.update({"name":"unrelated-start"}))
            r = identity.audit(root)
            self.assertTrue(has_reason(r, "start_package_identity_mismatch"))

    def test_missing_version_is_unqualified(self):
        with fixture() as (root, _):
            rewrite(root, "a", lambda obj: obj.update({"version":""}))
            r = identity.audit(root)
            self.assertTrue(has_reason(r, "manifest_version_invalid"))

    def test_optional_installed_package_name_is_checked(self):
        with fixture() as (root, _):
            write_package(root, "absent-optional", name="not-optional")
            r = identity.audit(root)
            self.assertTrue(has_reason(r, "resolved_package_identity_mismatch"))

    def test_optional_alias_real_package_is_accepted(self):
        with fixture() as (root, _):
            write_package(root, "absent-optional", name="real-optional")
            rewrite(root, "@wonderwhy-er/desktop-commander",
                    lambda obj: obj["optionalDependencies"].update(
                        {"absent-optional":"npm:real-optional@latest"}))
            r = identity.audit(root)
            self.assertTrue(r["identityAuditPassed"])
            self.assertEqual(r["npmAliasIdentityEdgesMatched"], 1)

    def test_conflicting_declared_identities_for_same_package_fail(self):
        with fixture() as (root, _):
            rewrite(root, "@wonderwhy-er/desktop-commander",
                    lambda obj: obj["dependencies"].update({"a":"npm:actual-a@^1"}))
            rewrite(root, "a", lambda obj: obj.update({"name":"actual-a"}))
            rewrite(root, "b", lambda obj: obj["dependencies"].update({"a":"^1"}))
            r = identity.audit(root)
            self.assertTrue(has_reason(r, "resolved_package_identity_mismatch"))

    def test_missing_required_closure_is_not_identity_pass(self):
        with fixture() as (root, _):
            (root / "a" / "package.json").unlink()
            r = identity.audit(root)
            self.assertFalse(r["identityAuditPassed"])
            self.assertTrue(has_reason(r, "declared_closure_unqualified"))

    def test_repeated_audit_has_stable_fingerprint(self):
        with fixture() as (root, _):
            a = identity.audit(root)
            b = identity.audit(root)
            self.assertEqual(a["packageManifestFingerprintSha256"],
                             b["packageManifestFingerprintSha256"])

def main():
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(IdentityTests)
    output = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
    print(json.dumps({
        "schemaVersion":1, "suite":"synthetic-package-identity-and-npm-alias",
        "tests":output.testsRun,
        "passed":output.testsRun-len(output.failures)-len(output.errors),
        "failed":len(output.failures)+len(output.errors),
        "installedPackagesExecuted":False,
        "installedPackagesModified":False,
        "testScratchCleaned":True,
        "devActivationAuthorized":False
    }, separators=(",",":")))
    if not output.wasSuccessful():
        for test, trace in output.failures + output.errors:
            print(str(test) + ": " + trace[-600:])
        raise SystemExit(1)

if __name__ == "__main__":
    main()
