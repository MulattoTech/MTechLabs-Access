#!/usr/bin/env node
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const APP_FIELDS = ['allow_authenticate_via_warp','allow_iframe','allowed_idps','app_launcher_visible','auto_redirect_to_identity','cors_headers','custom_deny_message','custom_deny_url','custom_non_identity_deny_url','custom_pages','destinations','domain','eager_redirect_cookie_setting','enable_binding_cookie','http_only_cookie_attribute','logo_url','mfa_config','name','oauth_configuration','options_preflight_bypass','path_cookie_attribute','read_service_tokens_from_header','same_site_cookie_attribute','scim_config','self_hosted_domains','service_auth_401_redirect','session_duration','skip_interstitial','tags','type','use_clientless_isolation_app_launcher_url'];
export const POLICY_FIELDS = ['precedence','approval_groups','approval_required','connection_rules','isolation_required','mfa_config','purpose_justification_prompt','purpose_justification_required','session_duration','decision','exclude','include','name','policy_resolution_account_id','require'];
export const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
export const same = (a, b) => canonical(a) === canonical(b);
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function flags(argv, allowed = []) {
  const known = new Set(['--apply', '--help', ...allowed]);
  for (const arg of argv) if (!known.has(arg)) throw new Error('Unknown option: ' + arg);
  return new Set(argv);
}
export async function configuration() {
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'deployment.json'), 'utf8'));
  // This repository deliberately keeps wrangler.jsonc as strict JSON.
  const wrangler = JSON.parse(await readFile(resolve(ROOT, 'wrangler.jsonc'), 'utf8'));
  if (manifest.workerName !== wrangler.name || manifest.databaseId !== wrangler.d1_databases?.find(x => x.binding === 'DB')?.database_id || manifest.accountId !== wrangler.vars?.ACCOUNT_ID) throw new Error('deployment.json and wrangler.jsonc disagree.');
  if (!/^[a-f0-9]{32}$/.test(manifest.accountId) || !/^[a-f0-9]{32}$/.test(manifest.zoneId)) throw new Error('Invalid deployment account or zone.');
  return { manifest, wrangler };
}
export function client(token = process.env.CLOUDFLARE_API_TOKEN, fetcher = fetch) {
  if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN in the environment; never put it in a file or command argument.');
  return async function api(method, path, body, { optional = false } = {}) {
    if (!path.startsWith('/accounts/') && !path.startsWith('/zones/')) throw new Error('Unexpected API path.');
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetcher('https://api.cloudflare.com/client/v4' + path, { method, headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if (optional && response.status === 404) return null;
    let data; try { data = await response.json(); } catch { throw new Error(`Cloudflare ${method} failed: HTTP ${response.status}, non-JSON response.`); }
    if (!response.ok || data.success === false) {
      // Do not log API response bodies: IdP responses may contain credentials.
      const codes = (data.errors || []).map(x => x.code).filter(x => Number.isInteger(x)).join(',');
      throw new Error(`Cloudflare ${method} ${path.split('?')[0]} failed: HTTP ${response.status}; error codes ${codes || 'unavailable'}.`);
    }
    return { result: data.result, info: data.result_info };
  };
}
export async function list(api, path) {
  const result = [];
  for (let page = 1; page <= 100; page++) {
    const response = await api('GET', path + (path.includes('?') ? '&' : '?') + `page=${page}&per_page=100`);
    if (!Array.isArray(response.result)) throw new Error('Unexpected list response.');
    result.push(...response.result);
    if (response.info?.total_pages ? page >= response.info.total_pages : response.result.length < 100) return result;
  }
  throw new Error('Pagination exceeded the safety limit.');
}
export async function query(api, manifest, body) {
  const response = await api('POST', `/accounts/${manifest.accountId}/d1/database/${manifest.databaseId}/query`, body);
  if (!Array.isArray(response.result) || response.result.some(x => x.success === false || x.error)) throw new Error('D1 query did not complete successfully.');
  return response.result;
}
export function managedTargets(manifest) {
  const apps = manifest.applications.filter(x => x.managed === 1 && ['gate', 'native'].includes(x.access_mode));
  if (apps.length !== 7 || apps.filter(x => x.access_mode === 'native').some(x => x.id !== 'codes')) throw new Error('Expected exactly six legacy gates and the codes application; review changed scope manually.');
  return apps.map(app => {
    const gate = manifest.gates?.find(x => x.appId === app.id);
    const policyId = app.id === 'codes' ? manifest.codePolicyId : gate?.policyId;
    if (!app.access_app_id || !policyId || (app.id !== 'codes' && (!gate.routeId || gate.pattern !== app.hostname + '/*'))) throw new Error('Missing exact route/policy identity for ' + app.id);
    return { ...app, ...gate, policyId };
  });
}
export function assertCentral(policy, target, manifest) {
  const codes = manifest.applications.find(x => x.id === 'codes');
  const expected = { evaluate_url: `https://${codes.hostname}/__access/evaluate/${target.id}`, keys_url: `https://${codes.hostname}/.well-known/access-evaluation-keys` };
  if (policy.id !== target.policyId || policy.reusable === true || policy.decision !== 'allow' || policy.include?.length !== 1 || !same(policy.include[0], { external_evaluation: expected })) throw new Error('Central policy does not match the recorded application/endpoint: ' + target.id);
}
export function assertOwner(app, policies, target, manifest) {
  if (app.id !== target.access_app_id || app.type !== 'self_hosted' || !app.allowed_idps?.includes(manifest.cloudflareIdp)) throw new Error('Original Cloudflare owner provider is missing or app type changed: ' + target.id);
  const expected = target.hostname + (target.id === 'codes' ? '/auth/access' : '');
  if (app.domain !== expected && !app.destinations?.some(x => x.type === 'public' && x.uri === expected)) throw new Error('Application hostname/path drift: ' + target.id);
  const owner = policies.filter(p => p.id !== target.policyId && p.decision === 'allow' && p.include?.some(r => r.email?.email?.toLowerCase() === manifest.ownerEmail.toLowerCase()));
  if (!owner.length) throw new Error('Original owner allow policy is missing: ' + target.id);
}
export function policySnapshot(policies, omitId) {
  return policies.filter(p => p.id !== omitId).map(p => ({ id: p.id, ...pick(p, POLICY_FIELDS) })).sort((a, b) => a.id.localeCompare(b.id));
}
export async function record(name, value) {
  const folder = resolve(ROOT, 'dist', 'operations');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = resolve(folder, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.json`);
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  console.log('Local operation receipt:', path);
}
export function initialSchema(sql) {
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  for (const statement of statements) {
    if (/^CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s+IF\s+NOT\s+EXISTS\b/i.test(statement)) continue;
    if (/^PRAGMA\s+foreign_keys\s*=\s*ON$/i.test(statement)) continue;
    if (/^INSERT OR IGNORE INTO guild_access\(id,enabled,version,updated_at\) VALUES\(1,0,0,0\)$/i.test(statement)) continue;
    if (/^INSERT OR IGNORE INTO scan_state\(id\) VALUES\(1\)$/i.test(statement)) continue;
    throw new Error('Initial schema contains a statement outside the reviewed additive bootstrap. Write a reviewed migration instead.');
  }
  return statements;
}
export async function deploy(argv = process.argv.slice(2)) {
  const options = flags(argv);
  if (options.has('--help')) { console.log('node scripts/deploy.mjs [--apply]\nDefault: local dry run. --apply updates the existing Worker and schedule, preserves secrets, and reapplies only the additive initial schema.'); return; }
  const { manifest, wrangler } = await configuration();
  const migrations = (await readdir(resolve(ROOT, 'migrations'))).filter(x => x.endsWith('.sql'));
  if (migrations.length !== 1 || migrations[0] !== '0001.sql') throw new Error('Schema has evolved. Review and apply new migrations separately before using this initial-schema deployer.');
  const schema = await readFile(resolve(ROOT, 'migrations/0001.sql'), 'utf8');
  const statements = initialSchema(schema);
  await import('./build.mjs');
  const modules = (await readdir(resolve(ROOT, 'src'))).filter(x => x.endsWith('.js')).sort();
  const bindings = [{ type: 'd1', name: 'DB', id: manifest.databaseId }, ...Object.entries(wrangler.vars).map(([name, text]) => ({ type: 'plain_text', name, text: String(text) }))];
  if (bindings.some(x => /TOKEN|SECRET|PRIVATE|PASSWORD/.test(x.name))) throw new Error('Sensitive value found in plain-text Worker vars. Use Worker secrets.');
  const metadata = { main_module: 'src/index.js', bindings, keep_bindings: ['secret_text'], compatibility_date: wrangler.compatibility_date,
    compatibility_flags: wrangler.compatibility_flags || [], observability: wrangler.observability };
  console.log(JSON.stringify({ mode: options.has('--apply') ? 'apply' : 'dry-run', worker: manifest.workerName, database: manifest.databaseId, modules, initialSchemaStatements: statements.length,
    cron: wrangler.triggers.crons, preserveSecretTypes: metadata.keep_bindings, changesAccessPoliciesOrRoutes: false }, null, 2));
  console.warn('Initial-schema bootstrap only: CREATE IF NOT EXISTS does not migrate changed columns. Existing application data is retained.');
  if (!options.has('--apply')) return;
  const api = client(), base = `/accounts/${manifest.accountId}/workers/scripts/${encodeURIComponent(manifest.workerName)}`;
  const current = (await api('GET', base + '/settings')).result;
  if (!current.bindings?.some(x => x.name === 'EVALUATION_PRIVATE_JWK' && x.type === 'secret_text')) throw new Error('Existing EVALUATION_PRIVATE_JWK Worker secret is required. This script never generates or prints private keys.');
  if (!current.bindings.some(x => x.name === 'DB' && x.type === 'd1' && x.id === manifest.databaseId)) throw new Error('Existing Worker database binding differs; refusing to retarget production.');
  const names = new Set(bindings.map(x => x.name));
  for (const binding of current.bindings) if (binding.type !== 'secret_text' && !names.has(binding.name)) metadata.bindings.push({ type: 'inherit', name: binding.name });
  await query(api, manifest, { sql: schema });
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  for (const file of modules) form.append('src/' + file, new Blob([await readFile(resolve(ROOT, 'src', file))], { type: 'application/javascript+module' }), 'src/' + file);
  await api('PUT', base + '?bindings_inherit=strict', form);
  await api('PUT', base + '/schedules', wrangler.triggers.crons.map(cron => ({ cron })));
  const after = (await api('GET', base + '/settings')).result;
  for (const secret of current.bindings.filter(x => x.type === 'secret_text')) if (!after.bindings?.some(x => x.name === secret.name && x.type === 'secret_text')) throw new Error('Post-deploy secret-preservation check failed. Inspect the Worker immediately.');
  await record('deploy', { at: new Date().toISOString(), worker: manifest.workerName, database: manifest.databaseId, modules, cron: wrangler.triggers.crons, secretBindingsPreserved: true });
  console.log('Deployment complete. Check /health and authenticated owner/app requests before closing the change.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) deploy().catch(error => { console.error(error.message); process.exitCode = 1; });
