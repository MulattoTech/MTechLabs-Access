# Existing hub navigation integration

The deployed hub is the static site at `C:\Tools\Dev\MTechLabs-Hub\site`, mounted
read-only into the existing `mtechlabs-hub` nginx container. Its host listener is
`127.0.0.1:20800`; the existing Cloudflare Tunnel reaches `http://mtechlabs-hub:80`.
This source was verified through Docker mounts. The `MulattoTech/M-TechLabs`
repository was not assumed to be the deployed website.

## Identity-filtered directory and visibility controls — 2026-11-06

The owner homepage at `https://m-techlabs.com` now loads its card directory
from `GET /admin/access/api/homepage`, using the existing Cloudflare Access
Worker and signed hub identity. Application names and URLs are not embedded in
the static HTML. The single manifest at `src/hub-catalog.js` lists all
user-facing apps and owner developer/integration services, including **MBody**
(`health.m-techlabs.com`) and **Tacticus Companion**
(`tacticus.m-techlabs.com`). Synthetic previews and non-interactive APIs
are explicitly identified; raw ingest endpoints are not linked.

The owner dashboard's **Homepage visibility** tab supports both site-wide
defaults and per-person hide/show choices. These are stored in the existing D1
`settings` table under `hub_visible:<card-id>` and
`hub_user_visible:<user-id>:<card-id>`; all new cards default to shown.
A site-wide hide always wins, then a person-specific hide can further narrow
the list. Neither setting changes Cloudflare or origin authorization.
The owner can restore any hidden card in the same tab. A
non-owner who is *separately permitted onto the hub* sees only enabled cards
whose registered application permission is also granted; owner-only and
unmanaged integrations never leak through the API. **The hub Cloudflare Access
policy itself is still owner-only.** Expanding that policy requires a separately
reviewed change, not a homepage toggle.

The nginx site still serves `index.html`, `app.js`, and `style.css` from
the read-only Docker mount. Its directory is now dependent on the
`mtechlabs-access-codes` Worker being healthy. When the Worker is
unavailable, a recovery message and direct Access Management link replace
the card list; the site's application links cannot be relied on until the
Worker recovers.

**Deployment sequence:** build/test/deploy the Worker first (no D1 migration),
verify the homepage JSON endpoint with the verified owner token, then back up
the served hub files and replace only `index.html`, `app.js`, and
`style.css`. Preserve `mission-control`, Compose, nginx, Docker networks,
tunnels, and all independent app volumes. Compare the source snapshot with
the served files and inspect the public homepage while signed in. Roll back
the three static files from a backup if navigation fails. Do not revert
application access policies to solve a catalog-only issue.

To add a future service, update `src/hub-catalog.js`, extend
`tests/homepage.test.js` for its hostname and audience, run `npm run check`
and `npm test`, deploy the Worker, and verify the homepage. Avoid advertising
a health check or a staging URL as a production-ready interactive app.

## Historical navigation snapshot (before adaptive directory)

`index.html` preserves the live hub navigation captured on 2026-11-06 and adds:

- **Fortnite Intelligence & Replay Studio** at `https://fortnite.m-techlabs.com`,
  as the first card in Apps & fleet control. Search for Fortnite, tracker,
  intelligence, replay, matches, stats, or players.
- **Sprout Track Preview** at `https://tracker-preview.m-techlabs.com`, as a
  separate card immediately after Sprout Track. It is explicitly labeled
  Preview and points to the preview host, while the production card keeps
  `https://tracker.m-techlabs.com`.

Both cards use the existing Apps filter, search behavior, styles, and link
pattern. All existing cards and navigation links are retained, including MCP
Manager and Fleet Overview / Mission Control. Status labels describe access or
preview context; they are not service-health probes. This navigation change
does not alter access policies or application permissions.

Deploy the reviewed `index.html` and any explicitly changed companion page to
the served `site` directory after backing up and
comparing the current live file. No container restart is required for this
static bind mount. If live navigation has changed since the snapshot, preserve
those newer changes before deployment. Restoring a reviewed backup removes
navigation changes only; it does not revoke access or change service routing.

[OPERATIONS.md](OPERATIONS.md) records the current Compose/nginx deployment
snapshots, preserved companion assets, direct Docker origin repair for Sprout,
Sprout preview and HomeBox, exact validation scope, and recovery locations.

## Historical Access / Code Watch integration

`navigation.patch` records the original two-card Access Management and Tacticus
Code Watch addition. It is retained as historical evidence and is not the patch
for the current snapshot.

The original file was backed up on the Windows host before that earlier edit:
`C:\Tools\Dev\MTechLabs-Hub\backups\index.pre-access-codes-20261031.html`.

The earlier deployed index SHA-256 was:
`50b93260c99fc6176615520efbdb49576a8662835657eb697d7c9c78329e309d`.

The access Worker, its dashboard and the Code Watch domain have separate
recovery steps in `docs/operations.md`.
