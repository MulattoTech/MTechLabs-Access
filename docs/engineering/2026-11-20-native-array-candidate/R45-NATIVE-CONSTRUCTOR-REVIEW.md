# Access #44 — R45 follow-up: eliminate the remaining New-Object dependency

**Status: isolated source-fix candidate, not approved or hosted-qualified.**

Starting from the separately published R43 candidate commit b090674b359512dc50749f55f65170e1ac393e2a (itself based on draft PR #45 exact head f0855c1227aacc49071581bb52ba5566bc07ffce), the subsequent R44 clean-checkout review verified a minimal buffer-allocation change. A further R45 review found a **second** New-Object invocation in the same Windows runtime probe. This is an important coverage gap for the *hypothesis* that command/module resolution contributed to the historical R6 stall; it does **not** establish that hypothesis as a fact.

## Source changes, exactly scoped

R43 already changed the bounded character-buffer expression:

    $buffer = [char[]]::new(16385)

R45 proposes changing the remaining native snapshot constructor:

    return New-Object -TypeName MTechLabs.DevRuntime.ProcessSnapshot -ArgumentList $ProcessId

to:

    return [MTechLabs.DevRuntime.ProcessSnapshot]::new($ProcessId)

This preserves the public C# constructor's single integer PID argument and produces the same type implementing IDisposable. The existing try/finally cleanup of the native snapshot, process-token/profile queries, error-to-unverified handling, and all 15-second process deadlines remain unchanged.

R45 also refreshes the two exact source/derived-hash pins in test/fixtures/reference-transport-child.mjs. The R43 four original diagnostic string changes, including all 32 failure-only instrumentation anchors, remain intact. No fixture code runs as a result of this source-only review. No workflow, security gate or npm dependency has been modified.

New immutable source identities after the proposed second line change:
- Normalized executable probe SHA-256: 650e96e36ed0c6cc95139f5422fce1840f66b5308a16a0cf7442cc7da8d26322
- Normalized failure-only derivative SHA-256: 19960fe28dbb8ab9c6138cd4de3662e6a1ba48e955766608d6e7f020b760affe
- Failure-only derivative instrumentation anchors: 32, unchanged

These hashes record source consistency only. R6 observed the boundary at instrumentation stage 78 before buffer allocation, but did not observe the native snapshot constructor. Therefore the reason for making this second change is **preventive completeness under an unproven hypothesis**, not new proof that it caused a failure.

## Synthetic and source-only validation

The [Node source-only regression suite](native-array-source-candidate.test.cjs) tests the exact two-line reversible change against the original PR #45 probe bytes, four R43 diagnostic command references, both frozen source/derivative hashes and all 32 anchors. It requires the original 15-second caller deadline, input-size guards, native process identity functions, and explicit failure-only/no-acceptance behavior.

[PowerShell buffer source checker](verify-native-array-ps5.ps1) and [synthetic native-constructor parity checker](verify-native-constructor-ps5.ps1) run in new Windows PowerShell 5.1 and PowerShell 7 sessions. They parse the candidate source without executing it. The constructor checker creates only an in-memory synthetic IDisposable type with a public int constructor; it verifies parity of ordinary and direct constructor results, argument preservation, disposal behavior, and the typed constructor with module auto-loading disabled. **It does not query any actual Windows account, profile, token, ACL, listener or interprocess transport.**

At R45 preparation: 16/16 source-bound Node tests and both checks in each PowerShell version passed. Local Node is 27 alpha and cannot substitute for the required hosted Node 24.

## Acceptance and operational no-go gates

The R45 candidate is only a proposal. The owner production H: installation, client entrypoints, accounts, permissions, credentials and DEV port 19741 were not modified. GitHub Actions has not been retried. PR #45 is still an unmerged draft and remains subject to a five-job hosted source acceptance block. Its historical R6 Windows native identity suite and 0.3.1 upstream PDF control still require genuine qualifying runs.

A separate review and a **genuinely admitted** GitHub-hosted Windows Node 24 run must qualify the exact new source head, two mandatory Windows jobs, all 18 native identity/security subgroups and normal process cleanup; both upstream 0.3.1 and 0.3.3 PDF/compatibility lanes, immutable logs/artifacts and Linux jobs must also pass. No timeouts may be relaxed and neither historical rejection may be reclassified. Future PR integration, normal main merge and distinct postmerge acceptance must be separately reviewed. Issue #46's later real restricted DEV-token/ACL-negative canaries, protected root, backup, rollback, routes and keys require explicit operational authorization.

**Do not promote this isolated branch as fixed or accepted until those independent gates are satisfied.**
