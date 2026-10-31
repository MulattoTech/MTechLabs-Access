#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, APP_FIELDS, POLICY_FIELDS, pick, same, flags, configuration, client, list, query, managedTargets, assertCentral, assertOwner, policySnapshot, record } from './deploy.mjs';

export function googleChanges(app, policy, googleId) {
  const requirements = policy.require || [];
  if (requirements.some(rule => rule.login_method && rule.login_method.id !== googleId)) throw new Error('Central policy already requires another login provider; review manually.');
  const updatedPolicy = { ...pick(policy, POLICY_FIELDS), require: requirements.some(rule => rule.login_method?.id === googleId) ? requirements : [...requirements, { login_method: { id: googleId } }] };
  const updatedApp = { ...pick(app, APP_FIELDS), allowed_idps: [...new Set([...app.allowed_idps, googleId])], auto_redirect_to_identity: false };
  return { updatedApp, updatedPolicy };
}
export async function finishGoogle(argv = process.argv.slice(2)) {
  const options = flags(argv);
  if (options.has('--help')) { console.log('GOOGLE_IDP_ID=<existing-cloudflare-google-idp-uuid> node scripts/finish-google.mjs [--apply]\nDefault: read-only live preflight and plan. Google OAuth credentials must already be configured securely in Cloudflare.'); return; }
  const googleId = process.env.GOOGLE_IDP_ID;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(googleId || '')) throw new Error('Set GOOGLE_IDP_ID to the real Cloudflare Google identity provider UUID.');
  const { manifest } = await configuration(), api = client(), base = `/accounts/${manifest.accountId}`;
  const idp = (await api('GET', base + '/access/identity_providers/' + googleId)).result;
  if (idp.id !== googleId || idp.type !== 'google') throw new Error('GOOGLE_IDP_ID does not identify a Google provider in this Cloudflare account.');
  // Never log or write idp.config: it may contain OAuth credentials.
  const discovery = JSON.parse(await readFile(resolve(ROOT, 'docs/discovery-2026-10-30.json'), 'utf8'));
  const plan = [];
  for (const target of managedTargets(manifest)) {
    const path = base + '/access/apps/' + target.access_app_id;
    const app = (await api('GET', path)).result, policies = await list(api, path + '/policies');
    const central = policies.find(p => p.id === target.policyId);
    if (!central) throw new Error('Recorded central policy is missing: ' + target.id);
    assertOwner(app, policies, target, manifest); assertCentral(central, target, manifest);
    const original = discovery.accessPolicies.find(x => x.app_id === target.access_app_id)?.policies || [];
    for (const owner of original) if (!policies.some(p => p.id === owner.id && same(pick(p, POLICY_FIELDS), pick(owner, POLICY_FIELDS)))) throw new Error('Original policy drift detected; review before enabling Google: ' + target.id);
    plan.push({ target, path, app, central, otherPolicies: policySnapshot(policies, target.policyId), ...googleChanges(app, central, googleId) });
  }
  console.log(JSON.stringify({ mode: options.has('--apply') ? 'apply' : 'dry-run', googleIdpId: googleId, targets: plan.map(p => ({ app: p.target.id, applicationId: p.target.access_app_id, centralPolicyId: p.target.policyId, preserveOwnerIdp: manifest.cloudflareIdp, addGoogleProvider: !p.app.allowed_idps.includes(googleId), requireGoogleOnlyOnCentralPolicy: true })), finalDatabaseSettings: ['google_idp_id', 'google_status=configured'], callback: `https://${manifest.accessTeam}/cdn-cgi/access/callback` }, null, 2));
  if (!options.has('--apply')) return;
  await record('google-before', { googleIdpId: googleId, applications: plan.map(p => ({ id: p.target.access_app_id, allowedIdps: p.app.allowed_idps, autoRedirect: p.app.auto_redirect_to_identity, policyId: p.target.policyId, require: p.central.require || [] })) });
  for (const item of plan) {
    // Constrain the central policy before exposing Google as a login choice.
    const currentApp = (await api('GET', item.path)).result;
    const currentPolicies = await list(api, item.path + '/policies');
    if (!same(pick(currentApp, APP_FIELDS), pick(item.app, APP_FIELDS)) || !same(policySnapshot(currentPolicies), policySnapshot([item.central, ...item.otherPolicies]))) throw new Error('Concurrent Access configuration change detected. Stop and repeat the dry run.');
    await api('PUT', item.path + '/policies/' + item.target.policyId, item.updatedPolicy);
    await api('PUT', item.path, item.updatedApp);
    const afterApp = (await api('GET', item.path)).result, afterPolicies = await list(api, item.path + '/policies');
    assertOwner(afterApp, afterPolicies, item.target, manifest);
    if (!same(policySnapshot(afterPolicies, item.target.policyId), item.otherPolicies)) throw new Error('Owner/other policy preservation check failed. Inspect Access before continuing.');
    const afterCentral = afterPolicies.find(p => p.id === item.target.policyId);
    assertCentral(afterCentral, item.target, manifest);
    if (!afterApp.allowed_idps.includes(googleId) || !same(afterCentral.require, item.updatedPolicy.require)) throw new Error('Google provider or required policy rule was not retained.');
    for (const [key, value] of Object.entries(item.updatedApp)) if (!same(afterApp[key], value)) throw new Error('Writable application setting was not preserved: ' + item.target.id + '/' + key);
    console.log('Verified:', item.target.id);
  }
  // One atomic statement advertises readiness only after every remote update verified.
  await query(api, manifest, { sql: "INSERT INTO settings(key,value,updated_at) VALUES('google_idp_id',?,?),('google_status','configured',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params: [googleId, String(Math.floor(Date.now()/1000)), String(Math.floor(Date.now()/1000))] });
  await record('google-complete', { googleIdpId: googleId, applications: plan.map(p => p.target.id), status: 'configured' });
  console.log('Google configuration attached and verified. Test a fresh approved Google login and an unapproved account; this script does not perform browser OAuth or grant anyone access.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) finishGoogle().catch(error => { console.error(error.message); console.error('Stopped. No new configured marker is written on a failed run. Completed remote steps may remain; review and rerun.'); process.exitCode = 1; });
