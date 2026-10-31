/** Deterministic public-source adapters. No model calls, credentials or arbitrary URLs. */
export const HISTORICAL_CODES = Object.freeze([
  'BALDRWEEN', 'MOREORK', 'BUZZ4TACTICUS', 'MGMXTACTICUS', 'OWGTACTICUS',
  'WWXTACTICUS', 'TERMINUS11K', 'MCTACTICUS', 'SUPERTACTICS', 'KENORK',
  'FRANKENMAWG', 'GUNDAMORK', 'FOXTEN',
]);

export const SOURCES = Object.freeze([
  { id: 'codex', name: 'Tacticus Codex', url: 'https://api.tacticuscodex.com/api/gamecode?maxAgeDays=60', pageUrl: 'https://www.tacticuscodex.com/game-codes', domain: 'tacticuscodex.com', format: 'json', enabled: true, maxBytes: 524288 },
  { id: 'wiki-history', name: 'Tacticus Wiki — 2026 announcements', url: 'https://tacticus.wiki.gg/wiki/2026Freebies', domain: 'tacticus.wiki.gg', format: 'html', enabled: true, maxBytes: 524288 },
  { id: 'wiki-active', name: 'Tacticus Wiki — evergreen codes', url: 'https://tacticus.wiki.gg/wiki/Active_Codes', domain: 'tacticus.wiki.gg', format: 'html', enabled: true, maxBytes: 262144 },
  { id: 'pocketgamer', name: 'Pocket Gamer', url: 'https://www.pocketgamer.com/warhammer-40k-tacticus/codes/', domain: 'pocketgamer.com', format: 'html', enabled: true, maxBytes: 524288 },
  { id: 'gamesradar', name: 'GamesRadar+', url: 'https://www.gamesradar.com/games/strategy/warhammer-40k-tacticus-codes/', domain: 'gamesradar.com', format: 'html', enabled: false, maxBytes: 4194304 },
].map(Object.freeze));

const MAX_RECORDS = 1000;
const TIMEOUT_MS = 5000;
const USER_AGENT = 'MTechLabsCodeBot/1.0 (+https://m-techlabs.com)';
const SOURCE_MAP = new Map(SOURCES.map(source => [source.id, source]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…', times: '×' };

export class SourceParseError extends Error {
  constructor(message) { super(message); this.name = 'SourceParseError'; }
}

function sourceFor(id) {
  const source = SOURCE_MAP.get(id);
  if (!source) throw new SourceParseError('Unknown source; only registered public sources are permitted.');
  return source;
}

function timestamp(now = Date.now()) {
  const value = typeof now === 'function' ? now() : now;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new SourceParseError('Invalid check timestamp.');
  return date.toISOString();
}

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? match;
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
  });
}

function withoutScripts(text) {
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
}

function plain(text) {
  return decodeEntities(String(text).replace(/<[^>]*>/g, ' ')).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function rewardText(text) {
  const cleaned = plain(String(text).replace(/<\/(?:li|p)>|<br\s*\/?\s*>/gi, '; '))
    .replace(/\s*(?:\(\s*(?:new|latest)!?\s*\)|\b(?:new|latest)!)\s*$/gi, '')
    .replace(/\s*;\s*/g, '; ').replace(/(?:;\s*){2,}/g, '; ').replace(/(?:;\s*)+$/g, '').trim();
  if (!cleaned || /^(?:rewards?|free rewards?|freebies?|tba|unknown|not (?:yet )?confirmed)[.!\s]*$/i.test(cleaned)) return null;
  return cleaned.slice(0, 600);
}

function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const code = plain(value).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,47}$/.test(code)) return null;
  if (/^(?:CODE|CODES|REWARDS|STEP\d*|NOTE|EXPIRED|ACTIVE|CONTENTS|DATE)$/.test(code)) return null;
  // A personal referral code is not a globally redeemable promotional code.
  if (/^[A-Z]{3}-\d{2}-[A-Z]{3}$/.test(code)) return null;
  return code;
}

