# Access44 implementation contract (before behavior execution)

Base: `15e851b11984592803d37599b639772e51e5c8c0`.

## Fixed installation and trust

The fixed directory `reference-bootstrap/` is adjacent to manager entrypoints. It contains public `trust.json`, private `authority/registration.json`, and private binary DER `authority/signing-key.pk8`. There are no CLI, environment, request, or response overrides for bootstrap root, key, endpoint, or registered production targets.

The native guard checks the installation/source/trust root against SYSTEM and Administrators ownership/control before trusting any declared authority SID. TrustedInstaller is permitted for Windows system ancestors. Ordinary parent create-sibling rights do not imply replacement authority; target/ancestor delete, delete-child, write-DACL, write-owner, reparse substitution and applicable content modification rights do. Public trust and source may be read by DEV; the private authority directory/key/registration may not.

The wrapper's PowerShell guard checks protected source and ancestor ACLs before reading/compiling the fixed C# helper. The native guard repeats handle-based checks, bounds reads, checks file identities/link counts, source hashes and Node hash. The wrapper validates Node before starting it. This does not attest source bytes already loaded into an arbitrary caller's process; supported entrypoints must themselves be launched from the protected installation. No source/activation qualification is fabricated.

## Portable trust contract

`lib/reference-bootstrap.mjs` exports `REFERENCE_SOURCE_FILES`, `validateReferenceTrust(input)`, `loadReferenceBootstrap(role)`, `createBootstrappedReferenceAuthority(authorityHandle)`, and `inspectRegisteredDevRuntime({configPath?,planPath?}={})`.

Exact ordered trust keys:

`schemaVersion, instanceId, generation, authoritySid, developmentSid, registrationSha256, publicKeySpki, developmentConfigPath, planPath, nodePath, nodeSha256, sourceSha256`.

Version is1. Instance has existing dev-label syntax/max48. Generation is a positive safe integer. Authority and development are distinct local `S-1-5-21-...` SIDs. Digests are lowercase64hex. publicKeySpki is canonical base64url DER Ed25519 SPKI, public-only. Paths are ordinary local absolute Windows declarations bounded1024, preserving declared spelling; existing ordinary dot/8.3 spellings can be declarations, but loaders require actual protected canonical identities. sourceSha256 has exactly the source17 keys below with lowercase64hex values. Required fields are enumerable own data properties; missing/unknown/accessor/symbol/nonenumerable/custom-prototype fields reject. Output is deep-copied/frozen. Error is `runtime_reference_bootstrap_invalid`. Raw trust text must equal canonical serialization and be <=32768 UTF8 bytes.

Exact source17:

1. package.json
2. inspect-dev-runtime.mjs
3. reference-server.mjs
4. manage-dev.ps1
5. windows-reference.ps1
6. windows-reference-native.cs
7. windows-runtime-probe.ps1
8. lib/reference-bootstrap.mjs
9. lib/reference-transport.mjs
10. lib/production-reference.mjs
11. lib/dev-runtime-reference.mjs
12. lib/runtime-files.mjs
13. lib/runtime-identity.mjs
14. lib/dev-runtime-plan.mjs
15. lib/dev-instance.mjs
16. lib/config.mjs
17. lib/token.mjs

`loadReferenceBootstrap('authority'|'client')` is Windows-only, returns an opaque handle exposing only instanceId/registrationSha256. It reads the public protected trust/source on both roles and private registration/key only for authority, validates actual current SID against the protected role SID and checks all bindings. Unsupported platform is `dev_runtime_platform_unsupported`; preload environment is `node_preload_environment_rejected`; invalid/untrusted native loading or forged handle is `runtime_reference_bootstrap_untrusted`. The private API constructs the existing immutable registered authority and verifies private/public key and registration/generation bindings. It exposes no raw key or arbitrary-path getter.

`inspectRegisteredDevRuntime` compares optional config/plan declarations to protected selected paths before any selected-file opens and uses `inspectDevRuntimeWithReference` exclusively. Public Inspect/Status never invokes direct production reading or obtains writer authority. Start/Install/Open stay refused.

## Transport

