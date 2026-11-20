#!/usr/bin/env python3
"""R37: read-only installed npm lifecycle-hook inventory.

Matches package install hooks and binding.gyp against npm lock hasInstallScript
metadata. Never installs, imports or executes installed packages, contacts the
network, reads credentials or modifies live files. A qualified inventory does
NOT authorize executing hooks, accepting DEV, or trusting the writable H: tree.
"""
from collections import Counter
import hashlib
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).parent
ns = SourceFileLoader("access46_r37_namespace",
                      str(HERE / "read-only-upstream-namespace.py")).load_module()
scan = ns.scan
ROOT = ns.ROOT
DIRECT = ("preinstall", "install", "postinstall")
CONDITIONAL = ("prepare",)
OTHER = ("prepublish","prepublishOnly","prepack","postpack","postpublish","dependencies")
MAX_SCRIPTS = 256
MAX_SCRIPT_CHARS = 8192
MAX_ERRORS = 12

def scripts_from_manifest(manifest):
    scripts = manifest.get("scripts")
    if scripts is None:
        return {}, None
    if not isinstance(scripts, dict) or len(scripts) > MAX_SCRIPTS:
        return {}, "scripts_map_invalid"
    for key, value in scripts.items():
        if (not isinstance(key, str) or not key or len(key) > 256
                or not isinstance(value, str) or not value
                or len(value) > MAX_SCRIPT_CHARS):
            return {}, "script_key_or_value_invalid"
    return scripts, None

def package_scripts(root, relative):
    package = root / Path(relative)
    info, sha, err = scan.manifest(root, package)
    if err:
        return None, None, "manifest_" + str(err)
    scripts, err = scripts_from_manifest(info)
    if err:
        return None, None, err
    native = package / "binding.gyp"
    try:
        st = os.lstat(native)
    except FileNotFoundError:
        binding = False
    except OSError:
        return None, None, "binding_file_unreadable"
    else:
        if not stat.S_ISREG(st.st_mode) or scan.has_reparse_or_link(st):
            return None, None, "binding_file_unqualified"
        binding = True
    return (info.get("version"), scripts, binding), sha, None

def audit(root=ROOT):
    errors = []
    try:
        prior = ns.audit(root)
        if not prior["completeNamespaceAccounted"]:
            errors.append("prior_namespace_unqualified")
        closure = scan.inventory(root, root / scan.START_NAME)
        if (closure["capsHit"] or closure["queueUnfinished"]
                or closure["requiredOrMetadataUnqualifiedCount"]):
            errors.append("declared_closure_unqualified")
        load_lock = ns.previous.lock.prior.load_lock
        project, _, perr = load_lock(root.parent / "package-lock.json")
        installed, _, ierr = load_lock(root / ".package-lock.json")
        if perr or ierr:
            errors.append("npm_lockfiles_unqualified")
        roots = closure["relativePackageRoots"] if not errors else []
    except (OSError, ValueError, TypeError):
        errors.append("prior_source_unavailable")
        roots = []
        prior = {}
        project = installed = {}
    counts = Counter()
    installed_with_hooks = prepare_packages = other_packages = 0
    installed_flagged = binding_count = other_script_entries = 0
    examined = 0
    sample = []
    fingerprints = []
    for rel in roots:
        data, manifest_sha, err = package_scripts(root, rel)
        if err:
            errors.append(err)
            continue
        version, scripts, binding = data
        if not isinstance(version, str) or not version:
            errors.append("package_version_unqualified")
            continue
        key = "node_modules/" + Path(rel).as_posix()
        a, b = project.get(key), installed.get(key)
        if not isinstance(a, dict) or not isinstance(b, dict):
            errors.append("lock_package_missing")
            continue
        f1, f2 = a.get("hasInstallScript"), b.get("hasInstallScript")
        if any(v is not None and type(v) is not bool for v in (f1, f2)):
            errors.append("lock_install_flag_invalid")
            continue
        if f1 != f2:
            errors.append("lock_install_flags_disagree")
            continue
        active = sorted(set(scripts).intersection(DIRECT))
        prep = sorted(set(scripts).intersection(CONDITIONAL))
        other = sorted(set(scripts).intersection(OTHER))
        if active: installed_with_hooks += 1
        if prep: prepare_packages += 1
        if other: other_packages += 1
        for k in active + prep + other: counts[k] += 1
        other_script_entries += len(set(scripts).difference(DIRECT + CONDITIONAL + OTHER))
        if binding: binding_count += 1
        if f1 is True: installed_flagged += 1
        if active and f1 is not True:
            errors.append("direct_install_hook_missing_lock_flag")
        elif f1 is True and not active and not binding:
            errors.append("unexplained_install_script_lock_flag")
        elif binding and not active and f1 is not True:
            errors.append("implicit_native_install_unverified")
        if active and len(sample) < MAX_ERRORS:
            sample.append({
                "publicPackagePath":Path(rel).as_posix(),
                "hookNames":active,
                "commandSha256":{
                    k:hashlib.sha256(scripts[k].encode("utf-8")).hexdigest()
                    for k in active
                }
            })
        fingerprints.append(json.dumps([
            Path(rel).as_posix(), version, manifest_sha, binding, f1,
            [[name, hashlib.sha256(scripts[name].encode()).hexdigest()]
             for name in sorted(set(scripts).intersection(DIRECT + CONDITIONAL + OTHER))]
        ],separators=(",",":"),ensure_ascii=True))
        examined += 1
    if not errors and examined != len(roots):
        errors.append("package_count_unqualified")
    digest = None if errors else hashlib.sha256(
        ("\n".join(sorted(fingerprints)) + "\n").encode("utf-8")
    ).hexdigest()
    return {
        "schemaVersion":1,
        "scope":"installed npm package.json lifecycle declarations versus hasInstallScript lock flags",
        "packageManifestsExamined":examined,
        "packagesWithDirectInstallHooks":installed_with_hooks,
        "packagesWithConditionalPrepare":prepare_packages,
        "packagesWithOtherNpmLifecycleHooks":other_packages,
        "hookCounts":{k:counts[k] for k in DIRECT + CONDITIONAL + OTHER},
        "otherNonLifecycleScripts":other_script_entries,
        "lockInstallScriptFlagCount":installed_flagged,
        "bindingGypPackageCount":binding_count,
        "directInstallHookSample":sample,
        "unqualifiedCount":len(errors),
        "unqualifiedByKind":dict(sorted(Counter(errors).items())),
        "unqualifiedSample":errors[:MAX_ERRORS],
        "qualifiedMetadataInventory":digest is not None,
        "metadataFingerprintSha256":digest,
        "priorNamespaceFingerprintSha256":prior.get("namespaceFingerprintSha256"),
        "scriptsExecuted":False,"installationApproved":False,
        "trustedPublisherProvenance":False,
        "realNpmInstallRuntimeVerified":False,
        "devActivationAuthorized":False
    }

if __name__ == "__main__":
    import sys
    if len(sys.argv)!=1:raise SystemExit("unsupported_arguments")
    r=audit()
    print(json.dumps(r,separators=(",",":"),ensure_ascii=True))
    if not r["qualifiedMetadataInventory"]:raise SystemExit(1)
