import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRuntime, profileOverlap, validateRuntimePlan, windowsPath } from '../lib/dev-runtime-plan.mjs';

// Pure, synthetic evidence only. These tests never query a user, read a profile,
// open a listener, create a file, spawn a process, or contact a remote service.
function planFixture() {
  const role = (name, sid, port, digit) => ({
    principalSid: sid,
    profileDirectory: `C:\\Users\\fixture-${name}`,
    manager: {
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      entryPath: `C:\\Fixtures\\${name}\\admin.mjs`,
      configPath: `C:\\Fixtures\\${name}\\manager.json`,
      port,
    },
    routing: {
      resource: `https://${name}-mcp.example.test/mcp`,
      origin: `https://${name}-origin.example.test/mcp`,
      backendId: `fixture-${name}`,
      accessAppId: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
      audience: digit.repeat(64),
      connectorAppId: 'asdk_app_' + digit.repeat(32),
      originHostHeader: `127.0.0.1:${port}`,
    },
  });
  return {
    schemaVersion: 1,
    platform: 'win32',
    instanceId: 'dev-fixture',
    authorizationMode: 'owner-only',
    production: role('production', 'S-1-5-21-100-200-300-1001', 19740, '1'),
    development: role('development', 'S-1-5-21-100-200-300-1002', 19741, '2'),
  };
}

function observationFixture(plan = planFixture()) {
  const identity = (role, pid) => ({
    status: 'observed',
    sid: role.principalSid,
    profileDirectory: role.profileDirectory,
    pid,
    creationFileTime: '134385640000000000',
  });
  return {
    current: identity(plan.development, 1200),
    production: { ...identity(plan.production, 1600), invocationMatched: true },
    development: { ...identity(plan.development, 2000), invocationMatched: true },
  };
}

const invalidPlan = error => {
  assert.equal(error?.message, 'invalid_dev_runtime_plan');
  return true;
};
function rejectsPlan(name, mutate) {
  test(`runtime plan rejects ${name}`, () => {
    const input = planFixture();
    mutate(input);
    assert.throws(() => validateRuntimePlan(input), invalidPlan);
  });
}

test('runtime plan accepts a distinct synthetic declaration and freezes independent snapshots', () => {
  const input = planFixture();
  const result = validateRuntimePlan(input);
  assert.deepEqual(result, input);
  for (const object of [result, result.production, result.development,
    result.production.manager, result.development.manager, result.production.routing, result.development.routing]) {
    assert.equal(Object.isFrozen(object), true);
  }
  input.development.manager.port = 29999;
  input.production.routing.backendId = 'changed-after-validation';
  assert.equal(result.development.manager.port, 19741);
  assert.equal(result.production.routing.backendId, 'fixture-production');
  assert.equal(result.production.manager.nodePath, result.development.manager.nodePath,
    'read-only Node executable sharing is allowed; config and entry identities remain separate');
});

for (const [name, mutate] of [
  ['unsupported schema', p => { p.schemaVersion = 2; }],
  ['unsupported platform', p => { p.platform = 'linux'; }],
  ['implicit delegated grants', p => { p.authorizationMode = 'grants'; }],
  ['missing production reference', p => { delete p.production; }],
  ['an array in place of a role', p => { p.production = []; }],
  ['unknown top-level readiness', p => { p.qualified = true; }],
  ['unknown top-level isolation', p => { p.isolated = true; }],
  ['an upstream-enable claim', p => { p.upstreamEnabled = true; }],
  ['unknown principal attestation', p => { p.development.verified = true; }],
  ['unknown manager launch command', p => { p.development.manager.command = 'DO-NOT-EXECUTE'; }],
  ['unknown live-routing attestation', p => { p.development.routing.liveVerified = true; }],
  ['a missing nested field', p => { delete p.development.manager.configPath; }],
  ['a non-DEV instance label', p => { p.instanceId = 'production'; }],
  ['a noncanonical DEV instance label', p => { p.instanceId = 'dev--fixture'; }],
  ['an oversized DEV instance label', p => { p.instanceId = 'dev-' + 'a'.repeat(45); }],
]) rejectsPlan(name, mutate);

