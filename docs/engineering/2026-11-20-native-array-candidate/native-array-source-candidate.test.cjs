"use strict";
/**
 * R43 source-only, offline candidate checks. No package imports, npm, fixture
 * accounts, PowerShell launch, production process, network or OS mutation.
 * Run explicitly: node --test docs/engineering/2026-11-20-native-array-candidate/native-array-source-candidate.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repo = path.resolve(__dirname, "..", "..", "..");
const manager = path.join(repo, "integrations", "mcp-manager");
const probeFile = path.join(manager, "windows-runtime-probe.ps1");
const fixtureFile = path.join(manager, "test", "fixtures", "reference-transport-child.mjs");
const runtimeFile = path.join(manager, "lib", "runtime-identity.mjs");
const probe = fs.readFileSync(probeFile, "utf8").replace(/\r\n/g, "\n");
const fixture = fs.readFileSync(fixtureFile, "utf8").replace(/\r\n/g, "\n");
const runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n/g, "\n");
const sha = data => crypto.createHash("sha256").update(data, "utf8").digest("hex");
const blob = data => {
  const bytes = Buffer.from(data, "utf8");
  return crypto.createHash("sha1")
    .update(Buffer.concat([Buffer.from("blob " + bytes.length + "\0"), bytes]))
    .digest("hex");
};
const expectedSourceHash = "b2acd47df8fa102941e79468d9b5e7d0dd1f285e761f7823ac9811a1e72fea70";
const expectedDerivedHash = "22079d3b4b5cda805ddd4ea3ca59887990b36479d108b8937f965ce9ef8bee31";
const originalProbeSha = "7dc933d63876199fdfce8cdbf856f914163a9ff30d85b03f5c0fbc6be5bca0ca";
const originalFixtureBlob = "1291e3031c2cb437b04915afaedb516507aed321";
const oldSourceHash = "7dc933d63876199fdfce8cdbf856f914163a9ff30d85b03f5c0fbc6be5bca0ca";
const oldDerivedHash = "f939e35a5e052616e7838c5b2bf7d38fd44b97ee1c8496a8fccee69566d3889b";
const commandOld = "$buffer = New-Object char[] 16385";
const commandNew = "$buffer = [char[]]::new(16385)";
const occurrences = (source, value) => source.split(value).length - 1;

function derivativeSource() {
  const begin = fixture.indexOf("function buildFailureProbe(source) {");
  const end = fixture.indexOf("function observeStdin(child) {", begin);
  assert.ok(begin >= 0 && end > begin && end - begin < 30000);
  // The extracted pure string-transform helper is evaluated without any
  // installed SDK or filesystem/network access in this VM context.
  const build = vm.runInNewContext(fixture.slice(begin, end) + "\nbuildFailureProbe");
  return build(probe);
}

test("candidate uses exactly one typed array buffer constructor", () => {
  assert.equal(occurrences(probe, commandNew), 1);
  assert.equal(occurrences(probe, commandOld), 0);
});
test("candidate changes only one byte-exact line of the frozen executable probe", () => {
  const original = probe.replace(commandNew, commandOld);
  assert.equal(sha(original), originalProbeSha);
});
test("candidate probe's normalized SHA-256 is exactly pinned", () => {
  assert.equal(sha(probe), expectedSourceHash);
});
test("probe still allocates a 16,385 character buffer and checks max input size", () => {
  assert.ok(probe.includes("if ($length -gt 16384) { throw 'input_too_large' }"));
  assert.ok(probe.includes("while ($length -lt $buffer.Length)"));
});
test("probe still performs Windows native process token/profile observation", () => {
  assert.ok(probe.includes("OpenProcessToken(process, 8, out token)"));
  assert.ok(probe.includes("GetUserProfileDirectoryW(token, profile, ref length)"));
  assert.ok(probe.includes("Get-RuntimeNativeSnapshot $ParentId"));
});
test("probe retains its fixed transport error path", () => {
  assert.ok(probe.includes("[Console]::Error.WriteLine('runtime_observation_failed')"));
});
test("only four matching diagnostic buffer anchor commands were changed", () => {
  assert.equal(occurrences(fixture, commandNew), 4);
});
test("original PR45 fixture is reconstructed by reversing exactly six pinned edits", () => {
  const original = fixture
    .replaceAll(commandNew, commandOld)
    .replace(expectedSourceHash, oldSourceHash)
    .replace(expectedDerivedHash, oldDerivedHash);
  assert.equal(blob(original), originalFixtureBlob);
});
test("fixture contains exact candidate source and derivative hash pins once", () => {
  assert.equal(occurrences(fixture, expectedSourceHash), 1);
  assert.equal(occurrences(fixture, expectedDerivedHash), 1);
  assert.equal(occurrences(fixture, oldDerivedHash), 0);
});
test("failure-only transform preserves all 32 diagnostic anchors", () => {
  const derived = derivativeSource();
  assert.equal(derived.anchors.length, 32);
  assert.equal(new Set(derived.anchors).size, 32);
  assert.ok(derived.anchors.includes("buffer_initialization"));
  assert.ok(derived.anchors.includes("utility_bootstrap_control"));
});
test("normalized candidate derivative identity matches the new frozen pin", () => {
  assert.equal(sha(derivativeSource().source), expectedDerivedHash);
});
test("derivative probes the typed array command between stages 78 and 79", () => {
  const source = derivativeSource().source;
  assert.ok(/Write-FixtureProbeStage 78\s*\n\s*\$buffer = \[char\[\]\]::new\(16385\)\s*\n\s*Write-FixtureProbeStage 79/.test(source));
});
test("derivative preserves separate preexisting typed-array and module controls", () => {
  const source = derivativeSource().source;
  assert.ok(source.includes("$fixtureProbeTypedBuffer = [char[]]::new(16385)"));
  assert.ok(source.includes("Write-FixtureProbeStage 82"));
  assert.ok(source.includes("Write-FixtureProbeStage 85"));
  assert.ok(source.includes("Microsoft.PowerShell.Utility.psd1"));
});
test("failure-only derivative is explicitly barred as acceptance evidence", () => {
  assert.ok(fixture.includes("kind: 'failure-only-instrumented-probe', acceptanceEvidence: false"));
  assert.ok(fixture.includes("fixture_probe_diagnostic_derivative_mismatch"));
});
test("native probe entry remains non-preloaded and subject to its 15-second deadline", () => {
  assert.ok(runtime.includes("if (process.env.NODE_OPTIONS || process.env.NODE_PATH)"));
  assert.ok(runtime.includes("timeout: 15000, maxBuffer: 32768"));
  assert.ok(runtime.includes("throw new Error('runtime_observation_unavailable')"));
});
