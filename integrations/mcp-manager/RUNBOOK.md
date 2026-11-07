# MTerm-CLI Desktop Bridge — owner runbook

## Daily use

Open https://m-techlabs.com/admin/mcp, or the **M-TechLabs MCP Manager** desktop
shortcut. The shortcut safely starts the manager when necessary before opening the dashboard. Repeated clicks reuse the existing verified listener. The M-TechLabs home page also has an **MCP & Desktop Commander** card.
Sign in using the existing owner Google account. The manager is independent of
MJobs, Fleet Control, and any particular source repository.

The initial policy is enabled, **read-only**, one in-flight tool request shared across
managed gateways. After confirming the status is connected, turn off **Read-only
tool set** and save when you want an AI client to edit files or run commands.
The **Simultaneous tool calls** slider spans **1–64** with quick presets (4, 8,
16, **32 · Fleet**, 64). For a 30+ ChatGPT Pro fleet, click **32 · Fleet** and
**Save policy**. Preview updates immediately; only saving changes the live limit.
This is a shared tool-request admission limit, not a limit on connected chats, and
it does not impose CPU or detached-process caps. Begin with a lower value if many
calls start builds or other heavy programs, and monitor PC responsiveness. Use **Allow new managed tool calls** to
pause/resume. Changes apply to queued and future tool calls, not commands that
are already running. They do not revoke OAuth tokens.

These controls only cover calls through this managed MCP connection. Codex and
Claude built-in file/shell tools, other MCP servers, and the existing hosted
Remote Desktop Commander connection are outside its control. Website grants
for other apps do not grant PC terminal access. PC control starts owner-only.

ChatGPT and Claude may connect at the same time. Remote web clients reuse one
backend, and enrolled native gateways participate in the shared admission
coordinator. This is not a development-task scheduler or Git merge coordinator. Give simultaneous coding tasks separate Git worktrees and
keep integration/merging serial; do not have both clients edit the same working
tree independently. Increasing the tool-call limit does not add AI quota or
guarantee faster builds.

## Connect a browser client

Remote endpoint: `https://mcp.m-techlabs.com/mcp`

