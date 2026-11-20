#!/usr/bin/env python3
"""Access #46: bounded read-only declared upstream dependency-closure inventory.

No imports of installed package code, npm installs, subprocesses, network, writes,
private file contents or authentication. Only package metadata and path attributes.
Does not establish actual JS module resolution, transitive runtime source closure,
effective Windows access, or production/DEV activation qualification.
"""
from __future__ import annotations
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

DEFAULT_NODE_MODULES = Path(r"H:\MTechLabs\MCP\node_modules")
START_NAME = "@wonderwhy-er/desktop-commander"
MAX_PACKAGES = 2500
MAX_EDGES = 20000
MAX_DEPTH = 32
MAX_MANIFEST_BYTES = 131072
MAX_NAMES_TO_REPORT = 35
PACKAGE_NAME = re.compile(r"^(?:@[a-z0-9._-]+/)?[a-z0-9._-]+$", re.I)
REPARSE_FLAG = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


def has_reparse_or_link(meta):
    return stat.S_ISLNK(meta.st_mode) or bool(getattr(meta, "st_file_attributes", 0) & REPARSE_FLAG)


def relative_safe(root: Path, candidate: Path):
    """Do not follow linked components inside the selected trusted-name boundary."""
    try:
        rel = candidate.relative_to(root)
    except ValueError:
        return False, "outside_root"
    cursor = root
    try:
        base = os.lstat(root)
        if not stat.S_ISDIR(base.st_mode) or has_reparse_or_link(base):
            return False, "root_unqualified"
        for part in rel.parts:
            if part in (".", ".."):
                return False, "unsafe_component"
            cursor = cursor / part
            meta = os.lstat(cursor)
            if has_reparse_or_link(meta):
                return False, "reparse_component"
        return True, None
    except FileNotFoundError:
        return False, "missing"
    except OSError:
        return False, "metadata_unavailable"


def manifest(root: Path, package_root: Path):
    ok, reason = relative_safe(root, package_root)
    if not ok:
        return None, None, reason
    try:
        root_stat = os.lstat(package_root)
        if not stat.S_ISDIR(root_stat.st_mode):
            return None, None, "not_directory"
        p = package_root / "package.json"
        ok, reason = relative_safe(root, p)
        if not ok:
            return None, None, reason
        meta = os.lstat(p)
        if not stat.S_ISREG(meta.st_mode) or meta.st_size > MAX_MANIFEST_BYTES:
            return None, None, "manifest_size_or_type"
        with open(p, "rb") as stream:
            checked = os.fstat(stream.fileno())
            if not stat.S_ISREG(checked.st_mode) or checked.st_size > MAX_MANIFEST_BYTES:
                return None, None, "opened_manifest_unqualified"
            raw = stream.read(MAX_MANIFEST_BYTES + 1)
        if len(raw) > MAX_MANIFEST_BYTES:
            return None, None, "manifest_size_limit"
        payload = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(payload, dict):
            return None, None, "manifest_invalid"
        return payload, hashlib.sha256(raw).hexdigest(), None
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        return None, None, "manifest_unreadable_or_invalid"


def package_names(data, key):
    if data is None:
        return [], "manifest_missing"
    value = data.get(key, {})
    if value is None:
        return [], None
    if not isinstance(value, dict):
        return [], "dependency_section_invalid"
    names = list(value)
    if len(names) > MAX_EDGES or any(not isinstance(n, str) or not PACKAGE_NAME.fullmatch(n) for n in names):
        return [], "dependency_names_invalid"
    return sorted(names), None


def resolve_dependency(root: Path, current: Path, name: str):
    if not PACKAGE_NAME.fullmatch(name):
        return None, "invalid_name"
    limit = root.parent
    cursor = current
    while True:
        candidate = cursor / "node_modules" / name
        if candidate.exists() or candidate.is_symlink():
            ok, reason = relative_safe(root, candidate)
            if not ok:
                return None, reason
            if not stat.S_ISDIR(os.lstat(candidate).st_mode):
                return None, "dependency_not_directory"
            return candidate, None
        if cursor == limit:
            break
        if cursor == cursor.parent or not (cursor == root or root in cursor.parents or cursor == limit):
            return None, "resolver_boundary_unverified"
        cursor = cursor.parent
    return None, "not_found_in_known_roots"