for (const input of [null, [], 'plan', 1, true]) {
  test(`runtime plan rejects non-object input ${JSON.stringify(input)}`, () => {
    assert.throws(() => validateRuntimePlan(input), invalidPlan);
  });
}

test('runtime plan accepts canonical DWORD SID boundaries without treating a username as identity', () => {
  const input = planFixture();
  input.development.principalSid = 'S-1-5-21-0-4294967295-1-4294967295';
  assert.equal(validateRuntimePlan(input).development.principalSid, input.development.principalSid);
});

for (const [name, value] of [
  ['a username', 'fixture-development'],
  ['lowercase SID prefix', 's-1-5-21-100-200-300-1002'],
  ['different SID revision', 'S-2-5-21-100-200-300-1002'],
  ['different SID authority', 'S-1-6-21-100-200-300-1002'],
  ['a service SID', 'S-1-5-18'],
  ['missing account RID', 'S-1-5-21-100-200-300'],
  ['extra SID subauthority', 'S-1-5-21-100-200-300-1002-1'],
  ['leading-zero domain subauthority', 'S-1-5-21-0100-200-300-1002'],
  ['leading-zero account RID', 'S-1-5-21-100-200-300-01002'],
  ['overflowing domain subauthority', 'S-1-5-21-4294967296-200-300-1002'],
  ['overflowing account RID', 'S-1-5-21-100-200-300-4294967296'],
  ['negative account RID', 'S-1-5-21-100-200-300--1'],
  ['exponential account RID', 'S-1-5-21-100-200-300-1e3'],
  ['fractional account RID', 'S-1-5-21-100-200-300-1002.0'],
  ['non-ASCII digits', 'S-1-5-21-100-200-300-１００２'],
  ['trailing SID newline', 'S-1-5-21-100-200-300-1002\n'],
]) rejectsPlan(name, p => { p.development.principalSid = value; });

rejectsPlan('the same principal with different declared profiles', p => {
  p.development.principalSid = p.production.principalSid;
});

for (const [name, value] of [
  ['drive-relative path', 'C:Users\\fixture-development'],
  ['unqualified relative path', 'Users\\fixture-development'],
  ['UNC profile', '\\\\server\\share\\fixture-development'],
  ['extended device path', '\\\\?\\C:\\Users\\fixture-development'],
  ['device namespace', '\\\\.\\C:\\Users\\fixture-development'],
  ['alternate data stream', 'C:\\Users\\fixture-development:stream'],
  ['trailing-dot component', 'C:\\Users.\\fixture-development'],
  ['trailing-space component', 'C:\\Users \\fixture-development'],
  ['wildcard component', 'C:\\Users\\fixture-*'],
  ['NUL control character', 'C:\\Users\\fixture-\0development'],
  ['DEL control character', 'C:\\Users\\fixture-\x7fdevelopment'],
  ['a reserved CON component', 'C:\\Users\\CON'],
  ['a reserved PRN extension', 'C:\\Users\\prn.txt'],
  ['a reserved AUX component', 'C:\\AUX\\fixture-development'],
  ['a reserved NUL extension', 'C:\\Users\\NuL.log'],
  ['a reserved COM device', 'C:\\Users\\COM1'],
  ['a reserved LPT extension', 'C:\\Users\\lpt9.json'],
]) rejectsPlan(name, p => { p.development.profileDirectory = value; });

