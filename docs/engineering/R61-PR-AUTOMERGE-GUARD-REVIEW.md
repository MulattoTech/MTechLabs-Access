# R61 — Protected IPC PR auto-merge guard (source-only review)

**Status: isolated candidate; not merged into PR #47 or main. No production or GitHub settings changes.**

## Source identity
- Repository: `MulattoTech/MTechLabs-Access`.
- Review branch: `fix/access44-r61-protected-auto-merge-guard-20261120`, forked from exact PR #47 head `b25c6a916cc1cdef783eeacc6b08c6bd51f3ac89`.
- Original triage script blob `43a57dc74204623d522164f5039a7d14c7d15c86`.
- Protected draft PR #45 remains at `f0855c1227aacc49071581bb52ba5566bc07ffce`.

## Problem
R60 proved the proposed triage classifier could mark a clean PR `ready` with only a single unrelated successful job, even if all five protected IPC acceptance jobs were absent. Live GitHub also reports `main.protected=false` and zero rulesets. PR #47 is open and unmerged, so the new automation is not currently running on main.

## Candidate safeguards
1. Require all five exact, unique, completed/successful protected jobs at the target PR commit, from the GitHub Actions app. Missing, duplicated, skipped, neutral, wrong-head, untrusted or truncated job results fail closed.
2. Require independently enforced classic `main` branch protection with strict required checks for all five jobs, at least one required review, dismissal of stale reviews and admin enforcement. Labels alone never grant integration authority; unknown policy or rulesets-only policy fail closed.
3. Block PR #45 categorically, including if no longer draft or someone applies an opt-in label.
4. Block generic auto-merge and automatic branch refresh for access, source, infrastructure, workflow, tool, test, security, plugin and engineering-document changes. Require a complete file list matching PR metadata and revalidate the head after reading it.
5. Recheck protected branch policy immediately before branch update or native auto-merge enrollment. Continue non-integrating backlog labeling when the branch policy is absent.

## Tests and limitations
- 22/22 offline Python regression tests passed on a separate Windows clone, using mocked GitHub replies and mutations only; real API calls during synthetic tests: zero.
- Covers negative single unrelated green job, missing/duplicate/skipped/untrusted/wrong-head checks, unprotected branch, missing review/admin enforcement, protected PR #45 even with opt-in, protected paths, file-list/head drift. A mock positive case preserves docs auto-merge under fully qualified enforcement.
- Git diff validation passed.
- No actual GitHub auto-merge GraphQL call, PR update, workflow run, payment/permission change or deployment was made. The script is supplementary; it is not proof of future GitHub policy enforcement and is not a security certification.
- The actual upstream PDF-control and native Windows identity/IPC acceptance remain unqualified, as does hosted Actions runner admission.

**Before adoption:** Independently review this guard against PR #47 and the desired main-branch policy. Restore GitHub Actions billing eligibility, execute the complete frozen hosted acceptance, and separately approve any PR merge or DEV provisioning. Keep PR #45 draft and production untouched.