def inventory(root: Path, first: Path):
    if first != root / START_NAME:
        raise ValueError("start_package_not_pinned")
    if not root.is_dir():
        raise ValueError("root_unavailable")
    queue = deque([(first, 0)])
    visited = set()
    manifest_rows = []
    root_rows = []
    fail = []
    missing_optional = []
    peer_declared = 0
    required_edges = 0
    optional_edges = 0
    max_observed_depth = 0
    stopped = False
    while queue:
        if len(visited) >= MAX_PACKAGES or required_edges + optional_edges >= MAX_EDGES:
            stopped = True
            break
        pkg_root, depth = queue.popleft()
        if depth > MAX_DEPTH:
            stopped = True
            break
        key = str(pkg_root).lower()
        if key in visited:
            continue
        visited.add(key)
        max_observed_depth = max(max_observed_depth, depth)
        obj, sha, error = manifest(root, pkg_root)
        if error:
            fail.append({"kind": error, "depth": depth})
            continue
        name = obj.get("name")
        version = obj.get("version")
        rel = pkg_root.relative_to(root).as_posix()
        manifest_rows.append((rel, str(name)[:150], str(version)[:70], sha))
        root_rows.append(rel)
        required, e1 = package_names(obj, "dependencies")
        optional, e2 = package_names(obj, "optionalDependencies")
        peers, e3 = package_names(obj, "peerDependencies")
        if e1 or e2 or e3:
            fail.append({"kind": "invalid_dependency_fields", "depth": depth})
            continue
        peer_declared += len(peers)
        optional_set = set(optional)
        for dependency in required:
            if dependency in optional_set:
                continue
            required_edges += 1
            resolved, reason = resolve_dependency(root, pkg_root, dependency)
            if resolved is None:
                fail.append({"kind": "required_" + reason, "dependency": dependency, "depth": depth})
            else:
                queue.append((resolved, depth + 1))
        for dependency in optional:
            optional_edges += 1
            resolved, reason = resolve_dependency(root, pkg_root, dependency)
            if resolved is None:
                missing_optional.append({"kind": "optional_" + reason, "dependency": dependency, "depth": depth})
            else:
                queue.append((resolved, depth + 1))
    fingerprint = hashlib.sha256("\n".join(
        "|".join(rec) for rec in sorted(manifest_rows)
    ).encode("utf-8")).hexdigest()
    failures_by_kind = {}
    for row in fail:
        failures_by_kind[row["kind"]] = failures_by_kind.get(row["kind"], 0) + 1
    optional_by_kind = {}
    for row in missing_optional:
        optional_by_kind[row["kind"]] = optional_by_kind.get(row["kind"], 0) + 1
    return {
        "schemaVersion": 1,
        "scope": "read-only declared package.json dependency closure, not loaded JS runtime",
        "startPackage": START_NAME,
        "root": "installed-manager-node_modules",
        "visitedPackageRoots": len(visited),
        "manifestFilesRead": len(manifest_rows),
        "requiredDependencyEdges": required_edges,
        "optionalDependencyEdges": optional_edges,
        "declaredPeerDependencyEdgesNotRecursed": peer_declared,
        "maxTraversalDepth": max_observed_depth,
        "queueUnfinished": len(queue),
        "capsHit": stopped,
        "requiredOrMetadataUnqualifiedCount": len(fail),
        "requiredOrMetadataUnqualifiedByKind": failures_by_kind,
        "requiredOrMetadataUnqualifiedSample": fail[:MAX_NAMES_TO_REPORT],
        "unresolvedOptionalCount": len(missing_optional),
        "optionalUnresolvedByKind": optional_by_kind,
        "optionalUnresolvedSample": missing_optional[:MAX_NAMES_TO_REPORT],
        "metadataFingerprintSha256": fingerprint,
        "readOnly": True,
        "importsExecuted": False,
        "transitiveJSImportsVerified": False,
        "binaryOrNativeHelpersVerified": False,
        "effectiveWindowsAccessVerified": False,
        "devActivationAuthorized": False,
        "relativePackageRoots": root_rows,  # tool may redact before publishing
    }


def main():
    result = inventory(DEFAULT_NODE_MODULES, DEFAULT_NODE_MODULES / START_NAME)
    if len(sys.argv) == 2 and sys.argv[1] == "--include-relative-package-roots":
        pass
    elif len(sys.argv) == 1:
        result.pop("relativePackageRoots", None)
    else:
        raise SystemExit("unsupported_arguments")
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))


if __name__ == "__main__":
    main()
