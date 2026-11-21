# R62 — Fail-closed documentation allowlist for access PR triage

**Status:** isolated engineering-source checkpoint. PR #45, PR #47, `main`, GitHub billing/settings and production remain unchanged.

## Exact baseline

- Repository: `MulattoTech/MTechLabs-Access` (private).
- Previous isolated R61 review commit: `ecd93f7b57d80819d78fdbff210bd23df6a0659f`; upstream automation PR #47 remains at `b25c6a916cc1cdef783eeacc6b08c6bd51f3ac89`.
- PR #45 remains open, draft and unmerged at `f0855c1227aacc49071581bb52ba5566bc07ffce`.
- As last checked, `main.protected=false`, zero GitHub rulesets; latest hosted run `44841780509` failed all five jobs before test execution owing to GitHub account payment/spending-limit admission.
- Neither R61 nor R62 has been integrated into PR #47, and neither is permitted to trigger CI or auto-merge a protected change.

## Independently reproduced R61 review gaps

A synthetic, read-only Python invocation of the **published R61** triage source showed:
- GitHub changed-file metadata `filename="docs/guide.md", status="renamed", previous_filename="src/auth.js"`: `protected_or_unverified_pr=false` and `docs_only=true`. Such a rename could be treated as documentation-only because only the destination was checked.
- `.gitignore` with status `modified`: `protected_or_unverified_pr=false`. Explicit `agent:automerge` could bypass the separate docs-only path restriction if repository policy were otherwise qualified.
- `docs/private/credential.md` with status `modified`: the same protection gap.
- Adding four new negative/positive tests to R61 produced **26 tests, three expected failures**, establishing a regression baseline without real GitHub mutations.

These are **source-policy bypasses in an unmerged candidate**, not evidence that GitHub merged or changed anything operationally.

## R62 correction

- Introduce one conservative `safe_documentation_file` predicate shared by both the protected-change filter and docs-only eligibility logic.
- The only generic automatic integration candidates are *simple Markdown additions/edits below `docs/`*, not changes outside that directory—even with `agent:automerge` opt-in. Exclude security, operational, private, credential, authentication, token and policy names.
- Refuse `renamed` entries and **any** `previous_filename` field to prevent source-to-docs rename laundering. Refuse deleted, copied, missing or unknown file statuses and unsafe path components/encodings.
- Keep the file-list count and exact head/base recheck, protected PR #45 exclusion, named five-job evidence, strict classic main-branch protection, required reviews and admin enforcement from R61.
- Preserve ordinary Markdown added/modified positive behavior under the required **mock** protection and checks.

## Verification and limits

- Final local Windows Python regression suite: **26/26 passed**, zero failures; original R61 suite was 22/22 before new tests.
- Synthetic tests use mocked GitHub APIs and mutations. No external request or real auto-merge happened in the tests.
- `git diff --check` passes; only the isolated PR-triage script, its regression suite, and two sanitized docs/evidence files are in scope.
- This remains an auxiliary, source-level guard. It does not attest the Git tree file mode/symlink status or actual GitHub GraphQL merge behavior, and must never replace enforced branch protection, required reviews, immutable source inspection and complete hosted acceptance.

**Release decision:** blocked. Before adopting the automation, review the exact R62 source against PR #47 and independently configure effective `main` policy. Restore account-level Actions eligibility and execute the protected Windows/Linux/PDF qualification. No branch protection, account, ACL, key, route, connector, production or DEV activation mutation is authorized by this record.
