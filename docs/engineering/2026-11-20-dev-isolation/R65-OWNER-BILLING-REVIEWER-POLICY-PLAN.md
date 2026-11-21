# R65 — Owner-side prerequisites before protected-IPC release

**READ-ONLY planning and evidence. These draft branch-protection API bodies are NOT applied and are NOT release authorization.**

## Verified repository and Actions state

- Repo: private, user-owned `MulattoTech/MTechLabs-Access`, default branch `main` at `15e851b11984592803d37599b639772e51e5c8c0`; authenticated GitHub API reports admin access.
- `main.protected=false`; zero effective repository rulesets.
- The current owner account is the **only repository collaborator**; **zero** non-owner collaborators and **zero** independent write-authorized reviewers. PR #45 was authored by that owner and is still draft/unmerged at `f0855c1227aacc49071581bb52ba5566bc07ffce`. PR #47 remains open/unmerged at `b25c6a916cc1cdef783eeacc6b08c6bd51f3ac89`.
- GitHub does not count PR-author self-approval. Configuring **one required approval with admin enforcement now would block normal merging**, so DO NOT apply that setting before an independent trusted reviewer is available. A qualifying collaborator's access is an explicit owner decision; do not automatically invite anyone.
- The authenticated GitHub `/user` endpoint does **not** include `plan`. This is **not evidence** that the account is on Free or Pro. GitHub documentation states private-repository classic branch protection requires GitHub Pro, Team or Enterprise. Verify eligible plan in GitHub Billing & Licensing UI.
- The current main commit has exactly five `completed/success` GitHub Actions check runs, all from verified GitHub Actions app ID `15368`:
  - `test`
  - `managed-mcp`
  - `managed-mcp-windows`
  - `Upstream qualification / ubuntu-latest / Node 24`
  - `Upstream qualification / windows-latest / Node 24`
- Historical main success establishes available check names and app provenance only; it does **not** qualify PR45. Last observed run `44841780509` failed five jobs **before execution**, with the GitHub annotation saying recent account payments failed **or** the spending limit must be increased. This message does not distinguish its possible billing causes.

## The first owner-controlled step: restore runner eligibility

1. Open https://github.com/settings/billing → **Billing & Licensing**. Review payment information, failed transactions/authorization holds, Actions budgets/limits, and plan eligibility. Do not assume available free minutes prove billing is healthy; GitHub documents that a failed authorization hold can block even free-tier usage.
2. If no correctable issue is visible, contact GitHub Support with run ID `44841780509` and the exact admission error. Do not change security policy, add payment details through chat, or trigger repeated identical runs to diagnose a billing lock.
3. Only when account eligibility is restored, authorize **one** bounded genuine workflow re-run on the exact frozen protected head, then inspect **all five executed jobs, immutable head, upstream 0.3.1 PDF control, Windows restricted-identity fixture, and artifact lineage**. An older green run cannot substitute.

## Staged repository protection plan — owner review first

Because a strict one-review rule would currently lack an eligible independent reviewer, the proposal has two **separate** phases:

### Phase A: checks-only enforcement (conditional, NOT applied)

Only if the personal plan actually supports private branch protections and the owner approves its impact on autonomous agents:
- Target exactly `main`, not all development branches.
- Require `strict=true`, the five exact `github-actions` contexts above (pin app ID `15368`), enforce for admins, require conversation resolution, disallow force pushes and deletion.
- Set `required_pull_request_reviews=null` while the independent reviewer is unavailable.
- This strengthens ordinary CI enforcement **but does not satisfy R61–R64 generic auto-merge guard** or independently authorize protected IPC merges. Keep PR47 generic auto-merge disabled; keep PR45 draft. Note GitHub branch protection accepts `success`, `neutral` and `skipped` statuses for required contexts, so explicit executed-step and artifact verification remains necessary.

### Phase B: one independent approval (conditional, NOT applied)

After an owner-authorized **independent reviewer with write access** is available and can approve future PRs:
- Preserve Phase A strict requirements and enable at least one required approval, stale-review dismissal, and admin enforcement.
- Verify an actual unrelated reviewer can satisfy the branch gate without bypassing it. Confirm impact on all active autonomous workflows and ensure an agreed rollback path before changing settings.
- PR45 still requires its own frozen exact-head qualification, native security fixture and original PDF control; a reviewer and branch policy do **not** turn red/zero-step CI into acceptance.

The sanitized `R65` JSON receipt contains **illustrative, unapplied** REST body candidates for both phases. Do not send those bodies automatically. GitHub's current branch-protection API uses `required_status_checks.checks` with `context` and optional `app_id` to pin a check provider; the owner must verify fields and plan at execution.

## Final preservation and limitations

No GitHub branch policy/ruleset, billing budget, collaborator, PR, Actions run, repository implementation, Windows user/ACL/service, production listener, Cloudflare tunnel, connector, protected secret, or DEV activation was modified. This evidence is a plan, not proof of account-billing recovery or future reviewer availability. The final protected security-release gates remain **closed**.