function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const iso = new Date(time).toISOString();
  if (iso.slice(0, 10) !== value.slice(0, 10)) return null;
  return value.length === 10 ? iso.slice(0, 10) : iso;
}

function record(source, code, rewards, sourceStatus, extra = {}) {
  return {
    code,
    rewards: rewards ?? null,
    sourceId: source.id,
    sourceUrl: source.pageUrl ?? source.url,
    sourceDomain: source.domain,
    sourceStatus,
    announcedAt: null,
    expiresAt: null,
    restrictions: null,
    ...extra,
  };
}

function dedupe(records) {
  const result = new Map();
  for (const item of records) {
    const prior = result.get(item.code);
    if (!prior) result.set(item.code, item);
    else result.set(item.code, {
      ...prior,
      rewards: prior.rewards || item.rewards,
      sourceStatus: prior.sourceStatus === item.sourceStatus ? prior.sourceStatus : 'unknown',
      announcedAt: prior.announcedAt || item.announcedAt,
      expiresAt: prior.expiresAt || item.expiresAt,
    });
    if (result.size > MAX_RECORDS) throw new SourceParseError('Source exceeded the bounded record limit.');
  }
  return [...result.values()];
}

function parseCodex(source, text, now) {
  let payload;
  try { payload = JSON.parse(text); } catch { throw new SourceParseError('Tacticus Codex did not return valid JSON.'); }
  if (!payload || !Array.isArray(payload.gameCodes)) throw new SourceParseError('Tacticus Codex gameCodes schema is missing.');
  if (payload.gameCodes.length > MAX_RECORDS) throw new SourceParseError('Source exceeded the bounded record limit.');
  const types = { gold: 'Coins', coins: 'Coins', blackstone: 'Blackstone', ammo: 'Ammunition', energy: 'Energy', salvage: 'Salvage', raidTickets: 'Raid Tickets', raidticket: 'Raid Tickets', requisition: 'Requisition Orders', requisitionOrder: 'Requisition Orders', xp: 'XP Books' };
  const records = [];
  for (const raw of payload.gameCodes) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.code !== 'string' || /[<>]/.test(raw.code)) continue;
    const code = normalizeCode(raw.code);
    if (!code) continue;
    const rewards = Array.isArray(raw.rewards) ? raw.rewards.slice(0, 25).map(reward => {
      if (!reward || !Number.isSafeInteger(reward.quantity) || reward.quantity < 0 || reward.quantity > 1e9) return null;
      const type = typeof reward.type === 'string' ? plain(reward.type).slice(0, 50) : '';
      const name = typeof reward.name === 'string' ? plain(reward.name).slice(0, 80) : '';
      const subType = typeof reward.subType === 'string' ? plain(reward.subType).slice(0, 50) : '';
      if (!type && !name) return null;
      const label = type === 'shards' ? `${name || 'Character'} shards` : types[type] || [subType, name, type].filter(Boolean).join(' ');
      return `${String(reward.quantity).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${label}`;
    }).filter(Boolean).join('; ') : typeof raw.rewards === 'string' ? rewardText(raw.rewards) : null;
    const expiresAt = isoDate(raw.expiresAt);
    const expiration = expiresAt ? (expiresAt.length === 10 ? Date.parse(`${expiresAt}T00:00:00Z`) + 86400000 : Date.parse(expiresAt)) : null;
    const status = raw.isActive === false || (expiration !== null && expiration <= Date.parse(now)) ? 'expired' : raw.isActive === true ? 'active' : 'unknown';
    records.push(record(source, code, rewardText(rewards || ''), status, {
      announcedAt: isoDate(raw.postedDate),
      expiresAt,
      restrictions: typeof raw.description === 'string' ? plain(raw.description).slice(0, 600) || null : null,
    }));
  }
  if (payload.gameCodes.length > 0 && records.length === 0) throw new SourceParseError('Tacticus Codex returned records but no valid promotional codes.');
  return records;
}

