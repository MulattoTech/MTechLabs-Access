# Desktop Commander 0.3.1 → 0.3.3: independent npm artifact review

## Outcome

**Both exact published artifacts and all 29 unique added dependency artifacts match the recorded integrity metadata. The corrected candidate lock changes only the intended root pin and Desktop Commander entry among existing packages, and the reviewed compiled paths support the existing source claims.** This is a static artifact/notice review; actual bridge compatibility and production rollout remain separate decisions. No upstream code, lifecycle script, installer or production verifier was run. Neither repository was modified.

## Exact identity

| Version | Tarball bytes | Files | Unpacked bytes | npm gitHead |
|---|---:|---:|---:|---|
| 0.3.1 | 1,698,882 | 292 | 4,126,145 | `7251da501d760e6eb5f95d802d9b42c741190950` |
| 0.3.3 | 1,766,017 | 311 | 4,349,837 | `bce370e9395f5bc74eda34913e5ae1dee48df8f8` |

- [0.3.1 tarball](https://registry.npmjs.org/@wonderwhy-er/desktop-commander/-/desktop-commander-0.3.1.tgz): SHA-256 `9661ecb819c3b47b8dfd8e2b58a6754ad1bb00c225518517d8ff0e3e0492f06d`.
- [0.3.3 tarball](https://registry.npmjs.org/@wonderwhy-er/desktop-commander/-/desktop-commander-0.3.3.tgz): SHA-256 `42390020cceb1cdfa537506fcd70f61eae10ab226c098403f1c5a77c350b07b3`.

Both SHA-512 SRI and SHA-1 shasum comparisons pass. File counts/unpacked sizes match metadata, every tar entry is a unique regular file, and the shipped manifest fields match registry metadata. Both pinned source manifests match the corresponding packaged manifest JSON; the source LICENSE bytes also match. Exact archive, per-file hashes and raw metadata are retained.

Both versions remain ESM, require Node **>=22.12.0**, use `dist/index.js` as the `desktop-commander` bin, retain setup/remove bins, and declare SDK **^1.32.1**. The Access manager's >=24 requirement remains a separate effective host requirement. Neither tarball includes a lock/shrinkwrap or original TypeScript sources.

Registry publication/provenance payloads name the downloaded SHA-512 digests. Their SLSA source pointers precede npm gitHead by one automated release commit: 51c7fbf→7251da5 for 0.3.1 and 6cb7f9d→bce370e for 0.3.3. Independent comparisons show only version changes in those release commits. Signature/Sigstore trust chains were not cryptographically verified, and no build was reproduced.

## Compiled contract and behavior

**Static tool names, input schemas and annotations have no identified changes.** `dist/tools/schemas.js` is byte-identical. The entire `dist/server.js` diff is one added paragraph in `kill_process.description`, documenting managed command-tree termination and negative node:local PIDs. The exact 606-byte patch is retained. The actual 53-tool bridge comparison remains necessary for runtime/dependency-generated differences.

| Area | Actual artifact observation |
|---|---|
| Dispatch/auth | `dist/index.js` is byte-identical. `--no-onboarding` follows stdio; remote activation requires the `remote` command or separately guarded device entry. Compiled 0.3.3 contains origin/path restrictions, fixed auth origins, saved endpoint-pair binding and redirect rejection. Remote modules and MQTT/Forge dependencies are still statically imported. |
| Command inspection | Ordinary process tools now select the actual shell before POSIX/PowerShell/cmd reading, including wrappers and script files; POSIX imports Unbash. Blocked/error outcomes refuse, while unseen outcomes can run with notes. This does not establish a sandbox. |
| Termination | `kill_process` now uses owned-session tree termination for a start_process PID; unrelated PIDs retain direct-PID termination. Failure reporting is preserved. |
| Windows | PATHEXT/ProgramData repair is shared. New threadpool bootstrap may relaunch on Windows libuv before 1.52, preserving argv and a launcher-lifetime channel. Actual Node/libuv and EOF ownership require qualification. |
| Search | All 12 search/ripgrep artifacts are byte-identical. Shared shell resolver/environment changes and dependency resolution can still affect behavior. |
| PDF | Under `MCP_CLIENT_DOCKER=true`, system Chromium takes precedence over cached Puppeteer Chrome and `--no-sandbox` is added. The marker is an environment comparison, not a verified containment boundary. |
| Startup | Existing feature-flag fetching and post-handshake Chrome discovery/download/document preload remain. `--no-onboarding` is not an offline switch. |

The complete archive delta is 28 added, 9 removed, 36 changed and 247 unchanged files. The removed bundled telemetry-contract files are replaced by implementation within the distribution; the exact direct dependency delta below has no other version-specification changes.

## Licenses and direct dependency delta

Both Desktop Commander tarballs ship the same complete **MIT LICENSE**: 1,108 bytes, SHA-256 `e77cff545e0506903bf6a4bf29169fa40911eb76d70d239267df10c5c59370dd`, with Eduard Ruzga/Contributor attribution. It is the only separately named license/notice file in each archive. The two browser UI bundles are byte-identical across versions; no license/copyright text was detected in them, so complete bundled-component notice coverage has not been established.

| Added dependency | Exact version | Declared license and qualification |
|---|---|---|
| mqtt |5.16.0|MIT; browser bundles contain short MIT/BSD-3-Clause notices, not a complete inventory of the 86 module-path entries. |
| node-forge |1.4.0|`(BSD-3-Clause OR GPL-2.0)` with an explicit BSD alternative. Embedded portions also carry MIT, Tom Wu permissive, BSD-labelled and public-domain notices. OpenSSL-derived attribution lacks precise version/terms evidence. |
| unbash |6.0.1|ISC; compiled ESM JavaScript parser, no native addon/WASM. |

Removed: `@desktop-commander/telemetry-contract` with `file:vendor/telemetry-contract`. All other direct specifications and optional `caffeinate` remain unchanged. The corrected lock adds 31 paths representing 29 unique artifacts. Their labels agree across lock, registry and shipped manifests: 26 MIT, 2 ISC and 1 Forge dual-license expression. BSD and ISC families already occur in the baseline; the sole newly introduced lock expression is `(BSD-3-Clause OR GPL-2.0)`, which has an explicit BSD choice.

All 29 unique new tarballs independently match the lock SHA-512 SRI, registry SHA-512 SRI and registry SHA-1. All ship license text; none declares `preinstall`, `install` or `postinstall`, or contains a Node addon, WASM, native library, or binding.gyp. Their other lifecycle declarations are recorded: notably socks and smart-buffer declare a `prepublish` command that installs TypeScript globally before building, and several worker/broker packages declare `prepare: husky`. These declarations are not evidence that ordinary registry dependency installation runs them. Forge ships a legacy SWF without ActionScript source; its default Node entry does not import the socket module.

Twenty-four artifacts provide registry gitHead. Twenty-three pinned manifest/LICENSE pairs match their shipped bytes; MQTT's manifest differs only in version (source 5.15.2, artifact 5.16.0). Five lack gitHead: `@babel/runtime`, `@types/readable-stream`, `@types/ws`, `typedarray` and `unbash`. Full notice text and per-artifact provenance are retained in `added-dependencies/SHIPPED-NOTICES.md` and `added-dependencies/lock-extension-report.json`. No reproducible source build or cryptographic provenance-chain validation was performed.

## Actual lock reconciliation

| Evidence | SHA-256 |
|---|---|
| Control lock | `aebd4d167353bb2a5c46865df019ffdc9d95ef904419e7fa695f5df7642aa813` |
| Corrected candidate lock | `1d28de913c330ce071735b594367e110c5752cec5a476d6da8bd327f6f52c143` |
| Corrected owner delta | `782b408f55857c6d6d978232b53f8bebe64bbdaaba8feefb83d3f2ebfea86a63` |

The independent before/after recomputation exactly matches **651 → 681 package entries; 31 added, 1 removed, 2 changed**. The changed existing entries are the root pin and Desktop Commander. The removed entry is the old bundled telemetry contract. Every other existing entry—including SDK **1.32.2**, resolved URL and integrity—is identical to control.

The resolved MQTT normal/optional dependency graph has **45 package paths and 73 recorded edges**, covering 29 added paths plus 16 existing paths. There are no missing normal/optional dependencies. Optional native `ws` peers `bufferutil` and `utf-8-validate` are absent and are not prerequisites imposed by this resolved graph.

The initial lock generation removed `libc` restrictions from 16 unchanged Linux Sharp/libvips records. Exact-version registry metadata corroborated the control restrictions. The owner restored only those 16 fields; independent review confirmed all 16 entries now match control. The initial drift and registry evidence remain preserved as history. The corrected lock has no remaining unrelated metadata drift identified by this comparison.

Existing `hasInstallScript` flags remain confined to Desktop Commander, fsevents and Puppeteer. Their prior native/browser prerequisites remain relevant; the absence of new native addons does not establish that those baseline prerequisites are installed or operational.

## Installation and qualification limits

Both main manifests retain:

```text
node dist/track-installation.js && node dist/npm-scripts/verify-ripgrep.js || node -e "process.exit(0)"
```

The tracking helper can read the home-directory Commander client ID and send HTTPS telemetry; the ripgrep verifier checks a native executable, and the outer fallback can conceal failure. The resolver can use the package binary, system PATH or common installation paths. An installation exit status is insufficient to prove the intended binary or native document prerequisites are ready.

The disposable harness should use the recorded exact locks and record actual native executable/cache paths, control feature-flag/browser effects, and qualify the configured Windows shells, command inspection, termination and shutdown. No changes to the old live verifier or production policy were made here.

Matching archive hashes does not establish benign behavior, complete source-to-build equivalence, whole-distribution license clearance, runtime 53-tool compatibility, or repair of the Access-owned OAuth boundary. Normal bridge argv does not reach upstream remote authentication; any claim about observed credential access/egress belongs to the controlled runtime qualification.

## Retained evidence

`artifact-review.json` holds the exact identities, selected compiled-file hashes, source/provenance checks, findings and limitations. This commit-ready directory retains the complete top-level LICENSE, added-dependency notice text, exact registry/source metadata, decoded attestation payloads, selected compiled hashes, tool-description diff, release comparisons and corrected-lock receipt. Original tarballs, safely extracted distributions, full compiled diffs and complete raw evidence remain in the separate scratch audit directory. No install, build, module import, paid call, production credential operation or repository mutation occurred.
