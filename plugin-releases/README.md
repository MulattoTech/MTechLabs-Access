# Private MTerm-CLI ChatGPT plugin recovery download

The owner-only website serves this archive after verified Cloudflare owner identity at
`/admin/mcp/plugin/latest.tar.gz`. The pinned metadata and SHA-256 are at
`/admin/mcp/plugin/latest.json`. Neither route is an account OAuth authorization operation.

## Canonical release reconciliation — 2026-11-19

The installed canonical personal ChatGPT plugin is **MTerm-CLI 0.2.3**,
release `pluginrel_6af62cc94f208191ae197a1a9ae7aa65`.
The complete current Plugin Creator release was inspected through the owner's
plugin connection: all eight readable source files matched the reviewed
`integrations/m-techlabs-desktop` files exactly.

`mterm-chatgpt-v0.2.3.tar.gz` is an explicitly labeled **source-equivalent
repack** of those eight canonical files, constructed using
`node scripts/package-canonical-plugin.mjs`. It is **not** asserted to be a
byte-identical download of Plugin Creator's original tar.gz; compressed archive
bytes may differ even when extracted plugin files match exactly.
`current.json` records the distinct sha256 and provenance. Tests validate all
eight extracted files, the manifest version, existing App dependency, canonical
remote MCP endpoint and OAuth DCR setting.

No App binding, Cloudflare Access policy, credential, provider grant, or installed
private plugin was changed by the website recovery archive reconciliation.
The older 0.2.1 archive is retained as historical source; the latest endpoint
updates only when a reviewed Worker version is deployed and read back.

## Future updates

Prefer retrieving the exact current published plugin archive using the
authenticated owner tool, verifying its release/version, and publishing that
archive byte-for-byte. If the original compressed bytes cannot be safely
materialized, an explicitly provenance-labeled source-equivalent repack is
permitted **only** after all canonical release files have been directly compared
with the checked-in source. Never silently substitute a repack while claiming an
exact original archive.

Pin the checksum, verify the file allowlist and no embedded service credentials,
run `npm run build && npm run check && npm test`, and confirm exact-head CI before
deploying. Read back both owner and anonymous download endpoints. This archive
does not reset ChatGPT account consent, create a native reconnect button, or
prove the original plugin can work without its Live Connection App binding.
