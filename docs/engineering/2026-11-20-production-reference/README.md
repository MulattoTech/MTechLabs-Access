# Production-reference source qualification — Access #40

This bounded source delivery implements the
[authenticated reference contract](../../../integrations/mcp-manager/PRODUCTION-REFERENCE.md)
on base main `60d7f5bae965dab2ea73805d8df411bc8b2b937e`
(tree `5a4a46624fe595704b505e8339e883a854c0046f`). The existing
[continuation ledger](../2026-11-12-cross-repository-checkpoint.md) remains the
single resume point. The exact published candidate, independent immutable review,
hosted acceptance, actual-main receipt and claim release belong to
[issue #40](https://github.com/MulattoTech/MTechLabs-Access/issues/40).

## Retained local evidence

- `pure-protocol-frozen.json` binds the 49-group test authored independently of
  implementation inspection. Its SHA-256 is
  `b0aed1a93aa5bb1df243d1467ebe5d7dbfe40e89862caab3a7f89a3e2b4651bc`.
- `pure-protocol-baseline-capability.json` and its TAP show one explicit missing
  API failure and 48 capability skips on the original base. This is a new-feature
  capability gap; it is not a behavioral bug-regression RED result.
- `pure-protocol-first-candidate.json` and its TAP record the first 49/49 pass
  against the initial implementation hash. Two subsequent fixed-category error
  wrappers strengthened handling of hostile thrown values and signal options.
  The full local gates below qualify the final source; the first-run source hash
  is deliberately retained as historical evidence.
- `local-gates.json` binds all 217 captured code, test and configuration inputs
  before and after qualification. Node v24.22.3 on Linux: root 128/128; manager
  363 total, 338 pass, 25 Windows-specific skips, no failures/cancellations/TODOs.
  Root check, build and generated UI comparison all exited zero. The final
  protocol source SHA-256 is
  `7a2ba4a9699a1e4c95ed95bc10db841c5513daf7a39d8464ee88565e220d4c30`.
- `integration-implementation-receipt.json` binds the initial four integration
  files and focused Linux checks. `integration-alias-fix-receipt.json` binds the
  subsequent Windows spelling correction and strengthened native fixtures;
  focused Linux checks passed 154 with 19 Windows skips. These are
  implementation-author receipts, not independent source acceptance or native
  Windows passes. The receipts' absolute paths name
  the original scratch evidence; hashes identify the recorded log contents.

The first revised full manager attempt failed the unchanged idle read-only
backend teardown test with an SDK POST 503. Its isolated run then passed 1/1,
and one standalone full manager repeat passed 338 with 25 skips. The final local
receipt retains the failed attempt, its log hashes and both follow-ups explicitly.
The 60 ms test timeout suggests sensitivity to scheduling, but the cause was not
established. No source or assertion was changed to obtain the repeat pass.

The protocol test author also runs the hosted evidence verifier and discloses
authorship of the 49 new protocol, 10 previous route and 141 previous runtime-plan
cases. A different reviewer, with no source or test authorship in this batch,
must accept the immutable whole-source candidate.

## Hosted gates and limits

The first hosted candidate, head `9e765ec59210897baf509f3331d1022a1f4d6a56`
and checkout `12f97057aa7fb604d70c2562a94321e8b3994b57`, was rejected in
[run 44707303036](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/44707303036).
Both Windows jobs had six new integration failures (441 total, 433 pass, two
skips). Root and Linux jobs passed. The retained
`first-hosted-candidate-rejection.json` binds the complete reviewed logs and seven
native source hashes, and explains why the four completed negative cases did not
provide sufficient evidence of their intended rejection stage. These results
are preserved rather than counted as successful qualification.

The correction compares the bounded config snapshot with the independently
resolved declared config's complete file identity. It preserves canonical path,
device/inode, link count, size and time checks. The native suite now has eleven
cases. Every case requires a successful unmodified inspection, and negative
cases record the reached exchange, mutation or credential-read stage. The added
alias case uses a controlled resolver mapping backed by real Windows file and
handle identities; it does not claim native 8.3 allocation qualification.

At preparation of this commit, corrected disposable native Windows integration
cases and exact revised-candidate/actual-main hosted checks remain pending. Acceptance requires
all five jobs on each revision, all frozen protocol titles, the eleven native case
titles and their seven source bindings, existing native identity/probe tests,
both upstream qualification versions, complete stage/cleanup evidence and zero
model calls. Actual-main run, job and archive IDs must differ from the candidate.

The new native suite includes one real observation of its own caller and an
inert, owned DEV listener, with synthetic signed production facts. Its other
native responses are synthetic. Filesystem write counters cover the integration's
observed Node `fs/promises` calls; fixture setup/drift and native compiler temporary
activity are outside those counters. The tests do not observe a live production
listener, provision a second OS account, prove protected key storage or deploy an
authenticated transport. All activation and qualification flags remain false.

No owner-host, Cloudflare, plugin, account, ACL, credential, grant or operational
deployment change is part of this batch. Protected bootstrap and ancestors,
independent DEV edge mapping, actual upstream roots and a qualified launcher
remain prerequisites for operational DEV provisioning.
