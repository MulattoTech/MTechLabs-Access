# R53 — Historical R6 Linux PDF timeout: client 90-second deadline not exhausted

**Disposition: historical source/artifact review only. R6 REJECTED; no proven root cause, correction, or new hosted qualification.**

## Original evidence, newly re-opened

The actual GitHub Actions artifact **14630209019**, `upstream-qualification-ubuntu-latest-44740386851-1`, from **run 44740386851**, attempt **1**, still existed on GitHub and was downloaded into an exclusive temporary review directory on the authorized host. It contained **10 report/log files**; this review parsed its original `qualification.json`, `control-result.json`, `candidate-result.json`, and the two small installation logs as data, **without installing or executing the upstream packages**. A [sanitized R53 receipt](sanitized-r53-r6-pdf-timing-20261120.json) records the exact three JSON SHA-256 hashes, immutable source identity, observed times and non-acceptance flags without copying raw error text, private paths or tool content.

The qualifier at PR45 exact head `f0855c1227aacc49071581bb52ba5566bc07ffce` has Git blob `5bd1fa10fad4f55af6e7b01349beb3b1b0793c26` for `integrations/mcp-manager/qualify-upstream.mjs`. Its source:

- Executes control `0.3.1` **before** candidate `0.3.3`, sequentially;
- Installs each lane using `npm ci --ignore-scripts --no-audit --no-fund`;
- Calls `write_pdf` and then `read_file` with **90,000 ms** MCP client deadlines;
- Rejects an `isError=true` response and records only a bounded, hashed and classified failure signal.

## Proven sequential timing bound

| Recorded quantity | Milliseconds |
| --- | ---: |
| Whole two-lane qualification, 13:00:07.817Z through 13:01:24.505Z | **76,688** |
| Completed control stages before PDF failure, eight stages | 2,064 |
| Completed candidate stages, ten stages | 25,741 |
| **Upper bound for failed control PDF stage** | **48,883** |
| Configured client `write_pdf` timeout | **90,000** |
| Candidate PDF-fidelity stage duration | 23,312 |

The calculation `76,688 − 2,064 − 25,741 = 48,883 ms` excludes additional preparation, installation and reporting overhead, so the actual failed control PDF stage must have taken **no more than this bound**. In particular, its failure **could not** represent the MCP caller waiting out its own **90-second** `write_pdf` deadline.

The control's `write_pdf` **returned** a tool error (`isError=true`, `failureCode=write_pdf_tool_error`) whose bounded 90-byte UTF-8 error text matched the qualifier's `timeout` classifier. The original report contains **no recorded error codes** and no timestamp for the failed stage itself. Thus the precise operation returning or producing the timeout signal is **unknown**. The 48.883-second upper bound does not establish a 30-second internal limit, browser-install failure, network outage, missing Chrome, or library defect.

## Entrypoint and environment comparison

Both admitted `@wonderwhy-er/desktop-commander` lanes reported an **identical executable entrypoint SHA-256**:

`7e58b9d5d64732ff8cd77cd477de30751feb6b59bc2353dfaa78825f015b2f2b`

Their exact package manifest and lockfile hashes **differ**. The frozen install logs report **612 packages for 0.3.1** and **643 packages for 0.3.3**. The candidate produced a PDF of **13,242 bytes** and completed its fidelity stage in 23.312 seconds; the control did not produce an accepted PDF or pass its stage. Equal entrypoint hashes do **not** prove identical dependency/runtime behavior, and the install-count difference does **not** establish that the lockfile change caused the PDF outcome. The source-level R40 lockfile difference review remains separate evidence.

## No-go and next genuine qualification

The historical R6 aggregate result is explicitly `pass=false`. R7 run 44742255585 never executed required steps, so no later PR45 or candidate-hosted result replaces it. Before proposing a causal fix, a genuinely admitted hosted **control** reproduction must preserve bounded evidence for the upstream error's internal failing operation (for example, whether rendering/browser launch itself reports a timeout) without leaking raw paths, secrets or disabling error handling. A hypothetical dependency, browser or timeout edit is **not authorized** by this report.

Keep the two required Windows native and both Linux/Windows upstream lanes, source pins, immutable artifact review, normal expected-head merge, separate actual-main acceptance and issue #46's future protected DEV token/ACL/rollback gate intact.

**No PR, CI rerun, source patch, npm install, PDF generation, production/Windows account/ACL/key change, tunnel/connector modification or DEV activation was performed.**