test('Windows path comparison normalizes lexical aliases without equating similarly named siblings', () => {
  assert.equal(windowsPath('C:/Users/fixture-development/./x/../'), 'c:\\users\\fixture-development');
  for (const allowed of ['C:\\Users\\CONifer', 'C:\\Users\\NULled', 'C:\\Users\\COM10', 'C:\\Users\\LPT0']) {
    assert.equal(typeof windowsPath(allowed), 'string');
  }
  for (const [a, b, expected] of [
    ['C:\\Users\\A', 'c:/users/a', true],
    ['C:\\Users\\A', 'C:\\Users\\A\\child', true],
    ['C:\\Users\\A\\child', 'C:\\Users\\A', true],
    ['C:\\Users\\A', 'C:\\Users\\A\\child\\..', true],
    ['C:\\Users\\A', 'C:\\Users\\AB', false],
    ['C:\\Users\\A', 'C:\\Users\\B', false],
    ['C:\\Users\\A', 'D:\\Users\\A', false],
  ]) assert.equal(profileOverlap(a, b), expected, `${a} / ${b}`);
});

for (const [name, change] of [
  ['case-normalized profile equality', p => p.production.profileDirectory.toUpperCase()],
  ['slash-normalized profile equality', p => p.production.profileDirectory.replaceAll('\\', '/')],
  ['dot-segment profile equality', p => p.production.profileDirectory + '\\child\\..'],
  ['a child of the production profile', p => p.production.profileDirectory + '\\child'],
  ['an ancestor of the production profile', () => 'C:\\Users'],
]) rejectsPlan(name, p => { p.development.profileDirectory = change(p); });

for (const [name, mutate] of [
  ['a non-production production port', p => { p.production.manager.port = 19742; p.production.routing.originHostHeader = '127.0.0.1:19742'; }],
  ['the production port for DEV', p => { p.development.manager.port = 19740; p.development.routing.originHostHeader = '127.0.0.1:19740'; }],
  ['a privileged DEV port', p => { p.development.manager.port = 1023; p.development.routing.originHostHeader = '127.0.0.1:1023'; }],
  ['an overflowing DEV port', p => { p.development.manager.port = 65536; p.development.routing.originHostHeader = '127.0.0.1:65536'; }],
  ['a fractional DEV port', p => { p.development.manager.port = 19741.5; }],
  ['a string DEV port', p => { p.development.manager.port = '19741'; }],
  ['an incorrect Host rewrite port', p => { p.development.routing.originHostHeader = '127.0.0.1:19740'; }],
  ['a public Host rewrite', p => { p.development.routing.originHostHeader = 'development-origin.example.test'; }],
  ['a differently spelled Host rewrite', p => { p.development.routing.originHostHeader = 'localhost:19741'; }],
]) rejectsPlan(name, mutate);

test('runtime plan accepts unprivileged port boundaries with exact Host rewrites', () => {
  for (const port of [1024, 65535]) {
    const input = planFixture();
    input.development.manager.port = port;
    input.development.routing.originHostHeader = '127.0.0.1:' + port;
    assert.equal(validateRuntimePlan(input).development.manager.port, port);
  }
});

for (const [name, targetRole, targetKey, sourceRole, sourceKey] of [
  ['the same canonical entry', 'development', 'entryPath', 'production', 'entryPath'],
  ['the same canonical config', 'development', 'configPath', 'production', 'configPath'],
  ['DEV config aliasing the production entry', 'development', 'configPath', 'production', 'entryPath'],
  ['DEV entry aliasing the production config', 'development', 'entryPath', 'production', 'configPath'],
  ['production config aliasing its entry', 'production', 'configPath', 'production', 'entryPath'],
  ['DEV config aliasing its entry', 'development', 'configPath', 'development', 'entryPath'],
]) rejectsPlan(name, p => {
  p[targetRole].manager[targetKey] = p[sourceRole].manager[sourceKey].toUpperCase().replaceAll('\\', '/');
});

