# Access #44 / PR #45 / issue #46 — hosted acceptance handoff

**Point-in-time record: 2026-11-20. Source/design planning only.** This handoff does **not** accept or merge a pull request, rerun GitHub Actions, amend a Windows account/ACL, alter the running production manager, provision a protected broker, change credentials/Cloudflare/connector grants, or activate DEV.

## Source and provenance to preserve

| Record | Verified identity / disposition |
|---|---|
| Source repository | `MulattoTech/MTechLabs-Access` |
| Accepted main base for the transport batch | `15e851b11984592803d37599b639772e51e5c8c0` |
| [Access #44](https://github.com/MulattoTech/MTechLabs-Access/issues/44) | Transport source, independent tests, hosted qualification and eventual release claim; currently open |
| [Draft PR #45](https://github.com/MulattoTech/MTechLabs-Access/pull/45) | Head `f0855c1227aacc49071581bb52ba5566bc07ffce`, still draft and unmerged |
| [Access #46](https://github.com/MulattoTech/MTechLabs-Access/issues/46) | Separate owner-host Windows ancestor-ACL/DEV provisioning issue; currently open and design-only |
| This isolated branch | `docs/access46-dev-isolation-preflight-20261120`, additive planning/test source **not** merged into main or PR #45 |
| Required but unavailable hosted receipt | [R7 run 44742255585](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/44742255585), attempt 2; failed admission |

The GitHub-hosted PR45 run above reports `conclusion=failure`, but **all five jobs have zero executed steps** (read-only run metadata observed on 2026-11-20). Historical GitHub error messages report recent account payment failures or a spending-limit restriction. This is **not** a result of running any of the five test bodies, and it supplies **zero fresh acceptance evidence**. The account owner must resolve GitHub billing eligibility through [GitHub Billing & Licensing](https://github.com/settings/billing). Do not blindly rerun while the admission error persists.

## R48 repo Actions setting versus unverified account billing and stacked draft-PR trigger

The [point-in-time R48 readiness handoff](R48-STACKED-PR-ADMISSION-HANDOFF.md) and [sanitized snapshot](sanitized-r48-actions-stack-readiness-20261120.json) confirm: repository Actions permissions report **enabled** with `allowed_actions=all`, but GitHub account Actions billing/runner admission is **not independently verified**. The authenticated personal billing usage-summary API returned HTTP **404**, which is *not* evidence of either an active billing hold or a cleared one. The most recent 35 repository workflow runs contain **no later successful run** than failed PR45 R7 run `44742255585` (five jobs, **zero** executed steps; created 2026-11-20 13:12 UTC). Only PR45 remains open; the isolated R46 candidate head `0da3a5f` has no PR-triggered workflow result.

The frozen workflow responds to `pull_request` and pushes to `main`, **not** direct pushes of the isolated candidate branch. A future, separately approved **draft stacked PR** would use `head=fix/access44-r43-native-array-candidate-20261120` at `0da3a5f`, `base=feat/dev-reference-transport-20261120` at PR45 `f0855c12`. Creating it may immediately start Actions: do **not** do so until the owner checks GitHub Billing & Licensing and explicitly approves the trigger. Recheck both exact refs, source commit ancestry, workflow tree and duplicate PR status at that moment. The pull-request checkout may use a synthetic merge ref while an upstream environment variable separately binds the PR head; correlate both Git objects with actual runner logs and artifacts. None of this obviates the earlier rejected R6 native/PDF lanes, real hosted Windows/Linux tests, PR45 source review, expected-head merge, distinct postmerge actual-main acceptance or issue #46's separate operational approval. **R48 performed GET-only checks and authored docs/receipt, not CI, PR creation or deployment.**

## R49 executable pre-PR structural gate (never an Actions/merge authorization)

The [read-only stacked-PR preflight](read-only-stacked-pr-preflight.py), its [29 offline negative cases](read-only-stacked-pr-preflight.test.py) and [sanitized live check](sanitized-r49-stack-preflight-20261120.json) validate the exact R46 candidate branch against PR45's reviewed head/base using fixed GitHub **GET-only** API calls plus read-only Git worktree/object/remote identity queries. The gate checks source ancestry, clean checkout, workflow and probe Git blobs, the current single open draft PR, repository Actions enabled, and historical R7 five-job/zero-step status. It fails closed on moved branches, modified workflow/tested source, duplicate PRs, changed Actions history or unavailable metadata. Current structural identity matched and the new synthetic suite passed **29/29**, but *every* evaluation returns **accountBillingEligibility=UNVERIFIED**, **createDraftPRCurrentlyAuthorized=false**, **ciRerunAuthorized=false** and **devActivationAuthorized=false**. Run explicitly with Python 3 and an existing checkout of the exact isolated candidate:

```powershell
python .\read-only-stacked-pr-preflight.py --candidate-checkout 'C:\Users\Dylan\AppData\Local\Temp\MTechAccess44-R43-NativeArray-20261120'
python .\read-only-stacked-pr-preflight.test.py
```

Even a successful exit means only a point-in-time structural match, **not billing eligibility, runner admission, or runtime security acceptance**. A new GitHub Actions run has not been triggered. Owner billing/runner admission confirmation and a separately deliberate PR-triggering approval remain mandatory, followed by genuinely executed five-job candidate and actual-main acceptance.

## Source-controlled 0.3.1 control metadata and independent local byte match (R39)

A separate [read-only PR45 control-source pin checker](read-only-pr45-control-lock-pin.py) and [19-case synthetic suite](read-only-pr45-control-lock-pin.test.py) compare the *two* current H: root npm metadata files to the **actual exact PR45 `0.3.1` qualification-control Git blobs** and SHA-256 hashes. GitHub separately supplied blob IDs from exact head `f0855c1227aacc49071581bb52ba5566bc07ffce`. The owner-host `package.json` (243 bytes) and `package-lock.json` (317,405 bytes) were both identical, in Git blob and SHA-256, to `qualification/control-package.json` and `qualification/control-package-lock.json`, respectively. The [sanitized R39 receipt](sanitized-control-source-pin-20261120.json) preserves these identities and the blocked run without publishing file contents or account tokens. This **narrows** the input-drift question for the control lane; it does **not** assert that installed packages were made from cryptographically verified tarballs or that the 0.3.1 PDF lane is qualified. The distinct candidate manifest pins `0.3.3`; no candidate binary/package payload was installed or attested.

The read-only [Actions admission tool](read-only-actions-admission.ps1) itself was independently re-executed against the exact current PR head and historical R7 run. Its 29/29 synthetic tests passed; actual run 44742255585 still returned `admissionObserved=false`, 0 of 10 required test stages, and rejection reason `jobs_have_no_executed_steps`. GitHub returned **no workflow artifacts** and the first job log endpoint returned 404 `BlobNotFound`. These facts are *not* proof of a passing or failing code test, nor proof that billing settings were restored. Source-pin success cannot replace genuinely executed hosted Windows/native/upstream acceptance.

## Read-only admission check (not acceptance)

A small metadata-only script, [`read-only-actions-admission.ps1`](read-only-actions-admission.ps1), checks exactly this repository and **re-reads the current PR #45 head, base and open/draft state** using authenticated read-only `gh pr view`, followed by `gh run view` for the historical workflow metadata. The run's SHA must match the separately observed current PR head and expected reviewed base. It does not start/rerun jobs, modify billing or access hosted artifacts. Run from this directory on a Windows host with PowerShell 7+ and GitHub CLI:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\read-only-actions-admission.ps1 -RunId 44742255585 -ExpectedHeadSha f0855c1227aacc49071581bb52ba5566bc07ffce
```

For the observed blocked R7 run, the script returns `currentPrCandidateMatched=true`, `admissionObserved=false`, `completedWithSteps=0`, `observedRequiredStages=0` of **10**, `requiredTestStagesObserved=false`, `reason=jobs_have_no_executed_steps` and **exit code 1**. After billing restoration, provide the new actual run ID **only after** verifying the reviewed current PR head/base; if either changed, independent source review and the exact-head gate must be restarted. This checker refuses a stale run that points to a previous PR head, a changed base, or a PR that is no longer open/draft/unmerged.

The checker makes **two distinct decisions**. `admissionObserved=true` means each of the five exact-name jobs was completed with **at least one completed runner step**; checkout/setup alone can satisfy this and is *not proof that tests ran*. `requiredTestStagesObserved=true` requires metadata for **all ten frozen, explicitly named test/build/upstream step labels** to be completed with a success or failure conclusion: four root steps, one in each manager job, and two in each upstream job. A single missing, skipped or duplicate mandatory step label fails that condition. `workflowReportedSuccess` is true only when those ten mandatory steps and all five jobs are metadata-successful. Even this is **not independent execution or security acceptance**. The checker also pins `event=pull_request` and the frozen workflow name. It **always returns `independentlyVerified=false`, `actualMainAccepted=false` and `devActivationAuthorized=false`**. It neither downloads nor validates logs, artifacts, native subgroups, source identity or job runner provenance. An incomplete run or mismatched job set must not be interpreted as full admission.

[`read-only-actions-admission.test.ps1`](read-only-actions-admission.test.ps1) exercises the pure report classifier against **29 synthetic offline cases** (no GitHub/API call), including checkout-only runner admission, missing build/check and upstream package qualification stages, duplicate/skipped required steps, failed test steps, wrong event/workflow, wrong SHA/run ID, missing/duplicate/extraneous jobs, incomplete runs, absent metadata and eight current-PR identity/state negative cases. The two live wrong-pinned-head and wrong-pinned-base checks were additionally rejected without mutating the actual PR. Run:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\read-only-actions-admission.test.ps1
```

When actual job execution becomes possible, the distinct, immutable-evidence verifier remains [`verify-hosted.py`](https://github.com/MulattoTech/MTechLabs-Access/blob/f0855c1227aacc49071581bb52ba5566bc07ffce/docs/engineering/2026-11-20-reference-transport/verify-hosted.py), not this admission checker. Use the actual filename `verify-hosted.py` when invoking its `--manifest` or `--compare-manifests` CLI. The verifier source's introductory usage prose currently says `review_hosted.py`, which does **not** match its committed filename; that is a documentation-name mismatch, not evidence that a nonexistent alternate verifier ran. Populate the source-controlled candidate/main manifest templates with **real run, source tree, current local checkout path, full logs and artifact IDs** before invoking it. Never treat a placeholder template or this metadata-only checker as evidence acceptance.

## Frozen 0.3.1→0.3.3 lockfile drift and release-review focus (R40)

The [read-only exact PR45 upstream lock comparison](read-only-upstream-lock-delta.py), [23 disposable negative/positive tests](read-only-upstream-lock-delta.test.py), and [sanitized frozen-input receipt](sanitized-upstream-lock-delta-20261120.json) compare independently verified Git blob IDs and SHA-256 for the `0.3.1` control and `0.3.3` candidate lockfiles **at the exact PR45 head**. Control has **651** lockfile entries, candidate **681**, comprising **650 common**, **31 added**, **one removed**. The only common package-version change is Desktop Commander `0.3.1` → `0.3.3`; root package dependency metadata also changes. All 31 candidate-only entries are nonoptional, with no new `hasInstallScript: true` flag. The candidate adds new network/crypto-adjacent library dependencies including `mqtt`, `node-forge` and `socks`, and removes the old nested `@desktop-commander/telemetry-contract` 0.1.1 lockfile entry. This is a *source-lockfile delta*, **not** proof that any library is used at runtime, that telemetry disappeared, or that any security vulnerability exists. Future immutable source review should explicitly evaluate added networking capability, source provenance, HTTP/IPC egress policy, and fixture results without conflating it with actual traffic.

The comparison tool reads only separately acquired, byte-exact PR45 lockfile copies. The local source files were extracted from Git objects into disposable scratch and checked against GitHub's independently returned source blob IDs. **Do not invoke npm or execute installed package code to obtain this metadata.** The source-only match is also **not** acceptance of the historically failing `0.3.1` PDF-control test. The current R7 run still has 0/10 required test stages, so the separate Windows native and both upstream hosted gates remain mandatory; exact source review cannot be represented as successful hosted CI. No production code or workflow source was changed by R40.

## Historical PDF control still rejected; frozen gate unchanged (R41)

The [source-bound read-only PDF rejection checker](read-only-pdf-control-gate.py), [26 in-memory synthetic tests](read-only-pdf-control-gate.test.py) and [sanitized R41 evidence](sanitized-pdf-control-rejection-20261120.json) independently confirmed that the exact current PR45 source's workflow, upstream qualifier, qualification helper and client verifier are **byte-identical to the R6 rejection report's recorded source versions**. The source still defines the `pdf_create_and_read_fidelity` stage with **90 s** `write_pdf` and `read_file` call timeouts, PDF header and text-content fidelity checks, tool error rejection and failure-bound overall pass criteria. The historical R6 Linux control **0.3.1** passed eight prior stages but returned `write_pdf_tool_error` with a **timeout signal** at the PDF stage; **0.3.3** candidate passed ten stages, including PDF. R6 status is **REJECTED**, and the audit correctly preserves that status even if a candidate stage passes. The original record does not reveal the precise timeout operation or root cause; no causal correction is claimed. New R41 synthetic tests reject tampered source hashes, weakening/removing the PDF gate, altered timeouts, forged accepted status, missing failure signals, and false source identities. **No PDF was generated or upstream package executed**. Genuine hosted exact-head upstream control and candidate reruns with immutable artifacts remain required before release; neither this static source comparison nor a passing candidate-only PDF lane substitutes for them.

## Actual R6 Windows native-capture failures and line-ending qualification (R42)

The [R42 source-bound Windows native failure review](WINDOWS-R6-NATIVE-CAPTURE-REVIEW.md), [pure classifier](read-only-r6-native-stall.py), [synthetic negatives](read-only-r6-native-stall.test.py) and [sanitized actual R6 job logs](sanitized-r6-windows-native-stall-20261120.json) identify why both historic **Windows jobs** could not provide native transport acceptance. R6 job IDs **136302296741** (upstream qualification) and **136302296679** (managed-mcp-windows) independently failed the first `node-identity` child during `real_identity_controls`: the native PowerShell capture was killed near the 15,000-ms bound with zero stdout/stderr bytes; the separate failure-only diagnostic's last stage was **78**, immediately before an invocation of `New-Object char[] 16385`, without stage 79. This narrows the stalled code boundary, but **does not prove the underlying cause**. The Git LF source (10,474 bytes, SHA-256 `7dc933d63876199fdfce8cdbf856f914163a9ff30d85b03f5c0fbc6be5bca0ca`) and its CRLF Windows copy (10,659 bytes, SHA-256 `f288c56bc06647c920ee4de335d0df368e98ff426469a8e44af896214995b64d`) are exactly equivalent under newline conversion, not source drift. Current PR45 adds only an extra failure-only diagnostic bootstrap probe; the executable probe still uses `New-Object` and no newly hosted proof exists. A proposed intrinsic `[char[]]::new(16385)` substitution is **not applied**; it requires exact-source pin and test updates and genuinely hosted separate-account/native evidence before claiming success. Never pass a child exit error merely because ordinary owner-user PowerShell 5.1 accepts either array syntax.

## Five jobs that must genuinely execute

The exact PR45 version of [`.github/workflows/check.yml`](https://github.com/MulattoTech/MTechLabs-Access/blob/f0855c1227aacc49071581bb52ba5566bc07ffce/.github/workflows/check.yml) defines the following matrix after checking out the candidate source. These are **five jobs**, with **two separate native Windows qualification invocations**:

| Job | Hosted runner | Mandatory evidence |
|---|---|---|
| `test` | Ubuntu / Node 24 | Root tests, source check and build; generated UI unchanged |
| `managed-mcp` | Ubuntu / Node 24 | Manager package install without lifecycle scripts and full manager tests |
| `managed-mcp-windows` | Windows / Node 24 | Manager tests with `MTERM_DISPOSABLE_REFERENCE_QUALIFICATION=1`, including native disposable-host fixture |
| `Upstream qualification / ubuntu-latest / Node 24` | Ubuntu / Node 24 | Full manager tests, **both exact upstream lanes**, clean source and an immutable reports artifact |
| `Upstream qualification / windows-latest / Node 24` | Windows / Node 24 | Full manager/native tests, **both exact upstream lanes**, clean source and an immutable reports artifact |

**No status green by inference.** The hosted tests must run and pass on the pinned exact PR head. A GitHub job that is administratively rejected before steps begin is **not** a failed code test and is **not** eligible for acceptance.

## What each hosted Windows report must establish

The [actual native suite](https://github.com/MulattoTech/MTechLabs-Access/blob/f0855c1227aacc49071581bb52ba5566bc07ffce/integrations/mcp-manager/test/reference-transport-native.test.mjs) defines **18 required disposable identity/ACL/pipe subgroups**. They include:

- Separate actual standard-user tokens and profiles; signed reference read in DEV without direct production reads, private-key reads, or writer effects
- Unauthorized real requester rejection; owner/DEV pipe endpoint identity and substitution resistance
- Protected private signing material/source/bootstrap ACLs, including unsafe ancestors and replacement attempts
- Remote pipe rejection with a positive control; hazardous module search path rejection; boundary/framing/timeout/cancellation and eight-concurrent admission/drain controls
- Final owned processes and all fixture accounts/objects cleaned up **naturally**, without emergency recovery; original manager state unchanged

The source test explicitly asserts `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`, `RUNNER_OS=Windows`, and fixture opt-in. **Do not fake these environment variables on the owner's PC** or treat local PowerShell/Node smoke checks as substitutes for real hosted identities.

## Known historical rejections to keep distinct

- The previous hosted Windows disposable identity fixture failed during setup/identity diagnostic before all 18 native subgroups could complete. Local diagnostic patches did not replace true hosted qualification.
- A prior Linux upstream-qualification artifact for R6 recorded the **0.3.1 control** failing at PDF creation/read fidelity with `write_pdf_tool_error` and a timeout signal, while **0.3.3 candidate** passed that stage. The source record [`r6-linux-upstream-rejection-review.json`](https://github.com/MulattoTech/MTechLabs-Access/blob/f0855c1227aacc49071581bb52ba5566bc07ffce/docs/engineering/2026-11-20-reference-transport/r6-linux-upstream-rejection-review.json) marks the historical candidate **rejected**, without a proven causal root cause. Do not silently accept control failure or relax timeouts.
- The latest R7 run never executed any jobs because of GitHub account admission. It cannot confirm that prior Windows failures, upstream failures, or source-review requirements are resolved.

## Required chronological acceptance sequence

1. **Billing restored by the account owner.** Confirm admission with a genuine run whose steps actually execute. Do not change GitHub token scopes, payment settings or billing on the owner's behalf.
2. **Pin an exact candidate.** Confirm PR45 head, base, source tree, workflow and frozen native/portable/upstream fixtures; if any source changes, restart the relevant independent-review and exact-head gates.
3. **Pass all five candidate jobs.** Require correct hosted identity, 18 native Windows subgroup outcomes in **both Windows jobs**, exact upstream control/candidate reports on both operating systems, no unexpected skip/failure and evidence of normal cleanup.
4. **Independently review immutable evidence.** Compare source hashes, full log and artifact identity, run ID/attempt, job identity and outcome using [`verify-hosted.py`](https://github.com/MulattoTech/MTechLabs-Access/blob/f0855c1227aacc49071581bb52ba5566bc07ffce/docs/engineering/2026-11-20-reference-transport/verify-hosted.py) and its frozen contract. A verifier failure is a rejection, not a reason to fabricate a manifest.
5. **Only after source acceptance**, consider the normal expected-head PR45 merge; then require a **separate actual-main five-job hosted acceptance** and durable issue #44 closing evidence. A candidate run is not the post-merge run.
6. **Only later and with separate concrete approval**, follow issue #46 to choose protected production and DEV roots, preserve the H: sibling workloads, prove actual owner/runtime/DEV token effective rights, plan and test rollback, and provision the independent DEV identity. **DEV activation remains disabled** pending its own positive and negative operational checks.

**Operational source/runtime compatibility note:** [C: authority and executable review](sanitized-c-root-authority-review-20261120.json) resolves the earlier broad “other” ACL categories under `C:\Program Files` to Windows built-in TrustedInstaller/CREATOR OWNER, while retaining real-token/child-ACL qualification as a no-go gate. The owner host's selected shared Node executable has **27 alpha** file-version metadata; PR #45's frozen hosted jobs use **Node 24**. A successful Node 24 source CI run does not by itself qualify a future production or DEV cutover on the local Node 27 alpha binary. No runtime or binary change is made by this observation.

**Separate operational dependency:** [Operational isolation and rollback review plan](OPERATIONAL-ISOLATION-CHANGE-PLAN.md) prepares the owner-host source/ACL/startup and reversible protected-root decision. That design cannot be executed merely because the candidate CI eventually passes; it still requires a second, concrete operational approval and actual DEV token/effective-rights qualification.

**After source acceptance, before any operational cutover:** [PRODUCTION-RELOCATION-REFERENCE-AUDIT.md](PRODUCTION-RELOCATION-REFERENCE-AUDIT.md) provides the exact-head H: hardcoding/side-effecting utility inventory to review alongside the protected-root [operational change plan](OPERATIONAL-ISOLATION-CHANGE-PLAN.md). Neither is an installation authorization; existing production Cloudflare origin and port 19740 must not be retargeted automatically.

## What is already available, but is not hosted acceptance

The isolated [issue #46 diagnostic directory](https://github.com/MulattoTech/MTechLabs-Access/tree/docs/access46-dev-isolation-preflight-20261120/docs/engineering/2026-11-20-dev-isolation) includes:

- A read-only Windows owner-host preflight with a private 9-path SDDL/type/reparse baseline. Last locally observed: **9/9 matched**, seven separate design blockers; production exclusive `127.0.0.1:19740` and owner invocation observations consistent; no listener at 19741.
- **49/49** owner-host regression tests, with no operational changes.
- **15/15** portable Windows ACL helper tests requiring no private owner-host baseline or DEV account.
- A mutation-sensitivity suite that detects **7/7** deliberately broken classifier changes; timeout/output guards and forged-stdout/forged-stderr negative controls passed locally.

These four forms of local evidence do **not** assert effective DEV permissions, hosted runner status, native pipe/ACL identity isolation, upstream package interoperability, trusted loaded source or protected authority bootstrap acceptance.

### Next action when GitHub Actions can start jobs

Verify the PR45 head has not moved, obtain a genuinely started five-job run, and independently inspect the complete hosted receipts **before** attempting a merge or any real Windows provisioning. If billing remains blocked, record the status once and **do not rerun repeatedly**. Neither this handoff nor another local-only test can remove that external prerequisite.
