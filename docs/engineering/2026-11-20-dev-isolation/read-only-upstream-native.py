#!/usr/bin/env python3
"""Access #46: bounded metadata-only native/helper artifact scan of package roots.

Uses the sibling dependency-closure classifier, no installed package imports,
file execution, filesystem changes or network. Skips nested node_modules (which
are inventoried separately), reparse directories and unknown/unqualified paths.
"""
from collections import Counter
import hashlib
import os
from pathlib import Path
import stat

from importlib.machinery import SourceFileLoader
source=Path(__file__).with_name("read-only-upstream-closure.py")
scan=SourceFileLoader("read_only_upstream_closure",str(source)).load_module()
ROOT=scan.DEFAULT_NODE_MODULES
MAX_FILES=120000
MAX_DIRECTORIES=32000
EXTENSIONS={".node",".dll",".exe",".so",".dylib",".wasm"}
NO_EXTENSION_BIN_NAMES={"rg","chrome","chromium","firefox","pdftotext"}

def audit():
    closure=scan.inventory(ROOT,ROOT/scan.START_NAME)
    if closure["capsHit"] or closure["requiredOrMetadataUnqualifiedCount"] or closure["queueUnfinished"]:
        raise ValueError("declared_package_roots_unqualified")
    visited_files=0
    visited_dirs=0
    found=[]
    skipped_links=0
    scan_capped=False
    file_types=Counter()
    for rel in closure["relativePackageRoots"]:
        base=ROOT/Path(rel)
        ok,reason=scan.relative_safe(ROOT,base)
        if not ok:raise ValueError("package_root_became_unqualified:"+str(reason))
        for current,dirs,files in os.walk(base,topdown=True,followlinks=False):
            visited_dirs+=1
            if visited_dirs>MAX_DIRECTORIES:
                scan_capped=True;break
            kept=[]
            for d in dirs:
                if d.lower()=="node_modules":continue
                cand=Path(current)/d
                try:
                    info=os.lstat(cand)
                    if scan.has_reparse_or_link(info):
                        skipped_links+=1
                        continue
                    if not stat.S_ISDIR(info.st_mode):
                        continue
                    kept.append(d)
                except OSError:
                    skipped_links+=1
            dirs[:]=kept
            for file in files:
                visited_files+=1
                if visited_files>MAX_FILES:
                    scan_capped=True;break
                p=Path(current)/file
                ext=p.suffix.lower()
                if ext not in EXTENSIONS and file.lower() not in NO_EXTENSION_BIN_NAMES:
                    continue
                try:
                    s=os.lstat(p)
                    if scan.has_reparse_or_link(s):
                        skipped_links+=1
                        continue
                    if not stat.S_ISREG(s.st_mode):
                        continue
                except OSError:
                    skipped_links+=1
                    continue
                kind=ext if ext else "unextended-helper"
                file_types[kind]+=1
                found.append({"rel":p.relative_to(ROOT).as_posix(),"kind":kind,"bytes":s.st_size})
            if scan_capped:break
        if scan_capped:break
    metadata_fingerprint=hashlib.sha256(
        "\n".join(sorted(f"{x['rel']}|{x['kind']}|{x['bytes']}" for x in found)).encode("utf-8")
    ).hexdigest()
    return {
        "schemaVersion":1,"scope":"installed package roots: bounded file metadata for native/helper artifacts",
        "declaredPackageRoots":len(closure["relativePackageRoots"]),
        "directoriesVisited":visited_dirs,"filesExamined":visited_files,
        "nativeOrHelperCandidates":len(found),
        "types":dict(sorted(file_types.items())),
        "reparseOrUnverifiedPathsSkipped":skipped_links,
        "scanCapped":scan_capped,
        "candidateMetadataSha256":metadata_fingerprint,
        "nativeOrHelperFileMetadata":found,
        "importsExecuted":False,"nativeFilesExecuted":False,
        "binaryBytesHashed":False,"transitiveRuntimeGraphVerified":False,
        "effectiveWindowsRightsVerified":False,"devActivationAuthorized":False
    }

if __name__=="__main__":
    import json
    import sys
    result=audit()
    if len(sys.argv)==1:
        result.pop("nativeOrHelperFileMetadata")
    elif len(sys.argv)==2 and sys.argv[1]=="--relative-candidates":
        pass
    else:
        raise SystemExit("unsupported_arguments")
    print(json.dumps(result,separators=(",",":")))
