#!/usr/bin/env python3
"""Access #46 R35: fail-closed read-only installed namespace and launcher audit.

Checks the complete installed node_modules namespace against the already
qualified package closure and accounts for non-package .bin command launchers
and npm's hidden installed-tree lockfile omitted from R34's package hash.

No npm/package code execution, network, production config/token reads, writes
to the installed tree, or operational activation. This is an untrusted H:
filesystem snapshot, not loaded-process or trusted-source attestation.
"""
from collections import Counter
import hashlib
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).parent
previous = SourceFileLoader(
    "mterm_access46_r35_previous", str(HERE / "read-only-upstream-bytehash.py")
).load_module()
scan = previous.scan
ROOT = previous.ROOT
MAX_DIRECTORIES = 12000
MAX_FILES = 100000
MAX_LAUNCHERS = 512
MAX_LAUNCHER_BYTES = 2 * 1024 * 1024
MAX_TOTAL_LAUNCHER_BYTES = 8 * 1024 * 1024
MAX_ERROR_REPORT = 10

def normal_relative(root: Path, path: Path):
    """Path is a relative namespace name, not a proof of canonical identity."""
    return path.relative_to(root).as_posix()

def parent_package_name(base: Path):
    """True only at an npm package root, including nested/scoped packages."""
    if base.name in (".bin", "node_modules") or base.name.startswith("@"):
        return False
    p = base.parent
    return (p.name == "node_modules" or
            (p.name.startswith("@") and p.parent.name == "node_modules"))

def package_candidates_in_directory(root: Path, current: Path, dirs):
    """Npm physical package names, never chasing reparse/symlink roots."""
    candidates = []
    for name in dirs:
        child = current / name
        if parent_package_name(child):
            candidates.append(normal_relative(root, child).casefold())
    return candidates

def under_root_package(rel: str, expected: set[str]):
    parts = rel.casefold().split("/")
    return any("/".join(parts[:i]) in expected for i in range(1, len(parts)))

