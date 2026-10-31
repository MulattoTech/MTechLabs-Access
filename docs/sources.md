# Tacticus code sources and operating costs

Checked October 30, 2026, America/Chicago. Source statements describe publication
evidence, not successful redemption on a player's game account.

## Enabled deterministic adapters

| ID | Fetch endpoint | Evidence and limitations |
| --- | --- | --- |
| `codex` | `https://api.tacticuscodex.com/api/gamecode?maxAgeDays=60` | Anonymous JSON endpoint used by the public Tacticus Codex page. Contains code, structured rewards, announcement date, `isActive`, and optional expiry. A public-client-derived integration, not a separately documented stable API. |
| `wiki-history` | `https://tacticus.wiki.gg/wiki/2026Freebies` | Promo Codes table. An announcement date establishes historical presence, not present validity. The table sometimes contains extra reward cells; the adapter joins all of them. Requires a reviewed annual URL update for 2027. |
| `wiki-active` | `https://tacticus.wiki.gg/wiki/Active_Codes` | Public evergreen-code list. Both wiki adapters share the same independent-source domain. |
| `pocketgamer` | `https://www.pocketgamer.com/warhammer-40k-tacticus/codes/` | Explicit working and expired sections. Generic text such as “rewards (new!)” becomes unknown reward data, never an invented reward. |
| `gamesradar` | `https://www.gamesradar.com/games/strategy/warhammer-40k-tacticus-codes/` | Implemented but disabled by default because its HTML exceeds 2 MB. Enable only after measuring deployed Worker CPU. Strike-through is recorded as the publisher's expiry claim. |

Human-facing Codex attribution links to
<https://www.tacticuscodex.com/game-codes>, not the API endpoint.

All enabled endpoints returned HTTP 200 during discovery without credentials.
The Codex public page itself is a JavaScript shell; the JSON endpoint was located
in the client code served to anonymous visitors. The adapter never reads private
Codex accounts, rosters, inventory or API tokens.

### Access restrictions

The wiki's robots file allows public article pages but disallows `/api.php`,
`/rest.php`, `/index.php`, special/action/search pages. Production uses ordinary
article HTML. Codex's public robots file expressly allows `/game-codes`; the API
host's robots and policy endpoints returned 401, whereas the code-list endpoint
used by the anonymous page returned 200. Pocket Gamer's wildcard robots policy
allows `/`. GamesRadar permits the article route and disallows various admin,
search and embedded paths and specified crawler identities.

Recheck source policies when enabling or changing an adapter. Any future
401/403/429, challenge page, redirect, parse failure, timeout or size excess must
be surfaced in source health. There is no CAPTCHA bypass, proxy rotation,
credential borrowing, user-agent impersonation or private endpoint fallback.
The bot identifies itself as `MTechLabsCodeBot/1.0 (+https://m-techlabs.com)`.

An official public code-announcement feed was not available during discovery.
The official site's WordPress posts feed was empty. Official Discord monitoring
requires an authorized bot with permission to read the relevant channel; it must
remain disabled until explicitly configured. Owner-reviewed manual submissions
are the safe alternative. The Tacticus Companion's account read APIs are not a
redemption-verification service.

## Adapter contract

`SOURCES` is an immutable registry. `url` is the fetch endpoint; optional `pageUrl`
is the human-facing attribution link; `domain` identifies an independent source
family; `maxBytes` is the maximum decoded response body. GamesRadar can be enabled
with `{ ...registeredSource, enabled: true }` without permitting URL changes.
`fetchSource` rejects caller-supplied URLs that do not exactly match this registry.
It never follows redirects, uses a five-second deadline, bounds response bytes
and records, and returns failure rather than fabricating results.

`parseSource(sourceId, text, now)` returns items with:

```js
{
  code, rewards, sourceId, sourceUrl, sourceDomain,
  sourceStatus: 'active' | 'expired' | 'unknown',
  announcedAt, expiresAt, restrictions
}
```

Dates are ISO date strings or ISO UTC timestamps when the source supplies a time.
Missing dates/rewards/restrictions are `null`. `restrictions` on Codex records is
the source's plain-text description, retained as a source claim. A date-only
expiry is treated as ending at the end of that UTC date. Any contradictory status
for a duplicate within a source becomes `unknown`.

`fetchSource(source, { fetch, now })` returns
`{ sourceId, ok, items, error, statusCode, checkedAt, retryAfterAt }`. The optional
`retryAfterAt` field is an ISO timestamp parsed from an upstream `Retry-After`
header, otherwise `null`; the scheduler must persist and honor it before the next
source request. On failure, `items` is empty;
the caller must preserve previously stored observations. `parseSource` throws
`SourceParseError` when a known schema or section disappears. A valid empty Codex
array is allowed and cannot expire any previously known codes.

