#!/usr/bin/env python3
"""R36 disposable bin declaration / launcher-template regression suite.

Fixture contains only synthetic package manifests, target files and command
shims under a TemporaryDirectory. No installed upstream command is executed.
"""
from contextlib import contextmanager
from importlib.machinery import SourceFileLoader
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
checker = SourceFileLoader(
    "access46_r36_checker", str(HERE / "read-only-upstream-bin-contract.py")
).load_module()
base_tests = SourceFileLoader(
    "access46_r36_fixture", str(HERE / "read-only-upstream-lock-structure.test.py")
).load_module()

def write_json(p, obj):
    p.write_text(json.dumps(obj), encoding="utf-8")

def manifest_with_bin(root, rel, entry):
    file = root / rel / "package.json"
    obj = json.loads(file.read_text(encoding="utf-8"))
    obj["bin"] = entry
    write_json(file, obj)

def payload_for(item, suffix, family):
    ref = "../" + item["pkg"] + "/" + item["target"]
    if suffix == "":
        prefix = "node " if family == "node" else ""
        return "#!/bin/sh\nexec " + prefix + '"$basedir/' + ref + '" "$@"\n'
    if suffix == ".cmd":
        prefix = "node " if family == "node" else ""
        return "@ECHO off\n" + prefix + '"%dp0%\\' + ref.replace("/", "\\") + '" %*\n'
    count = 4 if family == "node" else 2
    return "#!/usr/bin/env pwsh\n" + "".join(
        '& "$basedir/' + ref + '" $args\n' for _ in range(count)
    )

