import { SOURCES, HISTORICAL_CODES, fetchSource } from './sources.js';
import { one, rows, run, statement, nowSeconds } from './db.js';

export const COOLDOWN_SECONDS = 15 * 60;
export const LEASE_SECONDS = 120;
const FRESH_SECONDS = 7 * 86400;
const CURRENT_OBSERVATION = `MAX(e.observed_at,CASE WHEN e.snapshot_generation=s.current_generation THEN COALESCE(s.last_success,0) ELSE 0 END)`;
const EXPIRY_SECONDS = `CASE WHEN length(e.expires_at)=10 THEN unixepoch(e.expires_at,'+1 day') ELSE unixepoch(e.expires_at) END`;
const SOURCE_PRIORITY = `CASE e.source_id WHEN 'codex' THEN 0 WHEN 'wiki-history' THEN 1 WHEN 'wiki-active' THEN 2 WHEN 'pocketgamer' THEN 3 ELSE 4 END`;

export async function acquireScan(db, trigger, now = nowSeconds()) {
  const id = crypto.randomUUID();
  const lease = await one(db, `UPDATE scan_state SET lease_id=?,lease_until=?,next_allowed=?,last_started=?,last_trigger=?,last_error=NULL
    WHERE id=1 AND lease_until<=? AND next_allowed<=? RETURNING *`, id, now + LEASE_SECONDS, now + COOLDOWN_SECONDS, now, trigger, now, now);
  if (!lease) return { acquired: false, state: await one(db, 'SELECT * FROM scan_state WHERE id=1') };
  await run(db, 'INSERT INTO scan_runs(id,started_at,trigger,status) VALUES(?,?,?,?)', id, now, trigger, 'running');
  return { acquired: true, id, baseline: !lease.baseline_completed, state: lease };
}

function hasExpired(expiresAt, now) {
  if (!expiresAt) return false;
  const value = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt)
    ? Date.parse(`${expiresAt}T00:00:00Z`) + 86400000 : Date.parse(expiresAt);
  return Number.isFinite(value) && value <= now * 1000;
}

export function aggregateEvidence(evidence, reports = [], now = nowSeconds()) {
  // Source listings and player reports are different evidence. An unchanged source
  // snapshot refreshes only its current members, never omitted historical claims.
  const fresh = evidence.filter(item => Number(item.observed_at) >= now - FRESH_SECONDS && Number(item.observed_at) <= now + 300);
  const domains = new Set(fresh.map(item => item.source_domain));
  const active = fresh.some(item => item.source_status === 'active' && !hasExpired(item.expires_at, now));
  const expired = fresh.some(item => item.source_status === 'expired' || hasExpired(item.expires_at, now));
  const working = reports.some(item => item.outcome === 'working' && now - item.reported_at <= FRESH_SECONDS);
  const failed = reports.some(item => item.outcome === 'failed' && now - item.reported_at <= FRESH_SECONDS);
  let status = 'unverified';
  if ((expired && (active || working)) || (working && failed)) status = 'disputed';
  else if (expired) status = 'expired';
  else if (working) status = 'player_confirmed';
  else if (domains.size >= 2) status = 'corroborated';
  else if (failed) status = 'disputed';
  else if (active) status = 'likely_active';
  return { status, sourceCount: domains.size };
}

export async function initializeSources(db, now = nowSeconds()) {
  await db.batch([
    ...SOURCES.map(source => statement(db, 'INSERT OR IGNORE INTO sources(id,name,url,enabled) VALUES(?,?,?,?)', source.id, source.name, source.pageUrl || source.url, source.enabled ? 1 : 0)),
    ...HISTORICAL_CODES.map(code => statement(db, 'INSERT OR IGNORE INTO codes(code,first_seen,last_seen,historical,baseline,last_changed) VALUES(?,?,?,1,1,?)', code, now, now, now)),
    ...HISTORICAL_CODES.map(code => statement(db, "INSERT OR IGNORE INTO notifications(code,state,created_at) VALUES(?,'suppressed',?)", code, now)),
  ]);
}

async function snapshot(items) {
  // Hash relevant observations only. Source ordering and fetch/check timestamps
  // must not turn an unchanged archive into hundreds of writes.
  const normalized = items.map(item => ({
    code: String(item.code).trim().toUpperCase(), rewards: item.rewards || null,
    sourceUrl: item.sourceUrl, sourceDomain: item.sourceDomain, sourceStatus: item.sourceStatus,
    announcedAt: item.announcedAt || null, expiresAt: item.expiresAt || null, restrictions: item.restrictions || null,
  })).filter(item => /^[A-Z0-9][A-Z0-9_-]{1,47}$/.test(item.code)).sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const json = JSON.stringify(normalized);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { json, hash, count: normalized.length };
}

