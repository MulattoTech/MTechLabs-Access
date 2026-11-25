
# MTerm liveness qualification — 2026-11-25 UTC

Scope: paired Windows synthetic HTTP/MCP fixture; no production deployment, settings modification, OAuth, or real write tools.
Baseline 15e851b11984592803d37599b639772e51e5c8c0; candidate 2c4b397048df373426b24b95a943d7a085dcb608. Both use the same appended test and the existing pinned SDK dependencies via isolated worktree junctions.
Command in each integrations/mcp-manager directory: node --test --test-name-pattern='liveness qualification' test/remote.test.mjs.
Paired run 15:29:03–15:29:16 UTC. Both pass; candidate full remote suite subsequently 10/10, git diff --check clean (line-ending warning only).

| Case | Baseline first-tool ms | Candidate first-tool ms |
| --- | --- | --- |
| Cold ping then initialize/list/resource/tool | 364.4, 307.3, 310.2 | 316.8, 367.7, 269.0 |
| Warm | 37.9, 23.7, 31.2 | 32.7, 31.5, 31.6 |
| After idle | 285.3, 287.5, 300.4 | 399.6, 303.8, 334.0 |
| After deliberately aborted read | 201.7, 204.8, 204.1 | 205.1, 202.1, 204.3 |
| Cold direct | 317.7 | 335.3 |

First-tool results 13/13 each; three deliberate aborted reads each excluded from first-tool successes, then 3/3 successful recovery. Cold ping baseline [324.5,271.4,273.5] ms versus candidate [17.0,1.3,0.8] ms; after-idle ping [245.4,248.5,260.9] versus [0.9,0.9,0.7] ms. Gateway ready after all six baseline pings versus idle after all six candidate pings. Cold-ping initialization median 2.3 versus 259.0 ms. Warm median 31.2 versus 31.6 ms. Cold ping-to-tool median 310.2 versus 316.8 ms; after-idle median 287.5 versus 334.0 ms. Startup is deferred, not eliminated. Fixed-order small-sample fixture timings are not production latency or a general performance improvement. Each round records separate auth denial, initialize, discovery, resource fetch, read tool and cumulative timings, with no argument or response content persisted. Resource fetch is not UI rendering. Auth denial is not OAuth. Abort uses a synthetic read only. No uncertain write is replayed.

Live 2026-11-25 15:26 UTC: authenticated Live Connection metadata call succeeded in 2182 ms; terminal inventory succeeded. Wrapper/canonical shared app binding does not establish canonical-only authorization. Public endpoint unauthenticated GET 401 in 141.384,81.534,86.408 ms. Installed runtime H:\MTechLabs\MCP\runtime\remote.mjs normalized SHA256 491737F5643DEDAEAA0876114C41457E4AB8B0C749EDF0AA4BA9B0B2B0336BBE versus candidate 2D03D052F2F55B3D6E4397C16E2C285AE6AD88DA2B3D518D571F7896CE8B637A and parent 404C4E8C283A9EAA7BC09ED3B7416A15AA4420E3C017495551641CAB58A23E9D. Installed source differs; exact loaded code/deployment not verified. Installed listener 19740 and manager process observed. Browser access rejected: originating browser context required; no settings UI reproduction, no OAuth timing, no direct cold/idle/interruption through authenticated dev plugin. No claim of causal UI fix.

Next: supported dev-plugin browser session with stage timings, sanitized errors, independent authorization/init/discovery/resource rendering/first real read. Preserve production, identity and consent; no install, reconnect automation, or main merge here.
