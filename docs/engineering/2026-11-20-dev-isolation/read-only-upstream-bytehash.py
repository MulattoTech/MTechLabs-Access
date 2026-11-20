#!/usr/bin/env python3
"""Access #46 R34: bounded, read-only installed dependency byte-fingerprint.

For all dependency roots admitted by the earlier R30–R33 metadata checks,
hashes the actual installed regular-file bytes without importing/executing
installed modules, running npm, accessing credentials or modifying production.

This is a change-detection snapshot from a broadly writable H: installation,
NOT a trusted source signature, stable-handle attestation, real DEV-token
permission test, full dynamic/browser runtime closure or release acceptance.
"""
from __future__ import annotations
from collections import Counter
import hashlib
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).parent
lock = SourceFileLoader(
    "access46_r34_lock_structure", str(HERE / "read-only-upstream-lock-structure.py")
).load_module()
scan = lock.prior.closure_source
ROOT = scan.DEFAULT_NODE_MODULES
MAX_FILES = 100_000
MAX_DIRECTORIES = 12_000
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
READ_CHUNK = 1024 * 1024
MAX_REASONS = 10

def regular_unlinked(info):
    return stat.S_ISREG(info.st_mode) and not scan.has_reparse_or_link(info)

def identity_tuple(info):
    """Comparable path/handle fields on Windows; not a trust attestation."""
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)

def hash_file(path: Path):
    """One bounded read, checking opened and path metadata at both ends."""
    try:
        before = os.lstat(path)
        if not regular_unlinked(before):
            return None, None, "file_not_regular_or_link"
        if before.st_size > MAX_FILE_BYTES:
            return None, None, "file_size_cap"
        with open(path, "rb") as handle:
            opened = os.fstat(handle.fileno())
            if not regular_unlinked(opened) or identity_tuple(opened) != identity_tuple(before):
                return None, None, "file_changed_before_read"
            digest = hashlib.sha256()
            size = 0
            while True:
                piece = handle.read(min(READ_CHUNK, MAX_FILE_BYTES + 1 - size))
                if not piece:
                    break
                size += len(piece)
                if size > MAX_FILE_BYTES:
                    return None, None, "file_size_cap"
                digest.update(piece)
            after_handle = os.fstat(handle.fileno())
            if (identity_tuple(after_handle) != identity_tuple(opened)
                or after_handle.st_ctime_ns != opened.st_ctime_ns
                or size != opened.st_size):
                return None, None, "file_changed_during_read"
        after_path = os.lstat(path)
        if (not regular_unlinked(after_path)
            or identity_tuple(after_path) != identity_tuple(before)
            or after_path.st_ctime_ns != before.st_ctime_ns):
            return None, None, "file_changed_after_read"
        return digest.hexdigest(), size, None
    except OSError:
        return None, None, "file_metadata_or_read_unavailable"

