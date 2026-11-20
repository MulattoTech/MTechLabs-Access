# Protected local reference transport — source qualification

This record belongs to [Access #44](https://github.com/MulattoTech/MTechLabs-Access/issues/44),
from exact actual main `15e851b11984592803d37599b639772e51e5c8c0`, tree
`72db194d082b05809d82c770defcbdd68b98e40a`. It prepares the protected bootstrap,
authenticated Windows local exchange and restricted public `Inspect`/`Status`
entry. The [source contract](implementation-contract.md) was recorded before
behavior execution; final implemented behavior and limits are described in
[REFERENCE-TRANSPORT.md](../../../integrations/mcp-manager/REFERENCE-TRANSPORT.md).

The final shutdown contract was clarified before native fixture freeze: closing
the listener stops admission and releases the pipe namespace, then `closed`
waits for actual callback settlement. The operational server subsequently waits
for the core observers to become idle. Namespace ownership is not claimed during
that final drain, and no automatic restart is provided. The original contract is
retained as preparation history rather than silently rewritten.

## Source review corrections before native execution

Independent review identified missing directory child-deletion protection, an
extra-byte cancellation race, and mutation of pending native completions during
shutdown. The source now checks the stronger directory rights, rejects any
successfully completed monitor read before responding, and cancels a snapshot
of pending completions outside the dictionary lock. Pre-helper reads are bounded
before allocation, and compilation uses the verified C# text. Actual token-group
inspection includes deny-only groups rather than relying on the filtered .NET
group view.

The initial `source-stable-receipt.json` is preserved. A subsequent source review
caught a C# nested/enclosing local-name declaration conflict; the narrow rename
is recorded in `source-stable-receipt-r2.json`. These are source inspections and
corrections, not claims of successful Windows execution. The amended contract is
retained separately in `implementation-contract-final.md`.

## Independent test preparation and baseline

The portable trust/opaque-handle suite was frozen at 22 groups before any new
implementation execution. Its unchanged bytes are SHA-256
`b15b7ff2275c853d80cbec51114055b727c29d36841d566c9bd9ed4b1b089c76`.
The exact prior main records two new-module capability failures and 20 explicit
dependent behavioral skips. This is an absent-capability baseline, with no
behavioral pass or causal vulnerability claim.

The additive observer-idle suite was independently frozen at 9 groups, SHA-256
`bd010cf14556becdc87f6ae31150d6037ec299bf3c0c1ead53fc172059db603b`.
The exact prior main records one absent-API failure and 8 explicit dependent
skips. Its original 49 protocol-test groups remain byte-identical; the new idle
tests are a separate file.

The old public-wrapper success expectation required direct production-file
permissions. This batch deliberately changes that public contract. The single
affected group now requires missing protected trust to fail without fallback.
Its old complete file and the exact replacement binding are retained in
`prior-public-wrapper-tests.mjs` and `wrapper-contract-freeze.json`. Native
qualification must separately restore positive coverage for both public actions
through actual protected bootstrap and a registered authority.

## First focused source result

The first unchanged portable-plus-idle run records 31 tests: 30 passed, one explicit
Windows preload-order skip, zero failures/cancellations/TODO, and empty stderr.
All six selected input hashes before and after are identical. The full raw
streams and receipt are retained as `focused-first.*`; this is Linux source
qualification only. It does not establish Windows ACLs, separate identities,
pipe authentication, remote rejection or owner-host readiness.

## Frozen final inputs and full local gates

`native-fixture-freeze.json` records the completed native controller, three
helpers, 18 native subgroups, explicit disposable-host guards and bounded
cleanup. `frozen-inputs.json` binds 31 source, workflow, test and helper inputs.
The fixture's delayed-input case waits for observed callback cancellation while
the callback is still held before releasing it. Cleanup records successful
account creation before later setup, deletes only its exclusively owned tree,
and retains a recovery journal when cleanup is incomplete.

The final focused Linux run passed 30 tests with two explicit Windows-only
skips and no failures, cancellations, TODOs or stderr. Every frozen input was
unchanged. Full serial local gates then passed once:

| Gate | Observed result |
| --- | --- |
| Root tests | 170 tests, 170 passed, no skips or failures |
| Root check and build | Both exited successfully |
| Generated UI and plugin release | No changed bytes or diff |
| Manager tests on Linux | 396 tests, 369 passed, 27 explicit platform skips; no failures, cancellations or TODOs |
| Input stability | All 268 source inputs and all 31 frozen bindings unchanged |

Every command's complete stdout/stderr, input snapshots and receipt are retained
under `local-first-*`. The full receipt SHA-256 is
`0189cb0c7f2a25428965bbe4eb8e5415c57015992daea49bd9deea484752c265`.
These results establish local source qualification. The native fixture has not
executed as part of these Linux runs.

## Remaining integration gates at preparation

The native fixture is independently authored and frozen separately before its
first execution. It must run on both disposable hosted Windows jobs, prove real
standard-account separation and both public wrapper actions, distinguish actual
registered observations from injected transport-mechanism callbacks, and retain
complete cleanup/source bindings. Its explicit test opt-in does not change any
product trust or activation decision.

Full local qualification, immutable independent source acceptance, exact
candidate hosted acceptance, normal expected-head merge and distinct actual-main
acceptance remain required before delivery. No account, ACL, key, broker,
startup, Cloudflare, connector, production deployment or activation change on
the owner's host follows from these source results. The final issue receipt
will record completion and supersede these preparation-time pending gates.

The initial `verify-hosted.py` and `verifier-freeze.json` preserved the existing five-job,
native and upstream requirements and add strict checks for every new portable,
observer-idle and native group. Both Windows jobs must contain the full native
report, real positive controls, source bindings and successful cleanup. Its
initial SHA-256 was `50e3fb344f8fc2057ab69b4ceb6ddac824b72581be44c9b9150e84050d6bb3d6`.
The candidate and main manifest templates require exact run, attempt, checkout,
head, tree, full log and raw archive identities. Windows totals of 493 tests,
490 passes and three explicit platform skips are a frozen derived expectation
until observed; no native result is inferred from the Linux runs.

## First hosted rejection and diagnostic revision 2

[PR45](https://github.com/MulattoTech/MTechLabs-Access/pull/45) first qualified
candidate `03867a379228491a63db3dbf5747da7bdd17e5d5`, synthetic checkout
`e702d8534f5707d2dfa4be6d01d603e694528d09`, in
[run44731837582](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/44731837582).
All three Linux jobs passed. Both Windows jobs failed during initial fixture
setup, before any native case completed; fixture-tree cleanup and emergency
recovery also failed. This candidate was rejected. The exact cause was not
established by its original sanitized diagnostic. Independent source review and
the full hosted-status addendum are retained on
[issue44](https://github.com/MulattoTech/MTechLabs-Access/issues/44#issuecomment-7039072325),
with exact readback and lossless review reassembly recorded locally.

Revision 2 adds bounded setup-stage, command, exception-type, numeric-error and
source-line metadata to the native controller and wrapper. It changes no
product source, provisioning behavior, ACL rule, success assertion, timeout or
cleanup requirement. `diagnostic-r2-freeze.json` records the two changed tests;
the other 29 frozen inputs remain identical. The revision 2 verifier is SHA-256
`1b785e2cdee28a00a414e757d1cc514bbbc53ab41cdce54c43f5d5ee19c1fb9b`, and additionally
requires complete setup and empty failure diagnostics for acceptance. Original
fixture and verifier bytes remain immutable in the first candidate's Git tree.

The full local gates passed again for the diagnostic revision with the same
observed totals and stable inputs. Their complete records are retained under
`local-diagnostic-r2-*`. A fresh exact-tree Windows run remains required; the
diagnostic addition itself does not resolve or qualify the startup failure.

## Module-path correction, revision 3

The diagnostic candidate `a1b7c01c28d947a6be92ad98266e0b18bdf19420`, synthetic
checkout `5c8d0e7a200c1149b801a517aced1a4f8b7ad837`, was rejected in
[run44733564597](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/44733564597).
Both Windows reports identify `CouldNotAutoloadMatchingModule` at `Set-Acl`
during the initial root ACL operation; emergency cleanup repeated that error at
`Get-Acl`. Their inherited search paths included PowerShell Core modules. No
native case or account provisioning completed. The bounded diagnostic does not
expose the internal module-load exception or claim a deeper cause.

Revision 3 captures the inherited search-path metadata, then pins the fixture
controller and cleanup to Windows PowerShell's system module directory before
setup. Child processes receive that default, while the deliberate hostile-path
override remains available to its existing adversarial case. The wrapper and
verifier additionally require the effective module-path digest to match the
fixed value. Product files, ACL and cleanup functions, native case assertions,
timeouts and all prior verifier requirements remain unchanged.

`module-path-r3-freeze.json` and `module-path-r3-frozen-inputs.json` bind this
correction. The revision 3 verifier SHA-256 is
`5040504d6b98b272522ff56bb349c015c90a8a745230ea5f308fda931911f6f0`.
Full local gates passed again with the same observed totals and stable inputs;
the complete records are under `local-module-path-r3-*`. A new exact Windows
candidate is required to establish the correction and remaining native behavior.

## Child diagnostics, revision 4

The module-path candidate `1b1bb9a57cd008e0e48cc54cbe112b3ae389a94f`, synthetic
checkout `0cc85cefcc6f1a9af9261f7806fa76e08f66051b`, was rejected in
[run44734494406](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/44734494406).
Both Windows jobs completed protected setup and all natural cleanup requirements,
which establishes progress beyond the earlier module-loading failure. Both then
failed with `fixture_child_exit_wrong` during the actual identity controls,
before the first native case completed. The available report did not identify
the failed child operation or its underlying fixed error.

Revision 4 retains finite per-child role, operation, exit and elapsed-time
metadata; bounded error identifiers; and decoded-output counts/digests. Identity
diagnostics observe the existing calls and comparisons without changing their
arguments, environment, timeouts, results or number of probes. Output digests
are explicitly scoped to decoded and consumed text, not raw pipe bytes. Product
files and every existing case, control, ACL, cleanup and timeout requirement
remain unchanged. All 143 prior verifier requirements are retained.

`child-diagnostic-r4-freeze.json` and `child-diagnostic-r4-frozen-inputs.json`
bind the three changed test/helper inputs. The current verifier SHA-256 is
`967e127a917a4262485524869aec4d8e28cd80387345e7610b44cff59d0064d7`.
Full local gates passed again with the same observed totals and stable inputs;
complete records are under `local-child-diagnostic-r4-*`.

The revision 4 candidate `ed57e8368355c4984b4f2466e62594240d16edd6`, synthetic
checkout `830a3d0a96c09690168bad9c03ee952c4a9b24fb`, was rejected in
[run44736652736](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/44736652736).
Both Windows jobs completed protected setup and natural cleanup. The authority
profile child succeeded; its identity child's existing native-capture process
then timed out at 15,023 / 15,022 milliseconds with zero decoded stdout/stderr.
Administrator, PID and profile comparisons were not reached. No new native case
completed, and all three Linux jobs passed. The unchanged verifier rejected the
run. This establishes the native probe timeout, while its internal stalled
operation remains unknown.

The immutable independent source review is retained in
[issue44's revision 4 source receipt](https://github.com/MulattoTech/MTechLabs-Access/issues/44#issuecomment-7039747320).
Its original pending hosted status remains unchanged. The subsequent
[separate rejection receipt](https://github.com/MulattoTech/MTechLabs-Access/issues/44#issuecomment-7039752124)
contains the complete report and log bindings, also retained in
`child-diagnostic-r4-rejection-review.json`. Exact comment readback is recorded in
`revision-r4-durable-readback.json`. Native qualification remains unresolved.

## Failure-only probe trace, revision 5

Revision 5 preserves the original identity-capture invocation and its failure.
Only after that failed callback settles, the fixture may execute one separately
identified derivative of the exact probe under the same ordinary account and
Node parent, with the same empty listener-role request and 15-second deadline.
Fixed stage identifiers cover script entry, stdin, JSON parsing, both current
identity CIM queries, native compilation, native calls and output. The original
error is rethrown regardless of the derivative's outcome. Passing identity
checks must show that this diagnostic did not execute.

The derivative is created in the owned account's temporary directory. It records
the original raw hash, explicit CRLF-to-LF normalization, normalized and derived
hashes, deterministic splice checks, and unchanged original-source readback.
Only bounded stage/timing metadata, safe error identifiers and decoded-output
counts/hashes enter the report. Product source, original identity predicates,
ACLs, all native cases, cleanup requirements and existing deadlines remain
unchanged.

A last marker locates an interval in this later instrumented invocation. It
cannot establish the original invocation's exact stalled operation by itself;
different timing, cache state and instrumentation remain explicit limitations.
Diagnostic success does not count as an identity pass or candidate acceptance.

`probe-diagnostic-r5-freeze.json` and `probe-diagnostic-r5-frozen-inputs.json`
bind the three changed fixture inputs. `probe-diagnostic-r5-transform.json`
records all 27 matched splices and identical derived bytes from LF and CRLF
source; `probe-diagnostic-r5-stage-map.json` maps the fixed markers. The verifier
is SHA-256 `1a3ee64ccaee06ee6e8d556ae44f92c8f97457ac9b4c48f56a55a0216d26a16b`:
all 158 prior requirements remain, with 160 now.

The full serial local gates passed with the same root and Linux manager totals,
all 268 source inputs and 31 frozen bindings stable, and generated bytes
unchanged. Complete records are under `local-probe-diagnostic-r5-*`; the receipt
SHA-256 is `7ebde2487f979c0a8ace6b4a8c1c7fcb69edb683e09724dde6b0d5688f98d5f3`.
Fresh exact Windows execution is still required.

## Ownership

`runtime_review` owns product implementation; `repository_baseline` owns the
independent tests and hosted evidence verifier; `startup_mutations` independently
reviews the immutable complete source. Root coordinates CI, documentation,
evidence acquisition and integration. A test-author evidence review does not
substitute for independent whole-source approval.
