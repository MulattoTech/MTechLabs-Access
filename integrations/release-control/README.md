# Release Control — first safe slice

Standalone owner-only release review application, with no additional Cloudflare Worker, database, cron or hosted build. Runs locally with Node and the workstation's existing authenticated GitHub CLI. Access is independently verified using the pinned existing Cloudflare Access JWT verifier, exact owner policy, apex host and audience. Browser mutations require same origin and a custom header. No GitHub credential is exported or stored by this application.

The catalog has 30 non-archived repositories and two archived entries. Check-all uses batches of six and a 60-second per-project cooldown. Each check reads the actual default branch SHA; failure retains the prior observation as unavailable. MJobs and Sat Tracker have narrow read-only Docker observations, explicitly qualified as reported labels, unverified tags or unknown. Other deployment mappings require verification. A head change is not proof an update is deployable.

Prepare rechecks the exact current branch SHA and reads check-run evidence. Review and hold record the exact plan; a hold date is a manual reminder, not an automatic release schedule. Required CI gates and production activation adapters are not yet qualified. No remote shell, workflow dispatch, Git push, code build, Cloudflare deployment or product mutation is available in the web API. GitHub Actions links support separate review. Plans/events are stored locally, with atomic replacement and bounded event retention. Do not run --scan concurrently with the server. A stale reviewed plan never grants release authority.

Test: node --test integrations/release-control/release-control.test.mjs
Initial live read-only inventory: node integrations/release-control/server.mjs --scan
Serve: node integrations/release-control/server.mjs (loopback 127.0.0.1:20881)
Expected route: https://m-techlabs.com/admin/releases/ only after tunnel reachability and owner authorization are confirmed. No widening listeners. Preserve existing ingress rules and their independent Access guards.

Next: per-target signed/verified deployment identity; review exact-head CI policy, build artifact provenance, backups, stage and health checks; then enroll only tested dispatch/activation adapters and rollback. Never treat the master dashboard as a generic command execution endpoint.
