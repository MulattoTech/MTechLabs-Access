# Hub deployment and route recovery — 2026-11-06

## Deployed source and boundaries

The hub is the existing nginx container `mtechlabs-hub`, with its read-only web
mount at `C:\Tools\Dev\MTechLabs-Hub\site` and loopback listener
`127.0.0.1:20800`. The unrelated `home-portal` on host port 80 is the preserved
camera portal. Do not deploy hub files there.

This directory records the current `index.html`, `app.js`, `style.css`,
`monai.html`, nginx configuration, and Compose deployment configuration. Copy
web assets into the existing `site` directory when deploying, and copy
`compose.yml` / `nginx.conf` into the parent deployment directory only when their
changes have been reviewed. These configuration files are deployment snapshots;
they are not intended to run directly from this repository directory.

The separately maintained `site\mission-control` content and its existing
Grafana integration must be retained. No full-directory replacement is required
for a navigation update. Cloudflare's Access/Code Watch Worker and its admin
pages have their own deployment process; editing this hub does not deploy that
Worker or change application authorization.

`MTECH_HUB_TOKEN_FILE` identifies a protected existing token file. It contains a
path, not the token, and must remain host-local. Do not commit credentials or
copy the token into the served website. Validate Compose with
`docker compose -f compose.yml config --quiet` from the deployed directory.

## Current service-hub origins

Tunnel: `b790464f-ec87-492e-a13b-e534fee9e71d` (`mtechlabs-service-hub`).

| Hostname | Origin | Docker network |
|---|---|---|
| `m-techlabs.com`, `www.m-techlabs.com` | `http://mtechlabs-hub:80` | `mtechlabs-hub` |
| `tracker.m-techlabs.com` | `http://babytracker-sprout:3000` | `babytracker_default` |
| `tracker-preview.m-techlabs.com` | `http://babytracker-ocr-staging:3000` | `babytracker-ocr-staging_default` |
| `homebox.m-techlabs.com` | `http://homebox-homebox-1:7745` | `homebox_default` |
| `portainer.m-techlabs.com` | `https://host.docker.internal:9443` | Existing host route |

Fortnite uses its own dedicated tunnel and `127.0.0.1:4335`. MJobs and Fleet also
retain their independent tunnels. Homepage links do not grant access: the apex
and www hub remain owner-only, and each application retains its own policy.
Fortnite's two-account Google login acceptance is still pending.

## Repair evidence

The old Sprout production/preview routes targeted host ports 3123/3124, and
HomeBox targeted port 3100. All three refused connections from the hub network,
although their application containers responded successfully on their internal
ports. The repair attaches only the service-hub connector to those three
existing external networks and uses their container DNS names.

- Tunnel configuration version 3 at `2026-11-06T04:08:00Z` changes only the two
  Sprout service URLs. Independent structural comparison and the running
  connector's applied-configuration log verified this change.
- Version 4 changes only the HomeBox service URL from version 3. API readback
  verifies all other fields are unchanged. A probe from the actual connector's
  network namespace returned HomeBox HTTP 200 at `2026-11-06T04:15:43Z`.
- Both Sprout origins returned HTTP 200 from that same namespace. Their
  production and synthetic preview volumes remain separate and untouched.
- Existing Access guards, audiences, policies, Worker routes, public DNS,
  Portainer TLS handling, and the final 404 catch-all are preserved.
- The existing connector was attached to the networks without restarting it or
  any application. Compose now records these external attachments for recreation.

Public unauthenticated login redirects verify edge protection; they do not prove
successful application login. Origin HTTP checks prove the route and response,
not every application workflow. The originating Brave session is unavailable,
so no signed-in browser or camera-playback acceptance is claimed.

## Adaptive directory rollout — 2026-11-06

