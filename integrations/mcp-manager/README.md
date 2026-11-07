# MTerm-CLI managed Desktop Commander bridge

## Implementation brief

Provide a small cross-project local service for Dylan's existing AI clients,
independent of MJobs or any other repository. Reuse the free, open-source local
Desktop Commander MCP package, preserve existing MCP entries and hosted browser
connections, keep the PC responsive, and integrate management into the existing
owner-only M-TechLabs administration and permission system.

This implementation is deliberately small: Node ESM, no GPU runtime, no local
model, no Codex SDK/app-server, and no automatic development-agent launch. The
native stdio gateway and administration API use the Node standard library. The
optional remote MCP bridge reuses @modelcontextprotocol/sdk 1.32.2 from the
existing pinned Desktop Commander installation; it adds no AI inference service.
The manager adds an enforcing wrapper for enrolled clients, a fixed-function
authenticated administration API, and an authenticated Streamable HTTP MCP
origin. It does not create or rotate hosted accounts.

## What this does and does not enforce

- Managed clients launch gateway.mjs, which launches one upstream stdio child.
  One upstream installation is reused; each attached client has its own process.
  Browser remote requests share one additional lazily started gateway/child.
- Each tool call re-reads a small local policy file. Pause denies new tool calls.
  Read-only denies writes, all configuration tools, process/search launches,
  process input/termination, and unknown tools.
- The explicit read-only allowlist is in lib/policy.mjs. It includes local file
  reads, directory/file metadata, existing session/output/search result reads,
  and usage statistics. Remote-URL file reads are denied in read-only mode.
- The request limit is global across managed gateways sharing the same private
  state directory. It counts in-flight requests, not running or detached
  commands. The shared queue accepts 64 waiting tickets globally and 16 per
  client label. Each gateway also bounds its local pending buffer at 16,
  including requests awaiting registration during brief database contention.
  Admission is FIFO within a label and round robin between waiting labels.
  A native command may keep running after Desktop Commander returns a response.
- Low available physical memory or low/unverifiable installation-volume disk
  space blocks admission of start_process, start_search, interact_with_process, and write_pdf.
  It does not kill existing work and is not a hard memory, CPU, or GPU cap.
- A tool response timeout does not kill or retry the operation. Its admission
  slot remains held until a definitive upstream reply arrives. Abandoned active
  permits remain uncertain and block replacement work; inspect their outcome
  before recovery using the local recover-admission.mjs helper documented in RUNBOOK.md. Neither a timeout nor an expired heartbeat is proof that a
  command stopped.
- Policy changes affect subsequent/queued calls, never terminate live commands.
- There is no global process kill, arbitrary administration shell API, package
  installer, or account-authentication endpoint in this service. Authorized MCP
  tool calls retain native file/terminal powers when read-only is disabled.
- Separately configured native MCP and hosted Remote Desktop Commander clients
  do not pass through this wrapper and are not controlled by this policy.
- M-TechLabs website roles protect administration; they do not magically govern
  independent native file/shell execution. Desktop Commander's allowed folders
  and command blocklist are guardrails, not OS isolation.

ChatGPT and Claude.ai may use the separately protected self-hosted remote route
after a supported connector/OAuth setup. Existing vendor-hosted connections are
preserved and remain separate. Neither local installation nor self-hosting
changes AI-model limits, client-plan availability, or the quotas of a hosted
connection that is still in use. Browser login must be verified separately.

## Paths and installation

Verified upstream stable release when implemented: Desktop Commander 0.3.1.
The upstream package requires Node >=22.12.0; manager 0.3.0 requires **Node 24
or later** for its built-in SQLite admission coordinator. Verify installed Node
and npm metadata before installation. No separate database service is needed.

The intended deployment layout is:

    H:\MTechLabs\MCP\runtime\       this source tree
    H:\MTechLabs\MCP\node_modules\  one pinned upstream installation and SDK
    H:\MTechLabs\MCP\state\         manager configuration and instance metadata

Paths are examples, not auto-created global settings. Copy example-config.json
to the chosen state location and replace nodePath and package paths with verified
absolute paths. Config accepts exactly its documented fields; policy/inventory
and token paths must be distinct. minimumFreeMemoryMiB defaults to 4096 and can
be 256..65536. minimumFreeDiskMiB defaults to 10240. These floors apply to new
heavy-tool admission on the state volume, not every output path or the eventual allocation of running commands. No
environment home-directory overrides are used.

