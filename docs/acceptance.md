# Acceptance record

Deployment review: **October 30, 2026, America/Chicago**. This is a point-in-time
record, not a claim that all requirements in the original prompt are complete.

**Delivered:** a live owner dashboard, standalone Code Watch, persistent permission
and code data, six legacy application gates, preserved owner authentication,
deterministic source monitoring, and automated security/coordination tests.

**Main blocker:** Google OAuth credentials are missing and no Google identity
provider has been created. No genuine non-owner Google login, Ashley login or
Google cross-application access test has been completed.

**Current audience:** only the owner can use protected Code Watch. Guild access
is disabled and Google is not configured, so the member rollout is not complete.

## Production evidence

| Item | Observed result |
| --- | --- |
| Owner dashboard | Deployed at <https://m-techlabs.com/admin/access>; restricted to the verified recovery owner |
| Code Watch | Deployed at <https://codes.m-techlabs.com>; member APIs require an authorized session |
| Existing owner authentication | Original Cloudflare provider and owner policies preserved; owner gateway path tested |
| Access external evaluation | Real Cloudflare-signed request and signed response protocol successfully tested |
| Initial scan | Actual owner-triggered scan ran in production; all four enabled adapters succeeded |
| Stored code inventory | 811 distinct codes: 163 corroborated, 44 disputed, 552 expired, 14 likely active, 38 unverified |
| Independence of evidence | Four adapters represent three independent domains; both wiki pages count once |
| Historical suppression | All 13 required historical codes seeded; initial backlog suppressed; no new-code notifications from the import |
| Cron configuration | `*/30 * * * *` configured; timer-triggered execution has not yet been observed in this record |
| Guild access | Disabled, version 0, no stored hash. Automated live setup was blocked by Cloudflare WAF 1010; owner-UI live login/rotation remains unverified |
| Legacy gateway routes | Fleet, HomeBox, Portainer, BabyTracker, BabyTracker Preview and MJobs registered and gated |
| Existing origin faults | Fleet tunnel was offline beforehand. Preview returned an HTTP failure before and after gating. These are not verified healthy applications |
| Rollback | Owner-root gateway removal/restoration tested; original owner Access configuration retained |
| Runtime measurements | Successful standard-usage executions: baseline scan 66 ms CPU, code list 33 ms, owner bootstrap 17 ms, authentication 8 ms |
| Hosted GitHub checks | Workflow run 41157411508 did not start: GitHub reported failed recent payments or a spending-limit restriction. No code test step ran there; local 69-test result is separate |
| Independent Windows verification | The private repository was cloned to `C:\Tools\Dev\MTechLabs-Access` on MulattoTechBox. All 69 tests passed there with zero failures and process exit code 0 |
| Cost inspection | Zone Free plan verified; account default and Worker usage model are standard. Billing/subscription lookup returned 403, so exact account billing is unverified |

“Corroborated” means publication evidence from multiple independent domains.
“Player-confirmed” requires a separate individual account report. The displayed
inventory is not 811 codes verified by successful redemption.

## Original acceptance criteria

| Criterion | Status | Evidence or remaining requirement |
| --- | --- | --- |
| Existing Cloudflare owner login remains available | **Verified live** | Owner provider/policies retained and signed owner access validated; not dependent on Google |
| Central owner-only access dashboard | **Deployed** | People, grants, groups/defaults, inventory, guild settings, activity and sessions interfaces |
| Approve an individual Google account | **Partial / blocked** | Approval/allowlist persistence implemented and tested; actual Google authentication blocked by missing real client credentials |
| Grant one application without granting others | **Implemented; automated verification** | Default-deny backend and per-app matrix tested; actual non-owner Google journey still required |
| Configure Ashley’s verified account | **Awaiting owner input** | No email was supplied or invented; no sensitive application grant was made for her |
| Revoke access at relevant backends | **Implemented; automated verification** | Current user/grant/session state checked per HTTP request. Live Google revocation remains untested; existing legacy WebSockets/native sessions require origin controls |
| Guild users cannot reach private dashboards/APIs | **Implemented; automated verification** | Host/audience checks, owner-only admin and Code Watch-scoped guild sessions tested; final live guild verification pending here |
| Functional standalone Code Watch | **Verified live** | Website, successful production import and persistent code data available independently of the local PC |
| Scheduled checks run without AI | **Configured; timer observation pending** | Cron and deterministic scheduled handler deployed. Same scan path ran through an owner trigger; actual Cron invocation not yet observed |
| Manual refresh global cooldown | **Implemented; automated verification** | Atomic 15-minute shared lease/cooldown; 50 simultaneous callers produce one scan. Live manual scan plus a second browser-tab request produced one scan and an explicit cached/cooldown response; no production load test claimed |
| Known codes never reannounced as new | **Verified in import and tests** | Seeds, whole initial baseline, delayed first-success source imports and later-enabled sources suppressed |
| Honest source failures | **Implemented and tested** | Failure/backoff health retained; cached evidence preserved; missing listings do not become invented expirations |
| Services survive restarts and have recovery procedures | **Persistent deployment; partial verification** | Worker+D1 persistence and documented rollback. No full D1 restore or every-origin recovery drill claimed |

## Scope limits that remain visible

### Authorization granularity

The six legacy integrations enforce entry to an application. Their supported
choices are **Access allowed** and **Denied**. They do not retrofit internal
editor/viewer/operator roles into BabyTracker, HomeBox, Portainer, MJobs or Fleet.
Those applications retain their own logins, roles and session behavior.

