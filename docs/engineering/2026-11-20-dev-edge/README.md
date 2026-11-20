# Independent DEV edge source qualification

This is the retained local preparation record for
[Access42](https://github.com/MulattoTech/MTechLabs-Access/issues/42), based on
actual main `2a4e3fba0544bb22ff15785dcf1ae46c61891c3f` and tree
`502fc1a2de54ef111316747e4bc3c096922d76c7`. The existing engineering continuation
ledger remains the execution checkpoint. Exact source review, candidate and
actual-main acceptance, claim release and closure belong on that issue after
those gates complete.

## Delivered boundary

The [module contract](../../../DEV-EDGE.md) documents the closed descriptor,
declaration-only runtime-plan matcher, dedicated Worker entry, fixed response
schema and trust limits. The entry binds canonical DEV resources, backend/Host,
Access issuer/application/audience, connector, pinned owner subject/email,
credential fingerprint and authorization-store declaration. It captures the
selected values and DEV database method before asynchronous operations.

The existing application reserves both DEV hostnames before website database
access. The independent reviewer identified a trailing-dot hostname escape from
the initial exact-host reservation (EDGE42-001). The correction strips final
dots only to select the terminal DEV boundary; its unchanged exact URL check
still denies those aliases. An additional independent regression was frozen
before any behavior execution. An initial authentication-challenge spelling
mismatch found by static comparison was also aligned to the test contract
before that first run; no failed execution is claimed for this correction.

Successful authentication still returns HTTP 503 `dev_activation_disabled`,
with `ownerAuthorized: true` and every readiness/activation flag false. There
is no backend dispatch, MCP-body consumption, authorization-state write,
website grant fallback or production credential read. Production forwarding and
shared identity-verification modules remain unchanged.

## Independent fixture evidence

The test author is separate from the implementation author and from the final
whole-source reviewer. The original 41-group freeze is retained; the final 42-group
test preserves that original byte prefix and appends the hostname regression.
Its SHA256 is
`8306c91554ac98cbeb00735efcd9b13937d427d1f470c9700a2ced7288d1fdee`.

| Run | Result | Meaning |
| --- | --- | --- |
| Exact previous main, with its own local generated-assets build | 42 total: six failures and 36 explicit skips | Two new-API capability gaps, four causal routing failures; skipped new APIs are not passing behavior. |
| First corrected-source focused run | 42/42 passed; no failures, skips, cancellations or TODOs | Same frozen fixture bytes, including real temporary RSA signatures, owner/revocation checks, captured-selector races and side-effect traps. |
| Full local root suite | 170/170 passed | Existing production/auth/website tests and all 42 new cases. |
| Full local manager suite | 339 passed plus 25 explicit Windows skips | 364 total; native Windows cases require hosted qualification. |
| Syntax, build and generated UI diff | All passed | Generated UI and plugin-release bytes also remained identical before/after. |

The routing baseline first proves its signed delegated website neighbor works,
then observes the DEV namespace incorrectly reach it. Canonical DEV returned 200
instead of 503; the origin and trailing-dot aliases returned 200 instead of 404.
The separate poison production-binding case returned 500 instead of its required
terminal 503. These are synthetic source fixtures, not claims about a live DEV
route or exploitable production allocation.

The full local gates ran sequentially without retries. All 257 non-Markdown
tracked/nonignored inputs outside `docs/` stayed byte-identical. This intentionally
broader input inventory includes Python, SQL, JSONC and stable prior evidence in
addition to the previous batch's 217 selections. Root stderr contains the existing
negative-test diagnostics and npm's environment warning; manager stderr contains
the npm warning. Neither indicates a failed test. Raw logs and input manifests
are retained beside the receipts, with exact hashes in `evidence-files.json`.

## Remaining integration gates

`verify-hosted.py` retains the previous 49 protocol cases, 11 Windows reference
groups, 10 production-route regressions, native identity/launcher requirements,
and complete real-upstream archive checks. It adds exact pass-once checks for
all 42 root cases and immutable bindings for the new source/fixture bytes.
`hosted-manifest-requirements.json` describes its inputs. It reads metadata,
complete logs, ZIP evidence and Git blobs; it performs no network or product
execution. Both a fresh candidate run and a distinct actual-main run are required.

At preparation of this source commit, hosted Windows and upstream acceptance,
immutable whole-patch acceptance and merge remain pending. The final issue
receipt will bind the actual commit/tree, five jobs per phase, distinct workflow
and artifact identities, all required stages and the accepted evidence hashes.

## Scope limits

This qualifies source fixtures under Node 24, not a deployed Workers runtime.
No live host, Cloudflare, account, ACL, credential, authorization database,
connector, grant, route or deployment was changed or requalified. Descriptor
syntax and binding-object identity do not prove live provider allocation or
production separation. There is no metadata discovery document or activation
switch in the new entry. Protected bootstrap/transport, effective isolation,
upstream roots, deployed source, live routing/grants and a qualified launcher
remain separate prerequisites.