async function persistSnapshot(db, source, result, lease, now) {
  const data = await snapshot(result.items);
  if (source.snapshot_hash === data.hash) {
    await run(db, 'UPDATE sources SET last_checked=?,last_success=?,last_error=NULL,last_status=?,last_count=?,backoff_until=0 WHERE id=?', now, now, result.statusCode || 200, data.count, source.id);
    return { changed: false, discovered: 0 };
  }
  const generation = Number(source.current_generation || 0) + 1;
  const baseline = lease.baseline || source.last_success === null ? 1 : 0;
  const batch = [
    statement(db, `INSERT INTO codes(code,rewards,first_seen,last_seen,baseline,expires_at,restrictions,announced_at,last_changed)
      SELECT json_extract(value,'$.code'),json_extract(value,'$.rewards'),?2,?2,?3,
        json_extract(value,'$.expiresAt'),json_extract(value,'$.restrictions'),json_extract(value,'$.announcedAt'),?2
      FROM json_each(?1) WHERE 1 ON CONFLICT(code) DO NOTHING`, data.json, now, baseline),
    // Freeze a disappeared member at its last actual successful observation. It
    // must not borrow subsequent last_success values from a snapshot omitting it.
    statement(db, `UPDATE code_evidence SET observed_at=MAX(observed_at,?3)
      WHERE source_id=?2 AND snapshot_generation=?4 AND observed_at<?3
      AND code NOT IN (SELECT json_extract(value,'$.code') FROM json_each(?1))`, data.json, source.id, source.last_success || now, Number(source.current_generation || 0)),
    statement(db, `INSERT INTO code_evidence(code,source_id,source_url,source_domain,source_status,rewards,observed_at,expires_at,announced_at,restrictions,snapshot_generation)
      SELECT json_extract(value,'$.code'),?2,json_extract(value,'$.sourceUrl'),json_extract(value,'$.sourceDomain'),
        json_extract(value,'$.sourceStatus'),json_extract(value,'$.rewards'),?3,json_extract(value,'$.expiresAt'),
        json_extract(value,'$.announcedAt'),json_extract(value,'$.restrictions'),?4
      FROM json_each(?1) WHERE 1 ON CONFLICT(code,source_id) DO UPDATE SET
        source_url=excluded.source_url,source_domain=excluded.source_domain,source_status=excluded.source_status,
        rewards=COALESCE(excluded.rewards,code_evidence.rewards),observed_at=excluded.observed_at,
        expires_at=excluded.expires_at,announced_at=excluded.announced_at,restrictions=excluded.restrictions,
        snapshot_generation=excluded.snapshot_generation`, data.json, source.id, now, generation),
    statement(db, `INSERT OR IGNORE INTO notifications(code,state,created_at)
      SELECT c.code,'suppressed',?2 FROM codes c JOIN json_each(?1) j ON c.code=json_extract(j.value,'$.code')
      WHERE (c.baseline=1 OR c.historical=1) AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.code=c.code)`, data.json, now),
    statement(db, `UPDATE sources SET last_checked=?,last_success=?,last_error=NULL,last_status=?,last_count=?,backoff_until=0,
      snapshot_hash=?,current_generation=? WHERE id=?`, now, now, result.statusCode || 200, data.count, data.hash, generation, source.id),
  ];
  // One transactional D1 subrequest for an entire source, including its generation
  // publication. JSON1 avoids thousands of parameter-bound row statements.
  const results = await db.batch(batch);
  return { changed: true, discovered: Number(results[0]?.meta?.changes || 0) };
}

