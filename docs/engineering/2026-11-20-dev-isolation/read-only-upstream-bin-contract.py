#!/usr/bin/env python3
"""Access #46 R36: read-only npm bin-declaration and launcher-shape audit.

Checks each declared bin target against installed regular files and every
shell/CMD/PowerShell shim against its exact target and one of two observed
normalized template families. The six template SHA-256 pins were recorded from
the existing installed H: tree, NOT from a trusted npm publisher; they are
change-detection inputs, never security provenance or DEV authorization.

No installed package import/execution, npm, subprocess, network, or writes.
"""
from __future__ import annotations
from collections import Counter
import hashlib
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import re
import stat

HERE = Path(__file__).parent
namespace = SourceFileLoader(
    "access46_r36_namespace", str(HERE / "read-only-upstream-namespace.py")
).load_module()
scan = namespace.scan
ROOT = namespace.ROOT
SHIM_EXTENSIONS = ("", ".cmd", ".ps1")
MAX_SHIM_BYTES = 65536
MAX_COMMANDS = 256
MAX_REASONS = 12
BIN_NAME = re.compile(r"^[a-zA-Z0-9._-]+$")
SAFE_TARGET = re.compile(r"^[a-zA-Z0-9._/-]+$")
OBSERVED_TEMPLATE_SHA256 = {
    "": {
        "node": "2ac5ea5af2ebb84c8556f600de0d95406b02de71c7849387ee37281b58ba46ca",
        "direct": "87c9119ddffc456987cc0df63c378db0a1eeaa8d045a33e5d5975c5861536f49",
    },
    ".cmd": {
        "node": "a96c4d3e253b0bd26fe363d16a4f971f732834077434f66d016f815d764eef2c",
        "direct": "281aa465586bc508824209fb4e55d8884371482d007c04f0c6f4e5393213afb4",
    },
    ".ps1": {
        "node": "c40f743cb00b0db0aad560389687aa1a2d9594de21193c40b840d4e0eeb24b65",
        "direct": "aa4db2abbd30ff80b20c075363a2598b9e530e2089659307e8ea51fddb0cb506",
    },
}

def normalized_target(raw):
    """Npm bin file must stay inside its own package tree."""
    if not isinstance(raw, str) or not raw or not SAFE_TARGET.fullmatch(raw):
        return None
    if raw.startswith("/") or "\\" in raw or ":" in raw:
        return None
    text = raw[2:] if raw.startswith("./") else raw
    components = text.split("/")
    if not components or any(x in ("", ".", "..", "node_modules") for x in components):
        return None
    return "/".join(components)

def bin_map(root: Path, roots):
    mapping = {}
    problems = []
    for rel in roots:
        package = root / Path(rel)
        meta, _, failure = scan.manifest(root, package)
        if failure:
            problems.append("package_manifest_" + str(failure))
            continue
        raw_bin = meta.get("bin")
        if raw_bin is None:
            continue
        if isinstance(raw_bin, str):
            pname = meta.get("name")
            if not isinstance(pname, str):
                problems.append("string_bin_package_name_invalid")
                continue
            raw_bin = {pname.split("/")[-1]: raw_bin}
        if not isinstance(raw_bin, dict):
            problems.append("bin_declaration_invalid")
            continue
        for command, raw_target in raw_bin.items():
            if not isinstance(command, str) or not BIN_NAME.fullmatch(command) or command in (".", ".."):
                problems.append("bin_name_invalid")
                continue
            if command.casefold() in mapping:
                problems.append("bin_name_collision")
                continue
            target = normalized_target(raw_target)
            if target is None:
                problems.append("bin_target_invalid")
                continue
            pkg_rel = str(rel).replace("\\", "/")
            destination = package / Path(target)
            safe, why = scan.relative_safe(root, destination)
            if not safe:
                problems.append("bin_target_path_" + str(why))
                continue
            try:
                meta_target = os.lstat(destination)
                if not stat.S_ISREG(meta_target.st_mode) or scan.has_reparse_or_link(meta_target):
                    problems.append("bin_target_not_regular")
                    continue
            except OSError:
                problems.append("bin_target_metadata_unavailable")
                continue
            mapping[command.casefold()] = {
                "name": command,
                "pkg": pkg_rel,
                "target": target,
            }
            if len(mapping) > MAX_COMMANDS:
                problems.append("bin_command_count_cap")
                break
        if problems:
            break
    return mapping, problems

def normalized_shim(text: str, package: str, target: str):
    """Replace only the exact declared target with a literal placeholder."""
    expected = "/../" + package + "/" + target
    converted = text.replace("\r\n", "\n").replace("\\", "/")
    count = converted.count(expected)
    return converted.replace(expected, "/../MTERM_DECLARED_BIN_TARGET"), count

def read_shim(path: Path):
    """Bounded strict UTF-8; independently confirm bytes match guarded hash."""
    try:
        first = os.lstat(path)
        if not stat.S_ISREG(first.st_mode) or scan.has_reparse_or_link(first):
            return None, "shim_not_regular"
        if first.st_size > MAX_SHIM_BYTES:
            return None, "shim_size_cap"
        digest, size, failure = namespace.previous.hash_file(path)
        if failure:
            return None, "shim_" + failure
        data = path.read_bytes()
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            return None, "shim_changed_during_read"
        if len(data) > MAX_SHIM_BYTES:
            return None, "shim_size_cap"
        return data.decode("utf-8-sig"), None
    except UnicodeError:
        return None, "shim_utf8_invalid"
    except OSError:
        return None, "shim_unreadable"

