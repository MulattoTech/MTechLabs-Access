#!/usr/bin/env python3
"""Access #46 R38: static, non-executing script-disabled staging policy validator.

Validates a *design-only* immutable sketch of an isolated npm ci command and
its required safeguards. Does not invoke npm, spawn processes, authorize any
install, attest OS egress, verify signatures, or read production credentials.

Only hard-coded, documented plan fields are accepted. The checker NEVER marks
the proposed staging operation authorized: all evidence remains unverified.
"""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).parent
PLAN_PATH = HERE / "proposed-scriptless-staging-policy.json"
MAX_POLICY_BYTES = 16384
MAX_ERRORS = 20
CANONICAL_COMMAND = ["ci", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"]
EXPECTED_KEYS = {
    "schemaVersion", "policyId", "status", "observedCheckpoint",
    "proposedNpmStep", "mandatoryDesignControls", "evidenceState",
    "disabledOperations", "authorship"
}
EXPECTED_CHECKPOINT = {
    "source": "R37 installed npm lifecycle metadata (read-only, untrusted H: tree)",
    "sourceCommit": "67dd019b8f6947748df2d7e9cd9255295d14802b",
    "lifecycleFingerprintSha256": "9bda7986e204a73d41634ddd6c52a1e6cb8212e56555a452af7c882bb5571d79",
    "installHookPackages": 2,
    "assetConditions": [
        "desktop-commander-postinstall-telemetry-and-ripgrep",
        "puppeteer-postinstall-browser-download"
    ]
}
REQUIRED_CONTROLS = (
    "disposableWorkspaceOutsideExistingProduction",
    "independentlyTrustedPackageArchivesRequired",
    "existingHNodeModulesReuseForbidden",
    "osNetworkEgressDenialRequired",
    "privateTokensAndUserProfilesNotMounted",
    "nonAdministratorDisposableIdentityRequired",
    "noProductionOrDevListenerStart",
    "noInstallLifecycleExecution",
    "browserRipgrepNativeAssetQualificationRequired",
    "protectedParentAclAndRealTokenCanariesRequired",
    "rollbackAndServiceContinuityReviewRequired"
)
EXPECTED_EVIDENCE = {
    "hostedPR45CandidateChecks": "blocked",
    "independentlyPinnedSourceArchives": "unverified",
    "protectedCodeAndStateRoots": "unverified",
    "osEgressDenyOnDisposableRunner": "unverified",
    "standaloneOfflineCacheProvenance": "unverified",
    "browserRipgrepNativeArtifacts": "unverified",
    "effectiveRestrictedDevTokenRights": "unverified",
    "rollbackRehearsal": "not-performed",
    "separateOperationalApproval": "not-granted"
}
DISABLED = [
    "npm-ci","npm-install","npm-rebuild","npm-pack","npm-exec",
    "product-start","prod-cutover","dev-activation"
]
AUTHORSHIP = "source-only policy sketch; no trust/publisher authenticity asserted"

def read_plan(path=PLAN_PATH):
    """Bounded JSON, rejecting duplicate keys and linked policy files."""
    try:
        info = os.lstat(path)
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            return None, None, "not_regular_policy_file"
        if getattr(info, "st_file_attributes", 0) & getattr(stat,"FILE_ATTRIBUTE_REPARSE_POINT",0x400):
            return None, None, "policy_reparse_file"
        if info.st_size > MAX_POLICY_BYTES:
            return None, None, "policy_oversized"
        with open(path,"rb") as f:
            raw = f.read(MAX_POLICY_BYTES+1)
        if len(raw) > MAX_POLICY_BYTES:
            return None, None, "policy_oversized"
        def reject_duplicates(pairs):
            out={}
            for name,value in pairs:
                if name in out:raise ValueError("duplicate_key")
                out[name]=value
            return out
        parsed=json.loads(raw.decode("utf-8-sig"),object_pairs_hook=reject_duplicates)
        if not isinstance(parsed,dict):
            return None,None,"policy_root_unqualified"
        return parsed, hashlib.sha256(raw).hexdigest(), None
    except (OSError,UnicodeError,ValueError,TypeError):
        return None,None,"policy_unreadable_or_invalid"

def assess(data, policy_sha=None):
    issues=[]
    if not isinstance(data,dict):
        data={}
        issues.append("policy_not_object")
    if set(data)!=EXPECTED_KEYS:
        issues.append("policy_keys_unqualified")
    if type(data.get("schemaVersion")) is not int or data.get("schemaVersion")!=1:
        issues.append("schema_unqualified")
    if data.get("policyId")!="access46-r38-disposable-script-disabled-staging":
        issues.append("policy_id_unqualified")
    if data.get("status")!="DESIGN_ONLY_NO_EXECUTION_AUTHORITY":
        issues.append("operational_status_not_design_only")
    if data.get("observedCheckpoint")!=EXPECTED_CHECKPOINT:
        issues.append("r37_observed_hook_anchor_changed")
    command=data.get("proposedNpmStep")
    if not isinstance(command,dict) or set(command)!={
        "executable","argumentVector","shellInvocation","executeInThisCheckpoint"
    }:
        issues.append("npm_step_schema_invalid")
    else:
        if command.get("executable")!="npm":
            issues.append("npm_program_unqualified")
        if command.get("argumentVector")!=CANONICAL_COMMAND:
            issues.append("npm_script_disabled_offline_args_unqualified")
        if command.get("shellInvocation") is not False:
            issues.append("shell_execution_not_disabled")
        if command.get("executeInThisCheckpoint") is not False:
            issues.append("execution_not_forbidden")
    controls=data.get("mandatoryDesignControls")
    if not isinstance(controls,dict) or set(controls)!=set(REQUIRED_CONTROLS):
        issues.append("design_control_set_unqualified")
    else:
        for key in REQUIRED_CONTROLS:
            if controls.get(key) is not True:
                issues.append("required_control_missing_or_false")
                break
    evidence=data.get("evidenceState")
    if evidence!=EXPECTED_EVIDENCE:
        # These statuses are a frozen, unverified checkpoint. Editing "verified"
        # into a JSON field is not a trustworthy security attestation.
        issues.append("unverified_evidence_checkpoint_altered")
    disabled=data.get("disabledOperations")
    if disabled!=DISABLED:
        issues.append("disabled_actions_unqualified")
    if data.get("authorship")!=AUTHORSHIP:
        issues.append("design_authorship_unqualified")
    problems=Counter(issues)
    return {
        "schemaVersion":1,
        "scope":"source-only static staging command and mandatory controls design",
        "planSha256":policy_sha,
        "staticDesignValidated":not issues,
        "unqualifiedCount":len(issues),
        "unqualifiedByKind":dict(sorted(problems.items())),
        "unqualifiedSample":issues[:MAX_ERRORS],
        "proposedNpmCommand":CANONICAL_COMMAND,
        "npmInstallOrAnyOtherProcessExecuted":False,
        "lifecycleHooksExecuted":False,
        "osEgressActuallyEnforced":False,
        "packageArchivesIndependentlyAuthenticated":False,
        "protectedRootsAndRealDevTokenVerified":False,
        "rollbackExecuted":False,
        "hostedPR45AcceptanceVerified":False,
        "outstandingEvidenceGateCount":len(EXPECTED_EVIDENCE),
        "outstandingEvidenceGateNames":list(EXPECTED_EVIDENCE),
        "stagingOperationAuthorized":False,
        "productionCutoverAuthorized":False,
        "devActivationAuthorized":False
    }

if __name__=="__main__":
    import sys
    if len(sys.argv)!=1:
        raise SystemExit("no_arguments_supported")
    obj, sha, error = read_plan()
    outcome=assess(obj,sha)
    if error:
        outcome["unqualifiedCount"]+=1
        outcome["unqualifiedByKind"][error]=1
        outcome["unqualifiedSample"].append(error)
        outcome["staticDesignValidated"]=False
    print(json.dumps(outcome,separators=(",",":"),ensure_ascii=True))
    if not outcome["staticDesignValidated"]:
        raise SystemExit(1)
