#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flags, configuration, client, list, managedTargets, assertCentral, assertOwner, policySnapshot, same, record } from './deploy.mjs';

export async function rollback(argv = process.argv.slice(2)) {
  const options = flags(argv, ['--sessions-revoked']);
  if (options.has('--help')) { console.log('node scripts/rollback-gates.mjs [--apply] [--sessions-revoked]\nDefault: read-only plan. First --apply removes only the six central legacy-app policies and leaves gates intact. After revoking all existing non-owner Access sessions for these apps, rerun --apply --sessions-revoked to remove the exact recorded routes.'); return; }
  const { manifest } = await configuration(), api = client(), base = `/accounts/${manifest.accountId}`;
  const targets = managedTargets(manifest).filter(x => x.access_mode === 'gate');
  const routes = await list(api, `/zones/${manifest.zoneId}/workers/routes`), plan = [];
  for (const target of targets) {
    const path = base + '/access/apps/' + target.access_app_id;
    const app = (await api('GET', path)).result, policies = await list(api, path + '/policies');
    assertOwner(app, policies, target, manifest);
    const central = policies.find(p => p.id === target.policyId);
    if (central) assertCentral(central, target, manifest);
    const route = routes.find(r => r.id === target.routeId);
    if (route && (route.pattern !== target.pattern || route.script !== manifest.workerName)) throw new Error('Recorded route now belongs to another pattern or Worker: ' + target.id);
    // Never remove a gate if an unrecorded delegated allow or bypass policy remains.
    for (const policy of policies.filter(p => p.id !== target.policyId && ['allow', 'bypass', 'non_identity'].includes(p.decision))) {
      if (policy.decision !== 'allow' || !policy.include?.length || policy.include.some(rule => Object.keys(rule).length !== 1 || rule.email?.email?.toLowerCase() !== manifest.ownerEmail.toLowerCase())) throw new Error('Another policy can admit non-owner traffic. Leave gates in place and review: ' + target.id);
    }
    plan.push({ target, path, central, route, otherPolicies: policySnapshot(policies, target.policyId) });
  }
  console.log(JSON.stringify({ mode: options.has('--apply') ? 'apply' : 'dry-run', removePoliciesFirst: plan.filter(p => p.central).map(p => ({ app: p.target.id, policyId: p.target.policyId })), routesAfterSessionRevocation: plan.filter(p => p.route).map(p => ({ app: p.target.id, routeId: p.target.routeId, pattern: p.target.pattern })), sessionsRevokedAcknowledged: options.has('--sessions-revoked'), retained: ['original owner policies and Cloudflare IdP', 'owner admin routes', 'Code Bot domain and login policy', 'D1 data, grants, sessions, and audit history', 'Worker and cron'] }, null, 2));
  if (!options.has('--apply')) return;
  for (const item of plan) if (item.central) {
    const policies = await list(api, item.path + '/policies');
    const current = policies.find(p => p.id === item.target.policyId);
    if (current) { assertCentral(current, item.target, manifest); await api('DELETE', item.path + '/policies/' + item.target.policyId); }
  }
  // Verify all six policy removals before considering even the first route removal.
  for (const item of plan) {
    const policies = await list(api, item.path + '/policies');
    if (policies.some(p => p.id === item.target.policyId) || !same(policySnapshot(policies, item.target.policyId), item.otherPolicies)) throw new Error('Policy removal/preservation check failed; gates remain in place.');
  }
  await record('rollback-policies', { policiesRemoved: plan.map(p => ({ app: p.target.id, policyId: p.target.policyId })), routesRemoved: false });
  if (!options.has('--sessions-revoked')) {
    console.error('STOP: central policies are removed; all gateway routes remain. Revoke existing non-owner Access sessions for these applications in Cloudflare. Application/D1 logout is insufficient. Then rerun with --apply --sessions-revoked. Owner sessions need not be revoked.');
    process.exitCode = 2; return;
  }
  // The flag attests a manual Cloudflare revocation AFTER policy removal. Never infer this from D1 sessions.
  if (plan.some(p => p.central)) throw new Error('Policies were present at the start of this run. Gates remain. Complete non-owner Access revocation now, then run again with --sessions-revoked.');
  for (const item of plan) if (item.route) {
    const policies = await list(api, item.path + '/policies');
    if (policies.some(p => p.id === item.target.policyId) || !same(policySnapshot(policies), item.otherPolicies)) throw new Error('Access policies changed before route removal; stopped with remaining gates intact.');
    const current = (await list(api, `/zones/${manifest.zoneId}/workers/routes`)).find(r => r.id === item.target.routeId);
    if (current && (current.pattern !== item.target.pattern || current.script !== manifest.workerName)) throw new Error('Route changed concurrently; stopped.');
    if (current) await api('DELETE', `/zones/${manifest.zoneId}/workers/routes/${item.target.routeId}`);
    console.log('Removed gateway route:', item.target.pattern);
  }
  await record('rollback-complete', { routesRemoved: plan.map(p => ({ app: p.target.id, routeId: p.target.routeId })), nonOwnerAccessSessionsManuallyRevoked: true });
  console.log('Legacy gates rolled back to original owner-only Access policies. D1 and Code Bot are retained.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) rollback().catch(error => { console.error(error.message); process.exitCode = 1; });
