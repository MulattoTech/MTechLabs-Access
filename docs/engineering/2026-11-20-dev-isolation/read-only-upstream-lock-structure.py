#!/usr/bin/env python3
"""Access #46 R33: bounded read-only npm lockfile namespace and SRI metadata audit.

Checks all project and installed-tree npm v3 entries (including optional-only
project records), not just previously resolved dependencies. Uses no network,
npm, installed code imports, package execution, or filesystem mutation.

This is metadata syntax/consistency evidence, NOT cryptographic proof of
installed bytes, registry provenance, loaded runtime or effective Windows ACLs.
"""
from collections import Counter
import base64
import hashlib
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit

HERE = Path(__file__).parent
prior = SourceFileLoader("access46_r33_prior", str(HERE / "read-only-upstream-lock.py")).load_module()
ROOT = prior.ROOT
MAX_LOCK_BYTES = 1048576
MAX_ROOT_MANIFEST_BYTES = 131072
MAX_PROBLEMS = 12
SRI_LENGTHS = {"sha256": 32, "sha384": 48, "sha512": 64}
NAME = re.compile(r"^[a-z0-9._-]+$", re.I)
SCOPE = re.compile(r"^@[a-z0-9._-]+$", re.I)
SRI = re.compile(r"^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$")

def reject_duplicate_json_keys(pairs):
    result = {}
    for k, v in pairs:
        if k in result:
            raise ValueError("duplicate_json_property")
        result[k] = v
    return result

def bounded_object(path, bound):
    """One bounded regular-file read; no link at the file or immediate parent."""
    try:
        parent = os.lstat(path.parent)
        info = os.lstat(path)
        if (not stat.S_ISDIR(parent.st_mode) or prior.closure_source.has_reparse_or_link(parent)
            or not stat.S_ISREG(info.st_mode) or prior.closure_source.has_reparse_or_link(info)):
            return None, None, "unqualified_file_or_parent"
        if info.st_size > bound:
            return None, None, "file_oversized"
        with open(path, "rb") as handle:
            opened = os.fstat(handle.fileno())
            if not stat.S_ISREG(opened.st_mode) or opened.st_size > bound:
                return None, None, "opened_file_unqualified"
            raw = handle.read(bound + 1)
        if len(raw) > bound:
            return None, None, "file_oversized"
        value = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=reject_duplicate_json_keys)
        if not isinstance(value, dict):
            return None, None, "root_object_invalid"
        return value, hashlib.sha256(raw).hexdigest(), None
    except (OSError, ValueError, TypeError, UnicodeError):
        return None, None, "unreadable_or_invalid"

def validate_key(key):
    if not isinstance(key, str) or not key or "\\" in key or ":" in key:
        return "noncanonical_key"
    parts = key.split("/")
    i = 0
    while i < len(parts):
        if parts[i] != "node_modules":
            return "unexpected_path_component"
        i += 1
        if i >= len(parts):
            return "missing_package_name"
        part = parts[i]
        if part.startswith("@"):
            if (not SCOPE.fullmatch(part) or i + 1 >= len(parts)
                or not NAME.fullmatch(parts[i + 1])
                or parts[i + 1] in ("node_modules", ".bin")):
                return "invalid_scoped_package_name"
            i += 2
        elif NAME.fullmatch(part) and part not in (".", "..", ".bin", "node_modules"):
            i += 1
        else:
            return "invalid_package_name"
    return None

def validate_integrity(value):
    if not isinstance(value, str) or not value:
        return "integrity_missing_or_invalid_type"
    tokens = value.split()
    if len(tokens) != 1:
        return "integrity_token_count_unqualified"
    match = SRI.fullmatch(tokens[0])
    if not match:
        return "integrity_algorithm_or_format_unqualified"
    algorithm, digest = match.groups()
    try:
        data = base64.b64decode(digest, validate=True)
    except (ValueError, base64.binascii.Error):
        return "integrity_base64_invalid"
    if len(data) != SRI_LENGTHS[algorithm]:
        return "integrity_digest_length_mismatch"
    if base64.b64encode(data).decode("ascii") != digest:
        return "integrity_noncanonical_base64"
    return None

def validate_resolved(value):
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        return "resolved_missing_or_invalid"
    try:
        u = urlsplit(value)
        if (u.scheme != "https" or not u.hostname or u.username is not None
            or u.password is not None or u.fragment or "@" in u.netloc):
            return "resolved_not_qualified_https"
        if u.port is not None and not (1 <= u.port <= 65535):
            return "resolved_invalid_port"
    except ValueError:
        return "resolved_parse_invalid"
    return None

