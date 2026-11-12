# Exact added-lock artifact evidence

## Reviewed result

**31 added lock paths / 29 unique artifacts are covered.** All 29 match the corrected lock SHA-512 integrity, npm registry SHA-512 integrity and npm registry SHA-1. Twenty-six missing artifacts were fetched; the three direct artifacts were reused without redownload.

Corrected candidate lock SHA-256: `1d28de913c330ce071735b594367e110c5752cec5a476d6da8bd327f6f52c143`. Original candidate lock SHA-256: `fd80a897bf5405a04cbc7240f0c9eeca59ef96dae7e3f25592faa32cc936636d`. All 31 added entries are structurally identical to the original added-entry snapshot; only the parent review’s lock corrections changed. Original delta/control identities remain in the JSON report.

Every reviewed artifact ships standalone license text. License fields agree across lock, registry and shipped manifest: **26 MIT, 2 ISC, 1 (BSD-3-Clause OR GPL-2.0)**. The 26 newly downloaded artifacts consist of 25 MIT packages and split2 under ISC. Forge’s BSD alternative remains explicit.

## Acceptance limits

| Area | Evidence and limit |
|---|---|
| Identity | Established: all 29 artifacts match corrected-lock SRI, registry SRI and registry SHA-1; source snapshot binds unchanged added entries to the corrected lock. |
| License Evidence | Established for shipped standalone texts and detected embedded notices of all added artifacts. Complete final-distribution rights/notice compatibility is not determined; retain stated embedded-origin limits. |
| Install Hooks | No preinstall/install/postinstall declarations in added manifests. Other lifecycle declarations are preserved and must not be summarized as no scripts. No install was performed. |
| Native | No new Node addon/WASM/native-library/build prerequisite detected in these artifacts. Forge legacy SWF caveat remains; unchanged baseline and real runtime compatibility are outside this artifact review. |
| Provenance | 23 pinned source manifest/license pairs match; MQTT version mismatch and five absent gitHeads remain. Registry signatures/attestations and complete source-to-build reproducibility were not verified. |

## Material findings

- **Hook Source Workflows:** socks@2.8.10 and smart-buffer@4.2.0 each declare prepublish: npm install -g typescript && npm run build. Six worker/broker packages declare prepare: husky and prepublishOnly: npm run build. MQTT declares prepare build, Forge prepublish build, unbash prepack TypeScript build. None of the 29 added unique artifacts declares preinstall, install, or postinstall. These facts do not assert which hooks a particular npm workflow invokes; source or publishing workflows differ from registry dependency consumption.
- **Engine Field Shape:** concat-stream@2.0.0 has an array-valued engines field ["node >= 6.0"] in the lock, registry metadata and shipped manifest. Record this non-object shape rather than silently treating it as a normal engines.node constraint. The highest explicit Node lower bound among the added artifacts is fast-unique-numbers >=18.2.0; no runtime test was performed.
- **Embedded Notices:** Newly inspected artifacts include the complete Sindre Sorhus MIT notice in commist/leven.js; full Node.js/Joyent MIT texts in readable-stream and Joyent headers in events; regenerator-runtime Facebook/MIT notices in @babel/runtime; Linden Research/Joshua Bell attribution in typedarray; and both split2 copyright-year notices (standalone LICENSE 2014-2018, source header 2014-2021). abort-controller UMD sourcemap embeds an event-target-shim copyright/license pointer. These are captured alongside complete standalone license files.
- **Prior Direct Notice Limits:** MQTT browser bundles retain three short bundled notices and do not establish complete licensing for every embedded module. Forge retains MIT, custom Tom Wu, BSD-label and public-domain origin notices; lib/aes.js acknowledges OpenSSL-derived portions without an exact upstream version or separate OpenSSL terms. The complete top-level Forge license offers BSD or GPL v2. These are factual evidence limits, not infringement findings.
- **Native Scope:** No added artifact contains a detected .node, .wasm, native library, platform-native executable, native source prerequisite or binding.gyp, and none declares os/cpu/libc/gypfile restrictions. The only compiled asset candidate is the previously reviewed Forge flash/swf/SocketPool.swf, with no ActionScript source in its tarball. This does not certify unchanged baseline native packages or runtime behavior.
- **Source Provenance:** 24 of 29 artifacts carry a registry gitHead. Pinned package.json and top-level license bytes match for 23. MQTT alone retains the recorded version-only package manifest mismatch (source 5.15.2 vs tarball 5.16.0). @babel/runtime, @types/readable-stream, @types/ws, typedarray and unbash have no registry gitHead. concat-stream and process stale repository owner URLs were resolved through GitHub API repository redirects; their canonical pinned files match. Matching these selected files does not reproduce a build or authenticate publisher signatures.
- **Count Shape:** @types/readable-stream has 4 regular files plus one directory, versus registry fileCount 5; @types/ws has 5 regular files plus one directory, versus registry fileCount 6. Registry counts match archive entries in these two cases; all available unpacked sizes match. There is no integrity mismatch.