for (const key of ['backendId', 'accessAppId', 'audience', 'connectorAppId']) {
  rejectsPlan(`the production ${key} for DEV`, p => { p.development.routing[key] = p.production.routing[key]; });
}
for (const [name, mutate] of [
  ['the production public host reused as DEV origin', p => { p.development.routing.origin = p.production.routing.resource; }],
  ['the production origin reused as DEV public host', p => { p.development.routing.resource = p.production.routing.origin; }],
  ['one public/backend origin within a role', p => { p.development.routing.origin = p.development.routing.resource; }],
  ['an HTTP resource', p => { p.development.routing.resource = 'http://development-mcp.example.test/mcp'; }],
  ['a credential-bearing resource URL', p => { p.development.routing.resource = 'https://secret@development-mcp.example.test/mcp'; }],
  ['a resource URL with a query', p => { p.development.routing.resource += '?grant=PRIVATE'; }],
  ['a resource URL with a fragment', p => { p.development.routing.resource += '#PRIVATE'; }],
  ['a resource URL with another path', p => { p.development.routing.resource += '/other'; }],
  ['a resource URL with an explicit port', p => { p.development.routing.resource = 'https://development-mcp.example.test:443/mcp'; }],
  ['an IP-address resource', p => { p.development.routing.resource = 'https://127.0.0.1/mcp'; }],
  ['a noncanonical host spelling', p => { p.development.routing.resource = 'https://DEVELOPMENT-mcp.example.test/mcp'; }],
  ['an unknown OAuth grant blob', p => { p.development.routing.oauthGrant = 'PRIVATE'; }],
]) rejectsPlan(name, mutate);

for (const field of ['instanceId', 'backendId', 'accessAppId', 'audience', 'connectorAppId']) {
  rejectsPlan(`a trailing newline in ${field}`, p => {
    if (field === 'instanceId') p.instanceId += '\n';
    else p.development.routing[field] += '\n';
  });
}

test('matched synthetic local observations never qualify or activate the runtime', () => {
  const plan = planFixture();
  const report = evaluateRuntime(plan, observationFixture(plan));
  assert.deepEqual(report.currentIdentity, { status: 'matched' });
  assert.deepEqual(report.productionListener, { status: 'matched' });
  assert.deepEqual(report.developmentListener, { status: 'matched' });
  assert.equal(report.profileEnvironment, 'matched');
  assert.equal(report.mode, 'read-only');
  assert.equal(report.qualified, false);
  assert.equal(report.upstreamEnabled, false);
  assert.equal(report.runningSourceVerified, false);
  assert.deepEqual(report.routing, {
    declaredDistinct: true, authorizationMode: 'owner-only', liveVerified: false, oauthGrantsVerified: false,
  });
  for (const reason of ['cross_account_access_unverified', 'upstream_roots_unverified',
    'live_routing_and_oauth_grants_unverified', 'dev_upstream_disabled']) {
    assert.ok(report.reasons.includes(reason), reason);
  }
});

test('absent listeners and unavailable identity are kept distinct without inventing observations', () => {
  const report = evaluateRuntime(planFixture(), {
    current: { status: 'unavailable', error: 'PRIVATE QUERY FAILURE' },
    production: { status: 'absent' }, development: { status: 'absent' },
  });
  assert.deepEqual(report.currentIdentity, { status: 'unverified' });
  assert.deepEqual(report.productionListener, { status: 'absent' });
  assert.deepEqual(report.developmentListener, { status: 'absent' });
  assert.equal(report.profileEnvironment, 'unverified');
  assert.ok(report.reasons.includes('current_dev_identity_unverified'));
  assert.ok(report.reasons.includes('production_listener_absent'));
  assert.ok(report.reasons.includes('development_listener_absent'));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE QUERY FAILURE/);
});

test('missing observation input remains unverified', () => {
  for (const observation of [undefined, null, {}, [], 'observed']) {
    const report = evaluateRuntime(planFixture(), observation);
    assert.equal(report.currentIdentity.status, 'unverified');
    assert.equal(report.productionListener.status, 'unverified');
    assert.equal(report.developmentListener.status, 'unverified');
    assert.equal(report.qualified, false);
  }
});

