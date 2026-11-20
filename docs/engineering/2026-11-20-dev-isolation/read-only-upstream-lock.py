#!/usr/bin/env python3
"""Access #46 R32: bounded, read-only installed npm lockfile consistency check.

Compares the declared package-closure and installed metadata against BOTH the
project and npm installed-tree package-lock v3 records. Does not download,
install, execute or authenticate packages. A green result is not a provenance
signature, source-integrity guarantee, OS permission proof or DEV authority.
"""
from collections import Counter
import hashlib
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).parent
identity = SourceFileLoader(
    "access46_r32_identity", str(HERE / "read-only-upstream-identity.py")
).load_module()
closure_source = identity.scan
ROOT = closure_source.DEFAULT_NODE_MODULES
MAX_LOCKFILE_BYTES = 1048576
MAX_LOCK_ENTRIES = 5000
MAX_ERRORS_TO_REPORT = 12

def load_lock(path: Path):
    """Read exactly one bounded snapshot. Never follow a link at the file name."""
    try:
        parent = os.lstat(path.parent)
        source = os.lstat(path)
        if not stat.S_ISDIR(parent.st_mode) or closure_source.has_reparse_or_link(parent):
            return None, None, "lock_parent_unqualified"
        if not stat.S_ISREG(source.st_mode) or closure_source.has_reparse_or_link(source):
            return None, None, "lock_file_unqualified"
        if source.st_size > MAX_LOCKFILE_BYTES:
            return None, None, "lock_file_oversized"
        with open(path, "rb") as f:
            opened = os.fstat(f.fileno())
            if not stat.S_ISREG(opened.st_mode) or opened.st_size > MAX_LOCKFILE_BYTES:
                return None, None, "opened_lock_unqualified"
            raw = f.read(MAX_LOCKFILE_BYTES + 1)
        if len(raw) > MAX_LOCKFILE_BYTES:
            return None, None, "lock_file_oversized"
        data = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(data, dict) or type(data.get("lockfileVersion")) is not int or data["lockfileVersion"] != 3:
            return None, None, "lockfile_v3_required"
        packages = data.get("packages")
        if not isinstance(packages, dict) or len(packages) > MAX_LOCK_ENTRIES:
            return None, None, "lock_package_map_unqualified"
        if any(not isinstance(k, str) or not isinstance(v, dict) for k, v in packages.items()):
            return None, None, "lock_package_entry_unqualified"
        return packages, hashlib.sha256(raw).hexdigest(), None
    except (OSError, ValueError, UnicodeError, TypeError):
        return None, None, "lock_unreadable_or_invalid"

def audit(root: Path = ROOT):
    problems = []
    names = identity.audit(root)
    if not names["identityAuditPassed"]:
        problems.append("prior_identity_audit_unqualified")

    top, top_hash, top_reason = load_lock(root.parent / "package-lock.json")
    hidden, hidden_hash, hidden_reason = load_lock(root / ".package-lock.json")
    if top_reason:
        problems.append("project_" + top_reason)
    if hidden_reason:
        problems.append("installed_" + hidden_reason)

    matched = 0
    bundled = 0
    with_integrity = 0
    total = 0
    if not problems:
        seen = set()
        for rel in closure_source.inventory(root, root / closure_source.START_NAME)["relativePackageRoots"]:
            key = "node_modules/" + Path(rel).as_posix()
            if key in seen:
                problems.append("duplicate_closure_key")
                continue
            seen.add(key)
            total += 1
            project_entry = top.get(key)
            installed_entry = hidden.get(key)
            if project_entry is None or installed_entry is None:
                problems.append("lock_entry_missing")
                continue
            # Exact equality includes resolved URLs, integrity digests, flags,
            # dependencies and metadata; none are emitted in public reports.
            if project_entry != installed_entry:
                problems.append("lock_entry_conflict")
                continue
            manifest, _, reason = closure_source.manifest(root, root / Path(rel))
            if reason or not isinstance(manifest, dict):
                problems.append("installed_manifest_unqualified")
                continue
            version = manifest.get("version")
            if not isinstance(version, str) or not version:
                problems.append("installed_manifest_version_unqualified")
                continue
            if project_entry.get("version") != version:
                problems.append("lock_installed_version_conflict")
                continue
            integrity = project_entry.get("integrity")
            if isinstance(integrity, str) and integrity.strip():
                with_integrity += 1
            elif integrity is None and project_entry.get("inBundle") is True:
                bundled += 1
            else:
                problems.append("integrity_unqualified")
                continue
            matched += 1

        if total != names["packageManifestsInspected"]:
            problems.append("closure_coverage_mismatch")
        if top.get("", None) is None:
            problems.append("project_root_lock_entry_absent")
    counts = Counter(problems)
    return {
        "schemaVersion": 1,
        "scope": "read-only installed manifests and both npm v3 lock metadata snapshots",
        "installedManifestRoots": names["packageManifestsInspected"],
        "dependencyRecordsCompared": total,
        "identicalLockAndVersionRecords": matched,
        "recordsWithIntegrityMetadata": with_integrity,
        "bundledRecordsWithoutArchiveIntegrity": bundled,
        "unqualifiedCount": len(problems),
        "unqualifiedByKind": dict(sorted(counts.items())),
        "unqualifiedSample": problems[:MAX_ERRORS_TO_REPORT],
        "lockConsistencyPassed": not problems,
        "projectLockSha256": top_hash,
        "installedLockSha256": hidden_hash,
        "priorIdentityPassed": names["identityAuditPassed"],
        "noPackageExecuted": True,
        "noRegistryOrNetworkAccess": True,
        "noFilesModified": True,
        "archiveIntegrityVerifiedAgainstRegistry": False,
        "semverRangeSatisfactionVerified": False,
        "nativeAndDynamicLoaderAttested": False,
        "effectiveWindowsAclAttested": False,
        "devActivationAuthorized": False,
    }

def main():
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("unsupported_arguments")
    result = audit()
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))
    if not result["lockConsistencyPassed"]:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