function wikiArticle(text) {
  const marker = /<div\b[^>]*class=["'][^"']*\bmw-parser-output\b[^"']*["'][^>]*>/i.exec(text);
  if (!marker) throw new SourceParseError('Wiki article content marker is missing.');
  const content = text.slice(marker.index + marker[0].length);
  const footer = content.search(/<div\b[^>]*class=["'][^"']*\bprintfooter\b/i);
  return footer < 0 ? content : content.slice(0, footer);
}

function parseAnnouncementDate(value, source) {
  const match = /^(\d{1,2})\s*([A-Za-z]{3})$/.exec(plain(value));
  const year = /\/(\d{4})Freebies/.exec(source.url)?.[1];
  if (!match || !year) return null;
  const month = MONTHS.findIndex(name => name.toLowerCase() === match[2].toLowerCase());
  if (month < 0) return null;
  return isoDate(`${year}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`);
}

function parseWikiHistory(source, text) {
  const article = wikiArticle(text);
  const tables = [...article.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  const table = tables.find(match => /^Promo Codes$/i.test(plain(/<caption\b[^>]*>([\s\S]*?)<\/caption\s*>/i.exec(match[1])?.[1] || '')));
  if (!table) throw new SourceParseError('Wiki Promo Codes table is missing.');
  const result = [];
  for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(match => match[1]);
    if (cells.length < 3) continue;
    const code = normalizeCode(cells[1]);
    const announcedAt = parseAnnouncementDate(cells[0], source);
    if (!code || !announcedAt) continue;
    result.push(record(source, code, rewardText(cells.slice(2).join('; ')), /<(?:s|del|strike)\b/i.test(cells[1]) ? 'expired' : 'unknown', { announcedAt }));
  }
  return result;
}

function listRecords(source, html, status) {
  const result = [];
  for (const entry of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_-]{1,47})\s*[-–—:]\s*(.*)$/.exec(plain(entry[1]));
    if (!match) continue;
    const code = normalizeCode(match[1]);
    if (!code) continue;
    const isStruck = /<(?:s|del|strike)\b|text-decoration\s*:\s*line-through/i.test(entry[1]);
    result.push(record(source, code, rewardText(match[2]), isStruck ? 'expired' : status));
  }
  return result;
}

function headingSection(text, headingPattern) {
  const headings = [...text.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)];
  const index = headings.findIndex(match => headingPattern.test(plain(match[1])));
  if (index < 0) return null;
  const start = headings[index].index + headings[index][0].length;
  return text.slice(start, headings[index + 1]?.index ?? text.length);
}

function parsePocketGamer(source, text) {
  const active = headingSection(text, /^Working Warhammer Tacticus codes$/i);
  if (active === null) throw new SourceParseError('Pocket Gamer working-code section is missing.');
  const result = listRecords(source, active, 'active');
  const expired = headingSection(text, /^Expired codes$/i);
  if (expired !== null) {
    const listItems = listRecords(source, expired, 'expired');
    result.push(...listItems);
    // This publication currently uses a plain-text, pipe/I-delimited expired list.
    for (const token of plain(expired).split(/\s+I\s+|\s*\|\s*/)) {
      const code = normalizeCode(token);
      if (code) result.push(record(source, code, null, 'expired'));
    }
  }
  return result;
}

function parseGamesRadar(source, text) {
  const active = headingSection(text, /^All (?:Warhammer )?40K Tacticus codes$/i);
  if (active === null) throw new SourceParseError('GamesRadar code section is missing.');
  const result = listRecords(source, active, 'active');
  // Restrict extractions to explicit code/reward list items. Strike-through is an
  // actual source expiry claim; unrelated uppercase prose is never harvested.
  result.push(...listRecords(source, text, 'unknown').filter(item => item.sourceStatus === 'expired'));
  return result;
}