for (const [name, mutate] of [
  ['missing SID', o => { delete o.sid; }],
  ['an invalid SID', o => { o.sid = 'fixture-development'; }],
  ['a relative profile', o => { o.profileDirectory = 'fixture-development'; }],
  ['missing PID', o => { delete o.pid; }],
  ['zero PID', o => { o.pid = 0; }],
  ['negative PID', o => { o.pid = -1; }],
  ['fractional PID', o => { o.pid = 1.5; }],
  ['string PID', o => { o.pid = '1200'; }],
  ['unsafe PID', o => { o.pid = Number.MAX_SAFE_INTEGER + 1; }],
  ['PID beyond DWORD', o => { o.pid = 4294967296; }],
  ['missing creation time', o => { delete o.creationFileTime; }],
  ['numeric creation time', o => { o.creationFileTime = 134385640000000000; }],
  ['negative creation time', o => { o.creationFileTime = '-1'; }],
  ['fractional creation time', o => { o.creationFileTime = '1.5'; }],
  ['zero creation time', o => { o.creationFileTime = '0'; }],
  ['leading-zero creation time', o => { o.creationFileTime = '0134385640000000000'; }],
  ['creation time beyond signed FILETIME', o => { o.creationFileTime = '9223372036854775808'; }],
  ['creation time beyond UINT64', o => { o.creationFileTime = '99999999999999999999'; }],
  ['creation time with a trailing newline', o => { o.creationFileTime += '\n'; }],
]) {
  test(`runtime observation refuses ${name}`, () => {
    const plan = planFixture();
    const observation = observationFixture(plan);
    mutate(observation.current);
    mutate(observation.production);
    mutate(observation.development);
    const report = evaluateRuntime(plan, observation);
    assert.equal(report.currentIdentity.status, 'unverified');
    assert.equal(report.productionListener.status, 'unverified');
    assert.equal(report.developmentListener.status, 'unverified');
    assert.equal(report.qualified, false);
  });
}

test('runtime observation accepts positive canonical PID and FILETIME numeric boundaries', () => {
  const plan = planFixture();
  for (const [pid, creationFileTime] of [[1, '1'], [4294967295, '9223372036854775807']]) {
    const observation = observationFixture(plan);
    Object.assign(observation.current, { pid, creationFileTime });
    const report = evaluateRuntime(plan, observation);
    assert.equal(report.currentIdentity.status, 'matched');
    assert.equal(report.qualified, false);
  }
});

for (const invocationMatched of [undefined, false, 'true', 1]) {
  test(`listener invocation must be literal true, not ${String(invocationMatched)}`, () => {
    const plan = planFixture(), observation = observationFixture(plan);
    observation.production.invocationMatched = invocationMatched;
    observation.development.invocationMatched = invocationMatched;
    const report = evaluateRuntime(plan, observation);
    assert.equal(report.currentIdentity.status, 'matched');
    assert.equal(report.productionListener.status, 'unverified');
    assert.equal(report.developmentListener.status, 'unverified');
  });
}

test('an invocation match without OS principal and profile evidence is insufficient', () => {
  const report = evaluateRuntime(planFixture(), {
    current: { status: 'observed' },
    production: { status: 'observed', invocationMatched: true },
    development: { status: 'observed', invocationMatched: true },
  });
  assert.equal(report.currentIdentity.status, 'unverified');
  assert.equal(report.productionListener.status, 'unverified');
  assert.equal(report.developmentListener.status, 'unverified');
});

test('correct invocation cannot hide a foreign listener principal or OS profile', () => {
  const plan = planFixture(), observation = observationFixture(plan);
  observation.production.sid = plan.development.principalSid;
  observation.development.profileDirectory = plan.production.profileDirectory;
  observation.current.sid = plan.production.principalSid;
  const report = evaluateRuntime(plan, observation);
  assert.equal(report.currentIdentity.status, 'mismatched');
  assert.equal(report.productionListener.status, 'mismatched');
  assert.equal(report.developmentListener.status, 'mismatched');
  assert.equal(report.profileEnvironment, 'unverified');
});

