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
