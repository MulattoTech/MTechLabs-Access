# Access #46 — read-only DEV isolation preflight

**Status: design and diagnostic source only. Not installed, merged, or authorized for activation.**

This directory contains a narrowly scoped Windows PowerShell 7 preflight for the proposed independent MTerm-CLI DEV environment. It does **not** implement account provisioning, permissions changes, production relocation, reference-authority installation, startup migration, or routing changes. It belongs to [issue #46](https://github.com/MulattoTech/MTechLabs-Access/issues/46), which follows successful source qualification of [issue #44 / PR #45](https://github.com/MulattoTech/MTechLabs-Access/pull/45). GitHub Actions billing admission and the required five hosted gates remain unresolved.

## Source

[read-only-preflight.ps1](read-only-preflight.ps1) is intentionally pinned to the documented owner-host paths and the existing, private nine-object ACL baseline. The baseline's *SHA-256 digest* is in source, **not the baseline's raw SDDL or account identifiers**. The private baseline is retained locally under:

`%LOCALAPPDATA%\MTechLabs\MTermEngineering\Issue46\acl-baseline-20261120.json`

There is no automatic ACL backup, restore, install, account creation, mutation or elevation behavior. This script reads that baseline **once into a bounded byte snapshot (maximum 64 KiB)**, verifies SHA-256 of those same bytes, strictly decodes UTF-8, and then compares current ACL SDDL strings, filesystem object types (file versus directory), and reparse-point flags. It does not separately reopen the file to parse it after hashing; it never prints raw security descriptors, SIDs, owner names, account/profile paths, process command lines or token/credential contents. It checks eleven declared paths, including candidate directory names that currently do not exist. The candidate roots are *proposals*, not allocated or validated locations.

## Invocation

Run under the owner's existing ordinary Windows context using PowerShell **7 or later**:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\read-only-preflight.ps1
```

The output is one JSON diagnostic document. A report with `baseline.status="matched"`, `startup="configured-exact"`, and `listeners.production="listener-present"` means *those particular read-only observations* passed; **it is not an approval ticket**. `activationAuthorized`, `provisioned` and `readyForDevActivation` remain `false` regardless of readings. The script does not test under the absent `MTermDev` token and cannot attest current running source, same-ACL/same-type object replacement, hardlink aliases, alternate links or namespace races, OS-enforced isolation, Cloudflare or connector grants. Matching attributes are **point-in-time observations, not immutable object-identity attestation**.

A mismatch, inaccessible ACL or path lookup, denied account query, missing or nonlocal baseline location, unexpected startup shortcut or absent production listener is reported as a blocker or unverified observation; the tool does not auto-repair or retry. The private-baseline digest pins only one collected snapshot, not future legitimate changes; any later approved change requires a fresh owner-reviewed baseline and controlled rollout.

## Repeatable non-destructive checks

[read-only-preflight.test.ps1](read-only-preflight.test.ps1) exercises the diagnostic through seventeen bounded checks without installing software or altering system configuration:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\read-only-preflight.test.ps1
```

It verifies successful parsing, a static deny-list of mutating/network command invocations, an ordinary read-only assessment with all activation flags false, fail-closed behavior when the local baseline is absent, and fail-closed behavior when `Get-Acl` is synthetically denied, and additional refusal cases for inaccessible path lookup, inaccessible baseline lookup, denied local-user query, and inaccessible DEV-profile lookup, missing/relative/remote `LOCALAPPDATA` baseline roots and public-output sanitization, synthetic reparse-point substitution with unchanged ACL, file/directory substitution, and denied filesystem-object metadata, independence from the former separate `Get-FileHash`/`Get-Content` baseline readers, and a static single-read/bounds/decoding contract. It also checks the diagnostic's source hash is unchanged after execution. The test's output is a sanitized JSON receipt with `passed: 17` or a nonzero exit on failure. This is **not** an OS security proof or test under a DEV identity.

## Recorded local qualification (2026-11-20)

- PowerShell AST parse: **zero syntax errors**.
- Exact positive control: baseline **9/9 matching** ACL SDDL, object-type, and reparse-flag records; production Startup shortcut exactly matches the sign-in launcher; production loopback listener present, DEV listener absent.
- Reported **seven blockers**: broad mutation ACEs on three H: ancestors; missing DEV principal/profile; absent protected reference installation; unverified hosted source acceptance; and unverified actual DEV token/effective access.
- Negative control: an absent baseline produces `baseline-not-matched`, keeps all activation flags false.
- Negative control: a synthetic failing `Get-Acl` produces `acl-unverified:hRoot`, keeps all activation flags false.
- Negative controls: a thrown H: `Test-Path` reports `unverified` and `acl-unverified:hRoot` instead of terminating; denied baseline lookup is `unverified`; denied local-account lookup is **not** misreported as `absent`; denied DEV-profile lookup is `unverified`. All retain disabled activation flags.
- Missing, relative or remote `LOCALAPPDATA` values produce a sanitized `baseline.status=unverified` report instead of terminating. Baseline reads are constrained to an absolute fixed local drive; the private snapshot is not loaded from a UNC path. The additional negative tests assert this, and check the public JSON for raw SID/private path leakage.
- Synthetic namespace-substitution controls: a production ancestor that becomes a junction/reparse point while keeping its existing ACL must result in `baseline.status=drift`, `baseline-not-matched` and `reparse-ancestor:hProduction`; changing the object from directory to file must also cause drift; denying `Get-Item` metadata must report `unverified`. No live junction, file, or ACL was created or modified.
- Single-read control: even with the former separate baseline cmdlets synthetically disabled, the same-byte hash/strict-decode path retains **9/9 baseline matches**. A static check requires one `FileStream`, the 64 KiB bound, strict UTF-8 and in-memory SHA-256. This narrows the verification/read inconsistency but does **not** attest a native file ID, safely handle all concurrent replacement races or authorize an operational trust anchor.
- The local source file remained hash-stable during both tests. A source-only branch is used to preserve work without initiating another billing-blocked GitHub Actions run.

These are owner-host diagnostics, **not GitHub-hosted, cross-account, native pipe/ACL or upstream qualifications**.

## Operational boundary and later acceptance

Do not apply blanket inheritance resets to `H:\` or `H:\MTechLabs`: three unrelated immediate directories coexist with the production MCP directory. Before any independently authorized change:

1. Resolve GitHub Actions billing eligibility and obtain fresh exact-head hosted Windows/Linux acceptance for PR #45, including 18 disposable Windows subgroups, both upstream versions, independent source review, normal expected-head merge and separate actual-main checks.
2. Choose explicitly between independently protected relocation to verified Program Files/ProgramData roots and a carefully scoped H: parent-namespace ACL design; map rights for production owner, SYSTEM, Administrators and real DEV SID, including directory deletion/rename and alias/race checks. A child-only state ACL is insufficient.
3. Verify the intended protected root's parent permissions and atomically reserve the candidate names against squatting. Existing `C:\ProgramData` has broad create/write permissions; this script cannot promise safety merely because a candidate folder is absent.
4. Capture a *fresh, protected operational* ACL/owner/identity restoration manifest, independently qualify backup/rollback and production startup identity, and run effective-access denial controls on disposable canaries, never destructive production files.
5. Provision real DEV account/profile, protected public trust, independent authority keys, separate state/upstream directories, edge/App/AUD/grants and the launcher **only after separate concrete owner approval**. Keep DEV activation disabled until live positive/negative route tests and explicit activation approval.

See issue #46 for the current-versus-proposed ACL inventory and staged rollback proposal. Neither a green JSON preflight nor a clean local test is merge/release acceptance.