export function parseSource(sourceId, text, now = Date.now()) {
  const source = sourceFor(sourceId);
  if (typeof text !== 'string' || text.length > source.maxBytes) throw new SourceParseError('Source response is missing or exceeds its size limit.');
  const checkedAt = timestamp(now);
  const html = source.format === 'html' ? withoutScripts(text) : text;
  let records;
  if (sourceId === 'codex') records = parseCodex(source, text, checkedAt);
  else if (sourceId === 'wiki-history') records = parseWikiHistory(source, html);
  else if (sourceId === 'wiki-active') records = listRecords(source, wikiArticle(html), 'active');
  else if (sourceId === 'pocketgamer') records = parsePocketGamer(source, html);
  else records = parseGamesRadar(source, html);
  if (source.format === 'html' && records.length === 0) throw new SourceParseError('No code records recognized; the source format may have changed.');
  return dedupe(records);
}

async function readBounded(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') throw new SourceParseError('Source returned no readable response body.');
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > maxBytes) {
    await response.body.cancel();
    throw new SourceParseError('Source response exceeds its size limit.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new SourceParseError('Source response exceeds its size limit.');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally { reader.releaseLock(); }
}

/** All network targets come from SOURCES; caller-provided URLs are rejected. */
export async function fetchSource(source, options = {}) {
  const id = typeof source === 'string' ? source : source?.id;
  const checkedAt = timestamp(options.now ?? Date.now());
  const result = { sourceId: id ?? null, ok: false, items: [], error: null, statusCode: null, checkedAt, retryAfterAt: null };
  let registered;
  try { registered = sourceFor(id); } catch (error) { return { ...result, error: error.message }; }
  if (typeof source === 'object' && source.url !== registered.url) return { ...result, error: 'Source URL does not match the registered public endpoint.' };
  if (!(typeof source === 'object' ? source.enabled : registered.enabled)) return { ...result, error: 'Source is disabled.' };
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ...result, error: 'HTTP fetch is unavailable.' };
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new SourceParseError('Source fetch timed out after 5 seconds.'));
    }, TIMEOUT_MS);
  });
  try {
    const work = (async () => {
      const response = await fetchImpl(registered.url, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: registered.format === 'json' ? 'application/json' : 'text/html' },
      });
      result.statusCode = response.status;
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const retryTime = /^\d{1,9}$/.test(retryAfter.trim()) ? Date.parse(checkedAt) + Number(retryAfter) * 1000 : Date.parse(retryAfter);
          if (Number.isFinite(retryTime) && retryTime > Date.parse(checkedAt)) result.retryAfterAt = new Date(retryTime).toISOString();
        }
        await response.body?.cancel();
        throw new SourceParseError(response.status === 429 ? 'HTTP 429: upstream rate limit; keep cached results and retry on a later scheduled check.' : `HTTP ${response.status}: source is unavailable; cached results remain unchanged.`);
      }
      if (response.redirected || (response.url && response.url !== registered.url)) {
        await response.body?.cancel();
        throw new SourceParseError('Unexpected source redirect; endpoint must be reviewed before following it.');
      }
      const contentType = response.headers.get('content-type') || '';
      if (registered.format === 'json' && !/(?:application\/(?:[\w.+-]*\+)?json)/i.test(contentType)) {
        await response.body?.cancel();
        throw new SourceParseError('Expected JSON; source may be presenting an access challenge.');
      }
      const text = await readBounded(response, registered.maxBytes);
      return parseSource(id, text, checkedAt);
    })();
    const items = await Promise.race([work, timeout]);
    return { ...result, ok: true, items };
  } catch (error) {
    const message = timedOut ? 'Source fetch timed out after 5 seconds.' : error instanceof SourceParseError ? error.message : 'Source network request failed; cached results remain unchanged.';
    return { ...result, error: message };
  } finally { clearTimeout(timer); }
}
