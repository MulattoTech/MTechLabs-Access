# Durable-job capability reauthorization triage

**Verdict: confirmed by static source inspection, high confidence.** An already stored job can start or be requeued after its `vmRead`, `codeRead` or `testRun` permission is disabled. The dispatch path reads the current toolkit but omits those per-kind checks. This is a toolkit permission-enforcement defect; the evidence does not establish anonymous access, user-role escalation or additional OS authority.

## Source binding and scope

Inspected repository: `/workspace/scratch/a92a3aacdca1/MTechLabs-Access-Descriptions`. The receipt is anchored to immutable commit `7ea1e80bb3f7aa95bdf340d4290327a506f65292`. During review the checkout advanced to `4ab98c6f9571b34def09e6aa63679804bb48dc0d`; all **19 reviewed files are byte-identical** across those two snapshots. Root requested main `ba4a55b7` and supplied runtime equivalence; that commit object is absent locally, so this report does not independently claim a comparison to its bytes. Source SHA256 and Git-blob hashes, bounded excerpts, and the finite decision model accompany the triage JSON.

This was one supplied finding, reviewed inline under `codex-security:triage-finding`. No repository code, tests, scripts, service, provider, upstream binary or actual job ran. No repository, policy, job database, GitHub or production state was changed. Only this owned scratch receipt was written. The main skill and result contract were available; its linked shared assessment references could not be read. No repository-owned `SECURITY.md` or scoped `AGENTS.md` was found; the toolkit README/runbook and `docs/security.md` provided product context.

## Exact mechanism

| Stage | Current source behavior | Consequence |
| --- | --- | --- |
| Submit | `lib/jobs.mjs:46-70` checks `jobs`; VM inventory additionally checks `vmRead`; repository jobs check `codeRead`; test jobs also check `testRun`. It persists the original kind/root/path/selector as `queued`. | A fresh submission is denied after the relevant permission is revoked. |
| MCP resume | `lib/engineering-tools.mjs:51-85` maps every `mterm_job_*` action to `jobs`. `resumeJob`, at `lib/jobs.mjs:107-118`, reads only state/count and checks ID, confirmation, terminal state and a three-resume limit. | A valid prior job can be requeued while its kind permission is disabled. |
| Owner HTTP resume | `admin.mjs:118-131` calls the same helper after bearer/Host/Origin checks; the helper does not check toolkit permissions. The website adds owner session and CSRF checks in `src/mcp.js:181-205,234-253`. | Admin requeue also omits kind authorization. It may queue while jobs is off, but jobs-off still prevents runner dispatch. |
| First dispatch | `lib/jobs.mjs:181-197` reads current settings and policy, but gates only `jobs`, global enabled and global writable state before selecting a queued row. | Revocation before the **first** queued dispatch is affected even if `resumeJob` is never called. |
| Run/provider | `lib/jobs.mjs:165-173` reads current toolkit only for the timeout. `execute`, at 150-163, calls the VM/code providers directly. | The per-tool wrapper is not reentered. Providers contain no replacement toolkit permission check. |

The actual paths are `gateway -> executeEngineeringTool -> submitJob/resumeJob -> SQLite queued row -> runner tick -> run -> execute -> provider`, or authenticated owner HTTP routes into the same submission/resume helpers. The runner is started by the local admin server's listening event (`admin.mjs:177-179`). A queued row may wait for a slot or across a manager lifecycle; no narrow race or database tampering is required to describe the missing decision.

## Bounded static negative cases

A harmless analysis helper checked six relevant source patterns, then evaluated the observed guards as booleans. It did not import JavaScript, open a job database, alter configuration or invoke a provider. The following are **source-derived decisions, not observed command executions**. Assume a valid stored job, `jobs=true`, global enabled/writable policy, available slot and the remaining root/platform/resource prerequisites.

| Stored kind | Permission later disabled | Fresh submission | MCP resume capability check | Runner kind admission |
| --- | --- | --- | --- | --- |
| `vm_inventory` | `vmRead` | Denied | Passes `jobs` | Missing; provider remains reachable |
| `repo_diagnostics` | `codeRead` | Denied | Passes `jobs` | Missing; provider remains reachable |
| `run_tests` | `codeRead` | Denied | Passes `jobs` | Missing; provider remains reachable |
| `run_tests` | `testRun` | Denied | Passes `jobs` | Missing; provider remains reachable |

For the resume case, a known ID, `confirm=true`, failed/interrupted/cancelled state and `resume_count < 3` are still required. For first dispatch, the earlier queued row already suffices; no caller is required after the owner revokes the permission.