test('lexical OS profile aliases compare canonically while environment evidence stays separate', () => {
  const plan = planFixture(), observation = observationFixture(plan);
  observation.current.profileDirectory = plan.development.profileDirectory.toUpperCase().replaceAll('\\', '/') + '/child/..';
  const report = evaluateRuntime(plan, observation, {
    HOME: plan.development.profileDirectory,
    USERPROFILE: plan.development.profileDirectory.toUpperCase(),
    APPDATA: plan.development.profileDirectory + '\\AppData\\Roaming',
    LOCALAPPDATA: plan.development.profileDirectory + '\\AppData\\Local',
  });
  assert.equal(report.currentIdentity.status, 'matched');
  assert.equal(report.profileEnvironment, 'matched');
  assert.equal(report.qualified, false);
});

for (const [name, environment] of [
  ['HOME redirects to production', { HOME: 'C:\\Users\\fixture-production' }],
  ['USERPROFILE redirects to production', { USERPROFILE: 'C:\\Users\\fixture-production' }],
  ['HOME is relative', { HOME: 'relative-home' }],
  ['USERPROFILE is empty', { USERPROFILE: '' }],
  ['APPDATA equals the profile root', { APPDATA: 'C:\\Users\\fixture-development' }],
  ['APPDATA escapes to a sibling', { APPDATA: 'C:\\Users\\fixture-development\\..\\fixture-production' }],
  ['APPDATA has only a shared string prefix', { APPDATA: 'C:\\Users\\fixture-development-extra\\AppData' }],
  ['LOCALAPPDATA uses another drive', { LOCALAPPDATA: 'D:\\Users\\fixture-development\\AppData' }],
  ['LOCALAPPDATA uses an ADS', { LOCALAPPDATA: 'C:\\Users\\fixture-development\\AppData:stream' }],
]) {
  test(`profile environment refuses ${name}`, () => {
    const report = evaluateRuntime(planFixture(), observationFixture(), environment);
    assert.equal(report.currentIdentity.status, 'matched');
    assert.equal(report.profileEnvironment, 'redirected');
    assert.ok(report.reasons.includes('profile_environment_redirected'));
    assert.equal(report.qualified, false);
  });
}

for (const key of ['NODE_OPTIONS', 'NODE_PATH']) {
  test(`runtime inspection rejects nonempty ${key} without reflecting its value`, () => {
    const report = evaluateRuntime(planFixture(), observationFixture(), { [key]: 'PRIVATE_PRELOAD_VALUE' });
    assert.ok(report.reasons.includes('node_preload_environment_rejected'));
    assert.equal(report.qualified, false);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_PRELOAD_VALUE/);
  });
}

test('runtime report discloses no raw SID, profile, invocation, token or routing identity', () => {
  const plan = planFixture(), observation = observationFixture(plan);
  for (const value of Object.values(observation)) Object.assign(value, {
    commandLine: 'PRIVATE_ARGV_SENTINEL --token PRIVATE_TOKEN_SENTINEL',
    executablePath: 'C:\\PRIVATE_EXECUTABLE_SENTINEL.exe',
    token: 'PRIVATE_TOKEN_SENTINEL',
    error: 'PRIVATE_ERROR_SENTINEL',
    qualified: true, upstreamEnabled: true, liveVerified: true,
  });
  const beforePlan = structuredClone(plan), beforeObservation = structuredClone(observation);
  const report = evaluateRuntime(plan, observation);
  const serialized = JSON.stringify(report);
  for (const role of [plan.production, plan.development]) {
    for (const value of [role.principalSid, role.profileDirectory, ...Object.values(role.manager).filter(v => typeof v === 'string'), ...Object.values(role.routing)]) {
      assert.equal(serialized.includes(value), false, 'private plan value escaped into output');
    }
  }
  assert.doesNotMatch(serialized, /PRIVATE_|"(?:sid|principalSid|profileDirectory|commandLine|argv|token|audience|resource|origin|connectorAppId|executablePath)"/);
  assert.equal(report.qualified, false);
  assert.equal(report.upstreamEnabled, false);
  assert.equal(report.routing.liveVerified, false);
  assert.equal(report.runningSourceVerified, false);
  assert.deepEqual(plan, beforePlan);
  assert.deepEqual(observation, beforeObservation);
});
