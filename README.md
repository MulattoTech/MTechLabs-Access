# M-TechLabs Access Control and Tacticus Code Watch

A deployed Cloudflare Worker and D1 database provide an owner access dashboard,
application authorization gates, and a deterministic Tacticus code tracker for
**Warhammer 420k**. Normal operation makes no OpenAI, Codex, Claude, Gemini or other
model-inference calls.

**The owner dashboard and Code Watch are live. Google sign-in is not configured:**
the real Google OAuth client ID and secret have not been supplied. Existing
Cloudflare owner authentication remains available, and its original identity
provider and owner policies were preserved. See [the acceptance record](docs/acceptance.md)
for the exact boundary between deployed, tested and unfinished work.

**Protected Code Watch is currently usable only by the owner.** Google sign-in is
not yet configured and shared guild access remains disabled until the owner sets
its passphrase. The guild rollout therefore remains incomplete.

## Open the services

| Interface | Address |
| --- | --- |
| Owner access dashboard | <https://m-techlabs.com/admin/access> |
| Tacticus Code Watch | <https://codes.m-techlabs.com> |
| Public health response | <https://codes.m-techlabs.com/health> |

The Code Watch landing page is public. Its code-data and member-action APIs require
an authorized application session. The dashboard requires the verified owner’s
Cloudflare Access identity and application audience.

The initial live import contains **811 distinct codes**: 163 corroborated,
44 disputed, 552 expired, 14 likely active and 38 unverified. These are the
application’s evidence classifications, not a claim that every code was redeemed
successfully in the game. Four enabled adapters across three independent domains
completed successfully. The initial import and all 13 historical seed codes were
suppressed from new-code notifications.

## What each layer does

Cloudflare Access verifies identity and controls perimeter admission. The Worker
validates the signed Access token for the expected team and application, then
checks the current D1 user state and the specific application grant. Approval of
an account alone grants no application access. Guests never become Cloudflare
account administrators.

The owner’s original Cloudflare login remains independent of Google. The owner
dashboard cannot demote, suspend or reassign the recovery owner. Browser changes
require a host-scoped secure session, the exact request origin and a session-bound
CSRF token. Application cookies are Secure, HttpOnly and host-only; grants and
session revocation state are checked server-side without a stale permission cache.

### Registered applications

The canonical inventory and Cloudflare resource identifiers are in
[`deployment.json`](deployment.json). The live website was traced through its
actual Cloudflare tunnel and Docker mounts. Two navigation cards were added to
that existing static hub, with a backup and exact patch under `integrations/hub/`.
This repository does not replace all existing application source trees.

| Application or hostname | Integration in this release |
| --- | --- |
| `m-techlabs.com`, `www.m-techlabs.com` | Owner-only hub/recovery surface; not delegated |
| `codes.m-techlabs.com` | Native Code Watch sessions, permissions and individual tracking |
| `tracker.m-techlabs.com` | Application entry gate; BabyTracker’s internal roles remain its responsibility |
| `tracker-preview.m-techlabs.com` | Separate preview entry gate; origin returned an HTTP failure before and after the gate |
| `homebox.m-techlabs.com` | Application entry gate; HomeBox retains its login and roles |
| `portainer.m-techlabs.com` | Application entry gate; Portainer retains its login and roles |
| `mjobs.m-techlabs.com` | Application entry gate; MJobs retains its internal authorization |
| `fleet.m-techlabs.com` | Application entry gate; its tunnel was already offline during discovery |
| `academy.m-techlabs.com` | Existing owner-only service; not delegated through this dashboard |
| `feeds.m-techlabs.com` | Existing device-pairing authentication retained; dashboard grants do not manage paired devices |
| `codexpro-widgets.m-techlabs.com` | Existing public widget origin; not a delegated private application |
| `codexpro-oaksight.m-techlabs.com` | Existing separately authenticated MCP origin; tunnel was offline during discovery |

For legacy gates, the dashboard offers **Access allowed** or **Denied**. An access
grant does not make someone a viewer, editor or administrator inside that product.
For Code Watch, **Viewer** can browse, refresh and maintain a personal redeemed
checklist, but cannot submit a public player report. Individually approved Guild
Member, Editor, Operator and Administrator roles can also report redemption
results. Those higher labels do not grant source, guild or owner administration;
additional distinct operator/editor/delegated-administrator capabilities require
explicit backend implementation before being advertised.

## Owner workflows

### Add Ashley or another individual

1. Open **People & permissions** in the owner dashboard.
2. Enter the person’s exact confirmed Google email and a display name. Ashley’s
   email has not been supplied or guessed, and no account or grant was created for her.
3. Choose **Pending review** or **Approved**. Leave **Apply the configured
   invitation defaults** unchecked unless the configured defaults are intentional.
4. In the application-permission matrix, assign only the applications that person
   should use. Leave the others denied.
5. After Google setup and a successful login test, share the intended application
   link yourself. **The dashboard does not send an invitation email.**

