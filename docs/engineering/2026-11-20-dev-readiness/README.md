# DEV readiness inventory and provisioning proposal — November 20, 2026

This is the approved read-only continuation after Access36/PR37. The inventory
identifies the working production bridge and the changes needed for an independent
DEV bridge. It also records one source compatibility correction in
[Access38](https://github.com/MulattoTech/MTechLabs-Access/issues/38): the runtime
plan can now describe production's existing origin Host rewrite. No production
route or manager request allowlist changes as a result.

The source base is actual main `65f7c2ce59653fe905244fc8c2476f15157ca235`, tree
`f2b1d75728a4801831fdc280c16090cdedf56723`. The existing
[engineering checkpoint](../2026-11-12-cross-repository-checkpoint.md) remains the
continuation index. This document is a bounded delivery record and planning input.
The proposal is **not an executable runtime plan or activation authorization**.
DEV remains unqualified and upstream-disabled.

## Observed production and existing staging

The successful host observations were collected on November 20 between
07:56:49 and 08:04:00 UTC (01:56:49–02:04:00 America/Chicago). Cloudflare provider
reads span 07:55:14–08:00:49 UTC. All observations are point-in-time.

| Area | Observation | Limit |
| --- | --- | --- |
| Production manager | `MULATTOTECHBOX`, `127.0.0.1:19740`, PID33108. Native token/profile observation identifies the existing Dylan account and `C:\Users\Dylan`. | The exact executable, entry and config invocation matched while the native observer retained/rechecked the process. This does not attest loaded source bytes. |
| Invocation | `C:\Program Files\nodejs\node.exe`, `H:\MTechLabs\MCP\runtime\admin.mjs`, literal `--config`, `H:\MTechLabs\MCP\state\manager.json`. | Full private command lines are omitted. Current-file hashes and the stored deployment commit are separate evidence. |
| Installed packages | Manager0.4.0 and Desktop Commander0.3.1. Stored deployment record names commit `9373fadc00689dd782143ab5e49664536f460b8b`. | The record is not running-source attestation. Source CI for0.3.3 does not mean it is deployed. |
| Production token storage | Selected token file has digest-only format; its value was not returned. | This does not authorize reading it from DEV or changing its ACL. |
| Production edge | `mcp.m-techlabs.com/*` uses Worker `mtechlabs-access-codes`; its manager origin is `https://mcp-origin.m-techlabs.com`. | Provider configuration is distinct from a new end-to-end route test. |
| Production tunnel | Tunnel `27c6a2b0-4565-4372-b9fb-32e393a9b3fd` declares `mcp-origin.m-techlabs.com` → `http://127.0.0.1:19740`, with Host `mcp-origin.m-techlabs.com`. | Provider status was healthy. That alone does not establish OAuth or routed runtime identity. |
| Production Access | App `1cadb445-7786-4f0c-bc5b-3ba175643ec9`, managed OAuth/DCR enabled, one owner allow policy. | App AUD and structural policy/OAuth settings are in the sanitized provider inventory; no secret or policy-selector values were returned. |
| ChatGPT plugin | Plugin0.2.3, release `pluginrel_6af62cc94f208191ae197a1a9ae7aa65`, points to `https://mcp.m-techlabs.com/mcp`. | Canonical plugin and Live Connection share App `asdk_app_6af0c8a4c2b08191bf5c00d3b4f18dbb`. Both are enabled here, so the successful tool path does not prove a canonical-only grant. |
| Existing staging | Worker `mterm-gateway-staging`, public `mcp-staging.m-techlabs.com`, dashboard `mterm-staging.m-techlabs.com`, its own registry Durable Object and dashboard Access app. | This is the separate CLI gateway staging architecture. It is not the proposed Access DEV manager and will not be repurposed. |
| Port4320 | Existing listener PID22448, process metadata mentions Fleet, and a script-free local HTTP read returned a Fleet Control page title. | It is not evidence of an independent MTerm DEV manager. |

The later optional host follow-up returned an internal connector error. Its
execution outcome was not observed and it was not retried. Startup shortcut
details, the `H:\` drive-root ACL, deployment completion time and exact
absent-versus-unreadable classification for newer installed DEV source files
therefore remain unverified. Earlier successful observations are retained with
their own timestamps; the final error does not establish a production outage.

## Proposed DEV target and unresolved allocations

[provisioning-proposal.json](provisioning-proposal.json) deliberately has a
different shape from `dev-runtime-plan.json`. Unknown IDs are `null`; names and
paths marked as proposals are not reservations or measured identity.

| Component | Concrete proposal | Present state / prerequisite |
| --- | --- | --- |
| Windows identity | New local account `MTermDev`; expected profile `C:\Users\MTermDev`. | Account lookup returned UserNotFound and the proposed profile directory was absent. Capture the actual SID and OS-created profile after approved provisioning; do not synthesize them. |
| Installation | `H:\MTechLabs\MCP-DEV\runtime`, separate `node_modules`, and `state\manager.json`; instance ID `dev-local`. | Root absent. This location is conditional on qualified production/ancestor ACL protections. Moving DEV alone would not remove its inherited access to production on H:. |
| Manager endpoint | `127.0.0.1:19741`; existing trusted Node binary subject to file/ancestor permission qualification. | No TCP listener candidate was observed on19741. The port is not reserved; recheck listener and OS bind restrictions before use. |
| Public resource | `https://mcp-dev.m-techlabs.com/mcp`. | No exact DNS record, Worker custom-domain assignment or Access app was returned. Recheck at provisioning time. |
| Backend origin | `https://mcp-dev-origin.m-techlabs.com/mcp`. | Likewise unallocated at observation. Public and backend origins remain distinct from each other and production. |
| Tunnel | Dedicated proposed tunnel `mterm-dev`, target `http://127.0.0.1:19741`, Host exactly `127.0.0.1:19741`, unmatched ingress404. | Name/ID and credential unallocated. A dedicated DEV tunnel avoids editing the working production tunnel's ingress. Its credential, process identity and startup still require qualification. |
| Edge Worker | Proposed distinct Worker `mtechlabs-mcp-dev`, limited to the DEV resource/metadata paths. | Name not reserved. Existing source cannot be enabled for DEV by changing DNS or environment variables alone. |
| Authorization | New DEV Access App/AUD, separate owner policy and separate authorization state; managed OAuth configured for verified client callbacks. | IDs and allowed client registrations are unallocated. Do not attach production D1 credentials or modify the shared production policy. |
| Connector | New DEV connector App/registration and fresh per-client grants. | App/grant IDs unallocated. A new display name or plugin key does not establish separation. |
| Backend credential | Independently generated DEV bearer, digest-only manager file and DEV-only Worker secret binding. | Not generated or read. Effective credential separation must be checked inside an authorized observation context without exporting the production digest. |
| Runtime identity | Distinct immutable backend registration plus authenticated process/source binding. | Neither a production nor DEV immutable backend ID was observed. A PID, display label or manually invented backend ID is insufficient. |

The same Cloudflare account/zone can be used while retaining distinct resources.
Separate accounts are not a requirement of the current source contract. The
dedicated tunnel is a proposed operational choice, not a claimed existing resource.

## Why creating a user is insufficient

Production state is protected: its DACL allows the owner and SYSTEM, and the
config/token inherit that protection. The current runtime inspector directly
opens production config, digest and other reference metadata. A restricted new
user should fail those reads. Granting broad production access, elevating DEV,
enabling debug privileges or substituting a convenient copied config would not
establish the intended boundary.

The other direction is also unresolved. `H:\MTechLabs` and
`H:\MTechLabs\MCP` inherit **Authenticated Users Modify**, with inheritable
descendant access. A new standard account belongs to that broad principal.
Protecting only the state subdirectory does not protect production executable
code or the ancestor namespace. The unobserved drive-root ACL also needs review
for delete-child/rename paths. The existing `Developer` account has an explicit
FullControl grant on the owner's profile and must not be reused as the restricted
DEV identity.

Before account activation, prepare an exact current-versus-proposed ACL manifest
for the selected DEV paths and every relevant production ancestor, including
owner/group membership, inheritance, effective write/delete/rename/control rights,
reparse/hardlink checks and a saved restoration manifest. Preserve legitimate
owner/SYSTEM access and unrelated workloads. The appropriate explicit DACL
changes cannot be finalized from the incomplete drive-root observation. No ACL
or account change is part of Access38.

Verify denials using the actual DEV token against disposable canaries with the
intended permissions and qualified access-check mechanisms; do not modify live
production files just to demonstrate denial. Check that DEV cannot change
production runtime, configuration, credentials, trusted registration or ancestors,
and cannot access the owner profile through another group grant. A successful
read-only inspector report is not a substitute for these effective-access tests.

## Source prerequisites before provisioning

### 1. Restricted authoritative production observation

Replace the direct production-file dependency with a separately reviewed,
bounded observation interface. The production-authorized side must select a
protected registered target; the DEV caller must not choose arbitrary production
paths or commands. Bind each result to the actual config/topology snapshot,
intended DEV instance and config/plan fingerprints, a fresh request nonce and a
bounded lifetime. Authenticate the channel or receipt against a trust anchor
outside DEV-controlled storage.

The authorized side performs canonical topology/hardlink checks, digest-format
and effective-credential comparisons, and retained-handle process/listener checks.
Return constrained comparison results without production bearer/digest values.
The DEV side still measures its own calling process token/profile and rejects
preload/profile redirection. Expired, replayed, mismatched, denied or unavailable
observations stay unverified.

Observer code, registration and trust material cannot be trusted while DEV can
modify their installation or ancestors. A valid signature also does not prove
loaded source, ongoing liveness, account isolation or route/grant readiness.
This interface must preserve the fixed false activation flags until those other
gates have separate evidence. See
[the current reader](../../../integrations/mcp-manager/lib/dev-runtime.mjs) and
[foundation isolation checks](../../../integrations/mcp-manager/lib/dev-instance.mjs).

### 2. Closed DEV edge mapping and owner authorization

The existing [Worker entry](../../../src/index.js) recognizes the literal
production MCP hostname. The [remote adapter](../../../src/mcp-remote.js) pins
the production resource, challenge metadata and browser origins, while
[manager configuration](../../../src/mcp.js) pins its backend origin. An extra
DNS record does not produce a valid DEV route.

Implement and qualify a separate entry/descriptor binding all of these together:
the exact DEV public origin/resource and metadata path, Access issuer/AUD,
backend origin, backend credential and isolated authorization state. Reject
unknown hosts, incomplete allocations and mixed-environment mappings before
database lookup or backend fetch. Preserve owner identity plus `approved`,
`is_owner` and `revoke_before` checks. Preserve bounded bodies/responses, manual
redirect refusal, no automatic POST retry, explicit uncertain outcomes and
private trace filtering. Do not include website application-grant fallback,
production scanner/cron work or production D1 in the DEV entry.

Forward only rebuilt backend headers with the independent DEV bearer. Caller
OAuth/Access assertions, cookies, Origin and forwarding headers remain excluded.
If origin Access protection is added, design its service authentication explicitly;
the current adapter intentionally does not forward the caller's Access assertion.
Do not enable an incompatible origin requirement and assume it will work.

Cloudflare documents that `httpHostHeader` controls the origin Host, that JWT
validation must bind the intended application audience, and that managed OAuth
uses the application's Access policy. Policies can be shared, so editing a reused
production policy affects its other applications. A new independent DEV policy
avoids that coupling; the legacy staging policy cannot simply be attached to a
new app. Primary references:
[tunnel origin parameters](https://developers.cloudflare.com/tunnel/reference/origin-parameters/),
[Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/),
[policy management](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/).

### 3. Upstream roots and qualified lifecycle

The bounded installed0.3.1 source scan found home-derived tool history, fuzzy
search logs, remote-device state/logs and PDF/browser profile handling. It also
found APPDATA/LOCALAPPDATA/USERPROFILE use. These are source observations, not a
complete override audit or evidence that every path is used by the current bridge.
Inspect the selected control/candidate package's full configuration, log, browser,
cache and temporary roots, then exercise it under the actual DEV token with
disposable inputs and attributable write/cleanup evidence. Environment HOME
rewrites alone do not establish an independent OS profile.

The current DEV wrapper only supports Inspect/Status. Start/Install/Open are
refused. Qualify a separate launcher and startup identity, exact process ownership,
quiescence, crash/uncertain-job recovery and rollback before any operational
activation. Directly invoking the portable admin entrypoint is not a shortcut
around this gate. Manager job providers are a separate execution surface;
upstream-disabled does not mean all possible manager work is disabled.

## Provisioning order and acceptance evidence

| Stage | Required concrete output before proceeding |
| --- | --- |
| Source preparation | Restricted observation contract and implementation, closed DEV edge entry, qualified launcher, immutable independent review and exact candidate/actual-main CI. No live changes. |
| Operational preparation | Fresh account/path/port/route inventory; exact ACL and startup manifests, backup/restoration references, deployment source hashes and explicit allocation payloads. Resolve the unobserved H: root ACL and startup details. Present the concrete account/ACL/credential/Cloudflare changes for separate approval under the mission's operational boundary. |
| Local provisioning after approval | Create the dedicated account/profile and protected installation/state; record actual SID/profile, effective groups/rights and denied cross-account access. Install exact immutable DEV bytes and separate dependencies; keep upstream and job execution disabled pending qualification. |
| Identity and roots | Verify observer authority, DEV token/profile, canonical disjoint controls and effective credential separation. Exercise actual upstream roots only within the separately approved disposable qualification scope; retain no-production-write and cleanup evidence. |
| Edge resources after approval | Allocate dedicated tunnel/credential, isolated authorization state, Worker, exact DNS/route, Access App/AUD/policy and managed OAuth. Record returned IDs; preserve production/staging declarations. Allocate the connector App and grants separately. |
| Routed qualification | Bind a fresh authenticated response to intended DEV process creation identity and immutable deployed source. Test positive DEV routing plus wrong token/AUD/App/resource/origin/backend/grant denial and production-to-DEV/DEV-to-production rejection. No secret values in receipts. |
| Client qualification | Test canonical-only ChatGPT separately from the existing Live Connection; independently verify Claude.ai, Gemini and each supported custom-client flow. The current browser Origin allowlist covers ChatGPT/Claude, not explicit Gemini origins; a Google OAuth callback does not prove transport behavior. |
| Activation gate | Only after local isolation, upstream roots, exact running source, live routing/grants and launcher/recovery pass may a separately reviewed change enable DEV upstream. Preserve explicit unknown outcomes and a working recovery path. |

For DEV rollback, stop accepting new DEV work, drain known owned operations and
record uncertain work before releasing ownership. Disable/revoke only the newly
allocated DEV grants/routes/credentials, stop only the exact verified DEV-owned
processes and retain protected evidence. Restore only the approved recorded ACL
changes after checking that no unrelated owner changes occurred. Do not fall back
to production credentials, kill listeners by port alone, infer a stale lock solely
from elapsed time, or remove production/staging resources.

## Host declaration correction and qualification

The original strict validator required loopback Host for both roles, rejecting
the actual production tunnel declaration. The correction permits production's
exact canonical declared-origin hostname or `127.0.0.1:19740`. DEV remains exactly
`127.0.0.1:<configured-port>`. It changes only plan validation; runtime Host/Origin
allowlists, provider settings and all fixed false readiness flags are unchanged.

The frozen new regression has SHA-256
`22ba217c175238b11e1352a5fe45771ca83f38c4a9186e95603f74c8f14aced7`.
It produced seven passes and three expected assertion failures on exact original
main, then ten passes unchanged on the corrected source. Independent review also
ran the existing141 pure-plan tests plus these ten:151/151 passed. Source/test
authorship and limitations are disclosed in the retained receipts.

The files beside this document contain sanitized provider/host/plugin evidence,
the non-executable proposal, frozen RED/GREEN and local validation receipts.
The complete immutable source review, candidate/main Actions runs and artifacts,
normal merge, claim release and closure are recorded on
[Access38](https://github.com/MulattoTech/MTechLabs-Access/issues/38) after those
gates complete. They are pending at preparation of this source commit. Nothing
here awards whole-product CLI/DCP/WEB acceptance or declares a real DEV bridge.

Existing dependencies remain
[CLI209](https://github.com/MulattoTech/MTerm-CLI/issues/209) for canonical-only
grant evidence, [CLI246](https://github.com/MulattoTech/MTerm-CLI/issues/246) for
actual staging/UI metadata qualification, and
[CLI260](https://github.com/MulattoTech/MTerm-CLI/issues/260) for delivery-accounting
reconciliation. Their acceptance must follow their own evidence.
