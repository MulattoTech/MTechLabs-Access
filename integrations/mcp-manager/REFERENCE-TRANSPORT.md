# Protected Windows production-reference transport

The restricted `Inspect`/`Status` path now connects the existing signed-reference protocol to a fixed Windows local endpoint. It loads protected public pins, verifies the calling DEV token, authenticates the pipe endpoint, and invokes `inspectDevRuntimeWithReference`. It never falls back to opening production files from DEV.

The authority loads its own protected registration and Ed25519 key and observes only the registered targets. Its pipe accepts only the registered DEV identity. This source provides no installer, account creation, ACL mutation, operational key generation, startup registration, manager start, upstream activation, job execution, or provider configuration. Existing qualification and activation flags remain false.

## Installation and authority

The bootstrap location is fixed relative to the protected manager installation:

```text
reference-bootstrap/trust.json
reference-bootstrap/authority/registration.json
reference-bootstrap/authority/signing-key.pk8
```

The files are not shipped with operational values. An approved installation must provide actual identities, paths, registration, source digests, and keys. There is no environment, command-line, request, or response override for this directory, its key files, or the pipe endpoint.

| Object | Required protection |
| --- | --- |
| Public trust, complete pinned source graph, Node binary | Owned and controlled by SYSTEM or Administrators; DEV and the authority may have read access. TrustedInstaller is accepted for the supported Windows/Program Files system paths and drive roots. |
| Authority directory, registration, private key | The same control protection, with data read access limited to SYSTEM, Administrators, and the pinned authority SID. DEV receives no data read access. |
| Relevant ancestors | No untrusted owner, replacement, delete-child, delete, write-DACL, write-owner, or applicable attribute modification right. Benign create-sibling rights alone do not authorize replacing an already protected child. |

The guard conservatively rejects an unsafe allow ACE even if another deny ACE might neutralize it. It does not use a self-declared authority SID to approve the public trust anchor. Every applicable trustee is considered, including inherited and group allow entries; unsupported ACL forms and null DACLs fail closed. Target directory checks include `FILE_DELETE_CHILD` as well as content and control rights.

Only fixed local drives are supported. Reparse paths, mapped network drives, remote/device namespaces, and multiply linked files are refused. Native checks use opened handles, canonical names, file identity, bounded reads, and before/after metadata. Selected source/trust/key files remain open without write/delete sharing for the native helper's lifetime; ancestor directory handles prevent namespace deletion while held. These are checks within the stated Windows principal boundary, not a defense against an administrator deliberately replacing the trust system.

The existing production runtime/ancestor weaknesses documented in the [readiness plan](../../docs/engineering/2026-11-20-dev-readiness/README.md) still require operational resolution before installation. Protecting this bootstrap does not independently establish protection of every production application, the authority's whole profile, or its other execution surfaces.

## Trust manifest

`validateReferenceTrust` returns a new, deeply frozen declaration with these exact ordered keys:

```text
schemaVersion, instanceId, generation, authoritySid, developmentSid,
registrationSha256, publicKeySpki, developmentConfigPath, planPath,
nodePath, nodeSha256, sourceSha256
```

Version is `1`; generation is a positive safe integer. The instance uses the existing bounded `dev` label syntax. Authority and DEV are distinct canonical local user SIDs, with each numeric component within the Windows DWORD range. Hashes are exactly 64 lowercase hexadecimal characters. `publicKeySpki` is canonical unpadded base64url containing a public-only Ed25519 DER SPKI; private keys, alternate algorithms, trailing DER data, and alternate encodings are rejected.

Paths are bounded ordinary local absolute Windows declarations. The portable validator preserves their spelling; it does not resolve filesystem aliases or claim ACL protection. Native loading subsequently verifies the actual local objects. Required fields must be enumerable own data properties; missing, unknown, accessor, symbol, non-enumerable, array, and custom-prototype schemas are rejected without invoking descriptor getters.

The public file is at most 32,768 UTF-8 bytes and must equal `JSON.stringify(validateReferenceTrust(input))` exactly. `sourceSha256` contains exactly the ordered `REFERENCE_SOURCE_FILES` set exported by `lib/reference-bootstrap.mjs`: all 17 local executable/import/helper files, including the manager package manifest, both entrypoints, both wrappers, the C# source, and the complete transitive reference/runtime/config/token module graph. It cannot select extra files. Node's executable has its own pinned hash.

