# MTerm-CLI Desktop Bridge — owner runbook

## Source candidate and deployed runtime

The November 12 engineering branch proposes Desktop Commander **0.3.3** with a
separate disposable-hosted qualification harness. The observed live installation
remains **0.3.1**, and no production restart or deployment is part of that source
change. See [the qualification contract](qualification/README.md) before using
the candidate manifests. The production instructions below remain a separate
operational record; they are not an instruction to deploy this candidate.

## Daily use

Open https://m-techlabs.com/admin/mcp, or the **MTerm-CLI Manager** desktop
shortcut. The shortcut safely starts the manager when necessary before opening the dashboard. Repeated clicks reuse the existing verified listener. The M-TechLabs home page also has an **MTerm-CLI Desktop Tools** card.
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
- Gemini Web: open [Gemini connectors](https://gemini.google.com/customize/connectors),
  add a custom MCP connector called **MTerm CLI Desktop Bridge**, and use the endpoint above.
  Prefer automatic OAuth client registration. If manual setup is necessary, use the
  Gemini-specific, already registered **public OAuth client with PKCE and no client secret**
  and its exact approved redirect, rather than a generic client ID or a new wildcard.
  Complete Cloudflare Access owner authorization and select the connector for a
  read-only test. On **2026-11-19**, Gemini displayed **32 read-only tools** and
  successfully invoked **Get File Information**; this is historical evidence,
  not current session health or write/process-execution parity.
  See [Gemini verification record](verification-20261119-gemini-web.md).
- Do not select “No authentication” and do not paste the origin service token.
  It stays server-side and is not required for any browser client.
- Ask the client to list the managed tools and read the harmless installation
  file `H:\MTechLabs\MCP\package.json` first. Enable editing only when needed.

The origin transport and tools are tested independently of client account
authorization. A healthy backend does not prove either personal account has
finished its OAuth consent. Leave the original hosted connector installed until
the new connection has passed a real task in each client.

The historical 2026-11-08 private ChatGPT package version was 0.2.0; the owner later verified the same private plugin at v0.2.3 (2026-11-12). The website recovery download for 0.2.3 is prepared as a source-equivalent archive and must be independently deployed and verified. Original plugin ID:
`plugins_6aed1a85300481919559498b458ed278`, with published release
`pluginrel_6aeead9219788191b50e40e9cc1c3e37`. It is private to the owner's
account, not a public app listing. Package publication, account installation,
OAuth authorization, and conversation tool availability are separate states.
On 2026-11-08 the package existed, but ChatGPT permission inspection returned
`not_installed` by both its ID and name. The available browser connection
reported an unavailable originating browser context, so account installation
and a real ChatGPT tool call could not be completed in that session. See
[the verification record](verification-20261108.md).

## Gemini execution evidence and attribution

The owner-only `/admin/mcp` page has a **Gemini Web / execution evidence**
panel. It includes the dated 2026-11-19 Gemini `Get File Information`
result (3,041 bytes, last-modified `2026-10-05T21:13:14.048Z`), historical
Cloudflare OAuth authorization and discovery of 32 read-only tools.
These are historical owner-verified facts, **not** a current Gemini tool-call
health indicator.

After the **origin manager runtime** is updated and safely restarted, its
`remoteMcp.recentToolCalls` status includes at most 32 completed tool calls
for this stateless remote bridge (timestamp, tool name, outcome and elapsed
milliseconds). The data is in memory only: it resets when the manager restarts,
and past calls cannot be reconstructed from that feed. It never retains or
relays arguments, local paths, file contents, command output or OAuth tokens.
The Worker projects only allowlisted fields to the existing owner-gated page.

**Important attribution limit:** the remote HTTP transport uses a separate
stateless MCP server for each request. A `Gemini` label on `initialize` is
a client-supplied version observation, not a verified authenticated identity.
Subsequent `tools/call` requests cannot be reliably assigned to Gemini,
ChatGPT or Claude by that label. Accordingly, the recent-call table is
explicitly **all clients / unattributed**; it must never be used to assert
Gemini-specific file activity. A future authenticated per-client audit trail
requires verified OAuth client context and deliberate session correlation.
Do not infer attribution from timestamps, source IP, User-Agent or missing
connection labels.

Deploy the Worker and origin manager separately under their established
release paths. With an older origin manager, the new page displays that
recent-call logging is unavailable, not a fabricated empty or successful
history. Preserve running jobs, active connections and the existing release
rollback points before restarting a manager.

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

Manager 0.4.0 advertises the pinned upstream's 25 native tools plus 28
engineering tools (53 in this installation). Twenty-four native core tools
also appear in the observed 30-tool hosted connector. The six hosted-only
tools are cloud-account/device
identity, device listing, remote call history/result retrieval, approval review,
and remote service shutdown. They are not fabricated as local equivalents.
The reproducible `verify-installation.mjs` checks file, process, search, PDF,
DOCX, and spreadsheet operations in an isolated fixture on the actual PC.
`verify-clients.mjs` reads only the three named local MCP entries and tests their
configured command with protocol initialization, tool discovery, and one
harmless file-metadata read. Both saved-client and HTTP verifiers require the
native and engineering names, validate unique names and object input schemas,
and record the complete inventory size; they do not hardcode a total of 25.
The HTTP verifier uses an isolated manager and ephemeral token. Neither verifier
invokes an AI model, authenticates production HTTP, or proves that a browser
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

## Engineering toolkit setup and recovery (0.4.0)

All commands in this section run locally on `MulattoTechBox` under the
intended Windows user account. The examples assume the existing managed
installation layout; check paths before running. Do **not** copy private
tokens or browser credentials into commands, issues or logs.

1. Install the optional isolated math environment. The installer only creates
   `H:\MTechLabs\MCP\state\math-venv` and pins the reviewed requirements:

       powershell -NoProfile -ExecutionPolicy RemoteSigned -File H:\MTechLabs\MCP\runtime\install-math.ps1

   Verify with `...\math-venv\Scripts\python.exe -I ...\runtime\math_worker.py`
   using bounded JSON on standard input, or the MCP math tools after launch.

2. Configure local allowlisted repository roots, using a convenient parent
   that contains the Git repositories you actually want to manage (never a
   drive root). `rootId` is only a handle; the server resolves each requested
   relative directory to a canonical path and requires the exact Git top level.

       node H:\MTechLabs\MCP\runtime\configure-toolkit.mjs --config H:\MTechLabs\MCP\state\manager.json --add-root dev C:\Tools\Dev
       node H:\MTechLabs\MCP\runtime\configure-toolkit.mjs --config H:\MTechLabs\MCP\state\manager.json --list

   Remove one: `--remove-root dev`. Root paths are never writable through the
   website. No default arbitrary filesystem root is assumed.

3. Start with the original loopback-only launcher. First inspect the exact
   `19740` listener and owner; do not terminate processes to reclaim a port.

       powershell -NoProfile -ExecutionPolicy RemoteSigned -File H:\MTechLabs\MCP\runtime\manage.ps1 -Action Status
       powershell -NoProfile -ExecutionPolicy RemoteSigned -File H:\MTechLabs\MCP\runtime\manage.ps1 -Action Start

   The existing `install-windows-startup.ps1` creates *user-scoped* desktop
   and Startup shortcuts when absent, refuses to overwrite different
   shortcuts, and invokes the launcher. Use it once after validating the
   manager. It changes no firewall rule, machine-wide policy or services.

4. In the owner web dashboard, refresh status. Initially enable only the
   capabilities you need. `testRun`, `repoWrite`, `vmPower` and `jobs` are off
   by default. To execute those tools, the global `readOnly` gate must also be
   disabled, after reviewing the elevated permissions. The global pause and
   concurrency slider continue to apply to all managed calls.

5. Jobs: choose VM inventory, repository diagnostics, or one of the explicitly
   allowed tests (`npm-test`, `npm-lint`, `pytest`, `git-diff-check`). The
   queue stores metadata in `state\toolkit-jobs.sqlite`; this is state, not a
   cache to delete during deployment. New manager processes mark previous
   `running` jobs `interrupted` and do not infer their outcome. Use owner
   controls to cancel or explicitly requeue only after checking the PC.

6. Rollback: keep the current good source snapshot and all `state` data. Stop
   only the exact manager PID after proving no active managed requests, then
   restore the previous runtime source snapshot and restart. Do not roll back
   `toolkit.json`, admission SQLite or job SQLite blindly; an older manager
   ignores the new toolkit, while the newest coordinator state may reject
   an older client until it is reconnected.

### Permission and resource boundaries

- The owner dashboard relays fixed JSON routes through the Worker secret;
  CSRF, owner identity and input shape are verified at the edge and local
  bearer/Host checks at the PC. It does not accept arbitrary shell strings.
- Git actions require canonical root containment and the Git worktree's root.
  Checked patches require the expected 40-character HEAD and a successful
  `git apply --check`; no automatic commit, merge, push or deletion occurs.
- Hyper-V changes use fixed cmdlets and require an exact VM-name confirmation.
  Shutdown is graceful; checkpoints perform a disk-headroom preflight. No
  start/shutdown/checkpoint runs from a preview-only request.
- The process runner does not provide Windows Job Objects or a full process-
  tree kill guarantee. A timed-out test and an interrupted job may leave a
  subprocess; inspect before retrying. Never interpret a timeout as a safe
  rollback.
- All sensitive output and absolute paths stay local. Online job status is a
  limited metadata projection; detailed command results require an approved
  local tool call.