`lib/reference-transport.mjs` exports `serveReferenceTransport(opaqueAuthorityBootstrap, trustedAuthorityCallback)` and `createReferenceExchange(opaqueClientBootstrap)`.

Serve returns frozen `{ready: Promise, closed: Promise, close: () => same drain Promise}`. Exchange returns `(requestString,{signal}) => Promise<responseString>` compatible with existing core. Callback injection is a trusted owner-context integration API, not wire configuration; the operational server always constructs the fixed registered authority.

The fixed local pipe name derives solely from registrationSha256. Eight bounded pipe instances/connections, no queue/retry, FIRST_PIPE_INSTANCE on initial namespace keeper, explicit noninheritable DACL, PIPE_REJECT_REMOTE_CLIENTS. DEV gets individual data+READ_CONTROL rights without FILE_CREATE_PIPE_INSTANCE/WRITE_DAC/WRITE_OWNER. Each operation slot stays occupied until its actual callback settles; one authority closure per broker lifetime retains replay/capacity state.

Frames are length-prefixed strict UTF8: request <=2048 bytes, response <=8192, one request/response per connection, no extra frames. Connect/read/write/idle deadlines stay within the existing30-second request bound. Disconnect/cancel propagates; callbacks ignoring cancellation retain their admission slot. Private errors and payloads are not logged.

Server authenticates the real pipe impersonation token after a bounded read, checks registered DEV SID, and synchronously RevertToSelf before privileged callback. Failure to impersonate/revert denies. Client uses SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION. Server authentication uses the connected pipe's kernel-assigned owner SID and exact safe DACL (READ_CONTROL), plus mandatory pinned Ed25519 envelope verification; no cross-account OpenProcessToken assumption or wire-reported identity.

Transport errors: invalid frame/request `runtime_reference_invalid`; unavailable/peer denial `runtime_reference_unavailable`; admission `runtime_reference_busy`; deadline `runtime_reference_expired`; cancellation `runtime_reference_cancelled`; forged bootstrap `runtime_reference_bootstrap_untrusted`.

## Native helper / operational entry

`windows-reference.ps1 -Mode Bootstrap|Server|Exchange|Authority`; Bootstrap accepts `-Role Authority|Client`. No path/endpoint/key arguments. Root derives from PSScriptRoot. Internal Bootstrap IPC is private to its caller and supplies native-checked public text and authority-only key/registration bytes to the opaque Node loader; public inspector/server entrypoints never print these bytes. Server uses bounded multiplex stdio with the Node authority. Exchange consumes one bounded request and returns one bounded response. Authority is the protected pre-Node owner launcher for fixed `reference-server.mjs`.

No live owner host/provider/account/ACL/key changes. Independent tests and real separate-identity fixtures are owned by baseline. Native account fixture runs only with CI opt-in `MTERM_DISPOSABLE_REFERENCE_QUALIFICATION=1`; this is a test opt-in, never a product trust bypass. Hosted qualification must fail rather than skip on missing privileges.


## Final lifecycle clarification before source freeze

The listener-first shutdown design stops admission and releases the named-pipe namespace when `close()` begins. `transport.closed` still waits for all actual callback promises to settle; the operational server subsequently calls `waitForProductionReferenceAuthorityIdle(authority)` and waits for actual core observers. Namespace ownership does not extend through this observer drain. There is no automatic restart; an untrusted replacement endpoint remains refused by kernel owner/DACL checks and pinned signed-response validation. Forced process termination is not a graceful drain guarantee.

The additive idle API rejects forged functions synchronously with `runtime_reference_required`, coalesces concurrent pending idle waits, and resolves only when the core observer count reaches zero through actual onSettled callbacks. It observes current idle state, so it is called only after transport admission/callback drain during operational shutdown.

Before helper/compiler execution, new PowerShell paths use bounded stream reads, reject nonfixed/mapped-network drives, validate protected ACLs/ancestors and source hashes, and compile from the already verified bounded C# text. Native validation includes ordinary path syntax before file opens, retained handles, target directory DELETE_CHILD protection, raw TokenGroups including deny-only Administrators, TokenElevationTypeDefault, non-elevation, and prohibited privilege checks. Authority token booleans remain null/unverified. The existing native runtime probe now fixes PSModulePath to system modules.