## Exact added artifacts

Path counts include repeated lock placements. Full SHA-256 values and primary tarball URLs are in artifact-SHA256SUMS.txt and the structured report.

| Exact artifact | Paths | License | Declared lifecycle hooks |
|---|---:|---|---|
| abort-controller@3.0.0 | 1 | MIT | None |
| @babel/runtime@7.29.14 | 1 | MIT | None |
| bl@6.1.6 | 1 | MIT | None |
| broker-factory@3.1.15 | 1 | MIT | prepublishOnly: npm run build; prepare: husky |
| buffer@6.0.3 | 2 | MIT | None |
| buffer-from@1.1.2 | 1 | MIT | None |
| commist@3.2.0 | 1 | MIT | None |
| concat-stream@2.0.0 | 1 | MIT | None |
| event-target-shim@5.0.1 | 1 | MIT | None |
| events@3.3.0 | 1 | MIT | None |
| fast-unique-numbers@9.0.27 | 1 | MIT | prepublishOnly: npm run build; prepare: husky |
| help-me@5.0.0 | 1 | MIT | None |
| mqtt@5.16.0 | 1 | MIT | prepare: npm run build |
| mqtt-packet@9.0.2 | 1 | MIT | None |
| node-forge@1.4.0 | 1 | (BSD-3-Clause OR GPL-2.0) | prepublish: npm run build |
| process@0.11.10 | 1 | MIT | None |
| readable-stream@4.8.0 | 2 | MIT | None |
| rfdc@1.4.1 | 1 | MIT | None |
| smart-buffer@4.2.0 | 1 | MIT | prepublish: npm install -g typescript && npm run build |
| socks@2.8.10 | 1 | MIT | prepublish: npm install -g typescript && npm run build |
| split2@4.2.0 | 1 | ISC | None |
| typedarray@0.0.6 | 1 | MIT | None |
| @types/readable-stream@4.0.25 | 1 | MIT | None |
| @types/ws@8.18.2 | 1 | MIT | None |
| unbash@6.0.1 | 1 | ISC | prepack: tsc -p tsconfig.build.json |
| worker-factory@7.0.50 | 1 | MIT | prepublishOnly: npm run build; prepare: husky |
| worker-timers@8.0.34 | 1 | MIT | prepublishOnly: npm run build; prepare: husky |
| worker-timers-broker@8.0.18 | 1 | MIT | prepublishOnly: npm run build; prepare: husky |
| worker-timers-worker@9.0.15 | 1 | MIT | prepublishOnly: npm run build; prepare: husky |

## Evidence subset

This directory is the minimal commit-ready subset; it contains no tarballs, distributed runtime modules or executed upstream code.

- `lock-extension-report.json`: per-artifact digests, primary URLs, engine/script/native declarations, lock paths, source comparisons and limits.
- `SHIPPED-NOTICES.md`: complete standalone license/notice/author files and detected embedded notices, with artifact hashes.
- `artifact-SHA256SUMS.txt`: all 29 tarball SHA-256 values and exact primary URLs.
- `registry-metadata-evidence.json`: exact raw registry JSON text, URL and raw SHA-256 for each artifact.
- `source-manifest-evidence.json`: exact retrieved pinned and shipped package manifests with hashes and comparisons.

Full original tarballs, per-file manifests and safe extracted evidence remain outside this subset. This is factual artifact and notice evidence; it does not grant legal clearance or assert runtime compatibility. No further baseline source audit was performed.
