#!/usr/bin/env python3
"""Access #46 R39: bounded, read-only installed control manifest source pin.

Checks two non-secret package metadata files from H: against the *exact*
GitHub-tracked PR45 0.3.1 qualification control file bytes, independently
observed as of 2026-11-20. Does not contact GitHub or execute package code.
The pinned Git blobs and SHA-256 are a source-control comparison, not proof
that installed package tarballs, process memory, host ACLs or loaded code are
authentic. The current PR identity must be independently checked each time.
"""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import stat

ROOT = Path(r"H:\MTechLabs\MCP")
SOURCE_PR = 45
SOURCE_HEAD = "f0855c1227aacc49071581bb52ba5566bc07ffce"
MAX_META_BYTES = 512 * 1024
EXPECTED = {
    "package.json": {
        "repoPath":"integrations/mcp-manager/qualification/control-package.json",
        "blobSha1":"e4283b1edc780ccbe8d91afd1ceabf6361d756aa",
        "sha256":"af4f183d2fa4fe814fdc78f8201ebc7b704a8c89b3c2ef9e981dc6ef8c1d82e5",
        "bytes":243,
    },
    "package-lock.json": {
        "repoPath":"integrations/mcp-manager/qualification/control-package-lock.json",
        "blobSha1":"a33ce717dafe46ac9af17e89fa0bbefcccd07b92",
        "sha256":"aebd4d167353bb2a5c46865df019ffdc9d95ef904419e7fa695f5df7642aa813",
        "bytes":317405,
    }
}
REPARSE = getattr(stat,"FILE_ATTRIBUTE_REPARSE_POINT",0x400)
MAX_ERRORS = 10

def is_link(info):
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info,"st_file_attributes",0) & REPARSE)

def identity(info):
    # Comparable on path/open handles under observed Windows implementation.
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)

def read_bounded(path: Path):
    """Read byte snapshot from regular non-reparse file with time-of-read guards."""
    try:
        parent=os.lstat(path.parent)
        first=os.lstat(path)
        if not stat.S_ISDIR(parent.st_mode) or is_link(parent):
            return None,"unqualified_immediate_parent"
        if not stat.S_ISREG(first.st_mode) or is_link(first):
            return None,"unqualified_metadata_file"
        if first.st_size > MAX_META_BYTES:
            return None,"metadata_file_too_large"
        with open(path,"rb") as handle:
            opened=os.fstat(handle.fileno())
            if (not stat.S_ISREG(opened.st_mode) or is_link(opened)
                    or identity(opened)!=identity(first)):
                return None,"file_changed_before_read"
            raw=handle.read(MAX_META_BYTES+1)
            closed=os.fstat(handle.fileno())
            if (len(raw)>MAX_META_BYTES or len(raw)!=opened.st_size
                    or identity(closed)!=identity(opened)
                    or closed.st_ctime_ns!=opened.st_ctime_ns):
                return None,"file_changed_during_read"
        last=os.lstat(path)
        if (not stat.S_ISREG(last.st_mode) or is_link(last)
                or identity(last)!=identity(first)
                or last.st_ctime_ns!=first.st_ctime_ns):
            return None,"file_changed_after_read"
        return raw,None
    except OSError:
        return None,"file_unavailable"

def git_blob(raw: bytes):
    return hashlib.sha1(
        b"blob "+str(len(raw)).encode("ascii")+b"\x00"+raw
    ).hexdigest()

def strict_json(raw):
    def reject_duplicates(pairs):
        d={}
        for key,val in pairs:
            if key in d:raise ValueError("duplicate_json_property")
            d[key]=val
        return d
    value=json.loads(raw.decode("utf-8-sig"),object_pairs_hook=reject_duplicates)
    if not isinstance(value,dict):
        raise ValueError("json_root_not_object")
    return value

def audit(root: Path=ROOT, expected=EXPECTED):
    errors=[]
    files_compared=0
    fingerprints={}
    objects={}
    for basename in ("package.json","package-lock.json"):
        pin=expected.get(basename)
        if (not isinstance(pin,dict) or set(pin)!={"repoPath","blobSha1","sha256","bytes"}):
            errors.append("source_pin_definition_invalid")
            continue
        raw,failure=read_bounded(root/basename)
        if failure:
            errors.append(failure)
            continue
        current_blob=git_blob(raw)
        current_sha=hashlib.sha256(raw).hexdigest()
        fingerprints[basename]={"bytes":len(raw),
                                "observedBlobSha1":current_blob,
                                "observedSha256":current_sha}
        if len(raw)!=pin["bytes"]:
            errors.append("expected_byte_size_mismatch")
        if current_blob!=pin["blobSha1"]:
            errors.append("github_blob_identity_mismatch")
        if current_sha!=pin["sha256"]:
            errors.append("frozen_sha256_mismatch")
        try:
            objects[basename]=strict_json(raw)
        except (UnicodeError,TypeError,ValueError):
            errors.append("metadata_json_invalid")
        files_compared+=1

    if len(objects)==2:
        root_manifest=objects["package.json"]
        lock=objects["package-lock.json"]
        name="mtechlabs-local-mcp-runtime"
        deps={"@wonderwhy-er/desktop-commander":"0.3.1"}
        rootlock=lock.get("packages",{}).get("") if isinstance(lock.get("packages"),dict) else None
        installed_rec=lock.get("packages",{}).get(
            "node_modules/@wonderwhy-er/desktop-commander"
        ) if isinstance(lock.get("packages"),dict) else None
        if (root_manifest.get("name")!=name or root_manifest.get("version")!="1.0.0"
            or root_manifest.get("private") is not True
            or root_manifest.get("dependencies")!=deps):
            errors.append("control_root_manifest_semantics_changed")
        if (type(lock.get("lockfileVersion")) is not int or lock["lockfileVersion"]!=3
            or not isinstance(rootlock,dict) or rootlock.get("name")!=name
            or rootlock.get("version")!="1.0.0" or rootlock.get("dependencies")!=deps
            or not isinstance(installed_rec,dict) or installed_rec.get("version")!="0.3.1"):
            errors.append("control_lock_semantics_changed")
    else:
        if not errors:
            errors.append("both_manifest_files_not_qualified")
    return {
        "schemaVersion":1,
        "scope":"installed H: root manifest/lock vs exact PR45 tracked control blobs",
        "pinnedPrNumber":SOURCE_PR,
        "pinnedPrHeadSha":SOURCE_HEAD,
        "metadataFilesRead":files_compared,
        "metadataFileFingerprints":fingerprints,
        "unqualifiedCount":len(errors),
        "unqualifiedByKind":dict(sorted(Counter(errors).items())),
        "unqualifiedSample":errors[:MAX_ERRORS],
        "exactControlMetadataSourcePinMatched":not errors,
        "currentPrHeadIndependentlyRecheckedByThisScript":False,
        "installedTarballIntegrityVerified":False,
        "npmRegistryPublisherVerified":False,
        "runtimeLoadedCodeVerified":False,
        "hostWriteIsolationVerified":False,
        "npmOrPackageCodeExecuted":False,
        "filesModified":False,
        "prodCutoverAuthorized":False,
        "devActivationAuthorized":False
    }

if __name__=="__main__":
    import sys
    if len(sys.argv)!=1:
        raise SystemExit("unsupported_arguments")
    result=audit()
    print(json.dumps(result,separators=(",",":"),ensure_ascii=True))
    if not result["exactControlMetadataSourcePinMatched"]:
        raise SystemExit(1)