def audit(root=ROOT):
    errors = []
    prior_result = prior.audit(root)
    if not prior_result["lockConsistencyPassed"]:
        errors.append("prior_two_lock_gate_unqualified")
    project_path = root.parent / "package-lock.json"
    installed_path = root / ".package-lock.json"
    manifest_path = root.parent / "package.json"
    project, project_hash, project_error = bounded_object(project_path, MAX_LOCK_BYTES)
    installed, installed_hash, installed_error = bounded_object(installed_path, MAX_LOCK_BYTES)
    manifest, manifest_hash, manifest_error = bounded_object(manifest_path, MAX_ROOT_MANIFEST_BYTES)
    for role, err in (("project_lock",project_error),("installed_lock",installed_error),("root_manifest",manifest_error)):
        if err:
            errors.append(role + "_" + err)

    project_entries = installed_entries = {}
    project_only = 0
    with_integrity = bundled = resolved_https = scanned_records = 0
    if not project_error and not installed_error and not manifest_error:
        for role, value in (("project",project),("installed",installed)):
            if type(value.get("lockfileVersion")) is not int or value.get("lockfileVersion") != 3:
                errors.append(role + "_lock_version_unqualified")
            entries = value.get("packages")
            if not isinstance(entries, dict) or len(entries) > prior.MAX_LOCK_ENTRIES:
                errors.append(role + "_packages_unqualified")
                continue
            if role == "project":
                project_entries = entries
            else:
                installed_entries = entries
        if isinstance(project_entries, dict) and isinstance(installed_entries, dict):
            root_entry = project_entries.get("")
            if (not isinstance(root_entry, dict)
                or any(not isinstance(manifest.get(k), str) or not manifest.get(k)
                       or manifest.get(k) != root_entry.get(k)
                       or manifest.get(k) != project.get(k) for k in ("name","version"))):
                errors.append("project_root_identity_unqualified")
            if isinstance(root_entry, dict):
                for section in ("dependencies","devDependencies","optionalDependencies","peerDependencies"):
                    if (manifest.get(section) or {}) != (root_entry.get(section) or {}):
                        errors.append("project_root_dependency_declarations_changed")

            project_keys = set(project_entries) - {""}
            installed_keys = set(installed_entries)
            if "" in installed_keys:
                errors.append("installed_root_entry_unexpected")
            if not installed_keys.issubset(project_keys):
                errors.append("installed_entries_not_in_project_lock")
            project_only = len(project_keys - installed_keys)
            casefold = {}
            for role, entries in (("project",project_entries),("installed",installed_entries)):
                casefold.clear()
                for key, entry in entries.items():
                    if role == "project" and key == "":
                        continue
                    scanned_records += 1
                    reason = validate_key(key)
                    if reason:
                        errors.append(role + "_" + reason)
                        continue
                    lower = key.casefold()
                    if lower in casefold and casefold[lower] != key:
                        errors.append(role + "_casefold_collision")
                    casefold[lower] = key
                    if not isinstance(entry, dict):
                        errors.append(role + "_record_not_object")
                        continue
                    if not isinstance(entry.get("version"), str) or not entry["version"]:
                        errors.append(role + "_version_missing_or_invalid")
                    if role == "project" and key not in installed_keys and entry.get("optional") is not True:
                        errors.append("project_only_entry_not_optional")
                    if entry.get("integrity") is None and entry.get("inBundle") is True:
                        bundled += 1
                        if entry.get("resolved") is not None:
                            errors.append(role + "_bundled_has_resolved_url")
                    else:
                        check = validate_integrity(entry.get("integrity"))
                        if check:
                            errors.append(role + "_" + check)
                        else:
                            with_integrity += 1
                        check = validate_resolved(entry.get("resolved"))
                        if check:
                            errors.append(role + "_" + check)
                        else:
                            resolved_https += 1
    counted = Counter(errors)
    return {
        "schemaVersion": 1,
        "scope": "read-only full npm v3 lock namespace / SRI syntax / HTTPS metadata",
        "projectLockEntryCount": len(project_entries),
        "installedLockEntryCount": len(installed_entries),
        "projectOnlyOptionalEntryCount": project_only,
        "recordsInspectedAcrossBothLockfiles": scanned_records,
        "recordsWithValidSRIFormat": with_integrity,
        "recordsWithQualifiedHttpsMetadata": resolved_https,
        "bundledEntriesWithoutArchiveIntegrity": bundled,
        "unqualifiedCount": len(errors),
        "unqualifiedByKind": dict(sorted(counted.items())),
        "unqualifiedSample": errors[:MAX_PROBLEMS],
        "lockStructureQualified": not errors,
        "projectLockSha256": project_hash,
        "installedLockSha256": installed_hash,
        "rootManifestSha256": manifest_hash,
        "priorR32ConsistencyPassed": prior_result["lockConsistencyPassed"],
        "archiveBytesVerified": False,
        "registryProvenanceVerified": False,
        "semverSatisfactionVerified": False,
        "packageCodeExecuted": False,
        "actualLoadedModulesVerified": False,
        "realDevTokenEffectiveAccessVerified": False,
        "devActivationAuthorized": False
    }

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("unsupported_arguments")
    result = audit()
    print(json.dumps(result,separators=(",",":"),ensure_ascii=True))
    if not result["lockStructureQualified"]:
        raise SystemExit(1)
