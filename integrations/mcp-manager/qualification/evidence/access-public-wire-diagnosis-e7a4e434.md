# Access e7a4e434 hosted protocol diagnosis

**Current head remains blocked for qualification.** Both exact tarballs remove internal structured facts from public search/process replies; the harness expects fields that are intentionally absent.

- Both tarball server.js implementations call withoutInternalFacts before returning/recording tool results.
- The strip set includes start_search, get_more_search_results and start_process. Therefore the first search stage assertion expecting start.structuredContent.sessionId necessarily fails on a successful public search response.
- The strict blocklist helper also requires stripped start_process structuredContent, and would fail downstream. It must be repaired without returning to generic command-error acceptance.

## Required repair

- Bounded fail-closed text parsing tested with text-only wire fixtures; do not bypass managed gateway or import internal handlers for runtime qualification.
- Bind search session, actual owned result rows, requested offsets, exact count and pagination continuation; reject partial/permission-warning/timed-out/stopped/max-results outputs as completed success.
- Blocklist requires isError, exact known public denial text for the tested version and absent owned execution marker; generic parser failure or command-not-found does not prove blocklist matching.
- Preserve recorded search observations on future hosted failures without leaking unrelated raw configuration.

## Checks that remain valid

- get_config structuredContent.config remains public; exact owned configuration binding is valid.
- Positive process PID is in the initial text header; the existing fallback works, and can be anchored to that header.
- read_process_output is not in the strip set and returns bounded tail text; exact297,298,299 marker check remains valid.

The structured companion records exact public formats and hashes of all inspected tarball files. No actual upstream code was executed locally.
