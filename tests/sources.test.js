import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, HISTORICAL_CODES, SourceParseError, parseSource, fetchSource } from '../src/sources.js';

const NOW = '2026-10-31T01:00:00.000Z';
const codex = SOURCES.find(source => source.id === 'codex');
const codexFixture = {
  gameCodes: [
    { code: 'FLOPPAFRIDAY', rewards: [{ name: 'ammuk', type: 'shards', subType: '', quantity: 10 }, { name: '', type: 'ammo', subType: '', quantity: 10 }], postedDate: '2026-10-30', isActive: true, expiresAt: '' },
    { code: 'SUPERTACTICS', rewards: [{ name: '', type: 'gold', quantity: 2000 }, { name: '', type: 'blackstone', quantity: 30 }, { name: 'aleph-null', type: 'shards', quantity: 10 }], postedDate: '2026-10-29', isActive: true },
  ],
};

const wikiFixture = `<li>OUTSIDE - 9 invented rewards</li><div class="mw-parser-output">
 <h2>Promo Codes</h2><table class="wikitable"><caption>Promo Codes\n</caption><tbody>
 <tr><th>Date</th><th>Code</th><th>Contents</th></tr>
 <tr><td>30Oct</td><td>FLOPPAFRIDAY</td><td><ul><li>Munitions x10</li><li><a href="/wiki/Ammuk">Ammuk</a> shards x10</li></ul></td></tr>
 <tr><td>29Oct</td><td>SUPERTACTICS</td><td><ul><li>Coins x2000</li><li>Blackstone x30</li></ul></td><td><a href="/wiki/Aleph-Null">Aleph-Null</a> shards x10</td></tr>
 <tr><td>31Feb</td><td>NOTAREALDATE</td><td>100 Coins</td></tr>
 </tbody></table>
 <table><caption>Contests</caption><tr><td>30Oct</td><td>CONTEST</td><td>1 prize</td></tr></table>
 </div><div class="printfooter">Footer</div>`;

test('the exact 13 historical seeds are uppercase, unique and immutable', () => {
  assert.equal(HISTORICAL_CODES.length, 13);
  assert.equal(new Set(HISTORICAL_CODES).size, 13);
  assert.ok(HISTORICAL_CODES.includes('MCTACTICUS'));
  assert.ok(Object.isFrozen(HISTORICAL_CODES));
  assert.equal(SOURCES.find(source => source.id === 'gamesradar').enabled, false);
});

test('Codex live-shaped JSON preserves factual rewards and public provenance', () => {
  const result = parseSource('codex', JSON.stringify(codexFixture), NOW);
  assert.equal(result.length, 2);
  assert.equal(result[0].rewards, '10 ammuk shards; 10 Ammunition');
  assert.equal(result[1].rewards, '2,000 Coins; 30 Blackstone; 10 aleph-null shards');
  assert.equal(result[0].sourceStatus, 'active');
  assert.equal(result[0].announcedAt, '2026-10-30');
  assert.equal(result[0].sourceUrl, 'https://www.tacticuscodex.com/game-codes');
  assert.equal(result[0].sourceDomain, 'tacticuscodex.com');
  assert.equal(result[0].expiresAt, null);
  assert.equal(result[0].restrictions, null);
});

test('case-insensitive duplicates collapse and conflicting source claims become unknown', () => {
  const result = parseSource('codex', JSON.stringify({ gameCodes: [
    { code: '  SuPerTactics ', rewards: [], isActive: true },
    { code: 'SUPERTACTICS', rewards: '30 Blackstone', isActive: false },
  ] }), NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].code, 'SUPERTACTICS');
  assert.equal(result[0].rewards, '30 Blackstone');
  assert.equal(result[0].sourceStatus, 'unknown');
});

test('old listings and absent codes do not create inferred expiration', () => {
  const old = parseSource('codex', JSON.stringify({ gameCodes: [{ code: 'OLDLISTING', postedDate: '2020-01-01', isActive: true }] }), NOW);
  assert.equal(old[0].sourceStatus, 'active');
  assert.equal(old[0].rewards, null);
  assert.deepEqual(parseSource('codex', '{"gameCodes":[]}', NOW), []);
  assert.equal(old[0].expiresAt, null);
});

