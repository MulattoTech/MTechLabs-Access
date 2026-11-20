# DEV manager source foundation — issue 34

Authorized continuation from Access main
`83d5c3791a4fc459cb4c2e536f97b1f5f77273d0` (tree
`ba7c4546258f0d7c7403b688ab20e473f0658002`). One writer implements; independent
agents review source and qualification. The bounded acceptance contract and
claim are recorded in [issue 34](https://github.com/MulattoTech/MTechLabs-Access/issues/34).

## Delivered source behavior

The optional DEV descriptor selects a distinct loopback port and identity.
Startup validates the authoritative production reference, disjoint canonical
state, independent effective credentials, ordinary control files and all
existing DEV state before acquiring ownership. Reserved state targets, Windows
stream/name aliases, links/junctions and hardlinked DEV files are refused.
DEV ownership is exclusive; an unsuccessful bind cannot recover running jobs.
Cleanup drains managed operations and refuses to remove a replaced owner file.
Direct state writers require a validated snapshot; job recovery additionally
requires its live ownership claim.

Legacy configuration and Windows launchers retain their production behavior.
DEV remote/gateway upstream is explicitly disabled. Built-in job capabilities
remain governed by the existing policy and toolkit under the manager's OS user;
there is no assertion of isolated upstream or job execution. See
[the operational contract](../../../integrations/mcp-manager/DEV.md).

## Local evidence

`local-receipt.json` binds the base, source SHA-256 values, immutable test bytes,
commands' results and raw evidence hashes. The same final test file was copied
into an isolated detached baseline worktree; no production installation or
owner checkout was used.

| Gate | Observed result |
| --- | --- |
| Baseline capability reproduction | 16 expected failures, two native Windows cases skipped, exit 1 |
| Fixed focused suite | 18 pass, two native Windows cases skipped, zero failures/cancellations |
| Complete local manager suite | 133 pass, three Windows skips, zero failures/cancellations |
| Root suite | 128/128, no skips |
| Root syntax/build | pass; generated UI bytes unchanged |

Baseline command: `node --test --test-reporter=tap --test-skip-pattern='DEV cleanup' integrations/mcp-manager/test/dev-instance.test.mjs`.
The replaced-owner and direct-ownership revocation cleanup tests require the new
ownership primitive, absent from the baseline, and are excluded from that RED
claim. Both run and pass in the complete GREEN suite. The native Windows cases are case aliases and
ADS/trailing-component aliases. The full manager suite also retains the existing
Windows-only launcher identity test. No skip is treated as native acceptance.

Independent review found and resolved two concrete implementation defects:
existing config-consuming writer commands needed the new DEV validation, and
a never-listened server could otherwise call close then listen before Node's
asynchronous close event. Regression coverage also verifies deferred recovery
draining, preserved foreign ownership files, no stale takeover, and zero DEV
SDK/spawn calls. Later independent Windows review narrowed DEV paths to ordinary
local drive syntax, avoiding unqualified alternate-stream/device namespace
semantics. Production launchers are unchanged.

Final immutable review found a direct ownership-release race in the initial
candidate (`830f7c733dc784de9186ccab679d210252ce095d`, published as
`653dc9c865131a7aaf7f26ea74b5d6c798514c1c`). `review-gap-red.tap` records the
new immediate release/start-runner regression failing on that exact tree,
without fixture faults. Release now revokes the proof synchronously, once;
repeating an old release handle cannot revoke a subsequently reacquired lease.
The same frozen regression passes with the fix. The earlier candidate is not
merge-qualified; hosted acceptance must bind the subsequent reviewed revision.

## Acceptance and continuation

At this commit's preparation, hosted candidate/main gates remain pending. The
final issue receipt records the actual remote candidate, reviewed tree,
independent immutable acceptance, five candidate jobs, expected-head normal
merge, five distinct actual-main jobs and claim release. The issue is closed
explicitly only after those gates. Neutral `Refs #34` prevents early auto-close.

No real DEV activation, source installation, production restart, Cloudflare
change, credential rotation, plugin/grant replacement or paid model call is
included. Real upstream 0.3.1/0.3.3 qualification belongs only to the existing
disposable hosted workflows. An actual independent DEV OS profile, backend/App
routing and launcher need their own qualification before enabling upstream.
CLI formal acceptance remains unchanged (29.36%, 0/300; no DCP/WEB acceptance
awards from this bounded Access source slice).
