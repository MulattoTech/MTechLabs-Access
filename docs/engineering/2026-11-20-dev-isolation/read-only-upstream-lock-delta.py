#!/usr/bin/env python3
"""Access #46 R40 — read-only source-pinned upstream 0.3.1 -> 0.3.3 lock delta.

This scanner compares exact PR45 Git-tracked lockfile *bytes* and summarizes
the dependency and metadata drift. It NEVER executes npm, package scripts,
imports installed code, contacts the registry or claims hosted acceptance.

Use --control and --candidate pointing to disposable copies of the two source
blobs. CLI requires the frozen PR45 exact SHA-256 and Git object identities.
Tests supply independently pinned synthetic fixtures; no operational flags.
"""
from collections import Counter
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
from urllib.parse import urlsplit

SOURCE_HEAD="f0855c1227aacc49071581bb52ba5566bc07ffce"
PR_NUMBER=45
PINS={
    "control":{
        "blob":"a33ce717dafe46ac9af17e89fa0bbefcccd07b92",
        "sha256":"aebd4d167353bb2a5c46865df019ffdc9d95ef904419e7fa695f5df7642aa813",
        "bytes":317405,
        "repoPath":"integrations/mcp-manager/qualification/control-package-lock.json"
    },
    "candidate":{
        "blob":"cfda8deced19bf449f2b6c169d6cd4ec25f2251d",
        "sha256":"1d28de913c330ce071735b594367e110c5752cec5a476d6da8bd327f6f52c143",
        "bytes":330771,
        "repoPath":"integrations/mcp-manager/upstream-package-lock.json"
    }
}
MAX_LOCK_BYTES=1048576
MAX_PACKAGE_ENTRIES=2000
MAX_REPORT_ITEMS=12
REPARSE=getattr(stat,"FILE_ATTRIBUTE_REPARSE_POINT",0x400)

def git_blob(raw):
    return hashlib.sha1(b"blob "+str(len(raw)).encode("ascii")+b"\x00"+raw).hexdigest()

def is_reparse(meta):
    return stat.S_ISLNK(meta.st_mode) or bool(getattr(meta,"st_file_attributes",0)&REPARSE)

def read_bound(path):
    try:
        parent=os.lstat(path.parent)
        first=os.lstat(path)
        if not stat.S_ISDIR(parent.st_mode) or is_reparse(parent):
            return None,"parent_not_ordinary_directory"
        if not stat.S_ISREG(first.st_mode) or is_reparse(first):
            return None,"input_not_ordinary_file"
        if first.st_size>MAX_LOCK_BYTES:
            return None,"lock_file_oversized"
        with open(path,"rb") as f:
            opened=os.fstat(f.fileno())
            if (not stat.S_ISREG(opened.st_mode) or is_reparse(opened)
                    or (opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns)
                    != (first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns)):
                return None,"input_changed_before_read"
            raw=f.read(MAX_LOCK_BYTES+1)
            final=os.fstat(f.fileno())
            if (len(raw)>MAX_LOCK_BYTES or len(raw)!=opened.st_size
                    or (final.st_dev,final.st_ino,final.st_size,final.st_mtime_ns,final.st_ctime_ns)
                    !=(opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns,opened.st_ctime_ns)):
                return None,"input_changed_during_read"
        last=os.lstat(path)
        if ((last.st_dev,last.st_ino,last.st_size,last.st_mtime_ns,last.st_ctime_ns)
            !=(first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns,first.st_ctime_ns)):
            return None,"input_changed_after_read"
        return raw,None
    except OSError:
        return None,"input_unavailable"

def parse_lock(raw):
    def unique(pairs):
        obj={}
        for k,v in pairs:
            if k in obj:raise ValueError("duplicate JSON key")
            obj[k]=v
        return obj
    try:
        x=json.loads(raw.decode("utf-8-sig"),object_pairs_hook=unique)
        if (not isinstance(x,dict) or type(x.get("lockfileVersion")) is not int
                or x.get("lockfileVersion")!=3 or not isinstance(x.get("packages"),dict)
                or len(x["packages"])>MAX_PACKAGE_ENTRIES):
            return None,"unqualified_npm_v3_lock"
        p=x["packages"]
        if ("" not in p or not isinstance(p[""],dict)
            or any(not isinstance(k,str) or not isinstance(v,dict) for k,v in p.items())):
            return None,"unqualified_lock_entries"
        return x,None
    except (UnicodeError,ValueError,TypeError):
        return None,"invalid_or_duplicate_lock_json"

