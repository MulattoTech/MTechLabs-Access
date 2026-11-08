# MTerm-CLI connection verification — 2026-11-08

## Result and remaining boundary

The installed MTerm-CLI managed bridge can discover its complete tool inventory,
read and write an owned file, and run a harmless PowerShell command. The repaired
verification scripts also pass against the actual saved native-client commands
and an isolated HTTP manager. These checks do not establish a completed ChatGPT
installation, OAuth grant, or tool call from a ChatGPT conversation.

The current ChatGPT plugin-management inspection returned `not_installed`
for both the private plugin ID and the name MTerm-CLI. A requested
`full_access` permission update for that exact plugin returned the same status,
so no permission change was confirmed. Browser setup reported that an originating
browser context was unavailable. No repository review or merge approval is
needed to explain this account-connection limitation.

## Source and scope

Repository: [MulattoTech/MTechLabs-Access](https://github.com/MulattoTech/MTechLabs-Access).

The patch was staged in the clean branch
`fix/mcp-inventory-verification-20261108` from main commit
`9373fadc00689dd782143ab5e49664536f460b8b` (engineering toolkit release).
The owning source is `integrations/mcp-manager`; production is
`H:\MTechLabs\MCP\runtime`, manager version 0.4.0.

Two old acceptance gates still required the upstream-only set of 25 tools after
the manager added 28 engineering tools. The HTTP verifier asserted the number
25; the saved-client verifier required an exact 25-name set. Both now use a
shared inventory check requiring the native names and current engineering names,
unique portable tool names, object input schemas, JSON-compatible descriptors,
and a bounded serialized inventory. Valid additional tools are accepted.
Pagination is checked, and the HTTP status assertion uses its actual last-page
count. The existing authentication, Host, read-only, pause, and EOF cleanup checks
remain in place. No runtime authentication or authorization code was changed.

## Verification evidence

All observations below were made on 2026-11-08; they are point-in-time evidence.

| Check | Observed result | What it establishes |
| --- | --- | --- |
| Focused regression tests | 15 passed, 0 failed | Current managed set passes; native-only and same-size substitutions fail; malformed/duplicate names, invalid schemas, non-JSON/oversized inventories, pagination defects fail |
| Saved Codex, Claude Code, Claude Desktop entries | 3/3 passed; each listed 53 tools and read installation metadata | Their saved stdio launch commands work; no AI model was invoked |
| Actual descriptor inventory | 53 required tools; 0 extra; 66,371 serialized JSON bytes; largest descriptor 7,062 bytes | Complete native plus engineering discovery passed the shared structural checks |
| Isolated HTTP transport | Initialize and discovery passed; safe read passed; 2 resources and 0 prompts forwarded | SDK Streamable HTTP works with the manager using an ephemeral token |
| Isolated HTTP enforcement | Anonymous request 401; read-only write denied; paused read denied; status count matched discovery | Existing transport and policy boundaries remain effective in the fixture |
| Live managed stdio file operation | Owned temporary file written and read back with an exact marker | Real configured gateway file mutation and read work under the existing live policy |
| Live managed stdio process operation | Harmless PowerShell output command produced the marker and exited 0 | Real configured gateway command execution and output retrieval work |
| Cleanup and continuity | Owned gateways exited 0; smoke fixture removed; policy bytes unchanged; manager PID 42320 and start time unchanged | Verification preserved production sessions and policy |
| Public remote endpoint | Unauthenticated `/mcp` returned 401 with a protected-resource discovery challenge | Public authentication challenge is reachable; this is not an authenticated production HTTP test |
| OAuth discovery and owner policy | Resource and authorization-server metadata returned 200; DCR and S256 advertised; owner-only policy confirmed | No demonstrated reason to weaken or replace authentication |
| Private ChatGPT package | Version 0.2.0 exists; current release `pluginrel_6aeead9219788191b50e40e9cc1c3e37` | Package publication exists independently of account installation |
| ChatGPT account/conversation | Permission inspection and requested plugin permission update returned `not_installed`; browser context unavailable | Real ChatGPT installation, OAuth, and conversation tool invocation remain unverified |

Private package ID: `plugins_6aed1a85300481919559498b458ed278`.
Remote endpoint: [https://mcp.m-techlabs.com/mcp](https://mcp.m-techlabs.com/mcp).

The descriptor checks are deliberately structural. They do not certify every
JSON Schema keyword against every external client, or substitute for an actual
ChatGPT registration and tool invocation. No invalid advertised descriptor was
found in the observed inventory.

## Reproduction and local records

Run from the staged `integrations/mcp-manager` directory with Node 24:

```powershell
node --test test/verification-inventory.test.mjs test/verify-clients.test.mjs
node verify-clients.mjs
node verify-remote.mjs
```

The saved-client verifier reads only the known managed MCP entries and launches
their configured gateway commands. The HTTP verifier starts its own isolated
manager, policy, admission state, and random token; it does not authenticate to
the production HTTP service. Production retains its existing digest-only token
storage. No credentials were exported or changed.

The separate live file/process smoke used the existing production manager config
with a new owned stdio gateway and the existing enabled, writable policy. It
created one disposable fixture, ran `Write-Output MTERM_SMOKE_OK_20261108`,
retrieved the completed process output, then closed only its own gateway with EOF
and removed its own fixture. Its script and redacted report are under
`H:\MTechLabs\MCP\state\integration-verification-20261108`.
That directory also contains the focused-test, saved-client and HTTP logs.

This work verifies the MTechLabs-Access managed bridge. It does not relabel the
standalone MTerm-CLI repository as the deployed HTTP server. Any verifier-only
maintenance deployment should receive its own receipt; it must not overwrite
the full runtime deployment history or imply that the running manager restarted.
