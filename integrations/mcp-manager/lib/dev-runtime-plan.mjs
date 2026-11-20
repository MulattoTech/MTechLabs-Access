import path from 'node:path';

const fail = () => { throw new Error('invalid_dev_runtime_plan'); };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
const text = (value, pattern) => typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value) && pattern.test(value);
function sid(value) {
  return text(value, /^S-1-5-21-(?:0|[1-9]\d{0,9})-(?:0|[1-9]\d{0,9})-(?:0|[1-9]\d{0,9})-(?:0|[1-9]\d{0,9})$/) &&
    value.split('-').slice(4).every(part => Number(part) <= 4294967295);
}
export function windowsPath(value) {
  if (!text(value, /^[a-z]:[\\/]/i) || value.length > 1024) fail();
  if (value.slice(3).split(/[\\/]/).some(part => part !== '.' && part !== '..' &&
      (/[ .]$/.test(part) || /[<>:"|?*\x00-\x1f\x7f]/.test(part) ||
       /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) fail();
  return path.win32.resolve(value).toLowerCase();
}
export function profileOverlap(left, right) {
  const a = windowsPath(left), b = windowsPath(right);
  return [path.win32.relative(a, b), path.win32.relative(b, a)].some(relative =>
    relative === '' || (!path.win32.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\')));
}
function endpoint(value) {
  if (typeof value !== 'string' || value.length > 256) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/mcp' || url.search || url.hash || url.hostname.endsWith('.') ||
      !/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/.test(url.hostname) ||
      /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.href !== value) fail();
  return url.href;
}
function role(value, isProduction = false) {
  exact(value, ['principalSid', 'profileDirectory', 'manager', 'routing']);
  if (!sid(value.principalSid)) fail();
  windowsPath(value.profileDirectory);
  exact(value.manager, ['nodePath', 'entryPath', 'configPath', 'port']);
  for (const key of ['nodePath', 'entryPath', 'configPath']) windowsPath(value.manager[key]);
  if (!Number.isInteger(value.manager.port) || value.manager.port < 1024 || value.manager.port > 65535) fail();
  exact(value.routing, ['resource', 'origin', 'backendId', 'accessAppId', 'audience', 'connectorAppId', 'originHostHeader']);
  const routing = value.routing;
  endpoint(routing.resource); endpoint(routing.origin);
  // Describe the existing production origin without changing its working Host
  // rewrite. DEV remains restricted to its exact loopback Host declaration.
  const productionOriginHost = isProduction && routing.originHostHeader === new URL(routing.origin).hostname;
  if (routing.resource === routing.origin || !text(routing.backendId, /^[a-z][a-z0-9-]{0,63}$/) ||
      !text(routing.accessAppId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/) ||
      !text(routing.audience, /^[a-f0-9]{64}$/) || !text(routing.connectorAppId, /^asdk_app_[a-f0-9]{32}$/) ||
      (routing.originHostHeader !== '127.0.0.1:' + value.manager.port && !productionOriginHost)) fail();
  return Object.freeze({ ...value, manager: Object.freeze({ ...value.manager }), routing: Object.freeze({ ...routing }) });
}

export function validateRuntimePlan(input) {
  exact(input, ['schemaVersion', 'platform', 'instanceId', 'authorizationMode', 'production', 'development']);
  if (input.schemaVersion !== 1 || input.platform !== 'win32' || input.authorizationMode !== 'owner-only' ||
      !text(input.instanceId, /^dev(?:-[a-z0-9]+)*$/) || input.instanceId.length > 48) fail();
  const production = role(input.production, true), development = role(input.development);
  if (production.principalSid === development.principalSid ||
      profileOverlap(production.profileDirectory, development.profileDirectory) ||
      production.manager.port !== 19740 || development.manager.port === 19740) fail();
  const controls = [production, development].flatMap(value => ['entryPath', 'configPath'].map(key => windowsPath(value.manager[key])));
  if (new Set(controls).size !== 4) fail();
  for (const key of ['backendId', 'accessAppId', 'audience', 'connectorAppId']) {
    if (production.routing[key] === development.routing[key]) fail();
  }
  const urls = [production.routing.resource, production.routing.origin, development.routing.resource, development.routing.origin];
  if (new Set(urls.map(value => new URL(value).origin)).size !== 4) fail();
  return Object.freeze({ ...input, production, development });
}

function observedIdentity(value) {
  if (!value || !sid(value.sid) ||
      !Number.isInteger(value.pid) || value.pid <= 0 || value.pid > 4294967295 ||
      !text(value.creationFileTime, /^[1-9]\d{0,18}$/) || BigInt(value.creationFileTime) > 9223372036854775807n) return false;
  try { windowsPath(value.profileDirectory); return true; } catch { return false; }
}
function identityResult(observation, expected, listener = false) {
  if (observation?.status === 'absent') return { status: 'absent' };
  if (observation?.status !== 'observed' || !observedIdentity(observation) ||
      (listener && observation.invocationMatched !== true)) return { status: 'unverified' };
  return { status: observation.sid === expected.principalSid &&
    windowsPath(observation.profileDirectory) === windowsPath(expected.profileDirectory) ? 'matched' : 'mismatched' };
}

export function evaluateRuntime(planInput, observation, environment = {}) {
  const plan = validateRuntimePlan(planInput);
  const current = identityResult(observation?.current, plan.development);
  const production = identityResult(observation?.production, plan.production, true);
  const development = identityResult(observation?.development, plan.development, true);
  let environmentStatus = current.status === 'matched' ? 'matched' : 'unverified';
  if (current.status === 'matched') {
    for (const key of ['HOME', 'USERPROFILE']) {
      if (environment[key] !== undefined) {
        try { if (windowsPath(environment[key]) !== windowsPath(observation.current.profileDirectory)) environmentStatus = 'redirected'; }
        catch { environmentStatus = 'redirected'; }
      }
    }
    for (const key of ['APPDATA', 'LOCALAPPDATA']) {
      if (environment[key] !== undefined) {
        try {
          const relative = path.win32.relative(windowsPath(observation.current.profileDirectory), windowsPath(environment[key]));
          if (!relative || path.win32.isAbsolute(relative) || relative === '..' || relative.startsWith('..\\')) environmentStatus = 'redirected';
        } catch { environmentStatus = 'redirected'; }
      }
    }
  }
  const reasons = [];
  if (current.status !== 'matched') reasons.push('current_dev_identity_' + current.status);
  if (production.status !== 'matched') reasons.push('production_listener_' + production.status);
  if (development.status !== 'matched') reasons.push('development_listener_' + development.status);
  if (environmentStatus !== 'matched') reasons.push('profile_environment_' + environmentStatus);
  if (environment.NODE_OPTIONS || environment.NODE_PATH) reasons.push('node_preload_environment_rejected');
  reasons.push('cross_account_access_unverified', 'upstream_roots_unverified', 'live_routing_and_oauth_grants_unverified', 'dev_upstream_disabled');
  return {
    schemaVersion: 1, instanceId: plan.instanceId, mode: 'read-only',
    currentIdentity: current, productionListener: production, developmentListener: development,
    profileEnvironment: environmentStatus,
    routing: { declaredDistinct: true, authorizationMode: 'owner-only', liveVerified: false, oauthGrantsVerified: false },
    runningSourceVerified: false, qualified: false, upstreamEnabled: false, reasons,
  };
}