Code normalization is case-insensitive and conservatively accepts 2–48 ASCII
letters/digits, underscores and hyphens. Obvious personal referral-code patterns
are excluded. Unusual non-ASCII promotional codes require an adapter review;
the bot does not manufacture a normalized substitute. Source content must be
rendered as text in the UI, never inserted as trusted HTML.

## Evidence, history and notifications

The adapter's `active` means “this source currently lists it as active.” It does
not mean player-confirmed. Historical announcement rows remain `unknown` unless
the source explicitly marks expiration. Old dates and disappearing entries are
never treated as expiration evidence. The aggregate service should retain source
claims, expose conflicting current claims as disputed, and keep per-user redeemed
state separate from global validity.

Corroboration counts independent domains, not raw URLs. Wiki history plus the
wiki evergreen page therefore count once. Generic unknown rewards must not
overwrite known factual rewards. Shared-passphrase sessions do not establish
independent unique player identities.

The service seeds the 13 prompt-provided historical codes and suppresses their
import announcements. It must also suppress the initial successful baseline
import's backlog. Only a post-baseline discovery with sufficient corroboration
should become notification-eligible, guarded by a unique notification ledger.
Notification transport is optional and no messages are sent by these adapters.

## Costs and limits verified against official documentation

| Cloudflare component | Free plan allowance at verification |
| --- | --- |
| Workers | 100,000 requests/day; 10 ms CPU/invocation; 128 MB memory; 50 subrequests/invocation |
| Cron Triggers | Five per account; one `*/30 * * * *` trigger suffices |
| D1 | Five million rows read/day; 100,000 rows written/day; 5 GB total |
| Queues | 10,000 operations/day; 24-hour retention; normal delivery about three operations/message |
| SQLite Durable Objects | 100,000 requests/day; 13,000 GB-seconds/day; 5 GB storage; five million rows read/day and 100,000 rows written/day |

Workers Paid starts at $5 per account/month, including ten million requests and
30 million CPU milliseconds/month, with metered overages. Queues and SQLite
Durable Objects are also available on Free; neither requires upgrading by itself.
Free-plan quota exhaustion produces errors rather than an automatic paid
upgrade. Usage from the account's other applications consumes shared allowances.

The verified live sample contained 70 Codex records, 353 wiki announcement rows,
18 wiki evergreen entries and 757 Pocket Gamer records including its expired
archive. Rewriting all 1,198 observations 48 times daily would consume 57,504 row
writes before additional tables and indexes. Persist source snapshot hashes and
source check timestamps; avoid rewriting unchanged archival rows at every scan.

This implementation hashes a canonical, code-sorted snapshot of each source's
observations. An identical snapshot updates only the source's check/success row.
Each changed snapshot publishes a new generation in the same D1 transaction as
its JSON1 bulk import. Only evidence belonging to that current generation borrows
the source's newer successful-check timestamp. Omitted evidence is frozen at the
previous successful check, so later identical snapshots cannot keep a removed
listing fresh. Code list responses derive effective last-seen dates without
rewriting each code. SQL recomputes global statuses and writes only actual changes.

The automated SQLite test imports 1,200 observations across two sources, then
simulates 48 unchanged scans. It measures 288 row changes in total for those
scans and nine D1 calls per scan, including scan acquisition. Four enabled sources
add two source-row updates per scan; production index billing, actual source
changes and unrelated application writes are additional. This test establishes
headroom, not a promise that every future traffic pattern has the same cost.

The D1 limits documentation confirms that one `db.batch()` counts as one query
against the per-invocation limit even with multiple statements. JSON1 bulk import
avoids per-code network queries. Every source has a bounded payload below the
2 MB string/row limit, and each statement has fewer than 100 bound parameters.

Use indexed D1 queries and a conditional atomic lease/cooldown update to coordinate
refreshes. A 30-minute schedule is 48 checks/day. Source parsing, password hashing,
and authentication still need CPU measurement on the deployed plan; I/O wait is
different from CPU time. Cron changes may take up to 15 minutes to propagate and
execute in UTC. Background HTTP `waitUntil()` extends execution for up to 30
seconds after the response; Cron invocations have a 15-minute wall-time limit.

Official references:

- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/queues/platform/pricing/>
- <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- <https://developers.cloudflare.com/d1/worker-api/d1-database/>
- <https://developers.cloudflare.com/d1/platform/limits/>

There are no OpenAI, Codex, Anthropic, Claude, Google AI or Gemini calls in the
adapters. Normal source monitoring uses deterministic HTTP requests and parsers.