@contextmanager
def fixture():
    with base_tests.fixture() as root:
        items = [
            {"name":"run", "pkg":"@wonderwhy-er/desktop-commander",
             "target":"dist/main.js","family":"node"},
            {"name":"setup", "pkg":"@wonderwhy-er/desktop-commander",
             "target":"dist/setup.js","family":"direct"},
            {"name":"a", "pkg":"a", "target":"cli.js","family":"node"},
        ]
        manifest_with_bin(
            root,"@wonderwhy-er/desktop-commander",
            {"run":"dist/main.js","setup":"dist/setup.js"}
        )
        manifest_with_bin(root,"a","cli.js")
        pins = {ext:{} for ext in checker.SHIM_EXTENSIONS}
        for item in items:
            target = root / item["pkg"] / item["target"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("console.log('synthetic')\n",encoding="utf-8")
            shim_root = root / ".bin"
            shim_root.mkdir(exist_ok=True)
            for ext in checker.SHIM_EXTENSIONS:
                data = payload_for(item, ext, item["family"])
                (shim_root / (item["name"]+ext)).write_text(
                    data,encoding="utf-8"
                )
                canonical, _ = checker.normalized_shim(data,item["pkg"],item["target"])
                digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
                pin = pins[ext].get(item["family"])
                if pin is not None and pin != digest:
                    raise RuntimeError("fixture_inconsistent_template_family")
                pins[ext][item["family"]] = digest
        yield root, pins

def reason(r, kind):
    return r["unqualifiedByKind"].get(kind,0) > 0

class R36Tests(unittest.TestCase):
    def test_good_fixture_qualified(self):
        with fixture() as (root,pins):
            result = checker.audit(root,pins)
            self.assertTrue(result["binTargetContractsMatched"])
            self.assertEqual(result["declaredCommands"],3)
            self.assertEqual(result["shimFilesMatchingPinnedObservedTemplates"],9)
            self.assertEqual(result["nodeLauncherFamilies"],2)
            self.assertEqual(result["directScriptLauncherFamilies"],1)

    def test_repeat_identity_fingerprint_stable(self):
        with fixture() as (root,pins):
            a=checker.audit(root,pins)
            b=checker.audit(root,pins)
            self.assertEqual(a["binContractFingerprintSha256"],b["binContractFingerprintSha256"])
            self.assertTrue(b["binTargetContractsMatched"])

    def test_target_path_appears_exact_number_of_times(self):
        with fixture() as (root,pins):
            scripts=[("",1),(".cmd",1),(".ps1",4)]
            for ext,count in scripts:
                text=(root/".bin"/("run"+ext)).read_text(encoding="utf-8")
                _,observed=checker.normalized_shim(
                    text,"@wonderwhy-er/desktop-commander","dist/main.js")
                self.assertEqual(observed,count)

    def test_change_launcher_target_detected(self):
        with fixture() as (root,pins):
            p=root/".bin"/"run.cmd"
            data=p.read_text(encoding="utf-8").replace("main.js","another.js")
            p.write_text(data,encoding="utf-8")
            r=checker.audit(root,pins)
            self.assertFalse(r["binTargetContractsMatched"])
            self.assertTrue(reason(r,"shim_template_not_in_observed_families"))

    def test_append_unexpected_command_is_rejected(self):
        with fixture() as (root,pins):
            p=root/".bin"/"run.ps1"
            p.write_text(p.read_text(encoding="utf-8")+"\nWrite-Output injected\n",encoding="utf-8")
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"shim_template_not_in_observed_families"))

    def test_missing_bin_shim_refused(self):
        with fixture() as (root,pins):
            (root/".bin"/"run.cmd").unlink()
            r=checker.audit(root,pins)
            self.assertFalse(r["binTargetContractsMatched"])

    def test_extra_unknown_shim_refused(self):
        with fixture() as (root,pins):
            (root/".bin"/"unexpected.cmd").write_text("@echo OFF\n",encoding="utf-8")
            r=checker.audit(root,pins)
            self.assertFalse(r["binTargetContractsMatched"])

    def test_missing_target_file_refused(self):
        with fixture() as (root,pins):
            (root/"a"/"cli.js").unlink()
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"bin_target_path_missing"))

    def test_target_directory_instead_of_file_refused(self):
        with fixture() as (root,pins):
            p=root/"a"/"cli.js"
            p.unlink()
            p.mkdir()
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"bin_target_not_regular"))

    def test_absolute_target_rejected(self):
        for path in ("/etc/passwd","C:/Windows/system32/cmd.exe","../private.js",
                     "./../private.js","./a//b.js","a\\b.js"):
            with self.subTest(path=path):
                self.assertIsNone(checker.normalized_target(path))

    def test_ordinary_target_normalized(self):
        self.assertEqual(checker.normalized_target("./lib/cli.js"),"lib/cli.js")
        self.assertEqual(checker.normalized_target("cli.js"),"cli.js")

    def test_invalid_bin_declaration_path_rejected(self):
        with fixture() as (root,pins):
            manifest_with_bin(root,"a",{"a":"../outside.js"})
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"bin_target_invalid"))

    def test_invalid_bin_declaration_type_rejected(self):
        with fixture() as (root,pins):
            manifest_with_bin(root,"a",["cli.js"])
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"bin_declaration_invalid"))

    def test_duplicate_command_in_two_packages_refused(self):
        with fixture() as (root,pins):
            manifest_with_bin(root,"a",{"run":"cli.js"})
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"bin_name_collision"))

    def test_casefold_duplicate_command_refused(self):
        with fixture() as (root,pins):
            manifest_with_bin(root,"a",{"RUN":"cli.js"})
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"bin_name_collision"))

    def test_invalid_command_name_rejected(self):
        with fixture() as (root,pins):
            manifest_with_bin(root,"a",{"../../bad":"cli.js"})
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"bin_name_invalid"))

    def test_wrong_pin_refused_even_if_target_literal_matches(self):
        with fixture() as (root,pins):
            cloned={ext:dict(v) for ext,v in pins.items()}
            cloned[".cmd"]["node"]="0"*64
            r=checker.audit(root,cloned)
            self.assertTrue(reason(r,"shim_template_not_in_observed_families"))

    def test_family_variant_inconsistent_across_extensions(self):
        with fixture() as (root,pins):
            # A direct-form .cmd wrapper still points to the right declared
            # target, but contradicts the shell/PowerShell node family.
            p=root/".bin"/"run.cmd"
            entry={"pkg":"@wonderwhy-er/desktop-commander","target":"dist/main.js"}
            p.write_text(payload_for(entry,".cmd","direct"),encoding="utf-8")
            r=checker.audit(root,pins)
            self.assertTrue(reason(r,"shim_launcher_family_inconsistent"))

    def test_target_content_drift_reflected_in_predecessor_fingerprint(self):
        with fixture() as (root,pins):
            a=checker.audit(root,pins)
            p=root/"a"/"cli.js"
            p.write_text("console.log('changed')\n",encoding="utf-8")
            b=checker.audit(root,pins)
            self.assertTrue(a["binTargetContractsMatched"])
            self.assertTrue(b["binTargetContractsMatched"])
            self.assertNotEqual(a["binContractFingerprintSha256"],b["binContractFingerprintSha256"])

    def test_no_activation_or_trusted_origin_claim(self):
        with fixture() as (root,pins):
            r=checker.audit(root,pins)
            self.assertTrue(r["binTargetContractsMatched"])
            for field in ("baselineTemplatesFromTrustedPublisher","realLauncherBehaviorAttested",
                          "trustedCodeProvenanceVerified","effectiveWindowsAclVerified",
                          "devActivationAuthorized"):
                self.assertFalse(r[field])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(R36Tests)
    report=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({
        "schemaVersion":1,"suite":"offline-declared-bin-target-and-launcher-template",
        "tests":report.testsRun,
        "passed":report.testsRun-len(report.failures)-len(report.errors),
        "failed":len(report.failures)+len(report.errors),
        "syntheticTempFilesOnly":True,"productionPackagesModified":False,
        "installedCodeExecuted":False,"devActivationAuthorized":False,
    },separators=(",",":")))
    if not report.wasSuccessful():
        for test,trace in report.failures+report.errors:
            print(str(test)+": "+trace[-1000:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
