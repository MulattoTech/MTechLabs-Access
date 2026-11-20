# Access #46 — production relocation dependency and legacy-path audit

**Design/source review only. No cutover, source execution, CI rerun, account/ACL changes, or DEV activation.** This record reviews tracked source—not the private contents of user application configurations. A source match is not proof a runtime dependency was exercised.

**Source identity, November 20, 2026:** draft [PR #45](https://github.com/MulattoTech/MTechLabs-Access/pull/45) exact head `f0855c1227aacc49071581bb52ba5566bc07ffce`; base `15e851b11984592803d37599b639772e51e5c8c0`. A read-only tracked-file search compared the recorded installed-source revision `9373fadc00689dd782143ab5e49664536f460b8b` and local owner checkout `ba4a55b7ed351f7e60928179edaa7449de00be7d`. Selected files were subsequently reopened **directly from GitHub at the PR45 head**. The local checkout lacked the exact PR45 base Git object during this review; no locally inferred full PR45 source search is claimed.

## 1. Why a directory copy or shortcut change is insufficient

The current owner-scoped Startup shortcut calls **Windows PowerShell 5.1**, which invokes `H:\MTechLabs\MCP\runtime\manage.ps1 -Action Start`. That launcher selects an absolute H: manager source/config path, a fixed Node executable and exclusive production listener `127.0.0.1:19740`. The separately tracked installer pins the same H: root and, when run, can modify shortcuts and start the manager. Merely changing one shortcut would leave an old entry/config reference in the production launcher.

Several verification/setup utilities **write to H: state or user client configuration**, even when their names suggest diagnostics. The migration plan must explicitly retire or rebind them; they are not read-only and were **not executed** in this review. Conversely the public production hostname, Cloudflare backend origin and port contract must be **preserved** unless independently approved as a separate routed production change. Never perform a global search-and-replace of H:, port 19740, or origin hostnames.

## 2. Exact PR45-head source impact matrix

| File and Git blob | Static dependency or side effect | Required future disposition |
| --- | --- | --- |
| `integrations/mcp-manager/install-windows-startup.ps1` — `35eac7ae50dac95a42e0bf889a6fbaef256c0901` | Hardcoded H: root, PowerShell launcher shortcut and working directory; installer can invoke Start. | **Production change gate:** prepare exact new launcher/shortcut path and startup semantics, preserve existing entry until a rollback-qualified maintenance cutover; never execute for read-only inspection. |
| `integrations/mcp-manager/manage.ps1` — `cf812d14434eda151fc487cb3c42f82d4b6f87a4` | Hardcoded production H: runtime and config, shared Node location, exclusive 19740 ownership check. Current candidate has stricter argument parsing than the installed prior-revision source. | **Production change gate:** stage and independently qualify new launch-path/source identity and migration from deployed revision, with existing listener untouched until cutover. |
| `integrations/mcp-manager/admin.mjs` — `2e37b234afa2b7a3bec721cc9cd71543908eab23` | Production host allowlist, `mcp-origin.m-techlabs.com`, loopback 19740, config-selectable port with fallback 19740. | **Preserve production routing and Host checks.** Relocation does not authorize production-to-DEV origin or listener changes. |
| `integrations/mcp-manager/configure-desktop.mjs` — `9d045726010214553b482b4ecbcc8fe974e0e78f` | Writes the owner's Claude Desktop configuration, backups under H:, and a gateway/config command pointing at old H:. | **Separate client migration and backup gate.** Inspect actual installed client entries, preserve other servers, and authorize one surgical change. Do not execute during diagnostics. |
| `integrations/mcp-manager/inventory-tools.mjs` — `bcb1e275aef08353519812e95d730a0f6eaff291` | Launches module from old H: `node_modules` and writes tool manifest into H: state. | **Test/diagnostic writer:** retire or rebind to owned disposable state; prevent stale old-root writes after cutover. |
| `integrations/mcp-manager/verify-clients.mjs` — `57a494c0cbeb87351ca8f50d433a651414d428b1` | Hardcoded `INSTALLATION_ROOT` under H:, compares stored client source/config entries to that root, opens MCP sessions and writes a report in H: state. | **Client/source verification gate:** update installation-root assumptions and report location; do not assume three local clients' private settings are already correct. |
| `integrations/mcp-manager/verify-installation.mjs` — `090075eb3db5fd8dbda961efa7f5663141167c54` | Creates a temporary verification config beneath H: state, exercises filesystem/process tools, toggles test policy, writes a report. | **Side-effecting disposable qualification only:** require explicitly approved scratch location, owned process cleanup and real policy/source isolation. Not read-only. |
| `integrations/mcp-manager/verify-remote.mjs` — `5a6f9f957256d9b35fe922172963fd097f235244` | Creates H: remote-verification state, writes test policy and digest, binds ephemeral HTTP loopback server, probes production-compatible Host values. | **Side-effecting disposable qualification only:** isolate scratch and tokens, preserve production Host tests. Do not retarget actual production origin. |
| `integrations/mcp-manager/verify-http.mjs` — `4180888ab320185bc1f5f35b8ad1f02589d7478d` | Uses existing production `mcp-origin.m-techlabs.com` endpoints. | **Keep production origin constant** for post-cutover route checks unless separately approved. |
| `src/mcp.js` — `5bc115b4321bac1b40e99ca9a99d1c2167338bc8` | Production Worker pins backend `https://mcp-origin.m-techlabs.com`. | **Preserve public production edge.** No Cloudflare Worker/DNS/Access/connector mutation is implied by a filesystem relocation. |

Tracked local-source search also found legacy-root references in `example-config.json`, tests, `README.md` and `RUNBOOK.md`. Examples, source tests, installed config, and private client settings have different authority; none should be treated as interchangeable. No raw client configuration, secret, token, or account-specific report content was exported.

## Observed installed client mapping — redacted read-only check

A separate **target-only** inspection of the three known local client configuration files ran on the existing Windows owner profile on **2026-11-20 at 19:41 UTC**. It did **not** run the side-effecting `verify-clients.mjs` executable, start any configured client, load a client SDK, call a tool, or write/print raw configuration or credential values. The stand-alone Python 3.11+ standard-library checker is [`read-only-local-client-audit.py`](read-only-local-client-audit.py); the [offline tests](read-only-local-client-audit.test.py) pass **21/21** synthetic cases. The sanitized observed receipt is [`sanitized-local-client-mappings-20261120.json`](sanitized-local-client-mappings-20261120.json).

| Client configured in reviewed verifier | Managed entry observed | Gateway under old H: root | Manager config under old H: root |
| --- | --- | --- | --- |
| Codex | Yes | Yes | Yes |
| Claude Code | Yes | Yes | Yes |
| Claude Desktop | Yes | Yes | Yes |

All three selected entries also match the **known Node executable path and expected five-argument client shape** in the previously reviewed source. This is deliberately a **subset** of the full verifier contract: environment variables/secret values are not returned or validated for a future deployment, and no actual session/authentication/source/ACL identity was tested.

**Cutover decision:** all **three existing local stdio client entries** need a separately approved, individually backed-up **path/source remap** to the protected production gateway/config if the H: root is retired. Updating only the sign-in shortcut or `manage.ps1` leaves those clients invoking the legacy H: gateway. Preserve unrelated client settings, handle client-specific config syntax and reload/restart requirements, and verify rollback with read-only post-change checks plus separately approved authenticated client tests. A compatibility bridge or path alias retaining H: would retain a separate mutable-ancestor threat and is **not** automatically accepted as a fix.

**Rerun (read-only, on an approved owner profile):**

```powershell
python3 -B .\read-only-local-client-audit.test.py
python3 -B .\read-only-local-client-audit.py
```

The offline test creates and cleans only GUID-like disposable Python temporary fixtures. The live audit reads the three named client configs without modifying them. Executing from a different profile could enumerate a different set of files; the script does **not** attest the Windows user token, configuration inode, or permissions on ancestor paths. Do not treat a successful mapping match as approval to mutate any client.

## Observed production manager configuration — seven exact path fields

The installed production `state\manager.json` was inspected once in memory under the owner context on **November 20, 2026 at 19:46 UTC**, using a bounded (maximum 16 KiB), strictly decoded read. No raw JSON values or full configured paths were exported, and the sensitive token file referenced by `tokenPath` was **not opened**. The sanitized observed receipt is [`sanitized-production-config-paths-20261120.json`](sanitized-production-config-paths-20261120.json).

All seven required path fields declared by PR45's `lib/config.mjs` were present; the observed configuration had schema version 1, no unexpected top-level keys and **no DEV `instance` field**. The targets all existed, had the expected file/directory types and reported no reparse flag at the target itself.

| Installed field | Observed path category (value redacted) | Required future cutover treatment |
| --- | --- | --- |
| `nodePath` | Existing shared Node executable on C: | Preserve only after actual-host Node 27 alpha compatibility/identity qualification; do not implicitly change shared Node. |
| `serverPath` | Legacy production H: `node_modules` file | Pin installed upstream package/entry bytes and exact new protected package root. |
| `serverPackageJsonPath` | Legacy production H: `node_modules` file | Pin the associated package metadata, version and its source/entry pairing. |
| `stateDirectory` | Legacy production H: state directory | Qualify the explicit protected production state parent, ownership, DACL and backup/restore. |
| `policyPath` | Legacy production H: state file | Relocate only with approved policy-state preservation/rollback and write-policy checks. |
| `tokenPath` | Legacy production H: state file | Handle as sensitive: protected backup and permissions, **no token export to GitHub**, exact per-environment credential boundary. |
| `inventoryPath` | Legacy production H: state file | Bind inventory output to protected state and retire/rebind any writer utility using the old H: path. |

**Decision impact:** in addition to the Startup launcher and **three** observed configured Codex/Claude-client stdio entries, the production manager has **six currently existing H:-bound internal config dependencies** (two package + four state). A future cutover cannot consist only of a source directory move and a new shortcut. These seven configuration keys must be revalidated *as one canonical, disjoint, protected deployment* under the exact approved source, with the public production port/origin kept unchanged. New code roots, token location, package metadata and state permissions are **proposals**, not allocated destinations.

The read-only inspection establishes point-in-time path categories and target metadata only. It does **not** establish ancestor symlink/hardlink safety, open-file or loaded process identity, actual DEV-token permissions, secret continuity, credential rotation suitability or whether the candidate PR45 source is runtime-compatible with the existing installed package. The current configuration file itself was not modified.

## Installed upstream package identity and code-root ACL (new read-only evidence)

The existing manager config's `serverPath` and `serverPackageJsonPath` select a **currently installed** `@wonderwhy-er/desktop-commander` **0.3.1** module. A bounded, read-only owner-host check on November 20 at **19:51–19:52 UTC** found that the declared package main/bin matches its configured entry at relative `dist\index.js`, with both files under the same H: `node_modules` package root. The exact selected entry and metadata SHA-256 digests, lengths and ACL findings are recorded in [`sanitized-upstream-package-20261120.json`](sanitized-upstream-package-20261120.json). No package content was executed or written during the check.

| Current installed artifact | Read-only observation | Cutover requirement |
| --- | --- | --- |
| `serverPackageJsonPath` | Package `@wonderwhy-er/desktop-commander` version **0.3.1**; metadata file hash **`478981a544106e2529c53d43134b6033689bddc3d4cadee0ebb94be914089657`** | Verify exact selected package metadata/source and separately qualify a pinned version in the protected code root. |
| `serverPath` | Metadata-declared entry `dist\index.js`; on-disk hash **`7e58b9d5d64732ff8cd77cd477de30751feb6b59bc2353dfaa78825f015b2f2b`** | Bind the qualified entry, its dependencies and immutable source to actual process identity; no old H: fallback. |
| Package root and both selected files | **Inherited active Authenticated Users Modify `0x001301BF`**; no target reparse flag; DACLs not inheritance-protected. Separate BUILTIN Users `0x001200A9` is read/execute, **not write**. | A protected production deployment must eliminate standard-DEV effective modification/replacement/alias rights on every executable root and ancestor, not only on manager code and state. |

**Compatibility distinction:** the installed upstream is the **0.3.1 control** version, while PR #45's hosted qualification additionally targets **0.3.3**. An exact installed 0.3.1 package identity is not a successful 0.3.3 upgrade or the mandatory Windows/Linux upstream qualification. The selected host Node executable has **27 alpha** file metadata while hosted CI uses Node 24; both separately matter before any actual cutover. A digest of one entry and one package file does **not** establish transitive dependency integrity, native process loaded-source attestation or an OS effective-rights result.

## Executable dependency closure — expanded read-only scope

The installed upstream package's on-disk `package.json` declares **34 direct dependencies**. On November 20 at **19:57 UTC**, the owner-host inspection located **34/34** package roots: **33** in the manager-level `H:\MTechLabs\MCP\node_modules`, and **one** (`@desktop-commander/telemetry-contract`) in the upstream package's own nested `node_modules`. All 34 inspected dependency roots have an active Authenticated Users Modify ACE, are not DACL inheritance-protected, and have no reported target-level reparse flag. All 34 have installed package metadata with a version value. The declared optional package `caffeinate` was **not** independently qualified for presence.

A separate *static-text-only* check of the selected installed 0.3.1 `dist/index.js` found **13 direct top-level relative import statements**. All 13 target files existed under the package and reported active Authenticated Users Modify; no direct import target had a reported reparse flag. This is **not** a complete JavaScript parser, dynamic import analysis, transitive dependency graph, runtime module-resolution trace or loaded-source attestation.

The precise sanitized results and 34 declared package names are captured in [`sanitized-upstream-direct-dependencies-20261120.json`](sanitized-upstream-direct-dependencies-20261120.json). This evidence expands the protected-root migration's no-go condition: **do not move only `dist/index.js` while leaving dependencies loadable from the unprotected H: shared modules tree**. Stage a reviewed, immutable, fully qualified executable dependency closure in a protected owner-approved code root and verify exact file/ancestor identities with actual authorized standard DEV-token negative-write tests. Do not reset shared H: `node_modules` permissions; other workloads may depend on them. Any unresolved dynamic/native/browser/helper path remains a blocking unknown, not evidence of absence.

## Declared transitive package closure and native-helper footprint (R30)

A bounded read-only Windows filesystem traversal of the **installed 0.3.1 package** followed `package.json` required/optional dependency declarations, without importing the package. It inspected **612 package manifests** across **1,190 required dependency references**, with **zero unresolved required references**, **40 optional references** (36 absent, many representing other-platform builds), **51 peer references not recursed**, and maximum depth **11**. Scan caps were not reached. The deterministic manifest metadata fingerprint was `25c61402f52d5444ca69ad0471a289a994c894140c1cc780d6a4e7bf925cc7f7`, and the scanner independently rechecked that fingerprint.

An accompanying ACL review inspected **every one of the 612 resolved package roots**: **612/612** had **active, inherited Authenticated Users Modify**, while **0/612** had a protected DACL or observed target reparse flag. This is a permission-entry observation, not a real DEV-account effective-access test.

The native/helper scan traversed **2,587 directories** and examined **24,230 files** within these package roots, skipping nested `node_modules` directories accounted for through separately resolved package roots. It identified **four** candidate binaries, all with inherited Authenticated Users Modify:

| Public installed artifact | Format | SHA-256 of observed file |
| --- | --- | --- |
| `@vscode/ripgrep-win32-x64/bin/rg.exe` | EXE | `f9dde63498b3193f098355dbec97af99dc4f6b8fa0df5ed04114a03012c042cb` |
| `@img/sharp-win32-x64/lib/libvips-42.dll` | DLL | `06dab07cc386748513337a31672b1d5269fbc770a14ff403080575665bf0813f` |
| `@img/sharp-win32-x64/lib/libvips-cpp-8.18.7.dll` | DLL | `25001dbd05305a0a29119ab49933622c70b4a20ea12ef1d5d20ca40181db53bf` |
| `@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node` | Node native addon | `971048779f9c8598df14641dfc03c625885c93f473a788e65ca2deb50d0b083e` |

The sanitized [R30 receipt](sanitized-upstream-closure-20261120.json), [bounded package scanner](read-only-upstream-closure.py), [native file metadata scanner](read-only-upstream-native.py) and [17/17 passing synthetic tests](read-only-upstream-closure.test.py) are preserved on the isolated branch. The tests cover missing required/optional dependencies, invalid/oversized manifests, traversal limits, fingerprint sensitivity and native candidate detection, using only disposable fixture files.

**New cutover condition:** stage and independently qualify **all required runtime modules and native executables**, not just the upstream entry or its 34 directly declared dependencies. The installed H: tree cannot satisfy the proposed standard DEV write-isolation boundary with its observed DACLs. **Do not broadly harden H: in place**: sibling workloads share the parent. A future protected production code root must be source-pinned and tested for actual runtime resolution, native helpers, OS effective rights under a **real** restricted DEV token, and backup/rollback.

**Strict limit:** the declared `package.json` closure is not the complete JavaScript execution graph. Dynamic imports, browser/helper downloads, OS package loading, plugins, peer dependencies and optional platform-specific paths may differ. File hashes are snapshots, not upstream provenance or loaded-process attestation; no installed module was executed.

## Npm project/installed-tree lock consistency (R32)

Read-only comparison of the existing project npm lockfile and `node_modules/.package-lock.json` found **identical package entry metadata for 612/612 packages in the declared closure** and **612/612 installed manifest version matches**. The npm v3 project lock has **651** entries total, while the installed-tree lock has **612**; the audit's matched set is exactly the declared installed 612-package closure, not all possible unused/dynamic runtime paths. Both lockfiles contain **611 entries with archive-integrity metadata** and **one `inBundle: true` package without a separate archive integrity field**. Package identity/name checking (R31) remains a prerequisite.

The [source-only two-lock checker](read-only-upstream-lock.py), [18 disposable negative regression tests](read-only-upstream-lock.test.py), and [sanitized point-in-time receipt](sanitized-upstream-lock-20261120.json) are retained on the isolated design branch. A future protected-root build must stage and independently verify its reviewed lockfiles *and* actual installed package closure, rejecting H: write-capable fallback; matching lock metadata alone does not prove content hash, registry provenance, immutable loaded source, version-range satisfaction, native/browser resolution or real DEV-token access denial. No production package was installed, imported, executed or edited.

## Complete lockfile namespace and integrity-metadata structure (R33)

The [read-only R33 structural scanner](read-only-upstream-lock-structure.py), [30-case disposable suite](read-only-upstream-lock-structure.test.py), and [redacted point-in-time receipt](sanitized-upstream-lock-structure-20261120.json) extend the R32 installed-closure check to **every npm v3 package-lock entry**, including project-only optional-platform packages. The project lock carries **651** entries including the root, the installed-tree lock **612**; **38 project-only entries** are all `optional: true`. The installed root manifest name, version and declared dependency sections match its project lock record. Across both lockfiles, **1,260 SRI records** have canonical SHA-512 digest encoding/length and HTTPS resolution metadata, and the same one bundled package has no standalone archive integrity in either lock. **Zero** namespace, duplicate JSON-key, digest-format or metadata-URL problems were found at the read-only observation.

**No stronger trust conclusion follows:** the project lock, installed lock and package source remain simultaneously writable in the original H: ACL hierarchy, so matching them is not independent registry provenance, a verified archive hash or a runtime module attestation. No packages were installed/executed or downloaded; future protected-root acceptance still requires pinned trusted release assets, tested module/browser/native execution closure, actual standard DEV-token effective rights and rollback, after the independent PR45 hosted acceptance gate.

## Installed source-byte closure and drift detection (R34)

The [read-only byte-level scanner](read-only-upstream-bytehash.py), [20-case disposable test suite](read-only-upstream-bytehash.test.py), and [sanitized repeated observation](sanitized-upstream-bytehash-20261120.json) record an exact, bounded snapshot of installed package bytes: **612 package roots**, **2,587 directories**, **24,230 files** and **174,981,718 bytes**. Two scans produced the same SHA-256 digest of a sorted sequence of relative path, file size and SHA-256 content-hash records. The scan did not traverse owner tokens/state/config, import installed modules, or invoke npm/network. Its file size, total byte, file count, directory count, regular-file/reparse and before/after metadata checks fail closed. Platform-specific Windows path-based and opened-file timestamps differ: only their comparable identity fields are cross-checked, with method-specific timestamps checked separately.

**Use only as a historical point-in-time change-detection reference.** Source and locks remain under writable H: parents, so agreement across repeat scans is not proof of original safe bytes or authenticated registry provenance. Dynamic imports, native/browser/PDF helper runtime loading, mutable profile/cache fallback, cross-account effective rights and loaded Node process identity remain separate operational no-go gates. A reviewed protected production release must verify its **independently trusted** complete archive and runtime closure, not simply copy and trust this pre-cutover H: file snapshot.

## Installed namespace completeness and npm command launchers (R35)

The [R35 read-only namespace auditor](read-only-upstream-namespace.py), its [24-case disposable synthetic suite](read-only-upstream-namespace.test.py), and the [sanitized installed receipt](sanitized-upstream-namespace-20261120.json) extend R34 beyond package-only SHA-256 inventory. The installed npm tree has **612 declared and 612 physical package roots** (including scoped/nested packages), **38 node_modules directories**, **2,643 visited directories** and **24,297 files**. R34 covered **24,230 files** under qualified package roots; R35 separately hashes the **66 non-package command launcher shims** in the root `.bin` directory (42,110 bytes) and binds the one installed-tree lockfile through its prior checked SHA-256. No unexpected extra package directory, unclassified file, reparse link or traversal-limit failure was observed. A combined namespace SHA-256 fingerprints the R34 bytes, `.bin` launcher contents and the installed-lock SHA.

**Security interpretation:** npm command shims are potential executable entry points, so omitting them from a future protected-code copy could leave a writable H: command path in use. This receipt measures the current folder, not an independently signed, complete runtime load graph. It does not prove no application dynamically loads from an external directory, owner profile, browser cache, other npm global root or binary helper; it cannot establish race-free Windows file identity, source provenance or real DEV-token effective rights. Carry the complete reviewed executable/launcher closure into the future protected-root and rollback decision, after hosted PR45 source acceptance, rather than promote existing H: bytes as trusted.

## Installed npm bin targets and launcher-template families (R36)

The [R36 read-only declaration/target audit](read-only-upstream-bin-contract.py), [20-case synthetic suite](read-only-upstream-bin-contract.test.py) and [sanitized repeated receipt](sanitized-upstream-bin-contract-20261120.json) extend R35's **66 hashed npm `.bin` launchers** beyond byte counts. Exactly **22 package-declared `bin` command names** were observed across the 612 installed package roots, with no command-name collisions and an installed triple of shell, Windows CMD and PowerShell shims for each. The literal target in every shim matches its declaring package's ordinary non-reparse file. Two npm wrapper shape families are present: **20 Node-based** commands and **two directly invoked script** commands (`setup` and `remove`). Six normalized template SHA-256 fingerprints (one per platform shim and family) and the full bin-contract fingerprint were stable across two read-only scans. Zero unqualified target/template relationships were recorded.

**Important release/no-go distinction:** these shim shapes, package declarations and file targets all come from writable H: and were never matched to a signed/independently trusted upstream package or execution trace. Pinning a current malicious or compromised wrapper would also pin its contents. Before any protected production relocation, independently qualify trusted release source and all shims, target programs, Node/script-host execution and PATH/process-environment resolution, cross-account writable ancestors, static/dynamic helper loading and rollback. Do not imply that a current exact shim-text match establishes actual safe execution, effective DEV-token isolation or authorized DEV installation.

## 3. Deployment-version and executable compatibility gate

The previously verified installed `admin.mjs` and `manage.ps1` match the owner's working checkout bytes (Windows CRLF), and after line-ending normalization match the recorded prior deployment commit `9373fadc00689dd782143ab5e49664536f460b8b`. **Their PR #45 head versions are different source blobs.** A cutover to accepted PR45/main source would therefore be not merely a move: it would combine a new filesystem trust root with a source-version change. Review, stage, qualify and roll back those changes as independently distinguishable operations.

The local selected `C:\Program Files\nodejs\node.exe` has **27.0.0-alpha.0.0.0** file-version metadata while the PR45 hosted workflow tests **Node 24**. The manager's package declares `engines.node >=24`, not proof that the local alpha has the same behavior. Host compatibility and exact runnable executable identity need a separate evidence gate. Do not install, replace, upgrade or downgrade Node in this source-only audit.

## 4. Required go/no-go sequence before future cutover

1. **Finish source acceptance.** Resolve GitHub Actions billing admission, pass five genuine hosted candidate jobs including both native Windows account/pipe lanes and both upstream OS qualification lanes, review immutable evidence, merge normally only with the required approval, and pass the separate actual-main CI gate.
2. **Inventory real live dependencies.** Read exact owner sign-in shortcut and deployed wrapper/source/config identity, all intended client entry/command locations, existing runtime/state and trusted registration, upstream mutable roots, protected backup authority, public route and ongoing listener. Do not print private configuration contents. Search all **selected release** executable source and deployed install manifests for disallowed old H: targets; historical docs/tests may intentionally retain old-path evidence.
3. **Explicitly decide per file.** Approve new path values for startup installer and manager launcher; preserve port 19740 and production Host/origin contract; migrate or disable writer diagnostics; separately approve client config changes/backup restore. Document every changed file and source SHA, rather than broad string replacement.
4. **Qualify protected source/data roots.** Stage under explicitly protected parent/child ACLs and prove actual DEV-token cross-account **negative** access with approved disposable canaries. Protect `C:\ProgramData` descendants against inherited BUILTIN Users Write and establish creator/owner control for `C:\Program Files` descendants. Keep H: sibling workloads unchanged.
5. **Rehearse restoration.** Produce real protected backups of source/config/ACL/shortcut (not merely the historical nine-object private baseline), rehearse disposable restore and source integrity checks, document quiescence and uncertain work, preserve the existing production route until maintenance approval.
6. **Controlled cutover only after separate approval.** Quiesce owned work, verify exact new source/launch process and one loopback 19740 listener, authenticate existing production route/client behavior, and stop if old H: dependencies persist. Do not run side-effecting verification utilities on live PROD as ad hoc smoke checks.
7. **Later, independently provision DEV.** Only after production isolation and explicit approval: create real standard DEV token/profile, protected DEV code/state, unique credentials/Cloudflare/Access/connector grants, positive/negative routed qualification and separate activation authorization.

**No-go if any unresolved hardcoded *executable* H: path, broad parent mutation right, unqualified selected Node/runtime source, unapproved client configuration write, untested restoration, or missing independent hosted/source/operational evidence remains.**

## 5. Scope and limits

This is a **bounded static tracked-source review** with selected exact-head GitHub file reads and earlier owner-host read-only observations. It is not a full call-graph proof, an inventory of private installed client config, a successful runtime cutover, or a validation of OS effective access using a real DEV token. No installer, side-effecting verifier, manager process, credentials, tunnel, user, ACL, production listener, GitHub Actions workflow, or DEV activation was modified by this audit.
