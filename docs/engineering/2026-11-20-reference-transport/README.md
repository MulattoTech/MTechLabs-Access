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

`verify-hosted.py` and `verifier-freeze.json` preserve the existing five-job,
native and upstream requirements and add strict checks for every new portable,
observer-idle and native group. Both Windows jobs must contain the full native
report, real positive controls, source bindings and successful cleanup. Its
SHA-256 is `50e3fb344f8fc2057ab69b4ceb6ddac824b72581be44c9b9150e84050d6bb3d6`.
The candidate and main manifest templates require exact run, attempt, checkout,
head, tree, full log and raw archive identities. Windows totals of 493 tests,
490 passes and three explicit platform skips are a frozen derived expectation
until observed; no native result is inferred from the Linux runs.

## Ownership

`runtime_review` owns product implementation; `repository_baseline` owns the
independent tests and hosted evidence verifier; `startup_mutations` independently
reviews the immutable complete source. Root coordinates CI, documentation,
evidence acquisition and integration. A test-author evidence review does not
substitute for independent whole-source approval.
