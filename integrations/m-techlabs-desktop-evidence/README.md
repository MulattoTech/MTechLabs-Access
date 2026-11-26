# Canonical ChatGPT plugin source and recovery release

The sibling `m-techlabs-desktop` directory records the exact eight source files
read back from the canonical private ChatGPT plugin. This reconciles the older
repository-only 0.2.0 manifest with the actual package, rather than treating that
older manifest as the installed source of truth.

## November 12, 2026 release

- Plugin: `plugins_6aed1a85300481919559498b458ed278`.
- Previous release: `pluginrel_6af0cd87157c81919ee37775a27a5e65`, version 0.2.2.
- Published release: `pluginrel_6af62cc94f208191ae197a1a9ae7aa65`, version 0.2.3.
- Scope and audience: personal `USER`, `PRIVATE`, unchanged.
- App: `asdk_app_6af0c8a4c2b08191bf5c00d3b4f18dbb`, unchanged.
- Source update: README, the existing connection-recovery skill, and version
  literals in both manifests. Every other current-release file and protected
  manifest field was preserved.

The revised guidance preserves working connections when a reconnect control is
absent, removes a hardcoded workstation path, uses a bounded metadata check on an
authorized file, and scopes any success to the actual chat/tool path tested.
The stale README version is replaced with the manifest as the version authority.
The skill keeps its existing name and portable discovery location.

Independent prepublication review validated all eight original and candidate
files and the exact four-file overlay ZIP. Its SHA256 is
`52478365b17e03aaa46cc752829ff7f3898198a0473615b79b041af9b63812bc`.
The guarded update supplied the observed previous release ID, and a fresh readback
verified all eight resulting files against the reviewed candidate. JSON and skill
frontmatter YAML parsed successfully. Root build, syntax checks and 123 tests
passed. No test assertions or product runtime modules changed.

## Evidence and boundaries

The dated evidence directory contains before/after source, the upload result,
byte/hash validation, independent reviews and the complete local root test output.
It contains configuration identifiers and public service URLs, not credentials.

The earlier audit's proposed Unicode repair was rejected after inspection: both
manifests decode to the same U+2013 en dash. No such presentation defect is claimed.
The App-owned long description still mentions removing/readding. Its presentation
fields are protected by the supported App-backed plugin update boundary and were
preserved. A presentation rewrite requires the owning App's release channel.

The pinned website archive under `plugin-releases` remains a separate 0.2.1 source
artifact; its generated module and all serving code are unchanged. This release
does not publish a website download, restart the manager or Tunnel, alter OAuth
policy or reset account consent. Canonical-only authorization, real ChatGPT UI
rendering, wrapper removal, and the broader CLI issues 209/246 remain unverified.
No new personal skill or replacement plugin was installed.

For a future edit, inspect the current plugin release first. Compare against that
release, preserve App/MCP/presentation/audience, package only supported changes,
use its exact expected release ID, and verify the resulting stored source. Do not
publish this repository snapshot over a newer plugin release without reconciliation.
