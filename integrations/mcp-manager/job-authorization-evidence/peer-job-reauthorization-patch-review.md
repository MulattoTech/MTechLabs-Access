# Managed-job reauthorization patch review

**Result: no concrete in-scope surviving bypass or regression found.** Findings: **0**. This is a static source conclusion about the frozen patch, not a test-pass or production qualification claim.

## Exact reviewed artifact

- Repository: `/workspace/scratch/a92a3aacdca1/MTechLabs-Access-Jobs`.
- Local baseline: `4ab98c6f9571b34def09e6aa63679804bb48dc0d`. Root supplied its runtime equivalence to Access main `499`, tree `04d1d397`; that mapping was not independently reconstructed here.
- `jobs.mjs` candidate SHA256: `081f49980fbe4fc7b9cf541f283dec7b7b0af480e26a71f00e397f6e724c7366`.
- New `job-authorization.test.mjs` SHA256: `40f4678dbf1afab76238dced5aef51247c677acf33db93d27b072c7d2ab0311a`.
- `git diff -- integrations/mcp-manager/lib/jobs.mjs` SHA256: `8313f3b589e6ec257a995d5e58710b80aabe400fb3bfb6125b0a404be108aab2`.

Both changed files still matched the frozen snapshot at the last read. The complete snapshot and hash manifest accompany this receipt. `docs/security.md`, manager `README.md` and `RUNBOOK.md` are unchanged from the local baseline.

## Invariant checked

An eligible stored job must pass **current** `jobs` and per-kind permissions before its evidence is cleared and it is requeued, and again before a new provider invocation. The per-kind requirements are `vmRead` for VM inventory, `codeRead` for diagnostics, and `codeRead` plus `testRun` plus an exact allowed selector for tests. Initial queued work and explicitly resumed work must reach the same dispatch guard. Owner/enrolled access, global pause/read-only admission, repository containment, fixed commands and lifecycle rules must remain intact.

## Source verification

| Surface | How verified | Result |
| --- | --- | --- |
| Shared permission decision | Read `lib/jobs.mjs:49-60` and its three call sites. Exact Set membership gates both kind and test selector; string aliases/prototype names cannot select another action. | No bypass found. |
| MCP and owner HTTP resume | Traced both production callers (`lib/engineering-tools.mjs:80-85`, `admin.mjs:118-131`) into `resumeJob:118-133`. A scoped production-source search found no additional resume caller. | Both reach current kind authorization before updating the row. |
| First and resumed dispatch | Read the complete runner. In `jobs.mjs:166-185`, current toolkit authorization follows repository/resource awaits and precedes every VM/code provider invocation without another intervening await. | All three provider branches are guarded; initially queued jobs are covered. |
| Concurrent/denied resume | Inspected all production job-row writers. The update at 128-131 is conditional on the selected state and resume count; another successful resume changes them. Authorization failures happen before clearing result/error or incrementing the count. | No concrete state/evidence regression found. |
| Corrupt row/config | Followed unknown kind/selector values and invalid/missing configuration through `readToolkit` validation and the shared guard. Non-test commands remain irrelevant to fixed provider selection. | No fail-open path found. |
| Existing controls | Compared runner global gate, root/resource preflight, fixed provider arguments, status/log/cancel behavior, and authenticated callers with baseline. | No weakening found. |
| New regression source | Read all 153 lines and the fixture helpers. Reviewed denial/evidence preservation, dispatch, allowed command, competing resume, MCP and malformed-input assertions. | Coverage intent inspected; no execution or test outcome asserted. |

The newly inserted permission read makes it possible for toolkit revocation during repository preflight to be observed before provider invocation. The resume update's state/count predicate addresses the asynchronous authorization interval: supported API paths do not rewrite the job kind/root/command in that interval, and a competing successful resume cannot silently be overwritten by this update.

The helper's earlier position in `submitJob` can change which denial is returned when a request simultaneously has a disabled permission and invalid path/selector. No supported valid request is rejected by a newly different predicate, and no concrete externally promised error-precedence regression was found.

## Limits and unchanged behavior

Global pause/read-only still gates admission at runner tick (`jobs.mjs:208-214`). Provider-internal work and OS path identity do not receive continuous revocation/cancellation enforcement; these are unchanged baseline boundaries, not newly introduced findings. The documented contract does not require terminating already admitted live commands. No new untrusted writer to the private SQLite state was established.

The new test assertions were not treated as proof of nonexecution or provider-call counts. No repository module, test, provider, upstream command, service, network request or production operation ran during this review. No repository source or runtime state was edited and no work was delegated.

The security diff skill was read, but its shared preflight resource was unavailable. Consequently this receipt is the requested manual static patch review; it does not claim completion of the plugin's formal scan workflow. Review coverage is confined to the two changed files and necessary direct callers, providers, guards and product policy.
