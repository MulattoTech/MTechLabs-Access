# Canonical plugin 0.2.3 independent release readback

**Verified: the saved release matches the independently approved candidate byte for byte across all eight files.**

- Plugin: `plugins_6aed1a85300481919559498b458ed278`.
- Prior release: `pluginrel_6af0cd87157c81919ee37775a27a5e65` (0.2.2).
- Observed release: `pluginrel_6af62cc94f208191ae197a1a9ae7aa65` (0.2.3).
- Scope and visibility: USER / PRIVATE, unchanged.
- Verification: 2026-11-12T21:17:52.593543+00:00.

The reviewer independently fetched the full inventory, then all eight source files. Both reads returned the same release. The inventory is complete, with no missing or size-limited files. Every returned file hash and byte count matches the approved candidate and the locally persisted source. The four omitted overlay files remain byte-identical to the previous release.

The manifests differ from the prior release only by the version literal. The App identity, MCP connection and OAuth DCR, presentation, full default prompt, assets, skill name and discovery path, package name, description, scope and visibility are preserved. The website release artifacts and generated module remain unchanged in the source checkout.

This establishes the actual plugin documentation and bundled-skill release. It does not establish activation in an existing conversation, OAuth repair, canonical-only authorization, a live tool call, website archive publication, runtime deployment, or safe wrapper removal. No such actions were performed by the reviewer. The protected App-owned long description's older removal/readdition wording remains a separate follow-up.

Approved source receipt SHA256: `dc7bc60a37054962d5aa1794cb5d4305048a9fc60718a6ab85d930c123d0f825`.
