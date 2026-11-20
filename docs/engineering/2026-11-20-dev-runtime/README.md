# DEV runtime inspection — issue36

This source batch continues the approved MTerm mission from Access actual main
`e0bdf73ae00ff93c1d264d0f0b954fd8309e2ae1`, tree
`07b7efe74d42b1a3c06ef574fec8a3304e2af36c`. The bounded acceptance contract and
claim are in [issue36](https://github.com/MulattoTech/MTechLabs-Access/issues/36).

## Source delivered

The [runtime contract](../../../integrations/mcp-manager/DEV-RUNTIME.md) defines
a strict externally supplied plan bound to selected DEV/production configs,
canonical account/profile expectations, exact manager invocation and distinct
declared resource/origin/backend/Access App/AUD/connector App routing. Input
claims cannot enable activation or attest provider verification.

The Windows probe observes the actual Node parent primary token/profile and
exact loopback listeners using retained process handles, native argument parsing,
creation-time binding and repeated queries. Missing, denied, ambiguous, changing
or unknown-state evidence stays unverified. Manager state is not mutated; no
status/DB/server/ownership path is invoked. All plan/token paths receive local
ordinary-file guards before reads. Credentials must be digest-only. Profile and
all four config/entry identities are compared after filesystem canonicalization.

`manage-dev.ps1` supports only Inspect/Status and rejects launch/install/open
actions and Node preload variables before invoking Node. Production launcher,
installer, backend configuration and upstream blocks are unchanged. Every report
retains `qualified: false`, `upstreamEnabled: false`, unverified live routing/grants
and unverified running source. Matching local identity is a bounded observation,
not proof of cross-account access isolation or an activation grant.

## Reproducible local evidence

`local-receipt.json` binds exact source/test SHA-256 values, evidence hashes,
baseline and observed gate counts. Raw outputs are retained alongside it.

| Gate | Observed result |
| --- | --- |
| Previous-main reserved-name regression | One expected assertion failure, exit1; no import/setup failure |
| Preliminary new plan implementation | 125 pass / 16 assertion failures, exit1; not a baseline regression claim |
| Same frozen pure-plan test after correction | 141/141 pass, exit0; no skip/cancellation |
| Complete local manager suite | 278 pass / 14 native-Windows skips, zero failures/cancellations |
| Root suite | 128/128 pass, no skips |
| Root syntax, build, generated UI | pass; generated UI unchanged |

The original manager baseline has no runtime-inspector API. Absence of those new
APIs is a capability gap, not a failing behavior regression. The genuine baseline
regression uses only existing `createAdminServer()` with a control file named
`dev-runtime-plan.json`. Its unchanged test and data helper were copied to an
isolated detached worktree at the exact baseline above. The baseline accepts
that control; the candidate refuses before ownership/state writes. Command:

```text
node --test --test-reporter=tap integrations/mcp-manager/test/dev-runtime-reserved.test.mjs
```

The preliminary pure-plan run used the exact source hash recorded in its receipt.
`preliminary-runtime-plan.mjs.txt` retains those source bytes (reconstructed from
the narrow correction and verified against the originally observed SHA-256).
In a disposable checkout, copying those bytes into `lib/dev-runtime-plan.mjs`
and using the frozen current `test/dev-runtime-plan.test.mjs` reproduces that
new-feature run. The 16 observed failures cover reserved/DEL path components,
cross config/entry aliases and impossible PID/creation-time values. The unchanged
test file then passes all141 cases. Trailing-newline tests already passed in the
preliminary run; no newline regression is claimed.

Independent source review also found and resolved three issues before freezing:
listener state had to be measured explicitly instead of inferred from no remote
peer; token paths needed local-drive/link guards before any possible UNC lookup;
and PowerShell UTF-8 encoding had to match Node's pipe protocol. A later review
closed four-way canonical config/entry aliasing. Windows integration tests cover
these contracts, store snapshots, junction/hardlink rejection, and launcher
refusal. The canonical short-name decision test simulates realpath resolution;
it does not claim to provision a native 8.3 alias on the hosted filesystem.

## Native and hosted acceptance boundary

Linux skips do not count as native acceptance. Hosted Windows must separately
qualify the actual primary-token/profile observer, an owned inert Unicode-path
loopback listener and a 54-case AST-only decision fixture. The latter uses native
argument parsing with simulated process/listener snapshots and source-bound
query/disposal receipts. Existing 26-case production-launcher coverage is retained.
The inert positive listener exits through stdin EOF with retained-child cleanup;
no production process or actual manager/upstream is used for these new tests.

At preparation of this commit, independent immutable acceptance, five candidate
jobs and five distinct actual-main jobs remain pending. Both CI sets retain the
existing real upstream0.3.1/0.3.3 qualification in disposable Linux/Windows
accounts. Neutral `Refs #36` prevents early auto-close. The final issue receipt
must bind the exact remote candidate/tree, independent review, candidate jobs,
expected-head normal merge, actual-main jobs and artifacts, then release the
claim and explicitly close this bounded issue.

No actual DEV account/profile is provisioned, no upstream is enabled, and no
production installation, service, token, ACL, Cloudflare route, connector grant
or wrapper is changed. Hosted same-user fixtures cannot qualify two real users'
access isolation or live routing. CLI formal acceptance remains29.36%,0/300;
DCP0/48 and WEB0/12 remain unchanged. This batch uses no paid model workers.
