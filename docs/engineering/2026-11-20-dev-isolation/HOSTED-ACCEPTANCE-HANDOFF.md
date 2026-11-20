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