test('explicit expired flags and supported expiry timestamps are retained', () => {
  const result = parseSource('codex', JSON.stringify({ gameCodes: [
    { code: 'INACTIVE', isActive: false },
    { code: 'TIMEDOUT', isActive: true, expiresAt: '2026-10-30T12:00:00Z' },
    { code: 'TODAYCODE', isActive: true, expiresAt: '2026-10-31' },
    { code: 'UNVERIFIED', expiresAt: 'nonsense' },
  ] }), NOW);
  assert.deepEqual(result.map(item => item.sourceStatus), ['expired', 'expired', 'active', 'unknown']);
  assert.equal(result[1].expiresAt, '2026-10-30T12:00:00.000Z');
  assert.equal(result[3].expiresAt, null);
});

test('malformed records, personal referral codes, and invalid reward quantities are excluded', () => {
  const result = parseSource('codex', JSON.stringify({ gameCodes: [
    { code: '<script>BAD</script>' },
    { code: 'CODE' },
    { code: 'ABC-12-DEF' },
    { code: 'REALCODE', rewards: [{ type: 'gold', quantity: -2 }, { type: 'gold', quantity: '300' }, { type: 'gold', quantity: 50 }], description: '<b>New accounts only</b>' },
  ] }), NOW);
  // Markup is not a valid code, even if its inner text resembles one.
  assert.equal(result.some(item => item.code === 'BAD'), false);
  assert.equal(result.some(item => item.code === 'ABC-12-DEF'), false);
  assert.equal(result.find(item => item.code === 'REALCODE').rewards, '50 Coins');
  assert.equal(result.find(item => item.code === 'REALCODE').restrictions, 'New accounts only');
});

test('source schema changes and challenge pages fail honestly', () => {
  assert.throws(() => parseSource('codex', '<html>Access challenge</html>', NOW), SourceParseError);
  assert.throws(() => parseSource('codex', '{"codes":[]}', NOW), /schema/);
  assert.throws(() => parseSource('pocketgamer', '<html><li>MADEUP - 10 coins</li></html>', NOW), /section is missing/);
  assert.throws(() => parseSource('unknown', '', NOW), /Unknown source/);
});

test('wiki history uses only Promo Codes table and joins malformed extra reward cells', () => {
  const result = parseSource('wiki-history', wikiFixture, NOW);
  assert.equal(result.length, 2);
  assert.equal(result[0].code, 'FLOPPAFRIDAY');
  assert.equal(result[0].sourceStatus, 'unknown');
  assert.equal(result[0].announcedAt, '2026-10-30');
  assert.equal(result[1].rewards, 'Coins x2000; Blackstone x30; Aleph-Null shards x10');
  assert.equal(result.some(item => item.code === 'CONTEST' || item.code === 'OUTSIDE' || item.code === 'NOTAREALDATE'), false);
});

test('wiki evergreen adapter excludes navigation, scripts and generic prose', () => {
  const text = `<li>OUTSIDECODE - 100 Coins</li><div class='mw-parser-output'><p>Some uppercase prose: RANDOMTOKEN</p><ul>
    <li>REDDIT40K - 50 Blackstone and 10 <a href='/wiki/Exitor-Rho'>Exitor-Rho</a> Shards</li>
    <li>AHEM - 1 Blackstone</li><li>This is not a promo code</li></ul>
    <script>const fake = '<li>SCRIPTFAKE - 99 Coins</li>';</script></div><div class='printfooter'>footer</div>`;
  const result = parseSource('wiki-active', text, NOW);
  assert.deepEqual(result.map(item => item.code), ['REDDIT40K', 'AHEM']);
  assert.equal(result[0].rewards, '50 Blackstone and 10 Exitor-Rho Shards');
  assert.equal(result[0].sourceDomain, parseSource('wiki-history', wikiFixture, NOW)[0].sourceDomain);
});

