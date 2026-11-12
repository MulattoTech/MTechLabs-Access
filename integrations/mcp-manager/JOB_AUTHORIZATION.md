# Current capability admission for durable jobs

Source remediation for [Access issue 26](https://github.com/MulattoTech/MTechLabs-Access/issues/26),
within the broader [orchestration follow-up](https://github.com/MulattoTech/MTechLabs-Access/issues/16).

## Boundary

The job queue previously checked kind-specific permissions only when a job was
submitted. If the owner later revoked `vmRead`, `codeRead` or `testRun`, a stored
job could still be resumed or first dispatched. The same stored row reached the
provider without those current checks. Authenticated MCP and owner admin resume
routes both ultimately call `resumeJob`; queued dispatch also needs protection
when no new client call occurs.

This crosses the owner-controlled toolkit capability boundary. It does not
establish anonymous access, an escape from configured repository roots, a bypass
of global pause/read-only admission, or OS privilege escalation. The source
review and regressions use disposable local state and an owned Git fixture.
No owner repository, VM operation or upstream package is executed by them.

## Resulting behavior

| Stored job kind | Current capabilities required |
| --- | --- |
| VM inventory | `jobs`, `vmRead` |
| Repository diagnostics | `jobs`, `codeRead` |
| Allowlisted tests | `jobs`, `codeRead`, `testRun` |

The shared check also rejects unknown stored kinds and unsupported test selectors.
Submission uses the same check. Resume rereads toolkit settings before changing
the row; a denial leaves previous status, result, error, timestamps and resume
count intact. A conditional state/count update prevents concurrent resumes from
clearing evidence twice or incrementing an already requeued row.

The runner rereads current capabilities after its asynchronous repository/resource
preflight and immediately before dispatching a provider. A denied attempt records
`failed` with the applicable bounded capability error and no provider result.
Restoring a permission does not automatically retry that failed job; the existing
explicit resume action is required. Malformed toolkit settings fail closed.

Global pause/read-only/jobs admission, root confinement, fixed command selectors,
resource thresholds, explicit confirmation and the three-resume limit retain their
existing roles. Capability updates apply at admission; they do not retroactively
terminate an already dispatched operation. Existing cancellation still targets
supported direct children and does not guarantee descendant termination.

## Evidence and scope

The new focused regressions first produced **13 failures and one passing allowed
control** against the prior source. The corrected boundary passes **14/14** and
the owning manager suite passes **93/93** before final metadata/documentation
integration. They cover all kind capabilities at resume, initial and resumed
repository dispatch after revocation, MCP resume, preserved evidence, malformed
settings, invalid stored kinds/commands, concurrent resume and allowed execution.
The allowed execution uses only `git diff --check` in a disposable Git repository.

The implementation introduces no provider injection or testing override. VM
dispatch shares the same current capability guard; VM execution is not exercised
by this regression suite. Authenticated admin routes retain their existing tests
and call the same checked resume helper. The final candidate still requires
independent review, hosted checks and actual-main verification. Installed
deployment and live acceptance remain separate; no production restart is included.
