# R64 — Bind generic PR-triage readiness to the intended hosted workflow

**Disposition:** isolated review-only source candidate. No PR45/PR47 merge, CI dispatch, branch-policy mutation, production operation, or DEV activation.

## Reviewed state

- Repository: `MulattoTech/MTechLabs-Access`; this review branch `fix/access44-r64-verified-actions-provenance-20261120` is forked from exact R63 source head `10e45c8ec9456206e118d7b45b2e1c5b787e0108`.
- Protected [PR45](https://github.com/MulattoTech/MTechLabs-Access/pull/45) remains open/draft/unmerged at `f0855c1227aacc49071581bb52ba5566bc07ffce`.
- Proposed [PR47](https://github.com/MulattoTech/MTechLabs-Access/pull/47) remains open/unmerged at `b25c6a916cc1cdef783eeacc6b08c6bd51f3ac89`.
- `main` is not branch-protected; the repository has zero rulesets. Latest Actions run `44841780509` was blocked before tests by account billing/spending admission.

## Reproduced R63 trust gap

The R63 guard required five completed/successful named GitHub Actions check-runs with the target SHA and `github-actions` app slug, but it did **not** establish that those checks originated in the intended workflow and actually executed its mandatory test stages. The original synthetic 28-test suite passed, yet adding a new test with all five matching names but no origin/run/step evidence generated **one failure out of 29**, because the R63 code marked those checks acceptable.

This is a *missing evidence boundary* in an unmerged triage source candidate, not a demonstrated real GitHub bypass or actual protected merge.

## R64 correction

- Require the five check-run `details_url` values to be exact URLs under this repository's `actions/runs/{run_id}/job/{job_id}` namespace. Check each ID and require one shared run with distinct jobs; reject unrelated hosts, repositories, malformed URLs and mixed runs.
- Fetch the exact recorded run using read-only GitHub REST. Require the pinned `workflow_id=402397153`, path `.github/workflows/check.yml`, matching PR head SHA, `event=pull_request`, completed `success` and a valid attempt number.
- Fetch that run's complete first page of jobs and require exactly the five expected jobs. Bind each job ID/name/run ID/head SHA and completed successful status to its check run.
- Require nonempty, executed successful steps identifying the critical stages: root `npm test/check/build` and generated UI verification; manager `npm test`; upstream Windows and Linux comparison and exact evidence preservation.
- Preserve the existing fail-closed check-name, branch protection, independent review, PR45 exclusion, source/docs file type, exact Git tree and head-drift guards.
- No raw logs, step output, credentials or private data are recorded by the verifier. Metadata alone is not proof of actual test correctness and cannot replace independent hosted artifact review.

## Local and historic live verification

- R64 local Python suite: **31/31 passed** using synthetic, fully mocked GitHub responses; three new test methods include negative cases for missing provenance, spoofed job URLs, wrong workflow ID/path/event, split runs, missing or skipped stages, zero steps and incorrect job IDs.
- `git diff --check` passed.
- Independently inspected the actual successful historical PR workflow run `44717749608` at source `274d6cda6831748dd80a8fe90ed951761a3783a0`. Its workflow ID is `402397153`, path `.github/workflows/check.yml`, and five successful jobs contain the expected required stages.
- Executed the R64 `checks(sha)` function **read-only** against that historical SHA using authenticated GitHub CLI GET requests and confirmed it returns `(True, False)`. No GitHub source or status changes were made. This validates real GitHub response-shape compatibility, **not** PR45 acceptance.
- The live read-only check initially failed with HTTP 401 because a synthetic `GITHUB_TOKEN` environment variable overrode CLI credentials; it was corrected by removing the synthetic variable *before* invoking authenticated GETs. No real credential value was read or included in evidence.

## Release posture

This branch remains review-only; it does not update or trigger PR47, and `main` has no enforced protections. Before any automation adoption, independently review this complete source candidate, configure owner-approved branch protection, restore Actions runner eligibility, and complete actual exact-head hosted qualification. The frozen Windows-native identity/IPC checks, 0.3.1 PDF control and all operational DEV security/rollback/activation gates remain outstanding.

No production service, Windows user/ACL, key, Cloudflare route, connector permission, GitHub billing setting, PR merge or DEV activation changed.
