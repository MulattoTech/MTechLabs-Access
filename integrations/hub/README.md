# Existing hub navigation integration

The deployed hub is the static site at `C:\Tools\Dev\MTechLabs-Hub\site`, mounted
read-only into the existing `mtechlabs-hub` nginx container. Its host listener is
`127.0.0.1:20800`; the existing Cloudflare Tunnel reaches `http://mtechlabs-hub:80`.
This source was verified through Docker mounts. The `MulattoTech/M-TechLabs`
repository was not assumed to be the deployed website.

## Current navigation snapshot

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