The upstream 0.3.1 source does not expose an alternate config/log-root setting.
Its native configuration and local logs remain under:

    %USERPROFILE%\.claude-server-commander\

Those may also be used by existing remote-device processes. This manager never
edits that directory or alters its existing allowedDirectories/blocklist.
Upstream argument logs may contain sensitive information. The active argument
log rotates at 10 MB, but rotated files are not automatically deleted; monitor
their growth and review any retention plan separately. Do not erase existing logs.

## Authentication and state

Create policy.json from policy.example.json. Initial safe policy:

    {"enabled":true,"readOnly":true,"maxInflight":1}

Manager policy writes also persist `coordinationVersion:1`. The external API
continues accepting exactly the three policy controls above. A previously loaded
0.1.0 gateway rejects this marker and stops admitting new work until its client
is reopened; active commands are not killed. This prevents an old per-instance
gateway from silently bypassing the shared limit after an update.

Create inventory.json from actual nonsecret client configuration metadata using
inventory.example.json as the schema. Set configured/tested true only after the
corresponding configuration or test is verified. Inventory is a timestamped
snapshot, not a live hosted-account check.

Generate a cryptographically random bearer token through the approved secret
workflow. The preferred token file stores only:

    sha256:<64 hex digits of SHA-256 of the bearer token>

The Cloudflare Worker secret holds the real bearer token; the PC needs only its
digest. This avoids copying the plaintext token through remote command logs.
Never commit the real token, token digest file, machine config, or state.
The file must be a regular nonsymlink file. Compatibility with a plaintext
32..512-character nonwhitespace token is supported but not recommended.
Token changes require restarting only the administration process.

The manager compares SHA-256 of the supplied bearer using constant-time buffer
comparison. All requests require authorization, even unknown paths. The API
returns no token, raw tool arguments, environment values, executable paths,
upstream logs, or arbitrary subprocess output.

## Run the management process

Using the verified absolute Node executable:

    node H:\MTechLabs\MCP\runtime\admin.mjs --config H:\MTechLabs\MCP\state\manager.json

It always binds to 127.0.0.1:19740, never 0.0.0.0. Register an owner-controlled
launcher/scheduled task through the normal Windows deployment process if desired.
Do not run it as Administrator merely for convenience. An existing listener
causes a clean failure; no process is killed to claim the port.

The only accepted Host headers are localhost:19740, 127.0.0.1:19740, and the
fixed mcp-origin.m-techlabs.com origin (optional :443). If an Origin header is
present, it must be https://m-techlabs.com or https://www.m-techlabs.com.
Forwarded-Host headers are not trusted. There is no wildcard CORS.
The Worker must use its server-side secret when calling the fixed origin.

Supported endpoints:

    GET /v1/status
    POST /v1/policy
    POST /mcp

POST accepts exactly enabled:boolean, readOnly:boolean, maxInflight:integer 1..64.
The owner dashboard provides an immediate slider preview and quick presets (4, 8, 16, 32, 64). Choose **32 · Fleet** for roughly 30 concurrent tool calls, then press **Save policy**; the manager confirms the applied change. This is a shared *in-flight tool request* budget, not a chat count, CPU quota, or background-process cap.
It writes the policy atomically and returns:

    {
      "ok": true,
      "policy": {"enabled":true,"readOnly":true,"maxInflight":1},
      "appliesTo": "new_tool_calls",
      "runningCommandsInterrupted": false
    }

Error responses use:

    {"error":{"code":"unauthorized","message":"Authentication is required."}}

Admin codes: 401 missing/incorrect bearer; 403 invalid Host/Origin; 400 invalid
policy; 404 unknown path; 405 unsupported method; 503 policy save failure. The
policy request body is bounded to 4096 bytes. Responses are JSON and not cacheable.

## Self-hosted browser MCP

The origin is not a public, anonymous MCP server. Every /mcp request must first
pass the same constant-time bearer verification and fixed Host/Origin allowlist
as administration. A trusted edge Worker must authenticate and authorize the
owner via supported OAuth/Access, then call the origin using its private bearer.
The bearer is a server-to-server secret, not a credential to paste into ChatGPT
or Claude. This source does not implement OAuth discovery or grant user access.

The public connector URL is configured separately, for example:

    https://mcp.m-techlabs.com/mcp

