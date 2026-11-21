# R59 — Offline Node 24 Linux PDF diagnostic compatibility receipt

**Disposition: local focused compatibility evidence only; not GitHub-hosted acceptance or permission to activate DEV.**

## Tested source and exact environment

- Repository: `MulattoTech/MTechLabs-Access` (private).
- Tested source: clean R58 branch `fix/access44-r58-pdf-source-binding-20261120` at exact commit `15af99687b4f69b09518c237e1704e23fa14bd27`.
- Image: existing local `node:24-bookworm-slim`, reported Linux/amd64 image ID `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`; Docker reported matching `node@` repository digest. This is *observed local image identity*, **not** independent supply-chain attestation.
- Node version independently reported from the existing image: **v24.21.0**.
- Conditions: `docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 512m --cpus 2`, with the cloned `integrations/mcp-manager` directory mounted at `/work` read-only; working directory `/work`.
- Command executed inside the container: `node --test test/pdf-phase-source-binding.test.mjs test/pdf-phase-trace.test.mjs`.
- Observed result: **13 tests; 13 passed, zero failed, exit code 0**.

## Evidence meaning

The five R58 source-binding negative/positive tests passed under local Linux Node 24.21.0. These tests reconstruct the original reviewed R46 qualifier `5bd1fa10...` Git blob after removing the exact R56/R57 instrumentation and reject altered PDF deadlines, fixture content, PDF assertions, unrelated qualifier lines and duplicate wrapper/import. All eight R57 phase-helper tests also passed, including failure propagation, bounded non-secret telemetry, rejection of overlapping phase calls, and independent reports.

This removes one *local runtime-major-version uncertainty* left by the prior Node v27 alpha runs. It does **not** prove actual GitHub runner admission, Node24 on Windows, the protected native IPC or restricted-identity tests, execution of original `write_pdf`, browser startup, PDF fidelity on upstream 0.3.1/0.3.3, original R6 timeout cause, or GitHub-hosted five-job acceptance.

No dependency download/install, package lifecycle hook, upstream package, production service or protected operational configuration was exercised. Docker container image provenance was not separately audited. The source mount was read-only, networking was disabled, and the container was removed after the run.

## Gate and next action

As last checked, PR #45 remains open/draft/unmerged at `f0855c12`; the latest run `44841780509` failed all five jobs before test execution with account payment/spending-limit admission annotations. **Do not trigger another runner or stacked PR until the GitHub account owner restores Actions billing/runner eligibility and a fresh run is explicitly authorized.** R56–R59 are source-only diagnostic/test evidence, not merged, accepted, or deployed. No PROD, DEV, ACL, account, credential, key, Cloudflare/connector, service or route change is authorized or performed.