def audit(root: Path = ROOT):
    errors = []
    try:
        byte_result = previous.audit(root)
        if not byte_result["completeDeclaredClosureFingerprint"]:
            errors.append("prior_byte_inventory_unqualified")
        declared = scan.inventory(root, root / scan.START_NAME)
        if declared["capsHit"] or declared["queueUnfinished"] or declared["requiredOrMetadataUnqualifiedCount"]:
            errors.append("prior_declared_closure_unqualified")
        expected = {name.replace("\\", "/").casefold() for name in declared["relativePackageRoots"]}
    except (OSError, TypeError, ValueError):
        errors.append("prior_qualification_unavailable")
        expected = set()
        byte_result = {}

    observed = set()
    seen_paths = set()
    unknown_files = 0
    launcher_records = []
    launcher_bytes = 0
    files_seen = package_files = 0
    directories_seen = node_modules_dirs = 0
    root_lock_files = 0

    if not errors:
        try:
            for cur, children, files in os.walk(
                root, topdown=True, followlinks=False,
                onerror=lambda _: errors.append("directory_walk_unavailable")
            ):
                current = Path(cur)
                directories_seen += 1
                if directories_seen > MAX_DIRECTORIES:
                    errors.append("directory_cap_hit")
                    break
                ok, why = scan.relative_safe(root, current)
                if not ok:
                    errors.append("directory_metadata_" + str(why))
                    break
                if current.name.lower() == "node_modules":
                    node_modules_dirs += 1
                checked_children = []
                for name in sorted(children, key=lambda x: (x.casefold(), x)):
                    p = current / name
                    rel = normal_relative(root, p)
                    folded = rel.casefold()
                    if folded in seen_paths:
                        errors.append("casefold_duplicate_entry")
                        break
                    seen_paths.add(folded)
                    info = os.lstat(p)
                    if not stat.S_ISDIR(info.st_mode) or scan.has_reparse_or_link(info):
                        errors.append("child_dir_not_plain_directory")
                        break
                    if current == root and name.startswith("@"):
                        pass  # a scope container, never directly a package
                    elif current == root and name == ".bin":
                        pass  # only root-level npm command launchers are accepted
                    elif current == root and name.startswith("."):
                        errors.append("unexpected_root_hidden_directory")
                        break
                    elif current.name == ".bin" and current == root / ".bin":
                        errors.append("bin_subdirectory_unqualified")
                        break
                    checked_children.append(name)
                if errors:
                    break
                observed.update(package_candidates_in_directory(root, current, checked_children))
                children[:] = checked_children
                for name in sorted(files, key=lambda x: (x.casefold(), x)):
                    p = current / name
                    rel = normal_relative(root, p)
                    folded = rel.casefold()
                    files_seen += 1
                    if files_seen > MAX_FILES:
                        errors.append("file_cap_hit")
                        break
                    if folded in seen_paths:
                        errors.append("casefold_duplicate_entry")
                        break
                    seen_paths.add(folded)
                    info = os.lstat(p)
                    if not stat.S_ISREG(info.st_mode) or scan.has_reparse_or_link(info):
                        errors.append("file_not_plain_regular")
                        break
                    if under_root_package(rel, expected):
                        package_files += 1
                    elif rel == ".package-lock.json":
                        root_lock_files += 1
                    elif len(Path(rel).parts) == 2 and Path(rel).parts[0] == ".bin":
                        if p.suffix.lower() not in ("", ".cmd", ".ps1"):
                            errors.append("launcher_extension_unqualified")
                            break
                        if info.st_size > MAX_LAUNCHER_BYTES or len(launcher_records) >= MAX_LAUNCHERS:
                            errors.append("launcher_cap_hit")
                            break
                        digest, size, fail = previous.hash_file(p)
                        if fail:
                            errors.append("launcher_" + fail)
                            break
                        launcher_bytes += size
                        if launcher_bytes > MAX_TOTAL_LAUNCHER_BYTES:
                            errors.append("total_launcher_bytes_cap_hit")
                            break
                        launcher_records.append(json.dumps([rel, size, digest],
                                             separators=(",", ":"), ensure_ascii=True))
                    else:
                        unknown_files += 1
                        errors.append("file_outside_qualified_package_or_bin")
                        break
                if errors:
                    break
        except OSError:
            errors.append("filesystem_metadata_unavailable")

    extras = observed - expected
    missing = expected - observed
    if not errors:
        if extras:
            errors.append("undeclared_package_directories")
        if missing:
            errors.append("declared_package_directories_missing")
        if root_lock_files != 1:
            errors.append("installed_lockfile_missing_or_duplicate")
        if package_files != byte_result["successfullyHashedFiles"]:
            errors.append("package_file_count_disagrees_with_r34")
        if files_seen != package_files + len(launcher_records) + root_lock_files:
            errors.append("unaccounted_installed_files")

    fingerprint = None
    if not errors:
        # Includes the package bytes from R34, every root .bin launcher and
        # installed-tree lock SHA from R32/R33; no contents or paths published.
        lock_fingerprint = previous.lock.audit(root)["installedLockSha256"]
        payload = json.dumps(
            ["R35-v1", byte_result["byteInventorySha256"], lock_fingerprint,
             sorted(launcher_records)], separators=(",", ":"), ensure_ascii=True
        )
        fingerprint = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    counts = Counter(errors)
    return {
        "schemaVersion": 1,
        "scope": "read-only complete installed node_modules package/command namespace",
        "declaredPackageDirectories": len(expected),
        "observedPackageDirectories": len(observed),
        "undeclaredPackageDirectories": len(extras),
        "declaredPackageDirectoriesNotSeen": len(missing),
        "visitedDirectories": directories_seen,
        "nodeModulesDirectories": node_modules_dirs,
        "allNodeModulesFilesSeen": files_seen,
        "previouslyHashedPackageFiles": package_files,
        "additionalBinLaunchersHashed": len(launcher_records),
        "launcherBytesHashed": launcher_bytes,
        "installedTreeLockfilesSeen": root_lock_files,
        "otherUnqualifiedFiles": unknown_files,
        "unqualifiedCount": len(errors),
        "unqualifiedByKind": dict(sorted(counts.items())),
        "unqualifiedSample": errors[:MAX_ERROR_REPORT],
        "completeNamespaceAccounted": not errors,
        "namespaceFingerprintSha256": fingerprint,
        "priorPackageByteFingerprintSha256": byte_result.get("byteInventorySha256"),
        "installedCodeExecuted": False,
        "npmOrNetworkInvoked": False,
        "productionSourceOrConfigModified": False,
        "actualLoadedCommandGraphAttested": False,
        "trustedCodeProvenanceEstablished": False,
        "effectiveWindowsAclVerified": False,
        "devActivationAuthorized": False
    }

def main():
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("unsupported_arguments")
    result = audit()
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))
    if not result["completeNamespaceAccounted"]:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