The Worker must construct a narrowly allowlisted outbound request, not blindly
forward client headers. Pass Accept, Content-Type, MCP-Protocol-Version, the
JSON body and the configured private Authorization header. Omit the incoming
browser Origin or replace it with the fixed trusted site Origin; an arbitrary
client Origin is intentionally rejected. Never expose the private token or
origin management endpoints in a tool manifest.

Remote transport is stateless Streamable HTTP with JSON responses. POST handles
one JSON-RPC message; GET/DELETE return 405 (no persistent SSE stream or MCP
session). Bodies are capped at 1 MiB and HTTP concurrency at 64 requests.
The gateway participates in the shared maxInflight 1..64 budget and bounded
queue with native clients (128 tickets globally, 64 per client and per gateway;
128 pending requests per gateway). Heavy parallel execution can saturate the PC:
resource checks gate *new heavy calls* but do not govern CPU usage or detached
background processes. Existing 0.2.0 gateways continue using their original
validator and can reject policies above 2. Finish ongoing work and reopen each
Codex/Claude connection normally to load manager 0.3.0 before increasing the
shared policy above 2; never force-close an in-progress client to upgrade.
No tool call is automatically retried. Cancellation across separate stateless
requests, progress streaming, subscriptions, sampling, and task APIs are not
advertised or implemented. HTTP disconnect does not kill a tool or prove that
it stopped; inspect the native session before retrying anything with effects.

The first valid request starts one shared gateway labelled remote-web. The SDK
Client initializes it, and the HTTP server forwards the actual tools/list and
tools/call schemas/results. Native resources/list, resources/templates/list,
resources/read, prompts/list and prompts/get are forwarded when the upstream
advertises those capabilities. Subscriptions/listChanged are not advertised.
File-preview UI metadata is preserved when resources are supported; unsupported
UI resource metadata is stripped if an alternate upstream lacks resources.
No hosted account/device lifecycle tools are invented to imitate the vendor.

The verified installed local package exposes 25 tools; the hosted connector
inventory exposed 30. Twenty-four core computer tools overlap. Hosted-only
get_tool_result, list_devices, list_remote_tool_calls, review_device_call,
shutdown, and who_am_i are remote service/account lifecycle features. Local
give_feedback_to_desktop_commander is additional. This is core computer-tool
coverage, not a claim of identical hosted-service behavior or 100% parity.
Re-list tools after upstream version changes rather than assuming these counts.

Read-only/discovery-only use tears down the shared backend after five idle
minutes. Once a start_process, start_search, or interact_with_process call may
have executed, automatic teardown is conservatively deferred because a returned
tool response does not prove background work ended. Status exposes this fact.
There is no background-process counter or hard CPU/RAM cap. The custom stdio
transport closes with EOF only; unlike the SDK's stock stdio close, it never
escalates to signals. A closing backend must exit before another is spawned.
Manual service shutdown closes its owned transport and may trigger upstream
cleanup, so inspect active work before restarting it. Unrelated clients are
never stopped by this code.

SDK loading is lazy: an absent/broken SDK does not take down native stdio or
administration. It makes /mcp return a generic 503 and status unavailable. Native
local clients remain first-class and do not depend on OAuth or the HTTP bridge.

## Enroll compatible local clients

Back up the client's current configuration, merge only a distinct local entry,
and preserve every other MCP and setting. The local client's command is the
verified Node executable, not an unverified global shell:

    node H:\MTechLabs\MCP\runtime\gateway.mjs --config H:\MTechLabs\MCP\state\manager.json --client claude-desktop

Use client codex for Codex. The client label must be a nonsecret 1..64-character
alphanumeric/underscore/dot/hyphen identifier and should match its inventory
entry. Do not run the gateway as an idle background service; stdio clients
launch it on demand. This adds one small wrapper and one upstream child per
active local client, not one copy of the package per account.

Claude Desktop uses a merged mcpServers entry in its current configuration.
Codex uses its supported MCP CLI/config. Check actual installed client behavior
before assuming a config write means the connection is active. Normal client
restart or new session creation may be needed; do not kill unrelated sessions.

### Verification

1. Run the test suite before deployment.
2. Start the management process and confirm an unauthenticated request is 401.
3. Use the fixed-origin Worker route to confirm authenticated sanitized status.
4. Start a fresh enrolled client session, initialize MCP, and list tools.
5. Under read-only policy, execute a harmless allowed read and verify a
   configuration/write request is denied by the wrapper.
