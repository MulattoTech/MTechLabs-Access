# M-TechLabs Desktop MCP — owner runbook

## Daily use

Open https://m-techlabs.com/admin/mcp, or the **M-TechLabs MCP Manager** desktop
shortcut. The M-TechLabs home page also has an **MCP & Desktop Commander** card.
Sign in using the existing owner Google account. The manager is independent of
MJobs, Fleet Control, and any particular source repository.

The initial policy is enabled, **read-only**, one in-flight tool request per
managed instance. After confirming the status is connected, turn off **Read-only
tool set** and save when you want an AI client to edit files or run commands.
Keep the limit at one initially; two allows limited parallelism, not a global
PC CPU or background-process limit. Use **Allow new managed tool calls** to
pause/resume. Changes apply to queued and future tool calls, not commands that
are already running. They do not revoke OAuth tokens.

These controls only cover calls through this managed MCP connection. Codex and
Claude built-in file/shell tools, other MCP servers, and the existing hosted
Remote Desktop Commander connection are outside its control. Website grants
for other apps do not grant PC terminal access. PC control starts owner-only.

ChatGPT and Claude may connect at the same time. They share the remote backend
and its admission limit, but this is not a development-task scheduler or Git
merge coordinator. Give simultaneous coding tasks separate Git worktrees and
keep integration/merging serial; do not have both clients edit the same working
tree independently. Increasing the tool-call limit does not add AI quota or
guarantee faster builds.

## Connect a browser client

Remote endpoint: `https://mcp.m-techlabs.com/mcp`

- ChatGPT: use the private **M-TechLabs Desktop** plugin if it has been saved to
  the account, or add the endpoint as a custom MCP connection. Select OAuth
  and automatic/DCR client registration. Complete the Cloudflare owner login.
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

The pinned upstream package is Desktop Commander **0.3.1** and the installed MCP
SDK is **1.32.2**. Runtime and dependencies are on H:, with a single reused
installation. Local stdio clients each launch their own child on demand; remote
web clients share one lazy child. Idle read-only remote use closes after five
minutes. Potential background work defers that shutdown to avoid losing jobs.

The launch-admission floor is 4 GiB of free physical RAM. This is not a hard
memory allocation cap, a disk quota, or a global detached-job governor. Running
builds and autonomous agents still need separate limits. The server does not use
the GPU; it executes tools rather than performing local model inference.

Native Desktop Commander configuration and logs remain shared under
`C:\Users\Dylan\.claude-server-commander`. Its file/command restrictions are
guardrails, not OS isolation. Logs can contain tool arguments and grow over time;
do not publish them or delete unrelated history. No hosted-service quota or AI
subscription limit is increased by this installation.

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
Functional file, process, search, PDF, DOCX, and spreadsheet checks passed on the
actual PC. This is not a claim of complete hosted-product parity or verified
browser account login.