The public request form records an unverified pending request. It does not prove
ownership of the submitted email, create an authenticated session or grant access.
Google identity ownership is established during the eventual Access login.

**Groups & defaults** manages membership, group grants and optional invitation
defaults. An explicit per-person grant takes priority over group inheritance.
An explicit per-person denial blocks group access; without a direct setting, any
inherited denial defeats inherited allows. Defaults are copied only when selected
while adding a person and do not change existing users.

### Revoke access

Set the person’s status to **Suspended**, **Denied** or **Revoked** to block all
authorized applications, or set a specific application to **Denied**. Protected
HTTP requests consult the current decision. **Revoke sessions** invalidates the
person’s application sessions and rejects older Access tokens at the gateway until
a fresh sign-in. It does not disconnect an already-open legacy WebSocket or erase
independent native-product sessions; use the corresponding product’s controls
when those connections must be terminated immediately.

**Activity & sessions** shows application sessions, gateway activity and recent
Worker-visible audit events. Successful gateway activity is recorded at most once
per five minutes per person/application. Requests rejected by Cloudflare before
reaching the Worker belong in Cloudflare Access logs and are not automatically
imported into this dashboard.

### Enable or rotate the guild passphrase

Guild access is disabled at handoff (version 0, no stored passphrase hash). In **Guild access**, choose **Generate a strong
passphrase**, copy the generated 48-character value securely, enable shared guild
access and save. The generator runs in the browser; the server stores only a salted
PBKDF2-HMAC-SHA256 hash. The accepted length is 16–256 characters.

Saving rotates the guild session version and revokes old guild sessions. Disabling
guild access also blocks them. Guild sessions last four hours and grant Code Watch
access only. Their redeemed checklist belongs to that session; a shared passphrase
does not identify one person. Approved individual accounts retain their checklist
across sessions/devices. Only individual accounts with a reporting-capable role can submit global player reports;
checking **Mark redeemed** never verifies a code globally.

The backend rotation/isolation tests pass. The attempted automated live guild test
was blocked by Cloudflare WAF error 1010 before a temporary passphrase was set, so
the live sign-in/rotation check still needs to be completed through the owner UI.

### Finish Google sign-in

This is the remaining credential-dependent integration, not an automatic effect
of adding an email to the dashboard.

1. Create a Google OAuth **Web application** client using the owner’s Google Cloud
   project and the intended sign-in audience.
2. Add this exact authorized redirect URI:

   ```text
   https://broken-breeze-d0bb.cloudflareaccess.com/cdn-cgi/access/callback
   ```

3. Enter the actual client ID and secret directly in Cloudflare One’s Google
   login-method setup. Keep the existing Cloudflare owner provider enabled. Do not
   commit credentials or paste the client secret into chat.
4. Follow [`docs/operations.md`](docs/operations.md) and run
   `scripts/finish-google.mjs` first as a dry run, then with `--apply`, using the
   real Cloudflare Google provider ID. It attaches Google to the seven managed
   applications and requires Google on their existing central evaluation policies,
   while preserving the original owner provider and policies.
5. Test an approved account with one grant, denial at another application, session
   revocation, and a fresh owner recovery login. The script records configuration
   completion after verifying the API changes; a real Google login is still a
   separate acceptance check.

The settings flag controls the displayed setup state; it does not provision or
verify the Google provider. The **Sign-in setup** panel displays the callback and
links to Cloudflare authentication settings.

Policy template for the Code Watch application; use the matching registered app
ID in the evaluation URL for another application:

```json
{
  "name": "Central application grants",
  "decision": "allow",
  "include": [{
    "external_evaluation": {
      "evaluate_url": "https://codes.m-techlabs.com/__access/evaluate/codes",
      "keys_url": "https://codes.m-techlabs.com/.well-known/access-evaluation-keys"
    }
  }],
  "require": [{"login_method": {"id": "<verified-google-idp-id>"}}]
}
```

Cloudflare’s real signed evaluation request/response protocol has been tested.
That does not substitute for an end-to-end Google login, which remains blocked
until real credentials and the provider are configured.

## Code Watch behavior

The enabled sources are Tacticus Codex’s public JSON endpoint, the wiki’s current
year announcement table, the wiki’s evergreen list and Pocket Gamer. The two wiki
pages count as one independent domain. GamesRadar is implemented but disabled by
default because its large HTML response needs a CPU-budget check. Official Discord
reading requires an authorized bot; the owner’s manual-submission form is available
for announcements that cannot be collected automatically.

Cron is configured as `*/30 * * * *`. A real owner-triggered production scan
succeeded; observing a timer-triggered invocation is a separate acceptance check.
A second live manual scan completed successfully. A second browser tab immediately
requested another scan and received cached data with the active cooldown; only one
new scan was recorded. The visible refresh button uses a server-enforced 15-minute global cooldown and an
atomic D1 lease shared with scheduled checks. Concurrent clicks use the cached list
and one shared scan. Per-session/IP limits and upstream backoff add abuse control.

