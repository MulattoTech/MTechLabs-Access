# DEV runtime inspection contract

`manage-dev.ps1` inspects a proposed DEV runtime on Windows. It does not start,
stop, install, restart or open a manager. Its only supported actions are
`Inspect` and `Status`; `Start`, `Install` and `Open` return
`dev_activation_not_qualified` before invoking Node. The existing production
launcher and startup installer remain production-specific.

Every successful report has `qualified: false` and `upstreamEnabled: false`.
The existing DEV remote/gateway blocks remain enforced. A successful diagnostic
exit code means the report was produced, not that activation is authorized.

## Inputs and invocation

Use the PowerShell wrapper with explicit absolute paths:

```powershell
& 'C:\MTermDev\manager\manage-dev.ps1' -Action Inspect `
  -NodePath 'C:\Program Files\nodejs\node.exe' `
  -ConfigPath 'C:\MTermDev\state\manager.json' `
  -PlanPath 'C:\MTermDev\state\dev-runtime-plan.json'
```

These are examples, not installed paths. The wrapper rejects `NODE_OPTIONS`
and `NODE_PATH` before executing the selected Node binary. Direct invocation of
`inspect-dev-runtime.mjs` checks them too, but Node may already have executed a
preload before JavaScript runs. The wrapper is the supported entry point for
that boundary. Select an independently trusted Node executable and source tree;
this inspector cannot make a malicious executable or local operator trustworthy.

The helper uses the fixed supported Windows PowerShell 5.1 executable at
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, with no profile
and no interactive commands. It does not select an executable through PATH,
SystemRoot or ComSpec. Another Windows installation layout is unsupported and
returns unavailable. Input and output use bounded UTF-8 pipes, including paths
with non-ASCII characters. The helper receives only expected paths, port numbers
and the actual calling Node process ID/image; it does not evaluate command text.

The DEV configuration must first satisfy [the manager foundation](DEV.md).
The plan must be the ordinary, singly linked `dev-runtime-plan.json` directly
inside that DEV state directory. That filename is reserved against reuse as a
manager config, policy, token or inventory file. JSON inputs are limited to
16 KiB. The inspector verifies opened file identity, size and modification
metadata around bounded reads. This is a point-in-time topology check, not an
OS sandbox against concurrent local file or mount replacement.

Both token files must contain only `sha256:<64 hex digits>` (surrounding
whitespace is accepted). The inspector refuses legacy plaintext token files.
Do not grant a DEV account access to a production plaintext bearer to make an
inspection pass. Converting a production token file or providing an authoritative
scoped reference requires separate operational preparation. Nothing here changes
credentials or file permissions. Failure to read required evidence stays an error
or unverified observation; it does not trigger elevation or privilege changes.

## Strict external plan

All keys below are required; extra keys, including operator-supplied readiness
or verification assertions, are rejected. These fictional values illustrate the
shape and do not establish real accounts, provider resources or grants:

```json
{
  "schemaVersion": 1,
  "platform": "win32",
  "instanceId": "dev-local",
  "authorizationMode": "owner-only",
  "production": {
    "principalSid": "S-1-5-21-111-222-333-1001",
    "profileDirectory": "C:\\Users\\ProductionOwner",
    "manager": {
      "nodePath": "C:\\Program Files\\nodejs\\node.exe",
      "entryPath": "H:\\MTechLabs\\MCP\\manager\\admin.mjs",
      "configPath": "H:\\MTechLabs\\MCP\\state\\manager.json",
      "port": 19740
    },
    "routing": {
      "resource": "https://mcp.example.test/mcp",
      "origin": "https://mcp-origin.example.test/mcp",
      "backendId": "manager-production",
      "accessAppId": "11111111-1111-4111-8111-111111111111",
      "audience": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "connectorAppId": "asdk_app_11111111111111111111111111111111",
      "originHostHeader": "mcp-origin.example.test"
    }
  },
  "development": {
    "principalSid": "S-1-5-21-111-222-333-1002",
    "profileDirectory": "C:\\Users\\MTermDev",
    "manager": {
      "nodePath": "C:\\Program Files\\nodejs\\node.exe",
      "entryPath": "C:\\MTermDev\\manager\\admin.mjs",
      "configPath": "C:\\MTermDev\\state\\manager.json",
      "port": 19741
    },
    "routing": {
      "resource": "https://mcp-dev.example.test/mcp",
      "origin": "https://mcp-dev-origin.example.test/mcp",
      "backendId": "manager-development",
      "accessAppId": "22222222-2222-4222-8222-222222222222",
      "audience": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "connectorAppId": "asdk_app_22222222222222222222222222222222",
      "originHostHeader": "127.0.0.1:19741"
    }
  }
}
```

The instance ID and DEV port must match the selected configuration. Production
remains port19740. SIDs must be different canonical local/domain account SIDs;
profile roots must exist, be disjoint and have no linked ancestors. Canonical
filesystem checks resolve case and ordinary short-name aliases. Config/entry
paths must be distinct, and production/DEV entries cannot identify the same
file through a hardlink. Manager Node paths identify actual manager processes;
they are separate from the existing configuration's upstream `nodePath`.

Each resource/origin is a canonical HTTPS DNS URL ending exactly in `/mcp`,
without credentials, an explicit port, query or fragment. All four URL origins
must differ. Backend IDs, Access application UUIDs, Access audiences and connector
App IDs must differ between production and DEV. DEV `originHostHeader` is exactly
`127.0.0.1:<manager-port>` because its Host allowlist is strict. Production may
declare either `127.0.0.1:19740` or the exact hostname of its declared origin URL,
without a port, path, trailing dot or case variation. This represents a working
production origin Host rewrite without requiring a production routing change.
It does not change either manager's Host allowlist or verify the live route.
Changing a display name or a registry key does not satisfy these requirements.
The contract does not require separate Cloudflare accounts, teams or tunnel
processes; those choices must still preserve independently verified routing.

`authorizationMode` is presently `owner-only`. It describes the existing bridge
authorization boundary and makes no claim that website D1 application grants
authorize this route. OAuth issuers/scopes may be shared where appropriate;
actual App registrations, tokens, audiences and grant routing still need separate
positive and negative tests.

## Observations and report meaning

The native helper binds its requested current PID to its actual Node parent,
checks parent/helper creation order, and retains a limited-query process handle.
It obtains the process primary-token SID and token-associated profile through
Windows APIs, with no debug privilege or impersonation changes. Node independently
checks `os.userInfo().homedir`. Changing environment username/home variables does
not change these observations.

For each configured listener, the helper requires a successful TCP table query,
a recognized `Listen` state, one exclusive IPv4 `127.0.0.1` listener and an exact
owning PID. Unknown state, permission failure, wildcard/IPv6/multiple listeners
or inconsistent metadata remain unverified. The command line must parse natively
to exactly four arguments: expected Node, expected entry, literal `--config`,
expected config. Both CIM and the retained native handle must identify that
executable. Creation times are compared at CIM microsecond precision using exact
decimal arithmetic. The helper repeats process/listener checks while retaining
the handle, verifies liveness and disposes handles on every path.

These are bounded observations; a process can stop after a report. Exact paths
and invocation do not prove which source bytes an existing process loaded.
Access to another account's process token may be denied. That result stays
unverified; do not make DEV an administrator or enable debug privileges merely
to turn the diagnostic green.

The public report omits raw SID, profile/config/executable paths, command lines,
credentials and route identifiers. It contains only bounded status categories,
the DEV ID, refusal reasons and SHA-256 fingerprints of the selected config,
production config and plan bytes, explicitly labeled `current-file-snapshots`.
It does not expose a new HTTP endpoint or call a remote service.

| Field | Meaning |
| --- | --- |
| `currentIdentity` | Current Node primary-token identity matches the expected DEV account/profile, differs, is absent, or is unverified. |
| `productionListener`, `developmentListener` | Locally observed listener identity/invocation matches, differs, is absent, or is unverified. |
| `profileEnvironment` | HOME/USERPROFILE agree with the observed OS profile and APPDATA/LOCALAPPDATA, if set, are descendants; otherwise redirected/unverified. |
| `routing.declaredDistinct` | The strict plan declares distinct routing IDs and URLs; no provider or live route was contacted. |
| `routing.liveVerified`, `routing.oauthGrantsVerified` | Always false in this batch. |
| `runningSourceVerified`, `qualified`, `upstreamEnabled` | Always false in this batch. |

The environment rule is deliberately conservative; a legitimate redirected
Windows known-folder layout is reported as redirected and needs separate
qualification. The inspector makes no manager/config/state writes, acquires no
ownership lock and opens no jobs database. PowerShell native compilation may use
temporary/compiler cache files, so this is not a claim of zero filesystem activity
across the entire operating system.

## Provisioning and activation gates

Before any future DEV upstream activation, separately qualify:

1. A dedicated appropriately restricted Windows account/profile, actual account
   identity, and the authoritative production observation/reference mechanism.
   Verify group membership, privileges, ACLs and negative access tests against
   production mutable state and credentials. Different SIDs alone are insufficient.
2. The actual upstream config, log, browser and cache roots under that identity,
   including every package-supported path override. Confirm no production writes
   during disposable DEV exercises and preserve cleanup evidence.
3. Exact deployed manager/backend identity and immutable source, independent
   resource/origin routes, Access App/AUD, connector App/grants and backend
   credentials. Verify tunnel service targets the DEV loopback port and rewrites
   Host accordingly. Compare provider configuration with observations, not names.
4. Positive DEV routing plus negative cross-token, wrong-audience, wrong-App,
   wrong-origin/backend and grant tests. An authenticated runtime boot/challenge
   protocol may be needed to bind a routed response to the intended process.
5. A qualified operational launcher, restart/quiescence behavior, recovery and
   rollback. This inspector's status output is not an activation ticket.

Source tests use portable adversarial plan cases, disposable state stores, native
Windows identity/listener fixtures and AST-only simulated race/decision cases.
Hosted tests do not create or qualify two real OS users, alter production routes,
activate DEV upstream or establish production deployment. Candidate and actual
main gates are recorded separately in issue36.

## API references

- [Node `os.userInfo()` and `os.homedir()`](https://nodejs.org/api/os.html)
- [Windows token profile directory](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-getuserprofiledirectoryw)
- [Process creation times](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)
- [CIM date/time representation](https://learn.microsoft.com/en-us/windows/win32/wmisdk/date-and-time-format)
- [TCP state queries](https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-nettcpconnection)
- [Cloudflare Tunnel origin parameters](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/origin-configuration/)