def audit(root: Path = ROOT):
    errors = []
    counts = Counter()
    try:
        prereq = lock.audit(root)
        if not prereq["lockStructureQualified"]:
            errors.append("prior_lock_qualification_unverified")
            relative_roots = []
        else:
            inventory = scan.inventory(root, root / scan.START_NAME)
            if inventory["capsHit"] or inventory["queueUnfinished"] or inventory["requiredOrMetadataUnqualifiedCount"]:
                errors.append("dependency_closure_unqualified")
            if inventory["manifestFilesRead"] != prereq["installedLockEntryCount"]:
                errors.append("closure_vs_lock_root_count_mismatch")
            relative_roots = inventory["relativePackageRoots"] if not errors else []
    except (OSError, ValueError, TypeError):
        errors.append("prerequisite_unavailable")
        relative_roots = []

    packages = len(relative_roots)
    dirs_seen = files_seen = hashed = total_bytes = 0
    entries = []
    seen_keys = set()
    capped = False

    for rel in relative_roots:
        package = root / Path(rel)
        ok, reason = scan.relative_safe(root, package)
        if not ok:
            errors.append("package_path_" + str(reason))
            break
        try:
            for current, dirs, files in os.walk(
                    package, topdown=True, followlinks=False,
                    onerror=lambda error: errors.append("directory_walk_unavailable")):
                dirs_seen += 1
                if dirs_seen > MAX_DIRECTORIES:
                    errors.append("directory_count_cap")
                    capped = True
                    break
                current_path = Path(current)
                # Recheck the entire selected path before processing its contents.
                ok, reason = scan.relative_safe(root, current_path)
                if not ok:
                    errors.append("directory_path_" + str(reason))
                    capped = True
                    break
                directory_info = os.lstat(current_path)
                if not stat.S_ISDIR(directory_info.st_mode) or scan.has_reparse_or_link(directory_info):
                    errors.append("directory_type_or_link")
                    capped = True
                    break
                good_dirs = []
                for name in sorted(dirs, key=lambda x: (x.casefold(), x)):
                    if name.lower() == "node_modules":
                        # Each declared nested package is traversed separately.
                        continue
                    info = os.lstat(current_path / name)
                    if not stat.S_ISDIR(info.st_mode) or scan.has_reparse_or_link(info):
                        errors.append("child_directory_unqualified")
                    else:
                        good_dirs.append(name)
                dirs[:] = good_dirs
                if errors:
                    capped = True
                    break

                for name in sorted(files, key=lambda x: (x.casefold(), x)):
                    files_seen += 1
                    if files_seen > MAX_FILES:
                        errors.append("file_count_cap")
                        capped = True
                        break
                    candidate = current_path / name
                    relfile = candidate.relative_to(root).as_posix()
                    key = relfile.casefold()
                    if key in seen_keys:
                        errors.append("casefold_duplicate_file_path")
                        capped = True
                        break
                    seen_keys.add(key)
                    digest, length, fail = hash_file(candidate)
                    if fail:
                        errors.append(fail)
                        capped = True
                        break
                    total_bytes += length
                    if total_bytes > MAX_TOTAL_BYTES:
                        errors.append("total_byte_cap")
                        capped = True
                        break
                    hashed += 1
                    # Canonical JSON records disambiguate file names and separators.
                    entries.append(json.dumps(
                        [relfile, length, digest], separators=(",", ":"), ensure_ascii=True
                    ))
                if capped:
                    break
            if capped or errors:
                break
        except OSError:
            errors.append("directory_metadata_unavailable")
            break

    fingerprint = None
    if not errors and len(entries) == hashed == files_seen:
        fingerprint = hashlib.sha256(
            ("\n".join(sorted(entries)) + "\n").encode("utf-8")
        ).hexdigest()
    else:
        if not errors:
            errors.append("hashed_file_coverage_mismatch")
    counts.update(errors)
    return {
        "schemaVersion": 1,
        "scope": "read-only byte SHA-256 inventory of declared installed package roots",
        "selectedPackageRoots": packages,
        "visitedDirectories": dirs_seen,
        "discoveredFiles": files_seen,
        "successfullyHashedFiles": hashed,
        "totalHashedBytes": total_bytes,
        "scanCapHit": capped,
        "unqualifiedCount": len(errors),
        "unqualifiedByKind": dict(sorted(counts.items())),
        "unqualifiedSample": errors[:MAX_REASONS],
        "byteInventorySha256": fingerprint,
        "completeDeclaredClosureFingerprint": fingerprint is not None,
        "bytesReadButNeverPublished": True,
        "installedCodeImportedOrExecuted": False,
        "npmInvoked": False,
        "ownerSecretsOrConfigOpened": False,
        "trustedSourceProvenanceVerified": False,
        "liveRuntimeModuleGraphAttested": False,
        "raceFreeFileIdentityVerified": False,
        "effectiveWindowsAclVerified": False,
        "devActivationAuthorized": False,
    }

def main():
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("unsupported_arguments")
    result = audit()
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))
    if not result["completeDeclaredClosureFingerprint"]:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
