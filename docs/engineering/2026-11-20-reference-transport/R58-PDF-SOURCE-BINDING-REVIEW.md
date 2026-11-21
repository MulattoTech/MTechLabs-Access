# R58 — Exact-source binding for bounded PDF diagnostic candidate

**Status: source-only evidence. Not release acceptance or authorization to run hosted CI.**

## Reviewed source identity

- Original frozen PR #45 head: `f0855c1227aacc49071581bb52ba5566bc07ffce` (open draft, unmerged).
- Isolated Windows candidate: `0da3a5f74453cfbed82e2d1d4f61e1bae64efe9b`.
- Original candidate qualifier Git blob at `integrations/mcp-manager/qualify-upstream.mjs`: **`5bd1fa10fad4f55af6e7b01349beb3b1b0793c26`**, confirmed locally with `git rev-parse 0da3a5f:integrations/mcp-manager/qualify-upstream.mjs`.
- R56 PDF phase recorder source: `8f39d2791d16edb0b54f957354b5ca2b06fadddb`; R57 in-flight guard: `9779030f996f28e3ce2a25a9bc6f30edfc0603bf`.
- This R58 test is an **independent source-only check** added on a new branch based on exact R57. It modifies neither the executable qualifier nor helper.

## Method

The new `integrations/mcp-manager/test/pdf-phase-source-binding.test.mjs` reads the current qualifier *as text* (never imports or executes upstream code), validates a single, exact PDF-trace import and a single, exact three-phase wrapped block, and reverses only those known changes. It then computes the original Git blob SHA-1 including the `blob <bytes>\\0` prefix. The reconstructed, normalized original must equal the exact reviewed `5bd1fa10...` Git blob.

This is a **precise source-delta assertion**, not a claim that the PDF source is secure or the timeout resolved. It is intentionally fail-closed for future legitimate source edits until the reviewed anchor is updated through an independently approved change.

The test rejects synthetic mutations to the 90,000-ms `write_pdf` deadline, the fixed disposable Markdown, PDF magic/size threshold, required public readback text, phase sequence, and arbitrary non-PDF qualifier lines. It also rejects duplicate/removed instrumentation and mixed newline encodings. EOL-normalization accepts consistent Windows CRLF or Git LF, but not mixed line endings.

## Validation

- Five new offline source-binding cases passed on a separate clean Windows clone with local Node `v27.0.0-alpha.0.0.0`.
- Eight previously published R57 PDF trace cases passed in the same run.
- Total focused local checks: **13/13 passed**. Syntax validation and `git diff --check` passed.
- No dependency installation, package postinstall, actual `write_pdf`, browser, protected IPC, production/DEV execution, Windows restricted identity, or GitHub-hosted runner was invoked.
- This checks the qualifier's source **delta** only. It does not establish actual Node 24 behavior, original R6 PDF-control resolution, or safety across real operating-system identities.

## Release status

The latest inspected hosted run remains `44841780509`, in which all five jobs failed before executing test steps due to GitHub account payment/spending-limit admission annotations. The earlier PR #45 R7 hosted run also remains rejected. Account-level billing and runner eligibility must be restored and independently verified, followed by the frozen five-job Windows/Linux qualification, separate security review, and proper merge and actual-main acceptance gates. The source-only R58 branch is **not a stacked PR** and must not be merged directly.

Production services, credentials, accounts, ACLs, private keys, Cloudflare routes, connector settings, DEV provisioning and activation remain unchanged.
