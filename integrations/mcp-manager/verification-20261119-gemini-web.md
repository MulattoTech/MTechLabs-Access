# Gemini Web custom MCP — integration verification and release handoff

**Observation date:** 2026-11-19 (UTC). **Owner-facing feature:** MTerm CLI Desktop Bridge.

## Source-of-truth boundary

| Surface | Authority |
| --- | --- |
| Owner hub `https://m-techlabs.com/admin/mcp` | `MulattoTech/MTechLabs-Access`, `public/mcp.html`, `public/mcp.css`, `public/mcp.js`, Worker `mtechlabs-access-codes` |
| OAuth, protected browser MCP `https://mcp.m-techlabs.com/mcp` | Existing Cloudflare Access app `M-TechLabs Personal Desktop MCP` and existing Worker route; no OAuth code changes in this patch |
| Private desktop transport and origin manager | `MulattoTech/MTechLabs-Access/integrations/mcp-manager`, installed separately under `H:\MTechLabs\MCP` |
| Standalone CLI and separate *staging* gateway | `MulattoTech/MTerm-CLI`; not the owner bridge and not part of this release |
| Generic M-TechLabs development workspace | `MulattoTech/M-TechLabs`; not the deployed MCP owner console |

## Dated observed client evidence — historical, not continuous monitoring

On 2026-11-19, the owner's Gemini Web account created a custom MCP connector called **MTerm CLI Desktop Bridge**, using the existing endpoint. The account-linking flow reached Cloudflare Access, which accepted the owner login. Gemini displayed **32 read-only tools**. From a Gemini conversation it invoked **Get File Information** on the previously approved `C:\Tools\Dev\MTerm-CLI\AGENTS.md`, reporting **3,041 bytes** and last modified `2026-10-05T21:13:14.048Z`. No files were modified. The owner-provided test result was cross-checked against the open Gemini conversation text on 2026-11-19; the Gemini tool was **not re-invoked** by the integrator.

A separate 2026-11-19 tool call in the current ChatGPT conversation, through the configured MTerm-CLI Live Connection, returned the same file size and modified timestamp. This confirms that **one current ChatGPT tool path** works. It does not prove canonical-plugin-only authorization, Gemini session freshness, or parity between clients.

| State | Gemini Web on 2026-11-19 |
| --- | --- |
| Connector creation | Observed in the owner account |
| Owner authorization | Historical verification passed |
| Tool discovery | Historical verification passed: 32 read-only tools shown |
| Actual read-only tool execution | Historical verification passed: Get File Information |
| Write/process execution | **NOT VERIFIED**, not claimed |
| All tools / identical grants to ChatGPT and Claude | **NOT VERIFIED**, not claimed |
| Still registered and connected *at time of later checks* | **NOT VERIFIED** without a fresh Gemini UI/account-level check |
| Under-load reliability and additional users | **NOT VERIFIED** |

The displayed 32-tool count is **not** an authoritative count of the backend, standalone CLI staging gateway, or other clients' current grants.

## Cloudflare read-only inspection on 2026-11-19

- Access application `M-TechLabs Personal Desktop MCP`, hostname `mcp.m-techlabs.com`, remains `self_hosted` with a single explicit owner-only allow policy that requires the existing identity provider.
- `oauth_configuration.enabled = true`; `dynamic_client_registration.enabled = true`.
- Redirect allowlist contains the established ChatGPT callback patterns, the Claude callback, and the exact owner-specific Gemini callback `https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-ab817b2b0d8b05a093e9dbe1`.
- `allow_any_on_localhost = false` and `allow_any_on_loopback = false`. No Google wildcard was added.
- Existing Cloudflare Worker routes for `m-techlabs.com/admin/mcp*` and `mcp.m-techlabs.com/*` both use `mtechlabs-access-codes`.
- The Worker deployment last observed by API was created `2026-11-10T07:58:31Z`, version `a65ed883-30be-4bca-8d5a-697786ffd87a`. This **does not** prove that the current GitHub main commit or this documentation patch is deployed.