Codes are deduplicated case-insensitively. Source health, last successful checks,
rewards, provenance, status, expiry evidence, history and personal redeemed state
are persisted. Publication corroboration differs from player-confirmed redemption.
Conflicting claims are shown as disputed; absence from a source never proves expiry.
The first import, first imports of newly enabled sources and the 13 historical
seeds cannot create new-code announcements. A notification ledger exists, but
**no Discord webhook/bot or email delivery is connected**.

Source snapshots are hashed. An unchanged snapshot updates one source row rather
than every archived code. Generation tracking prevents removed listings from
remaining fresh through later successful checks. See [source details](docs/sources.md)
and [security responsibilities](docs/security.md).

## Development, deployment and recovery

GitHub source: [MulattoTech/MTechLabs-Access](https://github.com/MulattoTech/MTechLabs-Access) (private).
Implementation review: [pull request #1](https://github.com/MulattoTech/MTechLabs-Access/pull/1).
The hosted workflow could not start because GitHub reported an account payment/spending-limit restriction; its failure is not a failing code test. No account billing settings were changed.

Node.js 24 or newer is required for the SQLite-backed tests. There are no runtime
package dependencies or required model API keys.

```sh
npm test
npm run check
npm run build
```

The verified suite passes **69 tests** in the development environment and from the
GitHub clone at `C:\Tools\Dev\MTechLabs-Access` on the owner's Windows machine,
covering JWT signatures and
audiences, CSRF, owner boundaries, application isolation, revocation, guild sessions,
code evidence, parsing, concurrency and snapshot write budgets. Actual Worker
request tests verify Viewer report denial, retained personal checklist/refresh,
reporting-capable roles, live role downgrade, shared-guild denial and CSRF. `npm run build`
embeds the five files under `public/` into `src/ui.generated.js`; regenerate it after
UI edits. Unit tests do not replace real Google login. Both the desktop Code Watch and the owner dashboard were verified visually.
The two interfaces were also inspected at a 390-pixel mobile viewport; their
document widths stayed within the available viewport.

`wrangler.jsonc` records the Worker, D1 binding, environment values and Cron trigger.
`deployment.json` records the existing application inventory and Cloudflare IDs.
DNS, custom domains, Access applications/policies and legacy Worker routes also
exist in Cloudflare; do not assume the Worker manifest alone recreates that entire
configuration. Preserve the `DB` binding and the `EVALUATION_PRIVATE_JWK` Worker
secret when deploying. Never put private signing keys or OAuth secrets in Git.

Before future changes, export current routes/policies, retain the previous Worker
version and record a D1 recovery point/export. The discovery configuration is in
[`docs/discovery-2026-10-30.json`](docs/discovery-2026-10-30.json). Database data survives
Worker restarts/redeployments, but schema changes require deliberate migrations;
`CREATE TABLE IF NOT EXISTS` does not add columns to existing tables.

For a faulty new Worker version, roll back that Worker deployment while preserving
D1. For a legacy gateway rollback, first remove any newly delegated allow policy
and revoke affected delegated Access sessions; verify owner-only admission before
removing the new route to restore the original Access-protected origin. Keep the
original owner provider and policy. The owner-root gateway removal/restoration
mechanism was tested; a full recovery drill for every origin and future Google
session state has not been performed.

## Operating cost and remaining checks

No paid plan upgrade was made. The zone’s Free plan was verified, and the account
default/Worker usage model is **standard**. The Workers billing/subscription query
returned 403, so **an exact existing account bill or a guaranteed $0 bill cannot be
asserted**. Workers plan status is separate from the zone plan.

Official published Free allowances include 100,000 Worker requests/day, 10 ms CPU
per invocation, D1 five million rows read/day and 100,000 written/day. D1 Free has
500 MB per database and 5 GB total account storage. Workers Paid starts at
$5/account/month, with included usage and metered overages. Check the current
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) against the actual
account before making a cost promise.

A 1,200-observation test followed by 48 unchanged scans measured 288 SQLite row
changes and nine D1 calls per scan with two sources; four sources add two source-row
updates per scan. Index billing, changed snapshots, user activity and other
applications are additional. Production observability recorded successful standard
usage executions at **66 ms CPU for the baseline scan, 33 ms for a code-list request,
17 ms for owner bootstrap and 8 ms for authentication**. Several paths exceed the
published 10 ms Free allowance; this deployment must not be described as proven
Free-plan-compatible. These measurements do not yet cover live guild PBKDF2. Monitor
ongoing metrics and the actual account bill. Failed/stale scans must remain visible;
do not bypass authorization or silently purchase a higher plan to hide a limit.

Outstanding acceptance items include real Google credentials/login tests, Ashley’s
confirmed account and chosen grants, observation of scheduled execution, live
guild verification/activation by the owner, billing confirmation, and the previously
unavailable Fleet/preview origins. Full details are tracked in
[docs/acceptance.md](docs/acceptance.md).
