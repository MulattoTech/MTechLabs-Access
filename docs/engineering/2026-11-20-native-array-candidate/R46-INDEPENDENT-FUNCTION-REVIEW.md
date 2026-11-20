# Access #44 — R46: independent source review and synthetic function-level qualification

**Disposition: source-only checks passed; the R45 candidate remains unaccepted pending hosted Windows qualification.**

## Fixed review inputs

- Source-only candidate branch: fix/access44-r43-native-array-candidate-20261120
- Reviewed candidate commit: b97f1b5a78ebda910e66e41db191a32a09be645f
- Frozen draft PR #45 head on which this candidate is based: f0855c1227aacc49071581bb52ba5566bc07ffce
- Historical native R6 Windows jobs: 136302296741 and 136302296679 failed the first real_identity_controls child. Separately, the R6 Linux upstream PDF control failed at job 136302296697.

GitHub and the owner-host git object store were checked independently at the start. The R45 branch HEAD was unchanged, PR45 remained open/draft/unmerged, and the R7 five-job Actions run still lacked executed test steps. No new hosted run was available for the R45 candidate.

## Exact full-branch source audit

Comparing the immutable R45 Git object content to the exact PR45 parent showed:

- Exactly **nine changed paths** across the R43 and R45 candidate commits.
- The executable Windows runtime PowerShell probe differs by **exactly two expressions**: the bounded input-buffer constructor and the subsequent native snapshot constructor. Reversing only these two expressions reconstructs the original probe bytes.
- The failure-only child fixture differs by **exactly four original buffer-command anchors and two frozen SHA-256 constants**; its pre-existing typed-buffer control remains intact, and all **32 instrumentation anchors** remain.
- Seven unchanged mandatory sources were compared byte-for-byte: the GitHub Actions workflow, native runtime caller, native fixture test, DEV identity test, upstream qualifier, and both upstream npm control/candidate lockfiles.

This source comparison did not run package code or modify production, accounts, tokens, ACLs, connectors or listeners.

## Newly closed local test gap

The original R45 synthetic constructor-parity check instantiated a separate in-memory class. It did not call the candidate PowerShell function Get-RuntimeNativeSnapshot, so it did not test whether Initialize-RuntimeNative executes before resolving the new typed native class.

The new [R46 synthetic function-level test](verify-native-snapshot-function-ps5.ps1) parses the R45 probe source, extracts **only** that four-line function, checks its body against an exact expected string, and substitutes a local in-memory Initialize-RuntimeNative stub. The stub defines a synthetic class **under the same namespace and type name but without any Win32 API calls**. The test dot-sources the exact checked function body, not the complete runtime probe.

In a fresh Windows PowerShell 5.1 process and a separate PowerShell 7 process, the test demonstrated:

- Successful parsing with no synthetic type defined initially;
- Lazy class initialization before the typed constructor resolves;
- Exact integer PID forwarding;
- Disposal of both returned synthetic objects;
- Success with PowerShell module autoloading disabled on the second call;
- Rejection of a deliberately invalid synthetic PID without constructing another object.

The fixture is entirely synthetic. It did **not** inspect a real PID, account, token, profile, ACL or protected IPC endpoint, and did not make any network request or execute an installed upstream package. These tests do not prove why the original R6 native fixture stalled, nor acceptance of its 18 required hosted native groups.

## Release decision

The source-only candidate is coherent, and the identified local function-order gap is now covered. Nothing in this review authorizes integrating or merging the R45 branch into PR45, rerunning blocked CI, or deploying production/DEV. The real Win32 path, native handle lifetime, IPC/cross-account denial, both required hosted Windows Node24 jobs, and upstream 0.3.1 PDF control plus 0.3.3 candidate lanes remain **not qualified**.

Preserve the exact source hashes. Restore GitHub Actions admission before obtaining independently reviewed hosted Windows/Linux results and immutable artifacts. Only then should ordinary expected-head PR integration and distinct actual-main acceptance be considered. Protected DEV identity, ACL parent, credential/route, backup and rollback operations under issue #46 require separate approval.

**No production code or services, account, ACL, key, credential, connector route, PR45 commit, hosted workflow or DEV activation was changed during this R46 review.**