No policies, DNS records, OAuth callbacks, client grants, tokens, or running connections were modified by this reconciliation.

## Browser client instructions

- **ChatGPT Web:** Preserve the original private `MTerm-CLI` plugin ID and its owner OAuth/App dependency. It is not the MTerm-CLI standalone staging endpoint.
- **Claude Web:** Preserve its existing separately authorized custom MCP connector and automatic OAuth flow.
- **Gemini Web:** Use `https://gemini.google.com/customize/connectors`, add a custom MCP connector `MTerm CLI Desktop Bridge`, and enter `https://mcp.m-techlabs.com/mcp`. Prefer OAuth automatic client registration. If manual setup is required, use the *dedicated registered public client* with PKCE, **no client secret**, and the exact approved Gemini callback. Complete the existing Cloudflare Access owner consent and select the connector in the conversation before invoking a read-only tool.

Never enter the manager's origin service token into an AI client; never expand allowed redirects or weaken owner Access to resolve setup friction.

## Implementation and verification contract

This patch modifies only the owner HTML/CSS card, targeted static-page tests, and the relevant owner-bridge documentation. It does not change gateway tools or production authentication.

Before release: run root `npm test`, `npm run check`, `npm run build`, manager tests, `git diff --check`, and inspect exact-head GitHub Actions for Linux/Windows. Keep historical verification labels distinct from current health. Confirm that the original ChatGPT and Claude cards still render and the owner endpoint is unchanged.

**Interactive production acceptance remains separate:** from the owner's existing Gemini app, verify the connector is still installed and repeat Get File Information with an approved nonsensitive file. Confirm the deployed page shows Gemini under an authenticated owner session, and compare deployment revision to the approved source. Mark anything not directly checked **NOT VERIFIED**.

**Rollback:** Revert only the owner UI/docs revision or restore the previously verified Worker deployment after review; preserve the configured Cloudflare Access application, redirect allowlist, existing OAuth clients, private plugin ID, tunnel, origin manager, and active sessions. No credential rotation or connection removal is part of this change.

## November 19 follow-up: dedicated Gemini evidence and remote call history

The first owner screenshot showed a generic observed-client row (`Gemini`,
version `1.0.0`) but no Gemini-specific file-test details. The original
GitHub PR was still open and no website deployment had occurred.
The owner-facing source was extended with a standalone Gemini section:
historical OAuth/discovery and the exact read-only `Get File Information`
result, plus a live observed-protocol status that does **not** claim a
current authenticated session.

The local bridge now offers an optional, memory-only ring buffer of up to 32
recent remote tool calls, recording only tool name, completion time, outcome,
and elapsed milliseconds. Worker projection strips unrecognized fields and
always sets `clientAttribution: unknown`. No arguments, paths, result bodies,
or credentials are recorded. Historical calls cannot be backfilled. An older
manager reports no event-feed capability, not zero executions.

**Release is two-part:** the Cloudflare Worker serves the updated owner page
and safe status projection; the separately running Windows MCP manager must
be updated to the exact reviewed origin-manager source and safely restarted
for the live event feed. Never overwrite its runtime while jobs are active.
The stateless per-request transport still cannot identify which of the three
browser clients performed a particular `tools/call`. True per-client
attribution is **NOT VERIFIED** and requires an authenticated client-specific
identity/session correlation design. Do not use inference from client labels,
timestamps or access IPs.

## Handoff

Continue in this order: review tests and PR exact head; resolve CI failures if any; obtain any required merge/release approvals; deploy using the established `mtechlabs-access-codes` Worker workflow only when gates pass; inspect owner-only UI; perform an owner-driven fresh Gemini read-only tool call; then record exact deployment version and callback recheck. Do not restart the initial source audit or assume a historical tool test is a real-time heartbeat.