Code Watch enforces **Viewer** as read-only for public player reports while allowing
browsing, refresh and a personal redeemed checklist. Individually approved Guild
Member, Editor, Operator and Administrator roles retain reporting; shared guild
sessions cannot submit public reports. Report authorization rechecks the current
grant, including after a live session is downgraded to Viewer. Global account/access
management, source administration and guild rotation remain owner-only. Broader
delegated-administrator or distinct editor/operator actions are not implemented by
assigning a label; the owner permission matrix states this limitation explicitly.

Academy and the owner hubs remain owner-only. The paired-device family sync service,
public widget origin and separately authenticated MCP origin are inventoried with
their existing authentication retained. Dashboard grants do not govern those
external surfaces. This is therefore a central system for the integrated apps,
not a claim that every existing service now has native unified RBAC.

### Identity, invitations and audit coverage

Google credentials must be entered through the owner’s Google/Cloudflare settings,
followed by provider/policy wiring and a real approved-user test. The existing
Cloudflare owner method must stay enabled throughout. The displayed setup flag is
not proof that an OAuth provider works.

Adding a person records an allowlist/invitation entry; it does **not** send email.
Public requests are pending and unverified until identity is established by login.
Audit/activity views cover events observed by this Worker. Cloudflare perimeter
denials and independent native-application activity are not automatically ingested.
Gateway last-access recording is throttled to five-minute intervals.

### Optional sources and messaging

Codex, wiki history, wiki evergreen and Pocket Gamer adapters are enabled. GamesRadar
is implemented but disabled pending a resource check. There is no authorized
official Discord reader, Discord notification webhook/bot or email sender. Manual
owner submissions with source URLs are supported; a notification ledger records
suppression/eligibility without sending messages. Monitoring itself makes no model
calls and does not start development agents.

### Availability and cost

The pre-existing Fleet and preview origin problems are outside a successful login
or gate check. A gateway cannot make an offline tunnel or failing origin healthy.
Production observability recorded successful executions on the current standard
usage model. The baseline scan (66 ms), code list (33 ms) and owner bootstrap
(17 ms) exceeded the published 10 ms Free allowance; authentication measured 8 ms.
The service therefore is not represented as proven compatible with Workers Free.
Guild PBKDF2 has not yet been measured in production. The verified zone plan does
not establish the Workers account’s subscription. No guaranteed $0 bill, paid
upgrade or subscription change is claimed; ongoing traffic and billing still need
monitoring.

## Automated verification

`npm test` passed **69 tests, zero failures** against the current source. The tests
execute real SQLite behind a D1-compatible interface; they do not substitute
hard-coded SQL results.

The same suite also passed from the GitHub clone on the owner's Windows machine:
**69 tests, zero failures, exit code 0**. The development environment used Node.js
24; the Windows machine had Node.js `v27.0.0-alpha.0.0.0` installed. Its npm version
printed a compatibility warning but the test process completed successfully. No
system Node installation or GitHub billing setting was changed.
The Windows clone tested implementation commit
`3246e07cc268eb8da663eb369628b09304074d82`; subsequent changes only update handoff
documentation and do not alter the deployed source or test suite.

Coverage includes forged/wrong-audience/expired tokens, key rotation and redirect
handling, real external-evaluation protocol shapes, exact-origin CSRF, owner-only
routes, default deny, group precedence, per-app separation, session/guild revocation,
per-user checklist isolation, source parser fixtures, failed-source retention,
deduplication and concurrent refresh acquisition. Six tests send actual Worker
HTTP requests through session, CSRF and current-grant checks to verify reporting
permissions, personal checklist separation, immediate role downgrade and shared
guild boundaries.

The snapshot efficiency test imports 1,200 observations then performs 48 unchanged
scans. It records **288 SQLite row changes**, **nine D1 calls per scan**, and no
rewrites of unchanged code/evidence records. Omitted listings freeze at their prior
successful observation and become stale even while later source checks succeed.
This demonstrates headroom; actual D1 index accounting, changed source data and
other user/application traffic add usage.

Source adapters were also verified against real public bodies during development,
and the production owner scan subsequently verified four successful source checks.
Desktop and 390-pixel mobile layouts were visually verified. Code Watch and the
owner dashboard stayed within the available document width; tables/navigation
use their own horizontal scrolling where needed.
See [source details](sources.md) for policies, parsing limits and official pricing
references; see [the README](../README.md) for operations and recovery steps.

## Remaining completion work

1. **Google and Ashley:** supply real OAuth credentials through secure configuration,
   wire the provider and per-app policies, retain owner recovery, and test one
   allowed app, one denied app and revocation with a real non-owner account. Obtain
   Ashley’s exact confirmed email and desired grants; the sample matrix is not
   authorization to assign them.
2. **Guild access:** use the owner UI to set the passphrase, then complete live
   sign-in/rotation/isolation checks. It remains disabled with no hash until that
   intentional activation; the automated attempt stopped at WAF 1010.
3. **Unattended checks:** observe a timer-triggered Cron invocation and its persisted
   result after propagation. The successful owner-triggered scan proves the scan
   path, not the timer event itself.
4. **Operating verification:** confirm account billing, measure the guild hash path
   on the actual deployment. Desktop and mobile layouts are verified. Current standard
   usage works, but observed CPU exceeds Free limits on several paths.
5. **GitHub hosted CI:** resolve the account billing/spending-limit restriction and rerun the workflow. The failed hosted job did not execute the test suite. No spending limit or payment setting was changed.
6. **Existing origins:** repair or independently verify Fleet and the preview origin
   before declaring those applications healthy. Their prior faults are recorded
   separately from authentication and gateway behavior.
7. **Recovery:** rehearse a D1 restore and the remaining origin-recovery procedures
   against an isolated copy before treating full disaster recovery as verified.