- ChatGPT: open the private [MTerm-CLI connection](https://chatgpt.com/plugins/plugins_6aed1a85300481919559498b458ed278),
  install it if needed, select **Connect**, and complete the Cloudflare owner login. Enable the connection
  in the conversation. If configuring the endpoint manually instead, choose
  OAuth and automatic/DCR client registration.
- Claude: **Customize → Connectors → Add custom connector**. Enter the endpoint,
  select sign-in/OAuth and **Register automatically**, then authorize using the
  owner Google account. Enable the connector for the conversation.
- Do not select “No authentication” and do not paste the origin service token.
  It stays server-side and is not required for either client.
- Ask the client to list the managed tools and read the harmless installation
  file `H:\MTechLabs\MCP\package.json` first. Enable editing only when needed.

The origin transport and tools are tested independently of client account
authorization. A healthy backend does not prove either personal account has
finished its OAuth consent. Leave the original hosted connector installed until
the new connection has passed a real task in each client.

The private ChatGPT package is version 0.1.2, ID
`plugins_6aed1a85300481919559498b458ed278`. It is private to the owner's account,
not a public app listing. Creating the package does not complete its OAuth
consent or connect the Claude account.

## Local clients

The distinct `desktop-commander-local` entry is configured for Codex CLI, Claude
Code, and Claude Desktop. Start a new CLI session or restart Claude Desktop
normally when convenient; existing running sessions are not forcibly restarted.
Claude Desktop may require signing in the first time. Existing MCP entries are
preserved. No Codex SDK, app-server, API key, GPU model, or extra AI account is
needed for this connection.

## Windows service lifecycle

The management process runs as the current Windows user, bound only to
`127.0.0.1:19740`. The user Startup shortcut starts it on Windows sign-in; it is
not a machine-wide administrator service and does not run before user sign-in.
The PC must remain on, signed in, and online for remote tools. No power/sleep
setting was changed.

The launcher is idempotent and will not stop another process to claim the port:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File "H:\MTechLabs\MCP\runtime\manage.ps1" -Action Status
powershell -NoProfile -ExecutionPolicy RemoteSigned -File "H:\MTechLabs\MCP\runtime\manage.ps1" -Action Start
```

If the website shows the local manager unavailable, check those commands and
the existing Cloudflare tunnel. A paused server is different from an offline
one. The website cannot start a PC that is powered off or a process that is not
running. Do not restart the manager while it owns active background commands.

## Footprint and limits

Manager **0.3.0** admits up to 64 active calls, with a maximum of 64 concurrent
remote HTTP requests, a global queue of 128, and per-client/per-gateway queues
of 64. A connected chat consumes no slot until it starts an actual tool call.
Existing manager 0.2.0 processes reject policies above two; after upgrade, finish
existing work and reopen Codex/Claude clients normally so they load the updated
gateway before setting the live limit above two. Do not terminate ongoing sessions.

The pinned upstream package is Desktop Commander **0.3.1** and the installed MCP
SDK is **1.32.2**. Runtime and dependencies are on H:, with a single reused
installation. Local stdio clients each launch their own child on demand; remote
web clients share one lazy child. Idle read-only remote use closes after five
minutes. Potential background work defers that shutdown to avoid losing jobs.

The heavy-tool admission floors are 4 GiB of free physical RAM and 10 GiB of free
space on the private state volume (H: in this installation). They cover
`start_process`, `start_search`, `interact_with_process`, and `write_pdf`; the disk
check does not measure every possible output destination. These are admission checks, not a hard
memory allocation cap, a disk quota, or a detached-job governor. Running
builds and autonomous agents still need separate limits. The server does not use
the GPU; it executes tools rather than performing local model inference.

Native Desktop Commander configuration and logs remain shared under
`C:\Users\Dylan\.claude-server-commander`. Its file/command restrictions are
guardrails, not OS isolation. Upstream logs can contain tool arguments; do not publish them or delete
unrelated history. The installed package rotates its main log around 10 MiB
and trims its recent-tool history around 5 MiB. This is upstream behavior, not
a hard disk quota enforced by the manager. No hosted-service quota or AI
subscription limit is increased by this installation.

## Recover an uncertain reservation

Admission state lives in the local `admission.sqlite` database and its SQLite
`-wal`/`-shm` sidecars. Preserve them together; never copy only the main file as
a live backup or place the shared state directory on a network filesystem.

An interrupted tool call keeps its shared reservation because a timeout or a
closed gateway does not prove that its command stopped. A late definitive tool
response releases the reservation automatically. Do not delete the SQLite file,
retry the operation blindly, or kill unrelated processes to clear this state.

Inspect the exact ticket locally:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'H:\MTechLabs\MCP\runtime\recover-admission.mjs' --config 'H:\MTechLabs\MCP\state\manager.json' --action inspect
```

The report contains ticket IDs, tool names and recorded gateway/upstream PIDs,
without command arguments. Check the operation's actual result and any detached
work in its owning application or terminal, or through the preserved hosted
Remote Desktop Commander connection. Managed diagnostics can also queue while
uncertain reservations occupy the entire budget. Once that work has ended, pause new
managed calls in the dashboard and let its owning client and upstream exit
normally. Then reconcile only that ticket:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'H:\MTechLabs\MCP\runtime\recover-admission.mjs' --config 'H:\MTechLabs\MCP\state\manager.json' --action resolve --ticket '<ticket ID from inspection>' --confirm work-ended
```

The helper refuses recovery while either recorded process is alive, if the
upstream PID is unknown, or unless admission is paused. PID reuse is treated
conservatively as a running process. The explicit confirmation means you checked
that detached work has ended; the helper cannot establish that fact by itself.
It removes one reservation, records a bounded `reconciled` event, and never
replays the tool call. Inspect again, then resume admission when appropriate.

## Credentials, updates, and rollback

The Worker holds `MCP_MANAGER_TOKEN`; the PC holds only its SHA-256 digest in the
private state directory. Never commit state, existing client configuration
backups, credentials, or tool histories. The state/backups directories are
restricted to the Windows owner and SYSTEM.

Manager source is versioned in the MTechLabs-Access repository under
`integrations/mcp-manager`; the upstream manifest/lockfile record the installed
dependency tree. Updates should be staged, tested, and explicitly deployed, not
automatically fetched at each client launch.

To disable the new route, pause managed tools in the website, disconnect the
private connector in ChatGPT/Claude, and remove only the new
`desktop-commander-local` MCP entries if desired. Remove only the two newly
created M-TechLabs MCP shortcuts to disable autostart/navigation. Inspect active
work before closing the manager process. Existing hosted Remote Desktop
Commander is unchanged and remains available. Saved client config backups are
under `H:\MTechLabs\MCP\backups`; compare and merge them rather than blindly
overwriting later settings.

## Acceptance boundary

The local release advertises 25 tools, including 24 core tools also exposed by
the 30-tool hosted connector. The six hosted-only tools are cloud-account/device
identity, device listing, remote call history/result retrieval, approval review,
and remote service shutdown. They are not fabricated as local equivalents.
The reproducible `verify-installation.mjs` checks file, process, search, PDF,
DOCX, and spreadsheet operations in an isolated fixture on the actual PC.
`verify-clients.mjs` reads only the three named local MCP entries and tests their
configured command with protocol initialization, tool discovery, and one
harmless file-metadata read; it does not invoke an AI model or prove a browser
account has authorized OAuth. This is not a claim of complete hosted-product parity or verified
browser account login.


## Deployment and recovery evidence

The dashboard reports the manager version, Node and Desktop Commander versions,
manager memory, and the recorded source commit/deployment receipt. A receipt is
a record of the installation, not an independent query of GitHub or Cloudflare.
Client-reported initialization labels show recent protocol contact. They do not
prove a persistent client session or a completed account-level OAuth grant.

Use a clean Git worktree to stage and test changes. Keep the production runtime
on H:, retain a timestamped copy of the current runtime and private policy in
`backups`, pause new managed calls, and check that no managed gateway or remote
backend owns work before restarting the manager. Never stop unrelated services
to reclaim port 19740. Restore the prior runtime and policy from that same
checkpoint if startup verification fails. The desktop and Startup shortcuts
remain unchanged because both point to the versioned `runtime\manage.ps1`.

A running native client may retain an older gateway already loaded in memory.
Start a new Codex/Claude Code session or restart Claude Desktop normally to load
the updated gateway. Do not terminate an existing coding session as an upgrade
shortcut. Windows sign-in autostart is verified separately from a full reboot;
a reboot test requires actually restarting Windows and must not be inferred
from a valid Startup shortcut.
