# R57 — Bounded PDF phase trace concurrency guard

**Disposition: source-only review candidate, not accepted or deployable.**

## Scope and exact ancestry

- Parent: R56 PDF candidate commit `8f39d2791d16edb0b54f957354b5ca2b06fadddb` on `fix/access44-r56-pdf-phase-observation-20261120`.
- This checkpoint is on a *new*, separately cloned review branch, `fix/access44-r57-pdf-phase-guard-20261120`.
- Only the self-contained PDF phase recorder, its disposable tests, and this engineering note change. The executable qualifier's calls, frozen markdown, deadlines, PDF assertions, original R46 Windows probe, PR #45, workflow, and production do not change.

## Reproduced gap

R56 checks chronological phase order from completed `report.pdfPhases` entries. However the current phase is recorded only after its asynchronous callback returns. Two simultaneous calls for the same report/phase could therefore both be admitted before either result was recorded.

A new synthetic regression test reproduced the defect on the *unmodified* R56 helper: **6/7 tests passed; one new concurrency-negative test failed with `Missing expected rejection`**. This is a diagnostic state-integrity gap in the source candidate, **not evidence that production or the historic R6 PDF run exhibited such concurrency**.

## R57 correction and negative controls

- Use a module-private `WeakSet` of reports with a phase currently in flight.
- Reject overlapping phase attempts with existing fixed `qualification_pdf_phase_contract`, without entering a second action or exposing raw error data.
- Always release the in-flight report marker in a nested `finally` even if result recording unexpectedly throws.
- Preserve original source phase order, error propagation, sanitization, 180,000-ms recorded-duration cap, and all original R56 success/failure evidence.
- Explicit tests verify duplicate attempts are refused, later phases cannot run before the first completes, and separate reports remain independent.

## Observations, not release acceptance

- Post-correction local run: **8/8** focused Node test cases passed. Original five R56 test cases remain green.
- JavaScript syntax checks and `git diff --check` passed.
- Local Node is `v27.0.0-alpha.0.0.0`, **not** hosted Node 24.
- No actual upstream PDF, Chrome/browser, Windows identity, installed production package, or Github-hosted Windows/Linux acceptance was run. No new root cause for the historical 0.3.1 PDF timeout was established.
- The existing workflow triggers on PRs and main pushes; this branch-only publication is deliberately not a PR or CI dispatch.

**External blocker:** The latest inspected GitHub Actions run `44841780509` failed before any test steps with account payment/spending-limit admission annotations. PR #45 remains draft/unmerged at `f0855c1227aacc49071581bb52ba5566bc07ffce`. Restore runner eligibility and independently review the exact complete source and test evidence before any stacked PR, merge, or DEV activation. No production/user/ACL/key/route/connector settings are authorized to change here.
