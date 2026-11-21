# R55 — Independent PR activity and Actions admission

**Scope:** Read-only GitHub metadata and isolated engineering-branch diagnostic correction. No production installation/command, Windows security/ACL/account/key/route, workflow dispatch, PR creation, merge, or DEV activation.

## New verified state (2026-11-20, approximately 18:08 CST)
- PR [#45](https://github.com/MulattoTech/MTechLabs-Access/pull/45) remains open, draft, and unmerged at exact head `f0855c1227aacc49071581bb52ba5566bc07ffce`.
- The isolated Windows candidate remains `0da3a5f74453cfbed82e2d1d4f61e1bae64efe9b`. It is not an accepted native Windows fix.
- Unrelated PR [#47](https://github.com/MulattoTech/MTechLabs-Access/pull/47), head `b25c6a916cc1cdef783eeacc6b08c6bd51f3ac89`, is now open against main for guarded backlog triage.
- New run [44841780509](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/44841780509) was created at 2026-11-21T00:08:23Z for PR47. All five expected jobs completed failure with zero executed steps. GitHub's `gh run view` returned account-payment/spending-limit admission annotations for each job. **No test execution occurred**.
- The historical R7 PR45 run [44742255585](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/44742255585) still has five failed jobs with zero steps. R6 native-Windows and 0.3.1 PDF-control failures remain unresolved.

## Repaired false assumptions
Prior R50 preflight rejected **any** additional open PR and **any** workflow run newer than R7. Both conditions are now normal and irrelevant to the reviewed protected source. Such rejections would mask the real block (GitHub runner admission) and unnecessarily obstruct future structural revalidation.

R55:
1. Allows unrelated open PRs while rejecting duplicate PR numbers, a second PR using the protected feature/candidate head, any PR already targeting the protected feature branch, malformed entries, and unverified pagination.
2. Fetches the *exact historical R7 run* separately rather than assuming R7 stays newest. Recent unrelated runs may coexist; new runs referencing either reviewed protected head still force independent review.
3. Keeps exact PR45 head/base/draft, candidate checkout/remote/source-blob/ancestry, Actions policy, complete historical job metadata, owner identity, and **all authorization=false** requirements unchanged.
4. Performs only fixed GitHub GET and read-only Git metadata calls. Billing/runner admission is not inferred from structural source matching.

## Verification
- Existing R49/R50 disposable suite before changes: **36/36 passed**.
- R55 updated fail-closed suite: **47/47 passed**, including the live PR47/run shape, duplicate/stacked branches, new protected-head run rejection, historical R7 tampering, and pagination negatives.
- New live read-only preflight with a separate clean candidate checkout: `structuralPreflightMatched=true`, `unqualifiedCount=0`, `historicalJobStepCountZero=true`; `accountBillingEligibility=UNVERIFIED`, `hostedRunnerAdmissionVerified=false`, `createDraftPRCurrentlyAuthorized=false`, `ciRerunAuthorized=false`, `sourceMergeAuthorized=false`, `devActivationAuthorized=false`.
- New recent run independently establishes account billing/spending admission is blocked at that instant; the preflight itself does not inspect billing or payment details.

## Release disposition
**Blocked.** Owner must restore GitHub Actions billing/runner eligibility, then separately authorize the stacked draft PR and genuinely executed required Windows/Linux qualification. Review PDF-control instrumentation and exact-source acceptance evidence before any PR merge. Operational DEV provisioning remains a separate, not-approved security change.