def audit(root: Path = ROOT, template_pins=None):
    """Override pins only for disposable fixture tests, never in CLI."""
    pins = OBSERVED_TEMPLATE_SHA256 if template_pins is None else template_pins
    errors = []
    try:
        earlier = namespace.audit(root)
        if not earlier["completeNamespaceAccounted"]:
            errors.append("prior_namespace_unqualified")
        dependency = scan.inventory(root, root / scan.START_NAME)
        if dependency["capsHit"] or dependency["queueUnfinished"] or dependency["requiredOrMetadataUnqualifiedCount"]:
            errors.append("prior_declared_closure_unqualified")
        roots = dependency["relativePackageRoots"] if not errors else []
    except (OSError, TypeError, ValueError):
        errors.append("prerequisite_unavailable")
        roots = []
        earlier = {}

    mapping, mapped_errors = bin_map(root, roots) if not errors else ({}, [])
    errors.extend(mapped_errors)
    families = Counter()
    matched = 0
    seen = set()
    identity_rows = []
    if not errors:
        shim_dir = root / ".bin"
        safe, why = scan.relative_safe(root, shim_dir)
        if not safe:
            errors.append("shim_dir_" + str(why))
        else:
            try:
                files = sorted(shim_dir.iterdir(), key=lambda p: (p.name.casefold(), p.name))
            except OSError:
                files = []
                errors.append("shim_directory_unreadable")
            expected = {entry["name"] + ext
                        for entry in mapping.values() for ext in SHIM_EXTENSIONS}
            actual = {file.name for file in files}
            if len(files) != len(actual):
                errors.append("shim_duplicate_names")
            if expected != actual:
                errors.append("bin_shim_set_mismatch")
            seen_folded = set()
            if not errors:
                for key, entry in sorted(mapping.items()):
                    command = entry["name"]
                    observed_families = []
                    hashes = []
                    for suffix in SHIM_EXTENSIONS:
                        file = shim_dir / (command + suffix)
                        folded = file.name.casefold()
                        if folded in seen_folded:
                            errors.append("shim_casefold_collision")
                            break
                        seen_folded.add(folded)
                        payload, failure = read_shim(file)
                        if failure:
                            errors.append(failure)
                            break
                        normalized, occurrences = normalized_shim(
                            payload, entry["pkg"], entry["target"]
                        )
                        hashed = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
                        family = next((variant for variant, pinned in pins.get(suffix, {}).items()
                                       if hashed == pinned), None)
                        if family is None:
                            errors.append("shim_template_not_in_observed_families")
                            break
                        wanted = 4 if suffix == ".ps1" and family == "node" else (
                                 2 if suffix == ".ps1" else 1)
                        if occurrences != wanted:
                            errors.append("declared_target_reference_count_unqualified")
                            break
                        observed_families.append(family)
                        hashes.append(hashed)
                        matched += 1
                    if errors:
                        break
                    if len(set(observed_families)) != 1:
                        errors.append("shim_launcher_family_inconsistent")
                        break
                    families[observed_families[0]] += 1
                    identity_rows.append(json.dumps(
                        [command, entry["pkg"], entry["target"], observed_families[0], hashes],
                        separators=(",", ":"), ensure_ascii=True
                    ))

    fingerprint = None
    if not errors and matched == 3 * len(mapping):
        fingerprint = hashlib.sha256(
            json.dumps(["R36-v1", earlier["namespaceFingerprintSha256"],
                        sorted(identity_rows)], separators=(",", ":"), ensure_ascii=True
            ).encode("utf-8")
        ).hexdigest()
    elif not errors:
        errors.append("bin_shim_coverage_mismatch")
    return {
        "schemaVersion": 1,
        "scope": "read-only npm declared bin target vs installed shell/CMD/PowerShell wrappers",
        "declaredCommands": len(mapping),
        "shimFilesMatchingPinnedObservedTemplates": matched,
        "nodeLauncherFamilies": families["node"],
        "directScriptLauncherFamilies": families["direct"],
        "unqualifiedCount": len(errors),
        "unqualifiedByKind": dict(sorted(Counter(errors).items())),
        "unqualifiedSample": errors[:MAX_REASONS],
        "binTargetContractsMatched": fingerprint is not None,
        "binContractFingerprintSha256": fingerprint,
        "previousNamespaceFingerprintSha256": earlier.get("namespaceFingerprintSha256"),
        "baselineTemplatesFromTrustedPublisher": False,
        "installedCodeOrLaunchersExecuted": False,
        "realLauncherBehaviorAttested": False,
        "trustedCodeProvenanceVerified": False,
        "effectiveWindowsAclVerified": False,
        "devActivationAuthorized": False,
    }

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("unsupported_arguments")
    r = audit()
    print(json.dumps(r, separators=(",", ":"), ensure_ascii=True))
    if not r["binTargetContractsMatched"]:
        raise SystemExit(1)