export async function executeScan(env, lease, { fetcher = fetch, now = nowSeconds() } = {}) {
  if (!lease?.acquired || !lease.id) return { ok: false, skipped: true, successes: 0, failures: 0, discovered: 0 };
  const db = env.DB;
  let successes = 0, failures = 0, discovered = 0, changed = false;
  try {
    const configured = await rows(db, 'SELECT * FROM sources WHERE enabled=1');
    const byId = new Map(configured.map(source => [source.id, source]));
    const enabled = SOURCES.filter(source => byId.has(source.id) && byId.get(source.id).backoff_until <= now);
    const results = await Promise.all(enabled.map(source => fetchSource({ ...source, enabled: true }, { fetch: fetcher, now: new Date(now * 1000) })));
    for (const result of results) {
      const source = byId.get(result.sourceId);
      if (!result.ok) {
        failures++;
        const suggested = result.retryAfterAt ? Math.ceil(Date.parse(result.retryAfterAt) / 1000) : 0;
        const defaultBackoff = now + ([401, 403, 429].includes(result.statusCode) ? 3600 : 900);
        const backoff = Math.max(defaultBackoff, Number.isFinite(suggested) ? suggested : 0);
        await run(db, 'UPDATE sources SET last_checked=?,last_error=?,last_status=?,backoff_until=? WHERE id=?', now, String(result.error || 'Source unavailable').slice(0, 240), result.statusCode || 0, backoff, result.sourceId);
        continue;
      }
      successes++;
      const saved = await persistSnapshot(db, source, result, lease, now);
      changed ||= saved.changed;
      discovered += saved.discovered;
    }
    await recomputeStatuses(db, now, { refreshMetadata: changed });
    const pending = await one(db, 'SELECT COUNT(*) AS n FROM sources WHERE enabled=1 AND last_success IS NULL');
    const finished = Math.max(now, nowSeconds());
    await db.batch([
      statement(db, `UPDATE scan_state SET lease_until=0,lease_id=NULL,last_finished=?,last_success=CASE WHEN ?>0 THEN ? ELSE last_success END,
        baseline_completed=CASE WHEN ?=0 THEN 1 ELSE baseline_completed END,last_error=? WHERE id=1 AND lease_id=?`, finished, successes, finished, pending.n, failures ? `${failures} source(s) failed; cached evidence retained.` : null, lease.id),
      statement(db, 'UPDATE scan_runs SET finished_at=?,status=?,source_ok=?,source_failed=?,discovered=? WHERE id=?', finished, failures ? (successes ? 'partial' : 'failed') : enabled.length ? 'complete' : 'deferred', successes, failures, discovered, lease.id),
    ]);
    await cleanup(db, finished);
    return { ok: successes > 0, successes, failures, discovered, changed };
  } catch (error) {
    const message = String(error.message || 'Scan failed').slice(0, 240);
    const finished = Math.max(now, nowSeconds());
    await db.batch([
      statement(db, 'UPDATE scan_state SET lease_until=0,lease_id=NULL,last_finished=?,last_error=? WHERE id=1 AND lease_id=?', finished, message, lease.id),
      statement(db, "UPDATE scan_runs SET finished_at=?,status='failed' WHERE id=?", finished, lease.id),
    ]);
    throw error;
  }
}

