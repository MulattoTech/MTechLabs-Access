# Access PR24: candidate 92f5579b hosted receipt

**Status: blocked on Linux PDF creation.** Candidate `92f5579bdb8365013600fa210755f0671a23b868`, tree `d150910b16ff394a6c089b78a49235f7d88be14f`, completed [run 43289469119](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/43289469119), attempt 1, with three successful checks and one failure. No retry occurred.

## Exact checks

| Check | Job ID | Result | Source/guard tests |
|---|---:|---|---|
| managed-mcp | 131431539614 | success | 95/95 pass, 0 fail, 0 skip |
| Upstream qualification / ubuntu-latest / Node 24 | 131431540007 | failure | 95/95 pass, 0 fail, 0 skip |
| Upstream qualification / windows-latest / Node 24 | 131431540080 | success | 95/95 pass, 0 fail, 0 skip |
| test | 131431540218 | success | 123/123 pass, 0 fail, 0 skip |

All jobs used Node **v24.22.2**, npm **11.19.1**, with no skipped or cancelled tests. Both upstream jobs passed all 95 guard tests and their final tracked-source diff checks. Root test also passed check/build/generated-UI verification.

## Four real upstream lanes

| Behavior | Linux control 0.3.1 | Linux candidate 0.3.3 | Windows control 0.3.1 | Windows candidate 0.3.3 |
|---|---|---|---|---|
| Initialization, 53-tool contract, owned config/file work | Pass | Pass | Pass | Pass |
| Search completion and pagination | Pass | Pass | Pass | Pass |
| Shell blocklist before marker execution | Pass | Pass | Pass | Pass |
| Bounded output and owned process-tree cleanup | Pass via force_terminate | Pass via kill_process | Pass via force_terminate | Pass via kill_process |
| PDF creation/read fidelity | write_pdf_tool_error | write_pdf_tool_error | Pass | Pass |
| Admission released | Not reached | Not reached | Pass | Pass |
| EOF close, gateway/upstream/owned tree exited | Exit 0 | Exit 0 | Exit 0 | Exit 0 |
| Overall lane | Fail | Fail | Pass | Pass |

Both Linux failures are at `pdf_create_and_read_fidelity`, with `failureCode: write_pdf_tool_error` and `rpcErrorCode: null`. The report does not preserve the underlying PDF error detail, so this receipt does not assign a cause.

Search observations are independently consistent in all four lanes: six matches/results, three completed pages of two markers each, exactly markers 0–5 with no duplicate or gap, stable session identity, and `hasMoreResults` true/true/false.

Both platform tool arrays independently compare equal for all 53 names and non-description fields. Only `kill_process.description` differs. All four native prerequisite receipts still match the independently verified exact npm ripgrep binaries at 1.18.0.

## Assertion-backed evidence and limits

The exact harness and transport bytes were captured and matched to the candidate Git tree. A blocklist pass requires an owned sentinel file to remain absent and the public response to satisfy the denial predicate. A process pass checks fixture nonce, two live owned PIDs, a bounded three-line tail and both PIDs stopped. The transport closes only owned stdin; the harness waits for completion and records exit 0. Overall lane pass also requires no signal.

Windows PDF success means the harness observed a successful public write_pdf call, `%PDF-` signature, more than 1,000 bytes and public read_file output containing the fixture title. Both PDFs were **19,629 bytes**, with hashes:

- Control: `700126183908d5abbdaba34a576f296ffd1d31667409acfd202374bb3b350460`.
- Candidate: `da1e6eac3b5650f098056761d2b7575a5de2d8c738fcb1fb616430ebf3cd3b8f`.

The original PDFs, raw process output, raw blocklist responses and individual sentinel probes were not copied into the report artifacts. These outcomes are therefore tied to the reviewed harness assertions, while search values, binary hashes and completion fields are independently inspectable from the saved reports.

## Identity

All logs record PR checkout `ca587a109a2e2f85aa5ed39770d371273c233079`. Its tree equals the candidate tree and its parents are the exact base and candidate. Actual main remains `ba4a55b7ed351f7e60928179edaa7449de00be7d`. The candidate parent is 1123952b. All 26 checked manifest/lock/static artifact-evidence entries remain unchanged.

Linux lock hashes match the reviewed canonical files. Windows hashes exactly match those files converted to CRLF; JSON package content is unchanged.

## Preserved artifacts

| Platform | Artifact ID | ZIP bytes | Independently verified GitHub ZIP SHA-256 |
|---|---:|---:|---|
| Ubuntu | 13977145483 | 35,267 | `5acea300bc0aecc093bcebd69bc0969d819093cf4a9f618263a6eb1ae73a90e5` |
| Windows | 13975273648 | 35,758 | `70fffe312f4092c88a24b5e51619318243c780a922a6b0caeef889524599c956` |

Both ZIP digests match the API and upload logs. Complete decoded job logs, extracted reports, exact API/source identity, per-file hashes and independent artifact validation remain in `peer-access24-92f5579b-evidence`. No source/GitHub/production mutation or local upstream execution occurred. Overall qualification and deployment remain unapproved.