The current source includes an identity-filtered Worker-backed directory and
an owner-only Homepage visibility tab with global and per-approved-person
switches. Individual hides are stricter than (and cannot override) global hides
or app access grants. Its canonical app list is `src/hub-catalog.js`, not the
older static HTML snapshot. Update the Worker
first, then deploy just the three reviewed hub assets. The Worker uses the
existing `settings` D1 table and existing `/admin/access*` routes; no new
public route, OAuth provider, Access policy, secret, or database migration is
needed. No medical records or credentials enter the directory manifest.

Before copying static files: verify active host mount and live file hashes,
back up the exact originals, and compare for concurrent edits. After copying:
check the signed-in homepage, MBody launch link, owner visibility toggles,
the non-owner denied catalog test, search filters, and all original
Mission Control links. Preserve `mission-control` content and all unrelated
containers. A homepage API outage must show a recovery message, not a
client-side leak of private app links.

After every hub deployment or source-verification pass, back up and refresh the
host-local `C:\Tools\Dev\MTechLabs-Hub\deployed-source.json` receipt. Record the
canonical repository and exact verified commit, all six deployment files
(`index.html`, `app.js`, `style.css`, `monai.html`, `compose.yml`, `nginx.conf`),
the live/source SHA-256 values, line-ending-aware content equivalence, exact local
HTTP evidence for served assets, and the public Access redirect result. Windows
CRLF and Git LF can make raw hashes differ without a content change, so confirm a
text diff before declaring drift. The receipt is recovery evidence, not source;
never put tunnel tokens, cookies, OAuth secrets, private keys or other credentials
in it.

## Historical navigation update

The current index includes a Fortnite Studio private-preview shortcut and a
separate Sprout Track Preview shortcut in Apps. It preserves all 14 previous
cards and their 24 links, including Fleet Overview and Mission Control. Existing
search and category filters cover both new cards. Monai is labeled "Live video
unverified" because a listening media port alone does not establish playback.

For deployment, back up the current served files, confirm no intervening edits,
then copy only the reviewed changed files. Compare the served bytes at
`http://127.0.0.1:20800/` with the source commit and verify the public Access
redirects. Static bind-mounted content takes effect without restarting nginx.

## Recovery and remaining dependencies

Private host backups are under
`%LOCALAPPDATA%\MTechLabs\Hub-Deploy-Backups\20261106-sprout-routing`:

- `compose.before.yml` and `tunnel.before.json`: original pre-repair state.
- `compose.pre-homebox.yml` and `tunnel.pre-homebox.json`: working Sprout repair,
  before the HomeBox adjustment.
- Navigation backups and deployment verification records are retained alongside
  these files when the reviewed HTML is deployed.

Restoring old failed host-port URLs is not a useful service restoration unless
those host listeners have first been repaired. For a regression, inspect the
container, external network, and current origin response before choosing a
rollback. Network attachments do not create host ports; no new public listener
was introduced. Keep the existing application volumes, container ownership,
and access policies intact.

Docker Desktop and the Windows host must remain running; these external
application networks must exist when recreating the connector. No paid service
or new external data destination was added. Monai live video and interactive
application sessions still require their own verification.

## 2026-11-10 stale-tunnel reconciliation

`mjobs-devfleet-primary` is superseded infrastructure, not a current MJobs route:
`mjobs.m-techlabs.com` now resolves to the healthy `mjobs-windows-docker` tunnel,
whose origin is `http://api:8000`; the old tunnel still names the same hostname but
its historical `127.0.0.1:18701` origin has no listener and no DNS record targets
that tunnel.

`codexpro-oaksight` remains a legacy remote-config tunnel with a live DNS CNAME but
no connector. Its configured origin is `http://localhost:8787`; that port is now
owned by `C:\\Tools\\AO-Fleet-Control\\server.js`. Starting the old tunnel without
changing its origin could therefore publish the Fleet controller under the stale
OakSight hostname. Keep the tunnel down, keep Access protections unchanged, and do
not advertise the hostname as a working homepage service. This reconciliation did
not restart or delete either tunnel and did not modify DNS or Access policy.