export async function recomputeStatuses(db, now = nowSeconds(), { refreshMetadata = false } = {}) {
  const statements = [];
  if (refreshMetadata) statements.push(statement(db, `WITH ranked AS (
    SELECT e.*,row_number() OVER(PARTITION BY e.code ORDER BY e.rewards IS NULL,${SOURCE_PRIORITY},e.observed_at DESC) AS reward_rank,
      row_number() OVER(PARTITION BY e.code ORDER BY e.announced_at IS NULL,${SOURCE_PRIORITY},e.observed_at DESC) AS date_rank,
      row_number() OVER(PARTITION BY e.code ORDER BY e.restrictions IS NULL,${SOURCE_PRIORITY},e.observed_at DESC) AS restriction_rank,
      row_number() OVER(PARTITION BY e.code ORDER BY ${SOURCE_PRIORITY},e.observed_at DESC) AS expiry_rank
    FROM code_evidence e
  ), preferred AS (
    SELECT code,MAX(CASE WHEN reward_rank=1 THEN rewards END) AS rewards,
      MAX(CASE WHEN date_rank=1 THEN announced_at END) AS announced_at,
      MAX(CASE WHEN restriction_rank=1 THEN restrictions END) AS restrictions,
      MAX(CASE WHEN expiry_rank=1 THEN expires_at END) AS expires_at
    FROM ranked GROUP BY code
  ) UPDATE codes SET rewards=COALESCE(p.rewards,codes.rewards),announced_at=COALESCE(p.announced_at,codes.announced_at),
      restrictions=p.restrictions,expires_at=p.expires_at
    FROM preferred p WHERE codes.code=p.code AND
      (codes.rewards IS NOT COALESCE(p.rewards,codes.rewards) OR codes.announced_at IS NOT COALESCE(p.announced_at,codes.announced_at)
       OR codes.restrictions IS NOT p.restrictions OR codes.expires_at IS NOT p.expires_at)`));

  statements.push(statement(db, `WITH fresh AS (
    SELECT e.*,CASE WHEN ${EXPIRY_SECONDS}<=?1 THEN 1 ELSE 0 END AS dated_expired
    FROM code_evidence e LEFT JOIN sources s ON s.id=e.source_id
    WHERE ${CURRENT_OBSERVATION}>=?2 AND ${CURRENT_OBSERVATION}<=?1+300
  ), evidence_summary AS (
    SELECT code,COUNT(DISTINCT source_domain) AS source_count,
      MAX(CASE WHEN source_status='active' AND dated_expired=0 THEN 1 ELSE 0 END) AS active,
      MAX(CASE WHEN source_status='expired' OR dated_expired=1 THEN 1 ELSE 0 END) AS expired
    FROM fresh GROUP BY code
  ), report_summary AS (
    SELECT r.code,MAX(r.outcome='working') AS working,MAX(r.outcome='failed') AS failed
    FROM reports r JOIN users u ON u.id=r.user_id
    WHERE u.status='approved' AND r.reported_at>=?2 GROUP BY r.code
  ), calculated AS (
    SELECT c.code,COALESCE(e.source_count,0) AS source_count,CASE
      WHEN (e.expired=1 AND (e.active=1 OR r.working=1)) OR (r.working=1 AND r.failed=1) THEN 'disputed'
      WHEN e.expired=1 THEN 'expired' WHEN r.working=1 THEN 'player_confirmed'
      WHEN e.source_count>=2 THEN 'corroborated' WHEN r.failed=1 THEN 'disputed'
      WHEN e.active=1 THEN 'likely_active' ELSE 'unverified' END AS status
    FROM codes c LEFT JOIN evidence_summary e ON e.code=c.code LEFT JOIN report_summary r ON r.code=c.code
  ) UPDATE codes SET status=x.status,source_count=x.source_count,last_changed=?1
    FROM calculated x WHERE codes.code=x.code AND (codes.status<>x.status OR codes.source_count<>x.source_count)`, now, now - FRESH_SECONDS));

  statements.push(statement(db, `INSERT INTO notifications(code,state,created_at)
    SELECT c.code,'pending',? FROM codes c WHERE c.baseline=0 AND c.historical=0 AND c.status='corroborated' AND c.source_count>=2
      AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.code=c.code)`, now));
  return db.batch(statements);
}

export async function codeList(db, subject, now = nowSeconds()) {
  const [codes, evidence, redeemed, sourceState, scan] = await Promise.all([
    rows(db, "SELECT * FROM codes ORDER BY COALESCE(announced_at,'') DESC,first_seen DESC,code LIMIT 1500"),
    rows(db, `SELECT e.code,e.source_id,e.source_url,e.source_domain,e.source_status,e.rewards,e.expires_at,e.announced_at,e.restrictions,
      e.snapshot_generation,e.observed_at AS recorded_at,${CURRENT_OBSERVATION} AS observed_at,
      CASE WHEN e.snapshot_generation=s.current_generation THEN 1 ELSE 0 END AS in_current_snapshot
      FROM code_evidence e LEFT JOIN sources s ON s.id=e.source_id ORDER BY observed_at DESC`),
    rows(db, 'SELECT code FROM redemptions WHERE subject=?', subject),
    rows(db, 'SELECT * FROM sources'), one(db, 'SELECT * FROM scan_state WHERE id=1'),
  ]);
  const redeemedSet = new Set(redeemed.map(item => item.code));
  const grouped = new Map();
  for (const item of evidence) {
    if (!grouped.has(item.code)) grouped.set(item.code, []);
    grouped.get(item.code).push(item);
  }
  return {
    codes: codes.map(code => {
      const sources = grouped.get(code.code) || [];
      return { ...code, last_seen: Math.max(code.last_seen, ...sources.map(item => item.observed_at)),
        redeemed: redeemedSet.has(code.code), isNew: !code.historical && !code.baseline && now - code.first_seen < FRESH_SECONDS, sources };
    }),
    sources: sourceState, scan, serverTime: now,
  };
}

async function cleanup(db, now) {
  await db.batch([
    statement(db, 'DELETE FROM rate_limits WHERE reset_at<?', now - 86400),
    statement(db, 'DELETE FROM sessions WHERE expires_at<?', now - 86400),
    statement(db, 'DELETE FROM audit WHERE at<?', now - 90 * 86400),
    statement(db, 'DELETE FROM scan_runs WHERE started_at<?', now - 30 * 86400),
  ]);
}
