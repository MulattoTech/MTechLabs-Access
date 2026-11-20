#!/usr/bin/env python3
"""Access #46: read-only package-name and npm-alias identity cross-check.

Uses the independently retained bounded manifest-closure scanner. Reads only
installed package.json metadata, never imports/runs packages, does not install
or mutate anything. A successful result is NOT a signature, effective Windows
ACL check, runtime-loader attestation, or production/DEV acceptance.
"""
from __future__ import annotations
from collections import Counter
import os
import hashlib
from importlib.machinery import SourceFileLoader
import json
from pathlib import Path

scan = SourceFileLoader(
    "mterm_access46_declared_closure",
    str(Path(__file__).with_name("read-only-upstream-closure.py"))
).load_module()
ROOT = scan.DEFAULT_NODE_MODULES
MAX_REPORT_ERRORS = 12

def expected_target_name(declared_name, version_spec):
    """Return the expected installed package name, or an unqualified reason.

    npm aliases are "npm:real-name@range" or "npm:@scope/real@range".
    This checks only the alias syntax/name; it does NOT verify semver ranges.
    """
    if not isinstance(version_spec, str) or not version_spec.strip():
        return None, False, "invalid_dependency_spec"
    if not version_spec.startswith("npm:"):
        return declared_name, False, None
    body = version_spec[4:]
    marker = body.rfind("@")
    if marker <= 0 or marker == len(body) - 1:
        return None, True, "invalid_npm_alias_spec"
    target = body[:marker]
    if not scan.PACKAGE_NAME.fullmatch(target):
        return None, True, "invalid_npm_alias_target"
    return target, True, None

def audit(root: Path = ROOT):
    closure = scan.inventory(root, root / scan.START_NAME)
    preflight_ok = (
        not closure["capsHit"] and
        not closure["queueUnfinished"] and
        closure["requiredOrMetadataUnqualifiedCount"] == 0
    )
    problems = []
    rows = {}
    fingerprint_rows = []
    if not preflight_ok:
        problems.append("declared_closure_unqualified")
    else:
        for rel in closure["relativePackageRoots"]:
            package_dir = root / Path(rel)
            obj, sha, err = scan.manifest(root, package_dir)
            if err:
                problems.append("reopened_manifest_" + err)
                continue
            name, version = obj.get("name"), obj.get("version")
            if not isinstance(name, str) or not scan.PACKAGE_NAME.fullmatch(name):
                problems.append("manifest_name_invalid")
                continue
            if not isinstance(version, str) or not version.strip():
                problems.append("manifest_version_invalid")
                continue
            rows[os.path.normcase(str(package_dir))] = (package_dir, obj, name)
            fingerprint_rows.append(rel + "|" + name + "|" + version + "|" + sha)
        if len(rows) != closure["manifestFilesRead"]:
            problems.append("manifest_snapshot_incomplete")

    required = optional = present_matched = aliases = missing_optional = 0
    if preflight_ok and len(rows) == closure["manifestFilesRead"]:
        for path_key, (package_dir, obj, actual_name) in rows.items():
            # Resolve using the pinned package root and the closure scanner.
            if package_dir == root / scan.START_NAME:
                if actual_name != scan.START_NAME:
                    problems.append("start_package_identity_mismatch")
            raw_optional = obj.get("optionalDependencies") or {}
            for section in ("dependencies", "optionalDependencies"):
                declared, err = scan.package_names(obj, section)
                if err:
                    problems.append("dependency_names_invalid")
                    continue
                raw = obj.get(section) or {}
                for dependency in declared:
                    if section == "dependencies" and dependency in raw_optional:
                        continue
                    if section == "dependencies":
                        required += 1
                    else:
                        optional += 1
                    expected, is_alias, reason = expected_target_name(
                        dependency, raw[dependency]
                    )
                    if reason:
                        problems.append(reason)
                        continue
                    target, resolve_error = scan.resolve_dependency(
                        root, package_dir, dependency
                    )
                    if target is None:
                        if section == "optionalDependencies" and resolve_error == "not_found_in_known_roots":
                            missing_optional += 1
                        else:
                            problems.append("dependency_" + resolve_error)
                        continue
                    target_info = rows.get(os.path.normcase(str(target)))
                    if target_info is None:
                        problems.append("resolved_target_not_in_closure")
                    elif target_info[2] != expected:
                        problems.append("resolved_package_identity_mismatch")
                    else:
                        present_matched += 1
                        if is_alias:
                            aliases += 1

    counts = Counter(problems)
    return {
        "schemaVersion": 1,
        "scope": "read-only dependency package name versus declared name and npm alias",
        "packageManifestsInspected": len(rows),
        "requiredDependencyEdges": required,
        "optionalDependencyEdges": optional,
        "presentIdentityEdgesMatched": present_matched,
        "npmAliasIdentityEdgesMatched": aliases,
        "missingOptionalEdges": missing_optional,
        "unqualifiedCount": len(problems),
        "unqualifiedByKind": dict(sorted(counts.items())),
        "unqualifiedSample": problems[:MAX_REPORT_ERRORS],
        "identityAuditPassed": len(problems) == 0 and preflight_ok,
        "packageManifestFingerprintSha256": hashlib.sha256(
            "\n".join(sorted(fingerprint_rows)).encode("utf-8")
        ).hexdigest(),
        "installedPackageCodeExecuted": False,
        "versionRangesValidated": False,
        "fullNodeRuntimeResolutionVerified": False,
        "sourceSignatureVerified": False,
        "effectiveWindowsPermissionsVerified": False,
        "devActivationAuthorized": False
    }

def main():
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("unsupported_arguments")
    result = audit()
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))
    if not result["identityAuditPassed"]:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