def one_lock(path,pin):
    problems=[]
    if not isinstance(pin,dict) or set(pin)!={"blob","sha256","bytes","repoPath"}:
        return None,["invalid_source_pin"]
    raw,error=read_bound(path)
    if error:
        return None,[error]
    if len(raw)!=pin["bytes"]:problems.append("source_file_size_mismatch")
    if git_blob(raw)!=pin["blob"]:problems.append("source_git_blob_mismatch")
    if hashlib.sha256(raw).hexdigest()!=pin["sha256"]:problems.append("source_sha256_mismatch")
    obj,why=parse_lock(raw)
    if why:problems.append(why)
    return obj,problems

def audit(control:Path,candidate:Path,pins=PINS):
    problems=[]
    inputs={}
    for which,path in (("control",control),("candidate",candidate)):
        obj,reason=one_lock(path,pins.get(which))
        if reason:problems.extend(which+"_"+x for x in reason)
        inputs[which]=obj

    old=(inputs["control"] or {}).get("packages",{})
    new=(inputs["candidate"] or {}).get("packages",{})
    added=[]
    removed=[]
    changes=[]
    root_versions={}
    if not problems:
        for label,entry in (("control",inputs["control"]),("candidate",inputs["candidate"])):
            if entry.get("name")!="mtechlabs-local-mcp-runtime" or entry.get("version")!="1.0.0":
                problems.append(label+"_root_name_or_version_changed")
            expected="0.3.1" if label=="control" else "0.3.3"
            root=entry["packages"].get("",{})
            if (root.get("name")!="mtechlabs-local-mcp-runtime"
                or root.get("version")!="1.0.0"
                or root.get("dependencies")!={"@wonderwhy-er/desktop-commander":expected}):
                problems.append(label+"_root_package_dependency_changed")
            dc=entry["packages"].get("node_modules/@wonderwhy-er/desktop-commander")
            if not isinstance(dc,dict) or dc.get("version")!=expected:
                problems.append(label+"_upstream_version_unqualified")
            root_versions[label]=expected
        for key in sorted(set(new)-set(old)):
            record=new[key]
            added.append({
                "path":key,
                "version":record.get("version"),
                "optional":record.get("optional") is True,
                "installScriptFlag":record.get("hasInstallScript") is True
            })
            if (not isinstance(record.get("version"),str)
                    or not isinstance(record.get("integrity"),str)
                    or not record["integrity"]
                    or not isinstance(record.get("resolved"),str)
                    or urlsplit(record["resolved"]).scheme!="https"):
                problems.append("added_lock_package_without_expected_metadata")
        for key in sorted(set(old)-set(new)):
            removed.append({"path":key,"version":old[key].get("version")})
        for key in sorted(set(old)&set(new)):
            left,right=old[key],new[key]
            fields=sorted(k for k in set(left)|set(right)
                          if left.get(k)!=right.get(k))
            if fields:
                changes.append({
                    "path":key,
                    "changedFields":fields,
                    "controlVersion":left.get("version"),
                    "candidateVersion":right.get("version")
                })
    counts=Counter(problems)
    complete=(not problems)
    return {
        "schemaVersion":1,
        "scope":"exact-source PR45 npm 0.3.1 control vs 0.3.3 candidate dependency lockfile diff",
        "pinnedPR":PR_NUMBER,
        "pinnedHead":SOURCE_HEAD,
        "controlLockEntries":len(old),
        "candidateLockEntries":len(new),
        "unchangedOrChangedCommonEntries":len(set(old)&set(new)),
        "addedLockEntries":len(added),
        "removedLockEntries":len(removed),
        "candidateAddedNonoptionalEntries":sum(not x["optional"] for x in added),
        "candidateAddedInstallScriptFlags":sum(x["installScriptFlag"] for x in added),
        "addedPackageSummaries":added,
        "removedPackageSummaries":removed,
        "changedCommonEntrySummaries":changes,
        "changedCommonEntryCount":len(changes),
        "sourcePinsAndLockStructuresQualified":complete,
        "unqualifiedCount":len(problems),
        "unqualifiedByKind":dict(sorted(counts.items())),
        "unqualifiedSample":problems[:MAX_REPORT_ITEMS],
        "registryOrPackageArchiveAccessed":False,
        "npmOrInstalledCodeExecuted":False,
        "currentLivePRHeadRecheckedByThisScript":False,
        "networkCapabilityEquivalentToActualEgress":False,
        "publisherTrustOrRuntimeClosureAttested":False,
        "historicalPdfFailureResolved":False,
        "hostedSourceAcceptanceVerified":False,
        "prMergeAuthorized":False,
        "devActivationAuthorized":False
    }

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--control",required=True,type=Path)
    parser.add_argument("--candidate",required=True,type=Path)
    args=parser.parse_args()
    result=audit(args.control,args.candidate)
    print(json.dumps(result,indent=2,ensure_ascii=True))
    if not result["sourcePinsAndLockStructuresQualified"]:
        raise SystemExit(1)
