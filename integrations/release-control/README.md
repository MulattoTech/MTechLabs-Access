# M-TechLabs Release Control

Owner-only release inventory and review application, plus a guarded local deployment-engine candidate. **Production activation is disabled.** No production adapter or execution endpoint is enrolled. A review/hold is not deployment authority. See `acceptance-register.json` for the fixed mandatory acceptance gates.

## Operations

- Start the existing loopback controller: `node integrations/release-control/server.mjs` (127.0.0.1:20881; do not start a second live instance).
- Read-only live inventory and branch scan: `node integrations/release-control/server.mjs --scan`. The scan uses a disposable local state directory, not the live state file.
- Run deterministic local tests: `npm run test:release-control`. The existing repository verification workflow includes this script; no additional hosted runner is required.
- Owner-only dashboard: https://m-techlabs.com/admin/releases/. Cloudflare Access JWT signature, owner, audience, issuer, expiration and same-origin POST checks remain required. The controller does not export GitHub credentials.
- Check All reconciles live owner repository inventory first, then checks eligible sources in bounded batches. New repositories must be explicitly enrolled for **source tracking only**. Missing, archived, or changed-default-branch configured sources are blocked from further review until reconciled. No automatic deployment enrollment.
- A source comparison inherits the confidence of runtime evidence; reported Docker labels and image-tag hints are not independently verified source provenance. Unknown runtime identities stay unknown.
- Repeated preparation refreshes exact-SHA check-run evidence; marking reviewed rechecks the branch head. Required repository release policies remain unqualified. Dates displayed in America/Chicago; the legacy hold input uses the browser's local time and is not deployment scheduling.

## Local execution foundation

`admission.mjs`: strict plan and policy identities, publisher-bound required checks, explicit owner approval with expiry, fresh exact-head/artifact evidence, trusted resource requirements. The evidence provider must be independently qualified; the web API cannot supply evidence or authorize activation.

`deployment-store.mjs`: transactional SQLite ledger (WAL, FULL synchronization), legal states, immutable plans, idempotency keys, shared-resource locks, maintenance windows, and durable interruption recovery. Missed windows cancel rather than replay. This candidate ledger is not connected to production execution.

`execution.mjs`: local-only typed target registry and bounded execution, fresh admission before activation, confirmed active identity, rollback only when the approved candidate is positively identified and unhealthy, and explicit quiescent reconciliation. Timeouts/ambiguous outcomes retain locks. No arbitrary command endpoint. The tests use a disposable real HTTP target, not a production product.

## Recovery boundaries

The currently deployed controller remains the previously installed release. Do not overwrite that directory or its live state; do not alter Cloudflare Access, tunnel ingress, scheduled tasks, or either MTerm connection to qualify this candidate. Before enabling any product adapter, verify source/artifact identity, actual repository policy/evidence, resource locks, independent recovery path, and real target-specific backup/activation/rollback. Require exclusive execution-supervisor ownership for interrupted-operation reconciliation. A timeout is not proof an underlying operation stopped.

For live self-update qualification, implement an independent supervisor and versioned state migration, prove candidate and previous-release identity, retain the known-good release and independently usable emergency access, and test interruptions before changing the live service. Do not run a speculative recovery or restore a stale database over newer data.

## Acceptance accounting

The register is the fixed set of 20 conjunctive gates from the supplied production qualification contract. A gate is not PASS merely because a local foundation exists; all applicable criteria must be supported by exact-revision evidence. Qualification receipts record source commit and limitations separately, avoiding a self-referential commit identity. Live inventory evidence expires when the account or target changes. Current production blockers include verified runtime identities, qualified target adapters, owner authorization and persistent execution integration, independent review, real recovery and controller self-update, hosted gates, and authenticated end-to-end browser validation.
