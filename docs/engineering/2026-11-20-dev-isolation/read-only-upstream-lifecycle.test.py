#!/usr/bin/env python3
"""Access #46 R37 isolated npm lifecycle metadata regression cases.

Everything modified is a disposable TemporaryDirectory fixture, never
production packages or configuration. No script or npm command is executed.
"""
from contextlib import contextmanager
from importlib.machinery import SourceFileLoader
import io
import json
from pathlib import Path
import unittest

HERE=Path(__file__).parent
r37=SourceFileLoader("access46_r37",str(HERE/"read-only-upstream-lifecycle.py")).load_module()
fixtures=SourceFileLoader("access46_r37_fixtures",
                          str(HERE/"read-only-upstream-lock-structure.test.py")).load_module()

def put(path,obj):
    path.write_text(json.dumps(obj),encoding="utf-8")

def modify_package(root,rel,fn):
    file=root/rel/"package.json"
    obj=json.loads(file.read_text(encoding="utf-8"))
    fn(obj)
    put(file,obj)

def modify_both_locks(root,rel,fn):
    key="node_modules/"+rel
    for path in (root.parent/"package-lock.json",root/".package-lock.json"):
        data=json.loads(path.read_text(encoding="utf-8"))
        fn(data["packages"][key])
        put(path,data)

@contextmanager
def fixture():
    with fixtures.fixture() as root:
        yield root

def has(out, reason):
    return out["unqualifiedByKind"].get(reason,0)>0