test('Pocket Gamer handles unknown rewards, entities, both expiry separators and scoped sections', () => {
  const text = `<h2>Working Warhammer Tacticus codes</h2><ul>
    <li><strong>TERMINUS11K&nbsp;</strong><strong>-</strong> rewards (new!)</li>
    <li><strong>warhammer&nbsp;</strong>- 3,000 Coins and 200 Blackstone</li>
    <li><strong>AHEM</strong>&nbsp;- 1 Blackstone</li></ul>
    <h3>Expired codes</h3>OLDCODE I OLDERTOKEN | LASTEXPIRED
    <h2>How to use the Warhammer Tacticus codes?</h2><ul><li>INSTRUCTIONFAKE - 20 Coins</li></ul>`;
  const result = parseSource('pocketgamer', text, NOW);
  assert.equal(result.length, 6);
  assert.equal(result[0].rewards, null);
  assert.equal(result[1].code, 'WARHAMMER');
  assert.equal(result[1].sourceStatus, 'active');
  assert.deepEqual(result.slice(3).map(item => item.sourceStatus), ['expired', 'expired', 'expired']);
  assert.equal(result.some(item => item.code === 'INSTRUCTIONFAKE'), false);
});

test('GamesRadar distinguishes struck entries and removes new markers without asserting redemption', () => {
  const text = `<h3 id='section-all-40k-tacticus-codes'><span>All 40K Tacticus codes</span></h3><ul>
    <li><strong>SUPERTACTICS </strong>- 10x Aleph-Null Shards, 30x Blackstone <em><strong>new!</strong></em></li></ul>
    <h2>How to redeem Tacticus codes</h2><ul><li><s><strong>OLDCODE</strong></s> - 20 Coins</li></ul>`;
  const result = parseSource('gamesradar', text, NOW);
  assert.equal(result[0].rewards, '10x Aleph-Null Shards, 30x Blackstone');
  assert.equal(result[0].sourceStatus, 'active');
  assert.equal(result[1].sourceStatus, 'expired');
});

test('fetch is restricted to registered endpoints and never follows redirects', async () => {
  let calls = 0;
  const fetch = async (url, init) => {
    calls++;
    assert.equal(url, codex.url);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, undefined);
    return new Response(JSON.stringify(codexFixture), { headers: { 'content-type': 'application/json' } });
  };
  const success = await fetchSource(codex, { fetch, now: NOW });
  assert.equal(success.ok, true);
  assert.equal(success.statusCode, 200);
  assert.equal(success.checkedAt, NOW);
  assert.equal(success.items.length, 2);
  const rejected = await fetchSource({ ...codex, url: 'http://169.254.169.254/latest/meta-data' }, { fetch, now: NOW });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /registered public endpoint/);
  assert.equal(calls, 1);
});

test('disabled sources make no network call', async () => {
  const result = await fetchSource(SOURCES.find(source => source.id === 'gamesradar'), { fetch: () => { throw new Error('must not run'); }, now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.error, /disabled/);
});

test('network failures and 429 preserve empty result payload and honest source state', async () => {
  const limited = await fetchSource(codex, { fetch: async () => new Response('Rate limit', { status: 429, headers: { 'retry-after': '1800' } }), now: NOW });
  assert.equal(limited.ok, false);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.error, /rate limit/);
  assert.equal(limited.retryAfterAt, '2026-10-31T01:30:00.000Z');
  assert.deepEqual(limited.items, []);
  const failed = await fetchSource(codex, { fetch: async () => { throw new Error('sensitive upstream detail'); }, now: NOW });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.includes('sensitive'), false);
});

test('response bytes are bounded even when Content-Length is absent', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(codex.maxBytes + 1)); },
    cancel() { cancelled = true; },
  });
  const result = await fetchSource(codex, { fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }), now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.error, /size limit/);
  assert.equal(cancelled, true);
});

test('unexpected successful HTML challenges are not accepted as JSON', async () => {
  const result = await fetchSource(codex, { fetch: async () => new Response('<html>Verify you are human</html>', { headers: { 'content-type': 'text/html' } }), now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.error, /Expected JSON/);
  assert.deepEqual(result.items, []);
});

test('source responses cannot return an unbounded number of records', () => {
  const text = JSON.stringify({ gameCodes: Array.from({ length: 1001 }, (_, i) => ({ code: `CODE${i}` })) });
  assert.throws(() => parseSource('codex', text, NOW), /record limit/);
});
