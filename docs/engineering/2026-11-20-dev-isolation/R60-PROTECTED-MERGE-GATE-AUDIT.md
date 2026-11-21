# R60 — Protected IPC release gate versus proposed repository PR automation

**Disposition: READ-ONLY advisory and verified counterexample. No PR merge, label, branch rule, account setting, CI dispatch or operational host change.**

## Independently checked live GitHub state

- Repository: `MulattoTech/MTechLabs-Access` (private). Authenticated GitHub API returned `branches/main.protected=false`; `/branches/main/protection` returned **HTTP 404: Branch not protected**; `/rulesets?includes_parents=true` returned an array of **length 0**. This is an observed configuration, not a prediction about available account plan features.
- Security-sensitive [PR #45](https://github.com/MulattoTech/MTechLabs-Access/pull/45) remains `open`, `draft=true`, `merged=false` at `f0855c1227aacc49071581bb52ba5566bc07ffce`. `autoMergeRequest=null`, no labels, no review approval. **No automated merge is currently active for PR45.**
- Independent [PR #47](https://github.com/MulattoTech/MTechLabs-Access/pull/47) proposes scheduled PR triage and native auto-merge, at head `b25c6a916cc1cdef783eeacc6b08c6bd51f3ac89`. It remains unmerged, so its scheduled workflow is *not* currently running from main.
- The current Actions admission issue remains run `44841780509`: five jobs failed before executing test steps, with account payment/spending-limit annotations.

## Reproducible source-specific risk

Inspected the *exact* PR47 `tools/ci/pr_backlog_triage.py` blob `43a57dc74204623d522164f5039a7d14c7d15c86` from an isolated clean checkout. Its `checks(sha)` returns `good=true` whenever **any** returned checks exist, none report failure, and none are pending. It does **not** compare reported job names to the protected IPC mandatory five-job set. Its `classify(pr)` can therefore report `ready` for a clean non-draft PR when only an unrelated successful check exists.

An isolated Python test used a *synthetic in-memory GitHub GET replacement* returning exactly one successful check named `unrelated-lint`, no statuses, and a fresh mock commit. The actual checked-out PR47 module classified it as **`state=ready, good=true`**, although **zero of the protected five jobs were present**. Test exit 0; real GitHub calls 0 during the synthetic classifier invocation. This does **not** demonstrate GitHub's GraphQL auto-merge mutation would succeed or that any real PR was enrolled.

Because `main` currently has no enforced branch protection or rulesets, there is also no independently observed repository-side requirement for all five checks or separate review. GitHub documents branch protection/rulesets as the supported enforcement mechanism for required checks/reviews. The PR47 script's `agent:hold` and draft guards are useful, but alone are not a durable, privileged-policy release boundary. PR45 is currently protected from PR47's enrollment path by **draft status**, not by an enforced merge policy.

## Recommended remediation before enabling broad automation

1. **Owner-reviewed branch protection/ruleset** for `main`: require PR reviews, fresh approvals after source changes, and the *exact unique* required check contexts appropriate to the protected IPC five-job workflow. Determine plan and required-check names from current GitHub settings. Do not blanket-change policy without a separate review of impacts on other agent-driven workflows.
2. **Explicit protected-work exemption in PR47 script**: refuse to auto-enroll or auto-update PR45 and other protected-security changes unless an independently reviewed, durable release-specific allowlist/gate is satisfied. Do not infer readiness from one unrelated success, skipped or neutral check, incomplete pagination, or non-hosted check; fail closed on missing or ambiguous mandatory evidence.
3. Consider a visible **`agent:hold`** for PR45 if/when PR47 is adopted, but **no label was created or added** in R60. Do not remove PR45 draft status or enable native auto-merge.
4. Restore GitHub Actions runner eligibility; execute the original full hosted Windows/Linux qualification and independently verify exact-head logs/artifacts, including the 0.3.1 PDF-control and actual Windows identity/IPC checks, before any protected merge.
5. DEV provisioning and activation remain separate gated operations requiring actual protected root/ACL identities, backup and rollback plans and explicit owner approval.

## Limitations and preservation

This is **not** proof of a currently exploitable GitHub merge. PR47 is unmerged, the PR45 draft has no auto-merge request, and whether GitHub would accept a future auto-merge GraphQL operation is not established. No branch-protection, workflow, code, production, account, credential, ACL, key, tunnel, connector, or DEV state was changed in this review.
