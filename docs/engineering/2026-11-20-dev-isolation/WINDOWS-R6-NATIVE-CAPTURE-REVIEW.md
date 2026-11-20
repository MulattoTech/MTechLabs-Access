# Access #44 / #46 — R42: two independent R6 Windows native-capture failures

**Status: SOURCE/EVIDENCE TRIAGE ONLY. Historical jobs were rejected. No code fix, hosted retry, or operational change is claimed.**

## Source and evidence

GitHub Actions R6 run 44740386851, attempt 1, has two independently retrieved native Windows job logs:

| Job | Job ID | Failure | Failed stage |
| --- | --- | --- | --- |
| Upstream qualification / windows-latest / Node 24 | 136302296741 | fixture_child_exit_wrong | real_identity_controls |
| managed-mcp-windows | 136302296679 | fixture_child_exit_wrong | real_identity_controls |

Only public enum, count, bounded timing, stage and source-hash identities were retained in [the sanitized R6 Windows evidence](sanitized-r6-windows-native-stall-20261120.json); no raw logs, private Windows SIDs, profiles or tokens are published. [Read-only source/trace validator](read-only-r6-native-stall.py) and [in-memory regression cases](read-only-r6-native-stall.test.py) qualify the report against the exact historical and current PR45 Git objects, without executing Windows fixture accounts or external packages.

Historical R6 source revision: 9d29623f45a079eb3430466eceb44aac864becd9. PR45 current source head during this review: f0855c1227aacc49071581bb52ba5566bc07ffce (open draft). Recheck the remote PR identity before future use; the local validator uses fixed git object identities and does not requery the live PR.

## Recorded observations — not root-cause proof

Both hosted jobs completed disposable setup including source copies and initial ownership ACL, then successfully ran the first authority node-profile child (expected/actual exit 0). Their next node-identity child exited 1 instead of 0 with error identifier runtime_observation_unavailable, before any of the 18 native security/identity test cases completed.

The failing child was in native_capture; its Windows PowerShell subprocess was killed with SIGTERM after 15,023–15,026 ms and yielded zero decoded stdout/stderr bytes. A separate failure-only derivative probe also timed out after about 15 seconds. Its final marker was stage 78; stage 79 was absent. R6 diagnostic source places stage 78 immediately before the buffer creation command:

    $buffer = New-Object char[] 16385

Stage 79 would follow that command. This narrows the observed boundary to the cmdlet call or resolution path. It does NOT establish whether module auto-loading, the command implementation, a restricted runner environment, or another cause produced the stall. The derivative is expressly NON-ACCEPTANCE evidence; no causal fix is proven by observing its markers. Both test records also reported zero fixture cleanup errors, but did not establish a passing native suite.

## Git source and Windows line-endings

The executable integrations/mcp-manager/windows-runtime-probe.ps1 has the same Git blob in R6 and PR45 (485b9a76e818d899a6bde9c34b9139652c53ed56).

- Git LF source: 10,474 bytes, SHA-256 7dc933d63876199fdfce8cdbf856f914163a9ff30d85b03f5c0fbc6be5bca0ca
- CRLF checkout equivalent: 10,659 bytes, SHA-256 f288c56bc06647c920ee4de335d0df368e98ff426469a8e44af896214995b64d

The latter exactly matches the historical copied-source hash from both hosted R6 reports. The difference is newline normalization, not a changed executable probe.

The *diagnostic fixture* changed after R6: historical reference-transport-child.mjs Git blob 2aab4bdcd07a8f37f5e32d5dd8105e36749662b6 expected 31 instrumentation anchors; current PR45 blob 1291e3031c2cb437b04915afaedb516507aed321 expects 32 and adds a typed-buffer and PowerShell.Utility import control before the original New-Object diagnostic. The actual executable Windows probe still invokes New-Object. R7 ran zero steps, so this enhanced diagnostic was not hosted-qualified.

An owner-user PowerShell 5.1 syntax-only comparison showed both New-Object char[] 16385 and [char[]]::new(16385) produce equivalent zero-initialized System.Char arrays of length 16,385. It did not use the separate hosted/restricted Windows identity or prove native fixture success.

## Proposed minimal source-only remediation — NOT APPLIED

An independently reviewable candidate would replace the cmdlet buffer allocation with:

    $buffer = [char[]]::new(16385)

This may eliminate reliance on New-Object cmdlet/module resolution without changing the intended buffer type or size, but no observed evidence proves that the original cmdlet itself was the cause. Do not declare this a fix or apply it to the running H: production.

A candidate patch must update frozen source object identities, exact diagnostic anchor and derivative-source pins, and source-binding tests while preserving 15-second bounds, protected identity/pipe tests, negative canaries and complete cleanup. Both genuinely hosted Windows jobs must then pass all 18 native subgroups on the exact new head; genuine Linux/Windows control 0.3.1 and candidate 0.3.3 upstream lanes, PDF fidelity, independent artifact review, a normal protected merge, distinct actual-main acceptance and later separate operational approval remain mandatory.

**No production code, credentials, Windows account/ACL, Cloudflare connector, CI run or DEV activation was changed during R42.**
