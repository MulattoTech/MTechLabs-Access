# R63 — Git-object mode and blob identity verification for docs-only auto-merge

**Status: isolated source-only engineering candidate. Not merged into PR #47 or main.**

## Baseline, scope and live prerequisites

- Repository: `MulattoTech/MTechLabs-Access`; forked exact isolated R62 head `08403003b933abd11c10279e3cf0fea93f79f45f` onto `fix/access44-r63-doc-tree-type-20261120`.
- Protected PR #45 remains an unmerged draft at `f0855c1227aacc49071581bb52ba5566bc07ffce`.
- Proposed backlog triage PR #47 remains open/unmerged at `b25c6a916cc1cdef783eeacc6b08c6bd51f3ac89`.
- GitHub Actions runner admission remains blocked by account payment/spending-limit annotations from run `44841780509`, in which five jobs failed before any steps executed.
- `main.protected=false`, and GitHub reports zero rulesets. No branch-setting change is authorized here.

## Reproduced R62 gap

The GitHub PR changed-files endpoint records filenames, statuses, and blob SHAs but **does not attest Git tree object modes**. An eligible `docs/*.md` path could therefore be a mode `120000` Git symlink, mode `100755` executable blob, or mode `160000` submodule rather than a regular Markdown file. It could also be associated with stale or truncated tree metadata.

A new independent, synthetic test using the exact R62 code failed in **seven** negative subcases: symlink, executable, submodule, truncated tree, mismatched root SHA, mismatched blob identity, and mismatched commit identity. The baseline test suite reported **27 test methods with seven subtest failures**. These are *potential policy bypasses in an unmerged source candidate*, not observed live auto-merges or production issues.

## R63 correction

The proposed guard:
1. Re-checks the PR head and base after obtaining the bounded PR changed-file list.
2. Looks up the **exact head SHA's Git commit** with read-only `/git/commits/{sha}` and confirms the returned commit hash and tree hash.
3. Looks up the exact tree with read-only `/git/trees/{tree_sha}?recursive=1`; rejects truncated, mismatched, malformed or oversized (over 10,000 entries) trees.
4. Requires every candidate `docs/*.md` path to appear exactly once as a Git `type=blob`, `mode=100644` regular non-executable file, with a content SHA matching the changed-file record. Any missing/duplicate object or unknown SHA fails closed.
5. Re-checks the PR head/base/file count after Git-tree observation to narrow the metadata race window. GitHub branch protections remain the required final integration authority.

The guard retains R61/R62 restrictions: exact five successful hosted check contexts, enforced classic branch protection and reviews, categorically protected PR #45, and non-sensitive documentation-only auto-integration. A normal `100644` Markdown file remains eligible in the synthetic positive case.

## API shape and tests

- Separate **read-only** GitHub inspection of PR #47's exact Git commit showed the expected commit/tree relationship. The Git Trees endpoint returned `truncated=false` and a 452-entry Linux-independent tree. A sample `docs/acceptance.md` entry was a regular `100644` blob. These observations confirm API response structure, **not** a successful auto-merge request.
- Final local regression suite: **28/28 Python test methods passing**, including prior tests, 12 additional mocked Git-object negative subcases, positive normal Markdown, and PR-head drift after the tree fetch.
- No actual GraphQL auto-merge, branch update, GitHub policy edit, CI run, npm install, production access, security permission change, Windows native IPC fixture, broker provision or DEV activation occurred.
- A script-level Git-tree check cannot rule out all content-level issues in arbitrary Markdown or substitute for enforced branch policy, independent security review, pinned workflow sources or actual hosted acceptance.

## Release disposition

**Review-only, not executable release approval.** Do not merge PR #45 or deploy DEV until the five required real Windows/Linux jobs and original 0.3.1 PDF control pass, exact immutable source review is accepted, GitHub billing and protected-main policy are restored, and owner-approved operational isolation/rollback gates are satisfied. PR #47 should not be merged until the cumulative R61–R63 guard receives independent review and repository-side rules enforce the required checks and reviews.
