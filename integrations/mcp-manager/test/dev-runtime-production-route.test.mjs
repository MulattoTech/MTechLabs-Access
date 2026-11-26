import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRuntime, validateRuntimePlan } from '../lib/dev-runtime-plan.mjs';

// Pure declarations and synthetic observations. No accounts, files, listeners,
// credentials, provider resources or routing configuration are queried or changed.
function planFixture() {
  const role = (name, rid, port, digit) => ({
    principalSid: `S-1-5-21-100-200-300-${rid}`,
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
    instanceId: 'dev-route-fixture',
    authorizationMode: 'owner-only',
    production: role('production', 1001, 19740, '1'),
    development: role('development', 1002, 19741, '2'),
  };
}

function rejects(input, label) {
  assert.throws(() => validateRuntimePlan(input), error => {
    assert.equal(error?.message, 'invalid_dev_runtime_plan', label);
    return true;
  }, label);
}

function observations(plan) {
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

function assertUnqualifiedReport(input) {
  const report = evaluateRuntime(input, observations(input), {
    USERPROFILE: input.development.profileDirectory,
    HOME: input.development.profileDirectory,
    APPDATA: input.development.profileDirectory + '\\AppData\\Roaming',
    LOCALAPPDATA: input.development.profileDirectory + '\\AppData\\Local',
  });
  for (const name of ['currentIdentity', 'productionListener', 'developmentListener']) {
    assert.equal(report[name].status, 'matched', name);
  }
  assert.equal(report.profileEnvironment, 'matched');
  assert.equal(report.routing.declaredDistinct, true);
  assert.equal(report.routing.authorizationMode, 'owner-only');
  assert.equal(report.routing.liveVerified, false);
  assert.equal(report.routing.oauthGrantsVerified, false);
  assert.equal(report.runningSourceVerified, false);
  assert.equal(report.qualified, false);
  assert.equal(report.upstreamEnabled, false);
  for (const reason of ['cross_account_access_unverified', 'upstream_roots_unverified',
    'live_routing_and_oauth_grants_unverified', 'dev_upstream_disabled']) {
    assert.ok(report.reasons.includes(reason), reason);
  }
  const serialized = JSON.stringify(report);
  for (const role of [input.production, input.development]) {
    for (const privateValue of [role.principalSid, role.profileDirectory,
      ...Object.values(role.manager), ...Object.values(role.routing)]) {
      if (typeof privateValue === 'string') {
        assert.equal(serialized.includes(JSON.stringify(privateValue).slice(1, -1)), false,
          'report does not disclose declared private identity or route values');
      }
    }
  }
}

test('production route retains the exact loopback Host declaration', () => {
  const input = planFixture();
  const result = validateRuntimePlan(input);
  assert.equal(result.production.routing.originHostHeader, '127.0.0.1:19740');
  assert.equal(result.development.routing.originHostHeader, '127.0.0.1:19741');
});

test('production route accepts the exact hostname of its declared origin', () => {
  const input = planFixture();
  input.production.routing.originHostHeader = 'production-origin.example.test';
  const result = validateRuntimePlan(input);
  assert.equal(result.production.routing.originHostHeader, 'production-origin.example.test');
  assert.equal(result.production.routing.origin, input.production.routing.origin);
  assert.equal(result.development.routing.originHostHeader, '127.0.0.1:19741');
});

test('production hostname allowance follows the selected origin instead of a fixed hostname', () => {
  const input = planFixture();
  input.production.routing.origin = 'https://replacement-origin.example.test/mcp';
  input.production.routing.originHostHeader = 'production-origin.example.test';
  rejects(input, 'the previous origin hostname is no longer the selected origin');
  input.production.routing.originHostHeader = 'replacement-origin.example.test';
  assert.equal(validateRuntimePlan(input).production.routing.originHostHeader,
    'replacement-origin.example.test');
});

test('production Host rejects resource, DEV and lookalike hostnames', () => {
  for (const host of ['production-mcp.example.test', 'development-origin.example.test',
    'development-mcp.example.test', 'unrelated.example.test',
    'production-origin.example.test.attacker.test', 'prefix.production-origin.example.test',
    'production-origin.example.test.', 'PRODUCTION-ORIGIN.EXAMPLE.TEST']) {
    const input = planFixture();
    input.production.routing.originHostHeader = host;
    rejects(input, host);
  }
});

test('production Host rejects ports, URL syntax and credential-bearing forms', () => {
  for (const host of ['production-origin.example.test:443', 'production-origin.example.test:19740',
    'https://production-origin.example.test', 'https://production-origin.example.test/mcp',
    'production-origin.example.test/mcp', 'production-origin.example.test?route=dev',
    'production-origin.example.test#fragment', 'user@production-origin.example.test',
    'user:password@production-origin.example.test', '127.0.0.1:19741',
    'localhost:19740', '[::1]:19740']) {
    const input = planFixture();
    input.production.routing.originHostHeader = host;
    rejects(input, host);
  }
});

test('production Host rejects whitespace, header injection and non-string values', () => {
  for (const host of [' production-origin.example.test', 'production-origin.example.test ',
    'production-origin.example.test\n', 'production-origin.example.test\r\nHost: injected.test',
    'production-origin.example.test\t', 'production-origin.example.test\0',
    'production-origin.example.test\x7f', '', null, 19740, ['production-origin.example.test']]) {
    const input = planFixture();
    input.production.routing.originHostHeader = host;
    rejects(input, 'unsafe Host declaration');
  }
});

test('DEV Host remains exactly the loopback address and configured DEV port', () => {
  for (const port of [19741, 24719, 65535]) {
    const input = planFixture();
    input.development.manager.port = port;
    input.development.routing.originHostHeader = `127.0.0.1:${port}`;
    assert.equal(validateRuntimePlan(input).development.routing.originHostHeader, `127.0.0.1:${port}`);
    for (const host of ['development-origin.example.test', 'development-mcp.example.test',
      'production-origin.example.test', '127.0.0.1:19740', `localhost:${port}`, `[::1]:${port}`,
      `127.0.0.1:${port === 65535 ? 65534 : port + 1}`]) {
      const invalid = structuredClone(input);
      invalid.development.routing.originHostHeader = host;
      rejects(invalid, `DEV port ${port}, Host ${host}`);
    }
  }
});

test('production hostname support preserves the strict origin URL contract', () => {
  for (const origin of ['http://production-origin.example.test/mcp',
    'https://production-origin.example.test:443/mcp',
    'https://production-origin.example.test:19740/mcp',
    'https://user:password@production-origin.example.test/mcp',
    'https://production-origin.example.test/mcp?route=dev',
    'https://production-origin.example.test/mcp#fragment',
    'https://production-origin.example.test/other',
    'https://production-origin.example.test/mcp\n']) {
    const input = planFixture();
    input.production.routing.origin = origin;
    input.production.routing.originHostHeader = 'production-origin.example.test';
    rejects(input, 'noncanonical production origin');
  }
});

test('accepted production hostname declarations never qualify live routing or activation', () => {
  const input = planFixture();
  input.production.routing.originHostHeader = 'production-origin.example.test';
  assertUnqualifiedReport(input);
});

test('accepted production loopback declarations retain unqualified private reports', () => {
  assertUnqualifiedReport(planFixture());
});
