# DEV manager foundation

This source feature separates the manager's loopback identity, credentials and
mutable state. It does **not** activate an independent Desktop Commander bridge.
DEV `/mcp` returns unavailable before SDK loading. Direct DEV gateway startup
fails before creating state or spawning a child. Status names the DEV instance
and reports `upstreamEnabled: false` / `dev_upstream_disabled`.

Desktop Commander uses OS-user profile configuration/logs, including information
from `os.userInfo()`. Changing HOME, USERPROFILE, a plugin name, or the manager's
state directory does not establish that boundary. Real DEV activation needs a
separately qualified OS user/profile and independent backend/App/grant routing.
No production installation, shortcut, Cloudflare route, token or policy is changed
by this source delivery.

## Configuration contract

Existing schemaVersion 1 configurations without `instance` retain production
port 19740, Host/Origin allowlists, launcher and startup behavior. An explicit
DEV configuration adds exactly this object to the existing configuration:

```json
{
  "kind": "dev",
  "id": "dev-local",
  "port": 19741,
  "productionConfigPath": "H:\\MTechLabs\\MCP\\state\\manager.json"
}
```

The object belongs under the `instance` key. This example is a contract example,
not an installed configuration or an instruction to activate it on the owner PC.
IDs are `dev` or `dev-` followed by lowercase alphanumeric segments, up to 48
characters. Ports are integers 1024–65535 except production port 19740. Binding
is fixed to `127.0.0.1`; there is no configurable public host or inherited
production website origin.

Before loading a DEV configuration or constructing its admin server:

- The DEV state directory must already exist. Its config, policy, token and
  inventory must be distinct ordinary files directly inside that directory.
  They cannot use reserved state names (toolkit, jobs/admission databases and
  sidecars, deployment, instances, DEV runtime plan or manager ownership lock).
  Windows paths must use ordinary local drive syntax; UNC/device paths,
  alternate data streams, and components ending in a dot or space are refused.
- `productionConfigPath` must identify the authoritative existing production
  configuration, with no DEV descriptor. Its state and control files must be
  readable. The operator selects this reference; software cannot establish that
  an arbitrary unrelated reference is the actual production installation.
- Canonical state roots must be separate siblings or otherwise disjoint.
  Equal/ancestor/descendant roots, linked ancestors, symlinks/junctions and
  hardlinked DEV files fail closed. Windows comparisons account for case and
  canonical short names. DEV state may not contain production controls or either
  runtime's executable/package files. Read-only runtime files may be shared.
- The entire existing DEV state is checked for ordinary, singly linked files
  and unlinked directories, bounded to 4096 entries and eight nested directory
  levels. Exceeding the bound requires deliberate state review before startup.
- Token files must represent different effective SHA-256 digests; different
  filenames with identical tokens do not qualify. The existing digest format
  and legacy plaintext-token compatibility remain supported.

These are startup topology checks, not an OS sandbox against another local
actor concurrently replacing files, changing mounts, or modifying production
configuration after validation. Protect the installation with appropriate OS
permissions. No access-control guarantee is made for an omitted DEV descriptor.

## Launch and lifecycle

The existing `manage.ps1` and `install-windows-startup.ps1` remain production-only.
The separate [DEV runtime inspector](DEV-RUNTIME.md) supports only `Inspect` and
`Status`; activation actions are refused. It verifies local OS/profile and
invocation observations against a strict routing plan without changing manager
state, and keeps live routing, grants and upstream activation unqualified.
The portable source entrypoint is `node admin.mjs --config <absolute-manager.json>`.
DEV uses its configured port, and direct API callers must use
`server.listen(instance.port, '127.0.0.1')`. Other ports, public interfaces and
reusing a closed DEV server object are refused before binding.

The server acquires an exclusive `manager-owner.lock` in its validated state
before returning from construction. A second owner is refused before listening
or job recovery. An occupied port does not recover running jobs and does not
terminate or alter the listener owner. An unsuccessful bind releases only the
lock created by that server.

On close, the manager stops new job dispatch, aborts its active job controllers,
and drains recovery, dispatch and finishing writes, HTTP operations, serialized
policy/toolkit writes and managed remote closure before releasing ownership.
API callers should close every constructed server, including never-listened
ones, and await `server.managedClosed` after `server.close()` to verify the drain.
The public `closeManagedMcp()` hook only closes MCP and does not relinquish admin
ownership. Draining does not assert that detached external work has stopped.

There is no automatic stale-lock takeover. After a crash, inspect the recorded
instance, exact process/listener identity and outstanding job outcomes before
manually removing the DEV lock. A PID that no longer exists, elapsed time, or a
failed health check alone is not authorization to restart uncertain work. Lock
replacement by another file is detected; cleanup does not delete that file.

## Requests and direct callers

Every endpoint still requires bearer authentication. DEV accepts exactly one
Host field equal to `127.0.0.1:<port>` or `localhost:<port>`; an optional Origin
must be one of their exact HTTP origins. Production hosts/origins and forwarded
headers grant no DEV access. No CORS permission is emitted.

Status contains the bounded DEV ID/port and the disabled-upstream reason; it
does not return the config path, production reference, token, digest or lock
record. Policies, inventory, toolkit and jobs remain scoped to the selected
validated state. Job execution still follows the existing capability and policy
checks; manager separation is not authorization to run a real DEV workload.

`loadConfig()` returns a validated frozen DEV snapshot, including its frozen
instance descriptor. `createAdminServer(config, { configPath })` also checks a
direct caller's config against the selected on-disk config before ownership.
Direct job/database, toolkit-write, recovery and status callers require that
validated snapshot. Copying the config into a new raw object loses validation;
load it again instead. Internal validation provenance is not serialized into
`manager.json`. Starting a DEV job runner additionally requires the live admin
ownership claim; merely loading a valid config does not authorize job recovery.
Built-in job providers retain their existing capabilities and run as the manager's
OS user. The Desktop Commander block is not a block on every job provider or a
claim of isolated code/VM/test execution.

## Qualification and remaining activation gates

`test/dev-instance.test.mjs` uses disposable fixture controls and loopback
servers. It covers concurrent legacy/DEV managers; cross tokens and routing;
independent policy, inventory and job state; canonical, linked and hardlinked
aliases; reserved names; duplicate/stale ownership; occupied/public binding;
deferred job recovery during close; direct-writer guards; and zero DEV SDK/spawn
calls. Windows CI runs the native junction/hardlink/case paths. Linux alone is
not Windows qualification.

Candidate and actual-main CI separately run the unchanged production regression
suite and disposable real upstream 0.3.1/0.3.3 qualification. Those upstream runs
test legacy behavior on disposable hosted OS accounts; they do not qualify a
real DEV profile or prove production deployment. The issue/checkpoint receipts
record exactly which revision and gates passed.

Next activation work must establish the independent OS profile, backend/App/grant
identity, DEV operational launcher and end-to-end isolation evidence before
removing the DEV upstream block. Production cutover remains a separate action
with an exact running-source check, quiescence, backup and rollback plan.
