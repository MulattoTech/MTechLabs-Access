# Engineering tool descriptions

The 28 MTerm engineering tools now expose static, multiline plain text in their
MCP `description` field. Each description identifies purpose, inputs, required
permissions, and returned evidence or limits; tools with arguments also include
an example where useful. The labels remain readable in clients that display
plain text without Markdown. Descriptions contain no HTML or encoded line-break
sequences. The registry includes quoted examples and actual Unicode degree signs.

This is source metadata for [MTerm-CLI issue 246](https://github.com/MulattoTech/MTerm-CLI/issues/246).
It does not establish that an installed ChatGPT plugin has refreshed or rendered
the descriptions. Actual desktop and narrow settings views, authenticated staging,
skill metadata and the final deployment remain separate acceptance work.

## Behavior-grounded corrections

| Tool | What the description now makes explicit |
| --- | --- |
| `mterm_vm_checkpoint_create` | The provider calls `Checkpoint-VM`; it does not select or verify production checkpoint type. |
| `mterm_patch_apply_checked` | Even `apply=false` requires writable policy and `repoWrite`; the expected-HEAD check is not an atomic lock. |
| `mterm_repo_inspect` | Cleanliness and changed files exclude untracked files. Package script names are returned without executing them. |
| `mterm_code_symbols`, `mterm_code_references` | Searches are lexical patterns or literal text, with bounded results and no semantic resolution. |
| `mterm_test_run` | Commands execute repository code; missing optional lint can pass, and timeout targets the direct child. |
| `mterm_job_resume` | Failed, interrupted and cancelled jobs restart from the beginning; prior stored evidence is cleared. |
| `mterm_job_cancel` | A request does not prove descendant termination, and VM inventory does not consume the runner's abort signal. |
| `mterm_math_verify` | A false result can mean equivalence was not established; it is not a general proof of inequivalence. |

All 28 tool names, ordering, schemas, annotations and read-only membership match
Access source `ba4a55b7ed351f7e60928179edaa7449de00be7d`. A committed fixture binds the
non-description contract to SHA-256
`2f66aaf72db1583aa3940acb5a0374bb5298e90eec5e5bba0ec733ba25549cfe`.
Provider execution, capability dispatch and global admission are unchanged.

## Verification and limits

The new regressions first failed against the original descriptions. The revised
manager suite passes **79 tests**, including four metadata checks: exact contract
preservation; bounded readable sections without control characters or escaped
formatting; important behavior limitations; and actual managed gateway
`tools/list` JSON serialization. The gateway fixture runs an inert local child,
and confirms exact line breaks, quotes, Unicode and descriptor bytes even while
tool execution is paused. It does not authenticate through the production plugin.

The static provider review and normalized red/green records are retained in
`metadata-evidence/`; the dated engineering record binds their original and stored
hashes. Plain-text structure is verified; actual UI wrapping, clipping and
accessibility remain to be observed in the client. No production deployment,
runtime restart, authentication change or full issue acceptance is claimed.

The first hosted candidate passed all four metadata checks and the 123 application
tests, but the existing pause test failed because a fixed sleep did not establish
that the first request had dispatched and the second had queued. The follow-up
uses explicit started, queued and release barriers, preserving the assertion that
queued work is rejected during pause while already dispatched work completes.
This fixture correction changes no runtime admission code. The local suite again
passes 79/79; a fresh exact hosted result and review remain required. The failed
candidate receipt and revised green record are retained in `metadata-evidence/`.