The private `registration.json` is the full registration object already defined by [PRODUCTION-REFERENCE.md](PRODUCTION-REFERENCE.md), bounded to 65,536 UTF-8 bytes. `signing-key.pk8` contains binary DER PKCS#8 Ed25519 key material, bounded to 4,096 bytes. Loading verifies the private/public key pair, computed registration digest, generation, instance, pinned principal SIDs, selected DEV config/plan, and DEV Node declaration. These files are read only by the authority context.

Declarations and syntactically valid fabricated IDs cannot establish deployment truth. The portable validator creates no trusted handle. Only successful native loading creates the opaque role-specific capability; cloning or constructing a lookalike object cannot create an authority, pipe server, or exchange.

## Loading order and supported entrypoints

The JavaScript loader sends constant bootstrap code directly to the fixed system PowerShell. Before executing an on-disk helper, that code checks helper/C# ownership, ACLs, ancestors, and hashes against protected public trust. The PowerShell wrapper performs the equivalent independent pre-helper check. The helper then checks its C# bytes before compilation, and the native guard repeats the complete source, Node, trust, and private-material checks against held handles.

PowerShell is fixed to `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, without profiles or interactive commands. Module lookup is fixed to the Windows system module directory, including for the existing runtime probe. Neither PATH, SystemRoot nor ComSpec selects these executables. `NODE_OPTIONS` and `NODE_PATH` are refused before Node execution by supported wrappers.

The native DEV bootstrap additionally refuses an elevated token, Administrators group membership including a filtered admin group, and the presence of dangerous privileges such as backup, restore, take-ownership, debug, impersonation, TCB, token creation/assignment, driver loading, volume management, or security privilege. A different SID alone is insufficient. These token checks are repeated on the pipe's actual requester token before dispatch. Authority token elevation is not inferred or reported as false when unmeasured.

An approved installation can run the owner-context authority with:

```powershell
& 'C:\ProgramData\MTechLabs\ReferenceManager\windows-reference.ps1' -Mode Authority
```

The ordinary DEV identity uses the same protected installation:

```powershell
& 'C:\ProgramData\MTechLabs\ReferenceManager\manage-dev.ps1' -Action Inspect
& 'C:\ProgramData\MTechLabs\ReferenceManager\manage-dev.ps1' -Action Status
```

These are proposed installation examples, not claims that those paths or accounts exist. Optional `-NodePath`, `-ConfigPath`, and `-PlanPath` values are comparison-only: they must match the protected selections. They cannot choose a different bootstrap, key, endpoint, production target, or inspected config. Node is verified before the wrapper starts it. `Start`, `Install`, and `Open` still fail with `dev_activation_not_qualified`.

The internal `Bootstrap` helper mode exchanges native-checked bootstrap material with its same-identity Node loader. Authority-only internal IPC contains private key/registration bytes so Node can construct opaque key and registration objects. Public inspector/server entrypoints never print those bytes, and they never cross the DEV named pipe.

Direct JavaScript integration remains trusted code running within its current principal. It cannot retroactively prove the bytes already loaded into that process or secure an operator who deliberately launches altered code. The guarded entrypoints and protected installation are the supported operational boundary. Windows/.NET components and same-identity execution remain trusted; native compilation can use the current account's temporary/compiler storage. Existing source-loaded and broader runtime-isolation qualification flags stay false.

## Local endpoint and authorization

The sole endpoint name is:

```text
\\.\pipe\mterm-dev-reference-v1-<registrationSha256>
```

The authority precreates eight instances, with first-instance namespace ownership on the initial handle and `PIPE_REJECT_REMOTE_CLIENTS` on every instance. It retains the namespace while accepting work; shutdown releases it before observer drain completes. Handles are noninheritable. An occupied name is an error; the server never joins a foreign namespace or chooses a fallback name.

The pipe security descriptor pins the owner SID and has exactly four noninherited allow entries: SYSTEM, Administrators, and the authority SID have full control; DEV receives `0x00120183`, comprising data read/write, attribute read/write, READ_CONTROL, and SYNCHRONIZE. It excludes `FILE_CREATE_PIPE_INSTANCE`, WRITE_DAC, and WRITE_OWNER. Generic write is deliberately avoided because Windows maps it to pipe-instance creation permission.

The client opens only the fixed local name with identification-only SQOS. Before sending a request it reads the connected handle's kernel security descriptor and requires the pinned authority owner and exact DACL. This avoids relying on cross-account permission to open the server process token. The signed response is still independently verified against the pinned Ed25519 key, registration, request bytes, nonce, and time window. Kernel endpoint identity and signed response authenticity are separate checks.

After a bounded complete request frame, the server impersonates that pipe client only to read its actual Windows identity/token. It requires the pinned ordinary DEV identity, checks impersonation success, and synchronously reverts on the same thread before invoking the owner-context observer. Failed impersonation denies the request; failed reversion terminates the helper before any observer can run. Request-supplied SID, PID, profile, or authorization assertions do not exist in the wire schema.

This authorizes a Windows principal. It does not attest an arbitrary client's executable or prevent an authorized principal from deliberately relaying a request or sharing its own capabilities.

## Framing, capacity and cancellation

Each frame is a four-byte unsigned little-endian byte length followed by strict UTF-8. A connection carries exactly one request, at most 2,048 bytes, and one response, at most 8,192 bytes. Bounds apply before payload allocation. There are eight connections/operations, no admission queue, and no retry or alternate transport.

Coalesced extra request bytes are checked before dispatch. A bounded read monitor detects later extra input or disconnect, aborts the callback signal, and prevents a response once that input is observed before the response write. No second operation is dispatched. The implementation does not claim knowledge of arbitrary future bytes before they arrive. After writing its response, the server waits for client close or the existing deadline so disconnect cannot discard an unread response frame.

Connection, frame, idle, and write waits are bounded by the 30-second request window. A disconnected or timed-out callback that ignores cancellation retains its admission slot until it actually settles. Eight precreated instances also bound half-framed unauthenticated connections. The existing core retains one authority closure for the broker lifetime, its 64 nonce entries, eight observation limit, freshness/replay checks, and its own hidden-work accounting.

`serveReferenceTransport` returns `ready`, `closed`, and an idempotent `close()` returning the same drain promise. This generic transport drains the callback promises it invoked. The registered core may reject a public call on cancellation while its native observer is still settling. Therefore the operational server first closes admission and awaits `transport.closed`, then calls `waitForProductionReferenceAuthorityIdle(authority)` to await the actual core observers. Repeated core idle waits during active work share one pending promise. The idle API observes current work; an idle promise captured at startup is not a future shutdown barrier.

The operational broker announces only `reference_ready` with fixed false flags. EOF on its owned input or a handled shutdown signal first stops admission and closes the owned native helper, releasing the pipe namespace. Transport closure then waits for actual callback settlement, and operational closure additionally waits for actual core observations. Namespace ownership does not extend through that observer drain. No automatic restart is provided; a DEV-created replacement still fails the pinned kernel owner/DACL and signed-response checks. Forced process termination is not a graceful drain guarantee. The broker does not install a restart service or durable replay store; restart remains a separately qualified lifecycle event.

## Errors, evidence and remaining work

Errors are fixed categories: malformed trust, untrusted bootstrap, invalid transport input, unavailable transport/peer, busy capacity, expiry, or cancellation. No raw Win32/PowerShell exception, private path, key, credential fingerprint, registration, or callback error is returned in public diagnostics. Internal authority registration and control snapshots never become DEV-readable files.

Disposable qualification must use actual separate identities and actual protected files/pipes, including an allowed ordinary DEV user and a different denied user. An injected callback can qualify transport framing/cancellation mechanisms only; it cannot replace the separate positive test using the real registered observer and both public wrapper actions. Hosted results do not prove owner-host deployment, actual production ACLs, live routes/grants, upstream roots, running source, or activation readiness.

## Primary references

- [Named pipe security and access rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
- [CreateNamedPipe flags and remote-client modes](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createnamedpipew)
- [ImpersonateNamedPipeClient and reversion requirements](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient)
- [Client identification and impersonation levels](https://learn.microsoft.com/en-us/windows/win32/ipc/impersonating-a-named-pipe-client)
- [Security descriptor functions for opened kernel objects](https://learn.microsoft.com/en-us/windows/win32/secauthz/low-level-security-descriptor-functions)
