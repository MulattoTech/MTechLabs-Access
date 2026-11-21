# R56 — Bounded PDF phase observation (source-only candidate)

## Basis and scope

This checkpoint forks the isolated, unaccepted Windows source-fix candidate at `0da3a5f74453cfbed82e2d1d4f61e1bae64efe9b` into `fix/access44-r56-pdf-phase-observation-20261120`. It changes the **disposable upstream qualifier only** and adds its self-contained phase recorder and local negative tests. It does **not** change PR #45's frozen source, its five-job workflow, installed production, upstream npm package bytes, accounts, keys, ACLs, tunnels, or DEV activation.

The original R6 Linux control (Desktop Commander 0.3.1) returned a PDF timeout-classified tool error within at most 48,883 ms although the caller's `write_pdf` deadline remained 90,000 ms. The 0.3.3 candidate passed the recorded PDF stage. R54 source comparison narrowed direct non-Docker rendering-code differences, without proving the internal cause. Neither historical outcome is newly accepted.

## Proposed additional evidence

One existing `pdf_create_and_read_fidelity` stage still performs the same three required operations and assertions:
1. `write_pdf_rpc`: actual public `write_pdf` call, **unchanged 90,000 ms RPC deadline**, with original fixed disposable markdown and existing sanitized `pdfFailure` signals if `isError=true`.
2. `pdf_magic_and_size`: read owned output file and demand the original `%PDF-` signature and size greater than 1,000 bytes.
3. `read_pdf_fidelity`: public `read_file` call with **unchanged 90,000 ms RPC deadline**; require the original `MTERM PDF FIXTURE` text.

The new `report.pdfPhases` array contains only a fixed approved phase name, a pass/fail boolean, bounded monotonic `durationMs` (capped with `durationCapped`), and preserves invocation order. It never records raw tool data, exceptions, filesystem paths, browser output, environment values, or credentials. Failure still throws into the existing fail-closed qualifier handler and prevents advancement to subsequent phases. Successful PDF hash and size remain recorded **only after all three phases pass**, as before.

**Interpretation limit:** This separates public RPC execution from file-byte verification and readback, but it does *not* reveal internal Chrome initialization, browser launch, PDF rendering, or upstream network timeouts. It does not replace separate bounded internal probes if a future hosted failure requires them.

## Local validation and release limits

- Local Node version: `v27.0.0-alpha.0.0.0` (not the required hosted Node 24).
- `node --check` passed for the qualifier and added helper.
- `node --test integrations/mcp-manager/test/pdf-phase-trace.test.mjs`: **5 passed, 0 failed**.
- `git diff --check` passed. The qualifier diff adds one import and wraps the original three PDF operations; the fixed markdown, 90-second deadlines, signatures, fidelity assertion, source selection, normal reporting, and cleanup remain unchanged.
- Full repository suites, real `write_pdf` calls, hosted Windows/Linux execution, and independently qualified security identities **were not run**. New source would require independent review, updated exact-source/frozen test evidence, and genuinely executed hosted acceptance before integration.

## Current decision

**Reviewable only / not merge-authorized.** GitHub Actions' latest recorded PR47 run `44841780509` failed five jobs before execution with billing/spending admission annotations. PR45 stays draft/unmerged at `f0855c12`; protected Windows IPC and all operational DEV isolation gates remain blocked until restored runner eligibility and separate approval. No stacked PR, CI rerun, merge, deployment, or DEV activation was initiated by R56.