class LifecycleTests(unittest.TestCase):
    def test_no_hooks_is_valid(self):
        with fixture() as root:
            r=r37.audit(root)
            self.assertTrue(r["qualifiedMetadataInventory"])
            self.assertEqual(r["packageManifestsExamined"],3)
            self.assertEqual(r["packagesWithDirectInstallHooks"],0)
            self.assertEqual(r["lockInstallScriptFlagCount"],0)
            self.assertFalse(r["installationApproved"])

    def test_valid_postinstall_with_lock_flags(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"postinstall":"node setup.js"}}))
            modify_both_locks(root,"a",lambda o:o.update({"hasInstallScript":True}))
            r=r37.audit(root)
            self.assertTrue(r["qualifiedMetadataInventory"])
            self.assertEqual(r["packagesWithDirectInstallHooks"],1)
            self.assertEqual(r["hookCounts"]["postinstall"],1)
            self.assertEqual(r["lockInstallScriptFlagCount"],1)
            self.assertEqual(len(r["directInstallHookSample"]),1)
            self.assertNotIn("node setup.js",json.dumps(r))

    def test_valid_preinstall_plus_install(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"preinstall":"node pre.js","install":"node install.js"}}))
            modify_both_locks(root,"a",lambda o:o.update({"hasInstallScript":True}))
            r=r37.audit(root)
            self.assertTrue(r["qualifiedMetadataInventory"])
            self.assertEqual(r["hookCounts"]["preinstall"],1)
            self.assertEqual(r["hookCounts"]["install"],1)

    def test_prepare_not_misreported_as_direct_install(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"prepare":"npm run build"}}))
            r=r37.audit(root)
            self.assertTrue(r["qualifiedMetadataInventory"])
            self.assertEqual(r["packagesWithConditionalPrepare"],1)
            self.assertEqual(r["packagesWithDirectInstallHooks"],0)

    def test_pack_hooks_separate_from_install(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"prepack":"node pack.js","prepublishOnly":"node publish.js"}}))
            r=r37.audit(root)
            self.assertTrue(r["qualifiedMetadataInventory"])
            self.assertEqual(r["packagesWithOtherNpmLifecycleHooks"],1)
            self.assertEqual(r["packagesWithDirectInstallHooks"],0)

    def test_invalid_scripts_type_rejected(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":["node x.js"]}))
            self.assertTrue(has(r37.audit(root),"scripts_map_invalid"))

    def test_invalid_script_body_type_rejected(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"postinstall":42}}))
            self.assertTrue(has(r37.audit(root),"script_key_or_value_invalid"))

    def test_empty_script_text_rejected(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"postinstall":""}}))
            self.assertTrue(has(r37.audit(root),"script_key_or_value_invalid"))

    def test_large_script_text_rejected(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"postinstall":"x"*(r37.MAX_SCRIPT_CHARS+1)}}))
            self.assertTrue(has(r37.audit(root),"script_key_or_value_invalid"))

    def test_too_many_script_entries_rejected(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{str(i):"ok" for i in range(r37.MAX_SCRIPTS+1)}}))
            self.assertTrue(has(r37.audit(root),"scripts_map_invalid"))

    def test_missing_lock_flag_for_real_install_rejected(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"postinstall":"node x.js"}}))
            self.assertTrue(has(r37.audit(root),"direct_install_hook_missing_lock_flag"))

    def test_explicit_false_install_flag_refuses_hook(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"postinstall":"node x.js"}}))
            modify_both_locks(root,"a",lambda o:o.update({"hasInstallScript":False}))
            self.assertTrue(has(r37.audit(root),"direct_install_hook_missing_lock_flag"))

    def test_unexplained_lock_install_true_rejected(self):
        with fixture() as root:
            modify_both_locks(root,"a",lambda o:o.update({"hasInstallScript":True}))
            self.assertTrue(has(r37.audit(root),"unexplained_install_script_lock_flag"))

    def test_nonboolean_install_flag_rejected(self):
        with fixture() as root:
            modify_both_locks(root,"a",lambda o:o.update({"hasInstallScript":"true"}))
            self.assertTrue(has(r37.audit(root),"lock_install_flag_invalid"))

    def test_conflicting_lock_flag_refuses_previous_gate(self):
        with fixture() as root:
            file=root.parent/"package-lock.json"
            obj=json.loads(file.read_text(encoding="utf-8"))
            obj["packages"]["node_modules/a"]["hasInstallScript"]=True
            put(file,obj)
            self.assertTrue(has(r37.audit(root),"prior_namespace_unqualified"))

    def test_binding_gyp_inferred_install_with_lock(self):
        with fixture() as root:
            (root/"a"/"binding.gyp").write_text("{}",encoding="utf-8")
            modify_both_locks(root,"a",lambda o:o.update({"hasInstallScript":True}))
            r=r37.audit(root)
            self.assertTrue(r["qualifiedMetadataInventory"])
            self.assertEqual(r["bindingGypPackageCount"],1)
            self.assertEqual(r["lockInstallScriptFlagCount"],1)

    def test_binding_gyp_without_lock_marker_refused(self):
        with fixture() as root:
            (root/"a"/"binding.gyp").write_text("{}",encoding="utf-8")
            self.assertTrue(has(r37.audit(root),"implicit_native_install_unverified"))

    def test_binding_gyp_directory_substitution_refused(self):
        with fixture() as root:
            (root/"a"/"binding.gyp").mkdir()
            self.assertTrue(has(r37.audit(root),"binding_file_unqualified"))

    def test_script_edit_changes_fingerprint(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"prepare":"npm run a"}}))
            a=r37.audit(root)
            modify_package(root,"a",lambda o:o.update({"scripts":{"prepare":"npm run b"}}))
            b=r37.audit(root)
            self.assertTrue(a["qualifiedMetadataInventory"])
            self.assertTrue(b["qualifiedMetadataInventory"])
            self.assertNotEqual(a["metadataFingerprintSha256"],b["metadataFingerprintSha256"])

    def test_same_source_fingerprint_stable(self):
        with fixture() as root:
            a=r37.audit(root);b=r37.audit(root)
            self.assertTrue(a["qualifiedMetadataInventory"])
            self.assertEqual(a["metadataFingerprintSha256"],b["metadataFingerprintSha256"])

    def test_root_package_modification_blocks_prior_check(self):
        with fixture() as root:
            (root/"a"/"package.json").unlink()
            self.assertTrue(has(r37.audit(root),"prior_namespace_unqualified"))

    def test_unknown_custom_script_not_conflated_with_install(self):
        with fixture() as root:
            modify_package(root,"a",lambda o:o.update({"scripts":{"build":"node build.js","test":"node test.js"}}))
            r=r37.audit(root)
            self.assertTrue(r["qualifiedMetadataInventory"])
            self.assertEqual(r["otherNonLifecycleScripts"],2)
            self.assertEqual(r["packagesWithDirectInstallHooks"],0)

    def test_installer_never_authorized(self):
        with fixture() as root:
            r=r37.audit(root)
            for key in ("scriptsExecuted","installationApproved",
                        "trustedPublisherProvenance","realNpmInstallRuntimeVerified",
                        "devActivationAuthorized"):
                self.assertFalse(r[key])

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(LifecycleTests)
    r=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0).run(suite)
    print(json.dumps({
        "schemaVersion":1,"suite":"offline-installed-npm-lifecycle-hook-qualification",
        "tests":r.testsRun,"passed":r.testsRun-len(r.failures)-len(r.errors),
        "failed":len(r.failures)+len(r.errors),
        "disposableFixturesOnly":True,"installedScriptsExecuted":False,
        "productionModified":False,"devActivationAuthorized":False
    },separators=(",",":")))
    if not r.wasSuccessful():
        for case,tb in r.failures+r.errors:
            print(str(case)+": "+tb[-900:])
        raise SystemExit(1)

if __name__=="__main__":
    main()