## Actor and impact boundary

The owner must initially enable jobs and the required kind permissions. A legitimate owner later revokes one of those permissions while leaving jobs and global writable policy enabled. A currently authenticated owner-connected MCP client, or trusted enrolled local client, can request resume using an existing ID. That MCP request does **not** need the separate ability to save toolkit policy or edit SQLite. Automatic first dispatch needs no new actor after the revocation.

The remote surface is explicitly owner-only: `src/mcp-remote.js:68-94` validates the Access assertion, configured owner email, current approved owner record and revocation timestamp. Owner dashboard mutations require owner identity, matching session and CSRF (`src/mcp.js:181-205`); the PC checks bearer/Host/Origin (`admin.mjs:61-75`). The finding does not establish that a normal website user, anonymous client or revoked OAuth session can newly call these endpoints.

For test jobs, the sink is the already selected allowlist entry: `npm test`, `npm run lint --if-present`, `python -m pytest -q`, or `git diff --check` (`providers/code.mjs:91-103`). Repository test scripts can execute code/change files. The process launcher uses an argument vector, `shell:false`, inherited environment and ordinary manager process authority (`lib/command-runner.mjs:4-11`); it performs no elevation. Diagnostics use bounded Git/syntax operations, and VM inventory uses a fixed read-only `Get-VM` command on a suitably provisioned Windows host (`providers/infrastructure.mjs:4-11,24-25`). This does not extend to VM start/shutdown/checkpoint powers.

The supported policy boundary is the separate toolkit switch: README 394-402 presents independent capability controls and requires the corresponding permission for remotely initiated writes; `submitJob` implements those exact kind requirements. The new descriptions accurately disclose the existing submission-versus-resume checks (`engineering-descriptions.mjs:115-138`); they did not introduce the runtime omission. These switches do not promise OS isolation. Writable upstream Desktop Commander process/file tools may already grant broader host powers, so the finding is a failure to honor a toolkit permission revocation, not proof of new host privilege for the owner.

## Controls and evidence limits

- `jobs=false`, global pause, or global read-only **still blocks new runner dispatch** at `jobs.mjs:191`. No timing race after that admission check is claimed.
- A removed repository root is rechecked at execution by `allowedRepository`; canonical containment, Git-root validation, resource checks and fixed test selectors still apply. No arbitrary new selector, path escape or database corruption is needed or demonstrated.
- Permission changes do not promise to kill commands already running (README 46; RUNBOOK 18-25). This finding concerns a new start or explicit reexecution. Cancellation/descendant cleanup is outside its scope.
- Existing `engineering.test.mjs:67-80` covers queued cancellation and explicit resume without starting the runner. Scoped test inspection found no before-first-dispatch or before-resume capability-revocation regression. No test suite was executed here.
- Platform success, deployed exposure, live policy, actual command effects and production job state remain unobserved. Static confirmation establishes the missing authorization decision and reachable provider call, not host execution success.

## Existing issue mapping

The available local `github-inventory.json` snapshot covers **MulattoTech/MTerm-CLI**, verified at `2026-11-12T16:49:59.806Z`, rather than a complete Access issue inventory. The closest existing foundation is [MTerm-CLI #86](https://github.com/MulattoTech/MTerm-CLI/issues/86), which explicitly covers separate permissions and replay/revocation tests. [#130](https://github.com/MulattoTech/MTerm-CLI/issues/130), [#131](https://github.com/MulattoTech/MTerm-CLI/issues/131) and [#149](https://github.com/MulattoTech/MTerm-CLI/issues/149) are related resume/lifecycle/admission scopes. Those are contextual links, **not an established exact duplicate or a current status check**. No issue was created, edited, closed or fetched.

## Handoff

Recommend a narrowly scoped `fix-finding` implementation by the root writer: apply consistent current kind authorization before requeue and before queued dispatch, retaining existing global gates, root validation, fixed selectors and lifecycle semantics. Choose denied-job state/result semantics explicitly. In a separately authorized implementation step, add inert provider-boundary regressions for all four rows above and the allowed/global-policy/root-removal controls. This triage does not implement a fix or invoke the fix skill.

Evidence files in this receipt directory: `job-reauthorization-triage.json` (`triage-finding/v0`), `job-reauthorization-source-receipt.json` (source hashes and static decisions), and `job-reauthorization-source-excerpts.txt` (immutable line-numbered excerpts). Confidence is high for the bounded source finding; the singleton rank 1 in the JSON is not a severity rating.
