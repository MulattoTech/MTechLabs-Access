# Access #44 / #46 — R48 GitHub Actions billing-admission and stacked draft PR handoff

**Disposition: SOURCE-ONLY / READ-ONLY. Do not create a PR, rerun CI, merge, install a broker, modify live Windows identities/ACLs or activate DEV from this plan.**

## Freshly verified identity and repository state (2026-11-20)

The GitHub connector and authenticated GitHub CLI independently confirmed:

| Gate | Observed identity or status | Interpretation |
| --- | --- | --- |
| Source repository | `MulattoTech/MTechLabs-Access` | Existing connected owner account `MulattoTech` |
| Existing PR #45 | `OPEN DRAFT`, base `main` at `15e851b11984592803d37599b639772e51e5c8c0`, head `feat/dev-reference-transport-20261120` at `f0855c1227aacc49071581bb52ba5566bc07ffce` | **Unmerged.** Recheck exact refs before any future PR operation |
| Candidate source branch | `fix/access44-r43-native-array-candidate-20261120` at `0da3a5f74453cfbed82e2d1d4f61e1bae64efe9b` | Clean and pushed. Historical R43/R45 patches and R46 additive tests, not hosted accepted |
| Git ancestry | Candidate R46 → R45 `b97f1b5` → R43 `b090674` → PR45 head `f0855c12` | Fast-forward descendant from the feature head, but not merged or accepted |
| Open PR listing | Only PR #45 | No existing stacked candidate PR |
| Workflow event | `pull_request` (unfiltered bases) and `push` to `main` | An ordinary candidate-branch push does **not** trigger hosted CI; opening a stacked draft PR ordinarily does |
| Repository Actions permission | `enabled=true`, `allowed_actions=all`, `sha_pinning_required=false` | Repository Actions is enabled; **does not prove billing/runner eligibility** |
| Candidate run search | No PR-triggered workflow run returned for R46 commit | No hosted acceptance evidence |
| PR45 R7 run | `44742255585`, attempt 2, completed failure; five required jobs, zero executed steps | Admission failed **before** tests; code not qualified |
| Recent repo runs | Last listed run R7, created `2026-11-20T13:12:21Z`; no newer success in 35 latest records | No observed repo-run evidence of restored admission |
| Personal Actions billing usage summary | Read-only GitHub API returned HTTP 404 | **Unavailable, not evidence of active hold or proof billing is restored** |

The user-level billing summary API is available only to eligible enhanced-billing accounts with suitable authorization. A 404 must not be reclassified as a zero balance, an exhausted limit, proof of payment failure, or proof of reinstatement. This handoff records *account admission as unknown*, not a present-tense account billing diagnosis. Source references: GitHub's current [billing and licensing guide](https://docs.github.com/en/billing/get-started/introduction-to-billing) and [billing usage API](https://docs.github.com/en/rest/billing/usage).

## Re-review before a future stacked pull request

The appropriate **future** stacked PR is:

- Repository: `MulattoTech/MTechLabs-Access`
- **head:** `fix/access44-r43-native-array-candidate-20261120` — expected `0da3a5f74453cfbed82e2d1d4f61e1bae64efe9b`
- **base:** `feat/dev-reference-transport-20261120` — expected `f0855c1227aacc49071581bb52ba5566bc07ffce`
- State: **draft**; title proposal: `[Draft] Qualify Windows native runtime constructor correction (Access #44)`
- Do **not** target `main` directly, rewrite PR45's head, merge either branch, weaken tests, or select a different source commit by inference.

No PR was created during R48. Opening a draft PR could immediately trigger **five** GitHub Actions jobs, so require fresh owner confirmation of GitHub Actions admission and a separately deliberate action before creation. If the feature or candidate branch moved, if a conflicting PR now exists, if workflow source changed, or if the billing/runner status cannot be established, **stop and re-review**. Never auto-run `gh pr create`, `gh run rerun`, `gh workflow run`, `git push --force`, or `gh pr merge` from this document.

The workflow checks out the pull-request merge context by default, while the upstream qualification job separately binds `MTERM_QUALIFICATION_CANDIDATE_SHA` to the pull-request **head SHA**. Independently reconcile head, synthetic merge commit, checked-out tree and artifact source identities; no PR comment or source-only hash can replace runner logs.

## Mandatory hosted-source acceptance if the account can run Actions

The frozen `.github/workflows/check.yml` declares five required jobs: `test`, `managed-mcp`, `managed-mcp-windows`, `Upstream qualification / ubuntu-latest / Node 24`, and `Upstream qualification / windows-latest / Node 24`. Require **actual executed runner steps**, then all **ten explicitly named required test/build/upstream stages**, then a successful complete job set. The prior read-only metadata verifier [read-only-actions-admission.ps1](read-only-actions-admission.ps1) already distinguishes these levels; its `admissionObserved=true` would still **not** prove source/security acceptance.

In addition to job status: collect independently verifiable immutable job logs, full source trees/commits, artifact identities and hashes. Require all 18 hosted Windows native isolation/security subgroups, permitted and denied cross-account reference transport cases, normal cleanup without emergency recovery, and both 0.3.1 control and 0.3.3 candidate real upstream PDF/compatibility lanes on the required operating systems. Existing R6 Windows native and Linux control-PDF failures remain **rejected**; the R43–R46 typed constructor proposal has only local source/synthetic tests and a still-unproven causal rationale.

After a stacked candidate PR is *actually hosted-qualified* and independently accepted, integration into the original PR45 feature branch is a **separate review/approval decision**, followed by fresh exact-head PR45 hosted qualification, expected-head merge to protected main and a **distinct actual-main** acceptance run. None of these results would automatically authorize DEV provisioning.

## Owner-level prerequisite and explicit stop condition

Before attempting the stacked PR, the owner should confirm the account's Actions eligibility in [GitHub Billing & Licensing](https://github.com/settings/billing) and address any actual payment/budget/limit restrictions there. The API information observed above does not expose a reliable `canStartRunner` flag. If the owner cannot verify eligibility, **keep the PR uncreated and do not try repeated workflow reruns**.

Issue #46 still separately requires a protected production and DEV ancestor namespace, safe backup/rollback, real restricted DEV account and profile, effective negative ACL canaries, distinct keys and routes, and specific operational authorization. Current production port 19740 and the inactive DEV port 19741 must remain unchanged until those gates are satisfied.

**R48 made no source/runtime modifications to PR45 or the R46 candidate, no PR, no new CI run, no credential changes, and no production/DEV operational changes.**