6. Verify the owner-only site policy controls change policy and deny new calls
   when paused; existing commands should remain untouched.
7. Verify another existing native/hosted MCP still works and is labelled
   unmanaged/hosted rather than falsely controlled.

## Status contract

The UI gets schemaVersion:1 plus service, policy, policyValid, runtime,
resources, limits, coordinator, instances, inventory, deployment, boundaries,
warnings, and remoteMcp.

runtime exposes only Node version, verified package version, and installation
presence. resources contains available/total physical memory, the configured
memory/disk launch-admission thresholds, manager RSS/heap, and free/total bytes
of the state volume if readable. Deployment includes only a recorded source
commit, installation time and Worker version; it does not expose local paths.
admissionOpen refers to heavy-tool admission, not permission for all
safe reads. There is no fabricated CPU hard cap or GPU utilization value.

instances are sanitized heartbeat records of wrappers launched by this code:
id, client, active/stale state, timestamps, request/queue counts, and successful
MCP initialization state, manager version, and gateway RSS. A heartbeat older
than 45 seconds is stale; it is not
auto-killed. On clean exit a wrapper removes only its own UUID metadata file.
No existing process or unrelated file is deleted.

The coordinator uses transactional SQLite in WAL mode with full durability on
the local private state volume to
serialize admission across independent gateway processes. Global queue counts,
active permits and uncertain permits are reported separately. It does not
retry an uncertain request, reclaim active work just because a heartbeat is
old, or impose an OS process/memory limit. Confirmed rolled-back lock contention
retries admission bookkeeping only; it never repeats an executed tool call.
Keep the database and any WAL/shared-memory sidecars together. Use an offline
backup after gateway connections have closed; copying only a live main database
file is not a complete backup. Network-shared state directories are unsupported.

Inventory labels are bounded and sanitize away raw paths/URLs. Its connection
is unknown unless a matching managed client has a fresh initialized heartbeat.
Configured, connected, and tested are deliberately different fields.

remoteMcp contains only sanitized protocol/service observations:

    {
      "transport": "streamable-http",
      "endpoint": "/mcp",
      "state": "idle",
      "sdkLoaded": false,
      "sharedBackend": true,
      "activeHttpRequests": 0,
      "activeUpstreamRequests": 0,
      "maxHttpRequests": 8,
      "idleTimeoutSeconds": 300,
      "idleTeardownDeferred": false,
      "lastToolListCount": null,
      "lastSuccessfulRequestAt": null,
      "lastSuccessfulToolAt": null,
      "clientIdentityTracked": false,
      "resourceSupport": null,
      "promptSupport": null
    }

state is idle, starting, ready, closing, unavailable, or stopped. The tool count
is the most recent tools/list page, not an inferred total across pagination.
Timestamps prove only an origin operation succeeded, not which browser account
logged in. A bounded observedClients list records sanitized client-reported
initialize labels only; it is not a live account/session list. Client identity
and OAuth evidence belong to the edge authentication
layer and must not be inferred from an initialized shared backend.

## Tests and rollback

    npm ci --ignore-scripts --no-audit --no-fund
    node --test test/*.test.mjs

The SDK dependency is for reproducible scratch/CI tests; on the deployed PC it
may resolve from the existing parent node_modules installation, avoiding a
duplicate package tree. Do not copy node_modules or test state into the runtime.

Tests use temporary fixtures and fake local stdio children with the real SDK.
They cover
authentication, Host/Origin rejection, policy validation, secret minimization,
read-only/paused/low-memory/low-disk admission, shared request concurrency and
queue limits,
framing, timeouts without retry, preservation of unrelated files, real HTTP MCP
initialize/list/call, resource/prompt/UI metadata forwarding, lazy idle shutdown,
bounded HTTP requests, unavailable SDK, and safe handling of unsupported UI.

Rollback: restore only the backed-up local client entries, stop only this
administration process, remove its specific origin route/Worker configuration
if it was added, and preserve existing Desktop Commander package/config/logs.
Do not reset global client configuration or terminate unrelated AI sessions.

## Upstream references

- https://github.com/wonderwhy-er/DesktopCommanderMCP/releases/tag/v0.3.1
- https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/v0.3.1/package.json
- https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/v0.3.1/src/config.ts
- https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/SECURITY.md
- https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/README.md
- https://github.com/modelcontextprotocol/typescript-sdk

This is an independent local administration and MCP transport layer, not a
vendor fork or a reproduction of its account/device administration service.
