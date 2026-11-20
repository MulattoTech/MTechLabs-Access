# R54: Published npm PDF renderer source comparison (Access #44)

**Disposition: historical source/provenance audit only. R6 remains REJECTED. No causal fix or new hosted qualification.**

## Lockfile-verified published packages

R54 downloaded the two original npm tarballs to a new disposable scratch directory (not the production checkout), verified **whole-tarball SHA-512** against the exact frozen PR45 qualification lockfile integrity values, and inspected their tar entries in memory. It did not call npm, execute upstream code, extract files onto the host, or start a browser.

| Published version | Tarball bytes | SHA-512 integrity matched | Regular files |
| --- | ---: | --- | ---: |
| Control 0.3.1 | 1,698,882 | Yes | 292 |
| Candidate 0.3.3 | 1,766,017 | Yes | 311 |

Neither archive had symbolic/hard links or unsafe absolute/parent-escaping member paths. Both published entrypoints (package/dist/index.js) have SHA-256 **7e58b9d5d64732ff8cd77cd477de30751feb6b59bc2353dfaa78825f015b2f2b**, the same value recorded for both admitted entries in the actual historical R6 Linux artifact. The aggregate R6 report was still rejected.

## Compiled PDF module comparison (actual npm archives, not just tags)

The following compiled JavaScript files are **byte-identical** across published 0.3.1 and 0.3.3:

| File under package/ | Shared SHA-256 |
| --- | --- |
| dist/index.js | 7e58b9d5d64732ff8cd77cd477de30751feb6b59bc2353dfaa78825f015b2f2b |
| dist/tools/filesystem.js | 787d9f63525abf96d24b9a4696ac111c964510bc0899123d0afc9c5ab259dd69 |
| dist/handlers/filesystem-handlers.js | 667771f5439092c0554fa54313fbcb24a7762ffe6c7e4ed29f51dedcd52f417f |
| dist/tools/pdf/index.js | 9d7de10bb791a158fae0c61ee48d3d27bd3a623b6d7150335d6b97f71ee287ef |
| dist/tools/pdf/manipulations.js | 28d473e1752fbd67dcb6299df59902d7dc24b74d383b1564fb63d74764ffaa9c |

The one changed module in this group, dist/tools/pdf/markdown.js:
- Control 0.3.1 SHA-256: 61685462f9abb2517e4691fbc7baebea23260e776d3e216d941480551450e982
- Candidate 0.3.3 SHA-256: ece461975a0bb20a80e187431ca6a53281a691206f87711fc6a4700d76c3206b

There are **four exact line-diff hunks**: a new isDockerImage import; a documentation comment; conditionally skipping the Puppeteer cached-Chrome lookup when isDockerImage() is true; and conditionally adding --no-sandbox to Chrome arguments when isDockerImage() is true. Those are the only changes in the compiled markdown PDF renderer.

The published candidate package's isDockerImage() reads process.env.MCP_CLIENT_DOCKER === 'true'. In a static scan of every compiled JavaScript file in both archives, MCP_CLIENT_DOCKER occurred only in dist/utils/system-info.js. The frozen PR45 qualificationEnvironment() implementation in integrations/mcp-manager/lib/upstream-qualification.mjs copies only explicitly allowlisted parent environment variables and builds a fresh per-lane environment; **MCP_CLIENT_DOCKER is neither inherited nor set by that function**. Consequently, these two Docker-only PDF behavior branches are not expected to activate under the regular R6 disposable qualification environment. This is a source-path inference, **not direct instrumentation of the historical process environment**.

## PDF/browser dependency lock equality

Both exact frozen control/candidate lockfiles give the **same versions and integrity strings** for:
- md-to-pdf 5.2.5, puppeteer 25.16.0, puppeteer-core 25.16.0
- @puppeteer/browsers 3.2.6, chromium-bidi 157.0.8090-0
- pdf-lib 1.17.1, unpdf 1.8.1

Other dependency/initialization changes remain possible, and the two tarballs do contain different files. This comparison does **not** prove the full runtime environment or installed dependency trees were functionally identical. Equal entrypoints do not establish equal loaded state.

## Relevance to the historical failure

R53 established that the original hosted control 0.3.1 returned a timeout-classified write_pdf **tool error** in at most **48,883 ms**, before the qualifier's 90,000-ms MCP caller deadline; the candidate 0.3.3 PDF stage passed in 23,312 ms. R54 further narrows the evidence: the published direct PDF implementation and seven locked PDF/browser dependencies reveal **no straightforward non-Docker PDF code difference** that explains these different outcomes. An internal rendering/browser phase, a shared-vs-isolated environment interaction, or non-PDF dependency behavior remains unknown, not proven.

The next genuine hosted Windows/Linux qualifier, once GitHub Actions runner eligibility is restored, should preserve **both pinned upstream versions, the unchanged PDF fidelity rejection gate and all timeouts**. Only an independently reviewed diagnostic enhancement should record bounded, sanitized per-phase timing and fixed categorical outcomes (Chrome cache/system/install path, browser launch, markdown render, output write/read, cleanup), without exposing raw paths, tool errors, secrets or payload contents. Do not assert a browser or 30-second timeout cause without evidence.

**No new CI run, PR, source release, npm installation, browser execution, production files/services, Windows account/ACL/key/route change or DEV activation took place during R54.**
