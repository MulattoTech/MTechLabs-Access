#!/usr/bin/env python3
"""Verify supplied immutable hosted evidence, without network or source execution.

Usage: python review_hosted.py --manifest candidate-verification-input.json
       python review_hosted.py --compare-manifests candidate-verification-input.json main-verification-input.json
Reads Git blobs, metadata, complete logs and ZIPs; writes only JSON to stdout.
The manifest must specify expected identities/counts. Missing inputs never pass.
"""
import argparse, copy, hashlib, io, json, pathlib, re, stat, subprocess, sys, zipfile
from collections import Counter

class Rejected(Exception): pass
def require(ok, label):
    if not ok: raise Rejected(label)
def digest(data): return hashlib.sha256(data).hexdigest()
def read(path, limit=16 * 1024 * 1024):
    data = path.read_bytes()
    require(len(data) <= limit, "input_size_limit:" + path.name)
    return data
def js(path): return json.loads(read(path))
def one(values, label):
    require(len(values) == 1, "expected_one:" + label)
    return values[0]
def exact_keys(value, keys, label):
    require(isinstance(value, dict) and set(value) == set(keys), "schema:" + label)
def array(value, key):
    return value if isinstance(value, list) else value[key]
def quote_cases(blob):
    text = blob.decode("utf-8")
    block = one(re.findall(r"\$cases = @\(\r?\n(.*?)\r?\n\)", text, re.S), "frozen_cases")
    rows = []
    for line in block.splitlines():
        name = re.search(r"name = '([^']+)'", line)
        expected = re.search(r"expected = '([^']+)'", line)
        if not name: continue
        require(expected is not None, "frozen_expected")
        queries = re.search(r"queries = @\(([\d,\s]+)\)", line)
        cim = re.search(r"expectedCimQueries = (\d+)", line)
        rows.append({"name": name[1], "expected": expected[1],
                     "queries": [int(n.strip()) for n in queries[1].split(",")] if queries else None,
                     "pid": 34343 if "kind = 'current'" in line else 4242,
                     "cim": int(cim[1]) if cim else 1,
                     "nonexclusive": "listenerMode = 'non-loopback'" in line or "listenerMode = 'multiple'" in line})
    require(rows and len({r["name"] for r in rows}) == len(rows), "frozen_unique_cases")
    return rows

STAGES = ["initialize", "full_tool_contract", "owned_configuration", "file_read_write_metadata",
          "manager_read_only_denial", "content_search_completion_and_pagination", "shell_blocklist",
          "owned_process_output_and_tree_cleanup", "pdf_create_and_read_fidelity", "admission_released"]
JOB_KINDS = {
    "test": "root", "managed-mcp": "linux", "managed-mcp-windows": "windows",
    "Upstream qualification / ubuntu-latest / Node 24": "linux-upstream",
    "Upstream qualification / windows-latest / Node 24": "windows-upstream",
}
PARENTS = {
    "dev-runtime-identity": "Windows DEV runtime probe qualifies invocation, listener state, process lifetime and disposal",
    "dev-runtime-native-current-parent": "native Windows identity inspects only its own Node parent and ignores spoofed profile environment",
    "dev-runtime-native-listener": "native Windows listener observation qualifies the actual provider and Unicode fixture invocation",
    "manager-launcher-identity": "Windows launcher verifies executable, entry, configuration and listener identity",
}
PATHS = {
    "probe": "integrations/mcp-manager/windows-runtime-probe.ps1",
    "devFixture": "integrations/mcp-manager/test/fixtures/dev-runtime-identity.ps1",
    "listenerFixture": "integrations/mcp-manager/test/fixtures/runtime-listener.mjs",
    "launcher": "integrations/mcp-manager/manage.ps1",
    "launcherFixture": "integrations/mcp-manager/test/fixtures/launcher-identity.ps1",
}
REGRESSION_PATH = "integrations/mcp-manager/test/dev-runtime-production-route.test.mjs"
REGRESSION_SHA256 = "22ba217c175238b11e1352a5fe45771ca83f38c4a9186e95603f74c8f14aced7"

# Expanded registrations are bound to the unchanged 49-group test by its
# frozen immutable blob hash. This verifier never imports or executes
# product/test source.
PROTOCOL_PATH = "integrations/mcp-manager/test/production-reference.test.mjs"
PROTOCOL_SHA256 = "b0aed1a93aa5bb1df243d1467ebe5d7dbfe40e89862caab3a7f89a3e2b4651bc"
PROTOCOL_TITLES = ['production reference protocol capability is available with the agreed public API', 'control commitment binds the exact nonce and private control snapshot with domain separation', 'authority and client require correctly typed Ed25519 KeyObjects', 'trusted factory options reject unknown fields, invalid registrations, instance aliases and accessors', 'a valid exchange returns opaque, private and independently verifiable production facts', 'default clocks support a real immediate round trip without fixture time overrides', 'separate requests use fresh nonces and commitments even with identical private snapshots', 'opaque clients and proofs cannot be forged, cloned or revived by serialization', 'reference facts preserve the matched production listener observation', 'reference facts preserve the mismatched production listener observation', 'reference facts preserve the absent production listener observation', 'reference facts preserve the unverified production listener observation', 'authority rejects a request object instead of canonical text before observation', 'authority rejects leading whitespace before observation', 'authority rejects trailing newline before observation', 'authority rejects reordered JSON keys before observation', 'authority rejects duplicate schema keys before observation', 'authority rejects alternate Unicode encoding before observation', 'authority rejects arbitrary filesystem paths before observation', 'authority rejects arbitrary commands before observation', 'authority rejects caller-selected algorithms before observation', 'authority rejects oversized input before observation', 'authority rejects malformed request fields and unknown registration bindings before observation', 'authority rejects future, expired and excessive request windows before observation', 'request inputs remain exact, private data fields and never admit caller readiness claims', 'consumer rejects unknown envelope keys', 'consumer rejects a padded payload encoding', 'consumer rejects a padded signature encoding', 'consumer rejects a truncated signature', 'consumer rejects an unsupported envelope version', 'consumer refuses noncanonical, duplicated and oversized envelope text', 'consumer rejects wrong signing keys, modified signed facts and the wrong signature domain', 'a valid signature cannot bypass strict payload and fact schemas', 'consumer binds trusted signed responses to the exact registration and request bytes', 'consumer refuses authenticated observation windows outside the pending request', 'old responses cannot be reused for a new nonce or a changed control snapshot', 'exchange failures have no retry and redact private callback errors', 'observer failures and malformed facts are sanitized and consume the reserved nonce', 'authority reserves a nonce before awaiting observation and rejects concurrent replay', 'authority rejects already-aborted calls without observing or reserving the nonce', 'authority bounds eight observations and retains aborted work until actual settlement', 'authority retains all sixty-four nonce reservations without evicting live or failed entries', 'client bounds eight independent exchanges and releases capacity only after settlement', 'client deadline aborts exchanges without freeing ignored-abort capacity or retrying', 'late observer or exchange completion cannot authenticate an expired request', 'proof expiry is enforced at the exact wall deadline and cannot be rolled back', 'monotonic expiry and backwards clocks independently invalidate proofs permanently', 'invalid or overflowing clocks reject without private callback execution', 'clock callback failures are sanitized and invalidate an existing proof']
EDGE_TEST_PATH = "tests/mcp-dev-edge.test.js"
EDGE_TEST_SHA256 = '8306c91554ac98cbeb00735efcd9b13937d427d1f470c9700a2ced7288d1fdee'
EDGE_TITLES = ['DEV edge descriptor and authorization API capability is available', 'dedicated DEV entry capability exists without a scheduled production worker', 'DEV descriptor is canonically ordered deeply copied and frozen without activation', 'DEV descriptor rejects missing unknown array null and nonplain records', 'DEV descriptor refuses getters hidden keys and symbols without invoking accessors', 'DEV descriptor rejects authority claims owner aliases and malformed instance identifiers', 'DEV descriptor rejects every production or development endpoint alias and retarget', 'DEV descriptor independently separates all routing store and credential identities', 'DEV descriptor fixes credential and authorization bindings without production defaults', 'DEV descriptor binds exact manager ports and loopback Host declarations', 'DEV descriptor pins issuer and challenge metadata to canonical dedicated URLs', 'DEV runtime matcher proves declarations only and returns no runtime or activation authority', 'DEV runtime matcher is compatible with the complete existing validated runtime plan schema', 'DEV runtime matcher rejects every mismatched routing field port and top-level binding', 'DEV valid owner reaches the disabled terminal with no body backend or production work', 'DEV rejects invalid routes before reading configuration keys database or body', 'DEV method and explicit Origin refusals precede all configuration and identity work', 'DEV permits only declared browser origins or absent Origin while staying disabled', 'DEV metadata remains explicitly unavailable without fabricated OAuth discovery or owner lookup', 'DEV config requires exact canonical JSON and rejects duplicate reordered or oversized text before authentication', 'DEV captures only data environment bindings and rejects relevant accessors without invoking them', 'DEV bearer bytes must match their declaration and cannot reuse production credentials', 'DEV authorization store is mandatory distinct by handle and never falls back to production DB', 'DEV ignores a poison production DB getter and does not read production bearer configuration', 'DEV human authentication requires a real assertion rather than cookies bearer or descriptive identity', 'DEV signed assertions bind exact issuer signature algorithm and application token type', 'DEV admits one exact audience and rejects production mixed duplicate or malformed audiences', 'DEV JWT lifetime and human identity shape are checked before owner state access', 'DEV exact owner subject and normalized email must both match before database access', 'DEV owner row must be currently approved strictly typed and match the pinned owner', 'DEV owner revocation is read on every request and equality revokes the prior token', 'DEV authorization storage failure remains private and never consults grants or retries', 'DEV descriptor token store and prepare are captured before the first asynchronous digest', 'DEV pending key verification cannot retarget its captured descriptor or authorization store', 'DEV rechecks token expiry after the awaited owner-row lookup', 'DEV request claims headers and body cannot enable activation or leak private traces', 'dedicated DEV entry exposes only the disabled DEV surface and no production fallback', 'Worker reserves the canonical DEV resource even when a website grant would allow its hostname', 'Worker reserves the DEV origin hostname and malformed DEV paths before generic grant routing', 'Worker reserved DEV routes do not eagerly touch a poison production DB binding', 'Worker configured DEV route authorizes only its captured DEV owner and remains activation disabled', 'Worker terminally rejects trailing-dot DEV hostname aliases before generic grants or outbound routing']
EDGE_SOURCE_PATHS = ["src/mcp-dev-edge.js", "src/mcp-dev-entry.js", "src/index.js"]
REFERENCE_MARKER = "MTERM_DEV_REFERENCE_NATIVE_EVIDENCE "
REFERENCE_SOURCES = ["lib/dev-runtime-reference.mjs", "lib/runtime-files.mjs", "lib/dev-runtime.mjs",
                     "lib/production-reference.mjs", "lib/runtime-identity.mjs", "windows-runtime-probe.ps1",
                     "test/dev-runtime-reference.test.mjs"]
REFERENCE_UNSUPPORTED = "registered reference Windows integration refuses unsupported platforms before any I/O"
REFERENCE_FIXTURE_PRIVACY = "synthetic reference fingerprints are distinct from the actual private fixture declarations"
PATHS.update({"reference:" + key: "integrations/mcp-manager/" + key for key in REFERENCE_SOURCES})


def passed_exactly_once(log, titles, label):
    for title in titles:
        pattern = r"(?:^| )✔ " + re.escape(title) + r" \([\d.]+ms\)\r?$"
        require(len(re.findall(pattern, log, re.M)) == 1, label + "_pass_once:" + title)
        skipped = r"﹣ " + re.escape(title) + r" \([\d.]+ms\)(?: #[^\r\n]*)?"
        require(re.search(skipped, log) is None, label + "_not_skipped:" + title)


def skipped_exactly_once(log, titles, label):
    for title in titles:
        pattern = r"﹣ " + re.escape(title) + r" \([\d.]+ms\)(?: #[^\r\n]*)?"
        require(len(re.findall(pattern, log)) == 1, label + "_skip_once:" + title)
        require(re.search(r"✔ " + re.escape(title) + r" \([\d.]+ms\)", log) is None,
                label + "_not_passed:" + title)


def reference_titles(blob):
    titles = re.findall(r"^nativeTest\('([^']+)'", blob.decode("utf-8"), re.M)
    require(len(titles) == len(set(titles)) == 11, "batch40_eleven_native_integration_titles")
    require("test('" + REFERENCE_UNSUPPORTED + "'" in blob.decode("utf-8"),
            "batch40_unsupported_platform_control")
    require(blob.decode("utf-8").count("test('" + REFERENCE_FIXTURE_PRIVACY + "'") == 1,
            "batch40_portable_fixture_privacy_registration")
    return titles


def reference_native(log, family, titles, bound):
    reports = re.findall(re.escape(REFERENCE_MARKER) + r"([^\r\n]*)", log)
    if family == "root":
        require(not reports, "batch40_no_reference_report_in_root")
        return None
    if family != "windows":
        require(not reports, "batch40_no_reference_native_claim_on_nonwindows")
        skipped_exactly_once(log, titles, "batch40_native_linux")
        passed_exactly_once(log, [REFERENCE_UNSUPPORTED], "batch40_unsupported_linux")
        return {"nativeCasesSkippedExactlyOnce": titles, "unsupportedPlatformControlPassed": True,
                "nativeQualified": False}
    passed_exactly_once(log, titles, "batch40_native_windows")
    skipped_exactly_once(log, [REFERENCE_UNSUPPORTED], "batch40_unsupported_windows")
    r = json.loads(one(reports, "batch40_native_reference_report"))
    exact_keys(r, ["schemaVersion", "scope", "nativeCaseTitles", "completedCases", "sourceSha256",
                   "writeObservationScope", "nativeCompilerTemporaryActivityNotExcluded",
                   "productionListenerLiveProbes", "activationAuthorized", "qualified", "upstreamEnabled"],
               "batch40_native_reference_report")
    require(type(r["schemaVersion"]) is int and r["schemaVersion"] == 1, "batch40_native_reference_schema")
    require(r["scope"] == "disposable hosted Windows source qualification; no deployment or account-isolation claim",
            "batch40_native_reference_scope")
    require(r["writeObservationScope"] == "Integration fs/promises calls; excludes fixture setup/drift and native compiler temporary activity",
            "batch40_native_reference_write_observation_scope")
    require(r["nativeCompilerTemporaryActivityNotExcluded"] is True, "batch40_native_compiler_scope")
    require(type(r["productionListenerLiveProbes"]) is int and r["productionListenerLiveProbes"] == 0,
            "batch40_no_live_production_listener_probe")
    require(all(r[key] is False for key in ["activationAuthorized", "qualified", "upstreamEnabled"]),
            "batch40_no_activation_or_operational_qualification")
    require(r["nativeCaseTitles"] == titles and isinstance(r["completedCases"], list) and len(r["completedCases"]) == 11,
            "batch40_native_case_registration_completion")
    # Every case now proves a successful unmodified round trip. Ten cases
    # substitute native responses; case ten alone calls the real provider.
    roles = [[['development'], ['production']], [['development']], [['development'], ['development']],
             [['development'], ['production'], ['development'], ['production']],
             [['development'], ['production'], ['development'], ['production']],
             [['development'], ['development']], [['development'], ['production'], ['development'], ['development']],
             [['development'], ['development'], ['development'], ['development']],
             [['development'], ['development'], ['development']], [[], ['development']],
             [['development'], ['production']] * 6]
    controls = [1, 1, 1, 1, 1, 1, 1, 4, 1, 1, 6]
    extras = [{}, {"consumerProductionReads": 0},
              {"consumerProductionReads": 0, "wrongProfileComparedAsData": True},
              {"unregisteredPathReads": 0, "attackExchangeCalls": 1, "mutationApplied": True},
              {"attackExchangeCalls": 1, "mutationApplied": True},
              {"unregisteredPathReads": 0, "attackExchangeCalls": 1, "mutationApplied": True},
              {"credentialAttackExchanges": {"overlap": 1, "plaintext": 1},
               "actualCredentialFilesRead": {"overlap": True, "plaintext": True}},
              {"rejectedMutations": ["profile-junction", "entry-hardlink", "control-hardlink"], "exchangeCalls": 0},
              {"consumerProductionReads": 0, "throwingExchangeCalls": 1, "invalidClientExchangeCalls": 0},
              {"productionAuthority": "synthetic; production is not observed by this case", "currentPidMatched": True,
               "ownedDevListenerMatched": True, "consumerProductionReads": 0},
              {"canonicalAliasFixture": "controlled filesystem alias; not a native 8.3 allocation",
               "declaredCanonicalDifferent": True, "actualFileIdentityEqual": True,
               "canonicalPlacementRejections": ["config-reserved", "config-nested", "policy-reserved", "token-reserved", "inventory-reserved"],
               "canonicalPlacementAttackExchanges": 0, "canonicalPlacementCasesRead": 5}]
    def typed_exact(actual, expected, label):
        require(type(actual) is type(expected), "batch40_native_type:" + label)
        if isinstance(expected, dict):
            exact_keys(actual, expected, "batch40_native_case:" + label)
            for key, value in expected.items(): typed_exact(actual[key], value, label + ":" + key)
        elif isinstance(expected, list):
            require(len(actual) == len(expected), "batch40_native_list_length:" + label)
            for i, value in enumerate(expected): typed_exact(actual[i], value, label + ":" + str(i))
        else:
            require(actual == expected, "batch40_native_value:" + label)
    for index, (title, actual) in enumerate(zip(titles, r["completedCases"])):
        expected = {"name": title, "nodeFilesystemWriteCalls": 0, "requestedNativeRoles": roles[index],
                    "realNative": index == 9, "unmodifiedControls": controls[index], **extras[index]}
        if index == 10:
            opens = actual.get("aliasHandleOpens") if isinstance(actual, dict) else None
            require(type(opens) is int and opens >= 5, "batch40_native_alias_read_stages")
            expected["aliasHandleOpens"] = opens
        typed_exact(actual, expected, title)
    exact_keys(r["sourceSha256"], REFERENCE_SOURCES, "batch40_native_source_hashes")
    source_bindings = {key: bound("reference:" + key, r["sourceSha256"][key]) for key in REFERENCE_SOURCES}
    return {"marker": REFERENCE_MARKER.strip(), "cases": 11, "passedExactlyOnce": titles,
            "report": r, "sourceBindings": source_bindings, "allSevenSourcesBoundToImmutableTree": True,
            "nativeRealCases": 1, "syntheticNativeCases": 10, "productionListenerLiveProbes": 0,
            "activationAuthorized": False, "qualified": False, "upstreamEnabled": False}

def regression_titles(blob):
    require(digest(blob) == REGRESSION_SHA256, "batch38_frozen_regression_hash")
    titles = re.findall(r"^test\('([^']+)'", blob.decode("utf-8"), re.M)
    require(len(titles) == len(set(titles)) == 10, "batch38_ten_literal_regression_titles")
    return titles

def regression_passes(log, titles):
    for title in titles:
        pattern = r"(?:^| )✔ " + re.escape(title) + r" \([\d.]+ms\)\r?$"
        require(len(re.findall(pattern, log, re.M)) == 1, "batch38_regression_pass_once:" + title)
        skipped = r"﹣ " + re.escape(title) + r" \([\d.]+ms\)(?: #[^\r\n]*)?"
        require(re.search(skipped, log) is None, "batch38_regression_not_skipped:" + title)
    return {"path": REGRESSION_PATH, "gitBlobSha256": REGRESSION_SHA256,
            "count": len(titles), "passedExactlyOnce": titles, "skipped": 0}

def verify(manifest_path):
    m = js(manifest_path); base = manifest_path.parent
    require(m["schemaVersion"] == 1 and m["phase"] in ["candidate", "main"], "manifest_schema")
    for key in ["sourceSha", "headSha", "treeSha", "localSourceCommit"]:
        require(re.fullmatch(r"[0-9a-f]{40}", m[key]) is not None, "manifest_identity:" + key)
    def git(*args):
        return subprocess.check_output(["git", "-C", m["repoPath"], *args], stderr=subprocess.PIPE)
    actual_tree = git("rev-parse", m["localSourceCommit"] + "^{tree}").decode().strip()
    require(actual_tree == m["treeSha"], "immutable_local_tree")
    blobs = {k: git("show", m["localSourceCommit"] + ":" + p) for k, p in PATHS.items()}
    regression_blob = git("show", m["localSourceCommit"] + ":" + REGRESSION_PATH)
    frozen_regression_titles = regression_titles(regression_blob)
    protocol_blob = git("show", m["localSourceCommit"] + ":" + PROTOCOL_PATH)
    require(digest(protocol_blob) == PROTOCOL_SHA256 and len(PROTOCOL_TITLES) == len(set(PROTOCOL_TITLES)) == 49,
            "batch40_frozen_protocol_hash_and_title_count")
    frozen_reference_titles = reference_titles(blobs["reference:test/dev-runtime-reference.test.mjs"])
    edge_blob = git("show", m["localSourceCommit"] + ":" + EDGE_TEST_PATH)
    edge_titles = re.findall(r"^(?:test|apiTest|entryTest|routeTest)\('([^']+)'", edge_blob.decode("utf-8"), re.M)
    require(digest(edge_blob) == EDGE_TEST_SHA256 and edge_titles == EDGE_TITLES and
            len(edge_titles) == len(set(edge_titles)) == 42, "batch42_frozen_edge_hash_titles")
    edge_sources = {path: {"sha256": digest(git("show", m["localSourceCommit"] + ":" + path))}
                    for path in EDGE_SOURCE_PATHS}
    bindings = {}
    for key, blob in blobs.items():
        forms = {"git-bytes": blob}
        if b"\r" not in blob: forms["LF-to-CRLF"] = blob.replace(b"\n", b"\r\n")
        bindings[key] = {digest(data): {"form": form, "bytes": len(data)} for form, data in forms.items()}
    def bound(key, value, byte_count=None):
        require(value in bindings[key], "native_hash:" + key)
        result = bindings[key][value]
        if byte_count is not None: require(byte_count == result["bytes"], "native_bytes:" + key)
        return {"sha256": value, **result}
    new_cases = quote_cases(blobs["devFixture"]); old_cases = quote_cases(blobs["launcherFixture"])
    require(len(new_cases) == 54 and len(old_cases) == 26, "batch_frozen_case_counts")
    new_functions = re.findall(r"^function ([A-Za-z0-9-]+)", blobs["probe"].decode(), re.M)
    old_functions = re.findall(r"^function ([A-Za-z0-9-]+)", blobs["launcher"].decode(), re.M)
    run = js(base / m["files"]["run"])
    jobs = array(js(base / m["files"]["jobs"]), "jobs")
    artifacts = array(js(base / m["files"]["artifacts"]), "artifacts")
    require(run["id"] == m["runId"] and run["run_attempt"] == m["attempt"], "run_identity")
    require(run["head_sha"] == m["headSha"], "run_head")
    require(run["event"] == ("pull_request" if m["phase"] == "candidate" else "push"), "run_event")
    require(run["status"] == "completed" and run["conclusion"] == "success", "run_success")
    require(run["repository"]["full_name"] == m["repoFullName"], "run_repository")
    if m["phase"] == "main": require(m["sourceSha"] == m["headSha"], "main_source_head")
    require(len(jobs) == 5 and {j["name"] for j in jobs} == set(JOB_KINDS), "five_job_names")
    require(len({j["id"] for j in jobs}) == 5, "five_distinct_job_ids")
    job_results = []; upstream_nodes = {}

    for job in jobs:
        kind = JOB_KINDS[job["name"]]
        require(job["status"] == "completed" and job["conclusion"] == "success", "job_success:" + kind)
        require(job["steps"] and all(s["status"] == "completed" and s["conclusion"] == "success" for s in job["steps"]), "job_steps:" + kind)
        log_path = base / f'{m["phase"]}-job-{job["id"]}.log'
        raw = read(log_path); log = raw.decode("utf-8-sig"); lines = log.splitlines()
        indexes = [i for i, line in enumerate(lines) if " log -1 --format=%H" in line]
        index = one(indexes, "checkout:" + kind)
        sha = one(re.findall(r"\b[0-9a-f]{40}\b", lines[index + 1]), "checkout_sha:" + kind)
        require(sha == m["sourceSha"], "job_checkout:" + kind)
        require("##[error]" not in log, "job_error_annotation:" + kind)
        totals = {k: int(one(re.findall(r"ℹ " + k + r" (\d+)", log), "footer_" + k + ":" + kind))
                  for k in ["tests", "pass", "fail", "cancelled", "skipped", "todo"]}
        family = kind.split("-")[0]
        require(totals == m["expectedTotals"][family], "test_totals:" + kind)
        regression = regression_passes(log, frozen_regression_titles) if family != "root" else None
        edge_contract = None
        if family == "root":
            passed_exactly_once(log, EDGE_TITLES, "batch42_edge_contract")
            edge_contract = {"path": EDGE_TEST_PATH, "gitBlobSha256": EDGE_TEST_SHA256,
                             "count": 42, "passedExactlyOnce": EDGE_TITLES, "skipped": 0,
                             "sourceBindings": edge_sources,
                             "scope": "Fixture source behavior only; no live route, App, DB allocation, grant or activation acceptance"}
        protocol = None
        fixture_privacy = None
        if family != "root":
            passed_exactly_once(log, [REFERENCE_FIXTURE_PRIVACY], "batch40_portable_fixture_privacy")
            fixture_privacy = {"path": PATHS["reference:test/dev-runtime-reference.test.mjs"],
                               "gitBlobSha256": digest(blobs["reference:test/dev-runtime-reference.test.mjs"]),
                               "count": 1, "passedExactlyOnce": [REFERENCE_FIXTURE_PRIVACY], "skipped": 0}
            passed_exactly_once(log, PROTOCOL_TITLES, "batch40_protocol")
            protocol = {"path": PROTOCOL_PATH, "gitBlobSha256": PROTOCOL_SHA256, "count": 49,
                        "passedExactlyOnce": PROTOCOL_TITLES, "skipped": 0}
        registered_reference = reference_native(log, family, frozen_reference_titles, bound)
        skip_names = re.findall(r"﹣ (.*?) \([\d.]+ms\)(?: #[^\r\n]*)?", log)
        require(sorted(skip_names) == sorted(m["expectedSkips"][family]), "skip_identity:" + kind)
        node = one(re.findall(r"node: (v\d+\.\d+\.\d+)", log), "node_version:" + kind)
        require(node.startswith("v24."), "node_major:" + kind)
        def passed(title):
            require(re.search(r"✔ " + re.escape(title) + r" \([\d.]+ms\)", log) is not None, "parent_or_case_pass:" + title)
        reports = {}
        for line in lines:
            start = line.find('{"schemaVersion":1,"fixture":')
            if start < 0: continue
            report = json.loads(line[start:].strip())
            key = report["fixture"]
            require(key in PARENTS and key not in reports, "native_report_discriminator")
            reports[key] = report
        native = []
        if family == "windows":
            require(set(reports) == set(PARENTS), "all_four_native_reports:" + kind)
            for fixture_name, title in PARENTS.items(): passed(title)
            for fixture_name, cases, source_key, fixture_key, functions in [
                ("dev-runtime-identity", new_cases, "probe", "devFixture", new_functions),
                ("manager-launcher-identity", old_cases, "launcher", "launcherFixture", old_functions)]:
                r = reports[fixture_name]; modern = fixture_name == "dev-runtime-identity"
                keys = ["schemaVersion", "fixture", "sourceSha256", "sourceBytes", "powerShellVersion", "powerShellEdition", "platform",
                        "loadMode", "loadedFunctions", "listenerAndCimData", "blockedSideEffectAttempts", "queryFaults",
                        "cases", "total", "passed", "failed", "fixtureSha256", "childExitCode"]
                keys += ["executableBody", "processSnapshots", "argumentParser"] if modern else ["launchBodySelection"]
                exact_keys(r, keys, fixture_name)
                require(r["schemaVersion"] == 1 and r["platform"] == "Win32NT" and r["powerShellEdition"] == "Desktop", "native_platform")
                require(re.fullmatch(r"5\.1\.\d+\.\d+", r["powerShellVersion"]) is not None, "native_powershell")
                require(r["loadMode"] == "top-level-function-definitions-only" and r["listenerAndCimData"] == "simulated", "native_fixture_boundary")
                require(r["loadedFunctions"] == functions, "native_loaded_functions")
                require(r["executableBody" if modern else "launchBodySelection"] == "excluded-by-AST", "native_no_main_body")
                if modern: require(r["processSnapshots"] == "simulated" and r["argumentParser"] == "native-CommandLineToArgvW", "new_native_fixture_boundary")
                for key in ["blockedSideEffectAttempts", "queryFaults", "failed", "childExitCode"]:
                    require(type(r[key]) is int and r[key] == 0, "native_zero:" + key)
                require(r["total"] == r["passed"] == len(r["cases"]) == len(cases), "native_count")
                source_binding = bound(source_key, r["sourceSha256"], r["sourceBytes"])
                fixture_binding = bound(fixture_key, r["fixtureSha256"])
                for observed, expected in zip(r["cases"], cases):
                    require(observed["name"] == expected["name"] and observed["expected"] == observed["actual"] == expected["expected"], "native_decision:" + expected["name"])
                    require(observed["privateArgumentLeaked"] is False, "native_privacy")
                    passed(expected["name"])
                    if modern:
                        exact_keys(observed, ["name", "expected", "actual", "returnedPid", "expectedPid", "queries", "expectedQueries",
                                             "identityPreserved", "privateArgumentLeaked", "failed"], "new_case")
                        require(observed["queries"] == observed["expectedQueries"] == expected["queries"] and
                                all(type(v) is int for v in observed["queries"] + observed["expectedQueries"]), "native_query_dispose_vector")
                        require(observed["identityPreserved"] is True and observed["failed"] is False, "native_case_integrity")
                        require(observed["expectedPid"] == expected["pid"], "native_expected_pid")
                        returned = expected["pid"] if expected["expected"] == "observed" else None
                    else:
                        exact_keys(observed, ["name", "expected", "actual", "returnedPid", "errorKind", "listenerQueries", "cimQueries",
                                             "expectedCimQueries", "privateArgumentLeaked"], "old_case")
                        require(observed["listenerQueries"] == 1 and observed["cimQueries"] == observed["expectedCimQueries"] == expected["cim"], "old_query_counts")
                        error = ("nonexclusive_listener" if expected["nonexclusive"] else "other_process") if expected["expected"] == "rejected" else None
                        require(observed["errorKind"] == error, "old_error_category")
                        returned = 4242 if expected["expected"] == "owned" else None
                    require(observed["returnedPid"] == returned, "native_returned_pid")
                native.append({"fixture": fixture_name, "cases": len(cases), "distribution": dict(Counter(c["expected"] for c in cases)),
                               "powerShell": r["powerShellVersion"], "source": source_binding, "fixtureHash": fixture_binding, "allDecisionsQueriesAndParentsPassed": True})
            current = reports["dev-runtime-native-current-parent"]
            expected_current = {"schemaVersion": 1, "fixture": "dev-runtime-native-current-parent", "platform": "win32",
                "nodeVersion": node, "fixedPowerShellPath": True, "source": "process-primary-token-and-token-profile",
                "listenerRolesRequested": 0, "currentPidMatched": True, "profileMatchedOsUserInfo": True,
                "spoofedEnvironmentLeftIdentityUnchanged": True, "spoofedEnvironmentLeftCreationUnchanged": True,
                "measuredFieldsCannotBeOverridden": True, "preloadEnvironmentRejected": True, "operationalIsolationQualified": False,
                "probeSha256": reports["dev-runtime-identity"]["sourceSha256"]}
            require(current == expected_current, "native_current_exact_report")
            listener = reports["dev-runtime-native-listener"]
            expected_listener = {"schemaVersion": 1, "fixture": "dev-runtime-native-listener",
                "probeSha256": reports["dev-runtime-identity"]["sourceSha256"], "listenerFixtureSha256": listener.get("listenerFixtureSha256"),
                "listenerRolesRequested": 1, "listenerRole": "owned-inert-fixture-only",
                "listenerStateProvider": "native-Get-NetTCPConnection", "nativeCimCreationBound": True, "unicodeInvocationMatched": True,
                "currentUserProfileMatched": True, "exactOwnedPidMatched": True, "exitedOnStdinEof": True, "operationalIsolationQualified": False}
            require(listener == expected_listener, "native_listener_exact_report")
            native += [current, {**listener, "fixtureHashBinding": bound("listenerFixture", listener["listenerFixtureSha256"])}]
        else:
            require(not reports, "no_native_claim_on_nonwindows")
        qualification = None
        if kind.endswith("-upstream"):
            qlines = [line[line.index('{"pass":true,"sourceSha":'):].strip() for line in lines if '{"pass":true,"sourceSha":' in line]
            qualification = json.loads(one(qlines, "upstream_summary"))
            require(qualification["pass"] is True and qualification["sourceSha"] == m["sourceSha"] and
                    qualification["platform"] == ("win32" if family == "windows" else "linux"), "upstream_log_binding")
            require(qualification["lanes"] == [{"lane": "control", "pass": True}, {"lane": "candidate", "pass": True}], "upstream_log_lanes")
            heads = re.findall(r"MTERM_QUALIFICATION_CANDIDATE_SHA: ([a-f0-9]{40})", log)
            require(heads == [m["headSha"]], "upstream_candidate_environment")
            upstream_nodes[family] = node
        job_results.append({"id": job["id"], "name": job["name"], "kind": kind, "conclusion": "success", "checkout": sha,
                            "totals": totals, "skips": skip_names, "node": node, "logSha256": digest(raw), "logBytes": len(raw),
                            "native": native, "qualificationSummary": qualification, "productionRouteRegression": regression,
                            "productionReferenceProtocol": protocol, "registeredReferenceNative": registered_reference,
                            "referenceFixturePrivacyRegression": fixture_privacy,
                            "devEdgeContract": edge_contract,
                            "allMetadataStepsSucceeded": True})
    require(len(artifacts) == 2 and len({a["id"] for a in artifacts}) == 2, "two_distinct_artifacts")
    archive_results = []
    for platform, runner in [("linux", "ubuntu-latest"), ("windows", "windows-latest")]:
        expected_name = f'upstream-qualification-{runner}-{m["runId"]}-{m["attempt"]}'
        a = one([a for a in artifacts if a["name"] == expected_name], "artifact_platform:" + platform)
        require(a["expired"] is False and a["workflow_run"]["id"] == m["runId"] and a["workflow_run"]["head_sha"] == m["headSha"], "artifact_run_binding")
        raw = read(base / f'{m["phase"]}-{a["id"]}.zip', 5 * 1024 * 1024)
        require(len(raw) == a["size_in_bytes"] and "sha256:" + digest(raw) == a["digest"], "artifact_digest_size")
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            infos = z.infolist()
            require(len(infos) <= 32 and len({i.filename for i in infos}) == len(infos), "zip_member_count_uniqueness")
            require(sum(i.file_size for i in infos) <= 8 * 1024 * 1024, "zip_expanded_bound")
            contents = {}
            for info in infos:
                p = pathlib.PurePosixPath(info.filename)
                require(not p.is_absolute() and ".." not in p.parts and "\\" not in info.filename, "zip_member_path")
                require(not info.flag_bits & 1 and not stat.S_ISLNK(info.external_attr >> 16), "zip_member_type")
                if not info.is_dir():
                    with z.open(info) as member: data = member.read(8 * 1024 * 1024 + 1)
                    require(len(data) == info.file_size, "zip_member_size_crc")
                    contents[info.filename] = data
            qname = one([n for n in contents if n.endswith("/qualification.json") or n == "qualification.json"], "qualification_report")
            prefix = qname.rsplit("/", 1)[0] + "/" if "/" in qname else ""
            def companion(name): return json.loads(contents[prefix + name])
            q = json.loads(contents[qname])
            require(q["schemaVersion"] == 1 and q["sourceSha"] == m["sourceSha"] and q["candidateSha"] == m["headSha"] and q["sourceTree"] == m["treeSha"], "qualification_identity")
            require(q["pass"] is True and type(q["modelCalls"]) is int and q["modelCalls"] == 0 and
                    q["host"] == "github-hosted" and q["sdkVersion"] == "1.32.2" and q["managerVersion"] == "0.4.0", "qualification_boundary")
            require(q["platform"] == ("win32" if platform == "windows" else "linux") and q["arch"] == "x64" and q["node"] == upstream_nodes[platform], "qualification_platform_runtime")
            require([(l["lane"], l["version"]) for l in q["lanes"]] == [("control", "0.3.1"), ("candidate", "0.3.3")], "qualification_versions")
            for lane in q["lanes"]:
                require([s["name"] for s in lane["stages"]] == STAGES and all(s["pass"] is True for s in lane["stages"]), "qualification_all_stages")
                require(lane["toolCount"] == 53 and lane["childExitCode"] == 0, "qualification_tool_count_exit")
                require(all(lane[k] is True for k in ["pass", "initialized", "childExited", "upstreamExited", "ownedProcessTreeExited"]), "qualification_cleanup")
                require(companion(lane["lane"] + "-result.json") == lane, "qualification_lane_companion")
            comparison = q["contractComparison"]
            require(comparison == companion("tool-contract-comparison.json"), "contract_comparison_companion")
            require(comparison["added"] == comparison["removed"] == comparison["contractChanges"] == [] and
                    comparison["descriptionChanges"] == ["kill_process"], "contract_report_delta")
            inventories = [companion(lane + "-tools.json") for lane in ["control", "candidate"]]
            require(all(isinstance(items, list) and len(items) == 53 and len({t["name"] for t in items}) == 53 for items in inventories), "raw_tools_count_uniqueness")
            left, right = [{t["name"]: t for t in items} for items in inventories]
            require(set(left) == set(right), "raw_tools_names")
            changed = []
            for name in sorted(left):
                x, y = copy.deepcopy(left[name]), copy.deepcopy(right[name])
                dx, dy = x.pop("description", None), y.pop("description", None)
                require(x == y, "raw_tool_contract:" + name)
                if dx != dy: changed.append(name)
            require(changed == ["kill_process"], "raw_tool_description_delta")
            archive_results.append({"id": a["id"], "name": a["name"], "bytes": len(raw), "sha256": digest(raw),
                "platform": q["platform"], "node": q["node"], "sourceSha": q["sourceSha"], "candidateSha": q["candidateSha"],
                "tree": q["sourceTree"], "modelCalls": 0, "files": len(contents), "zipIntegrityAndBounds": True,
                "qualificationSha256": digest(contents[qname]), "stagesPerLane": 10, "toolCountPerLane": 53,
                "versions": [l["version"] for l in q["lanes"]], "allStagesAndCleanupPassed": True,
                "companionReportsMatch": True, "rawToolDefinitionsCompared": True, "descriptionChanges": changed,
                "limits": q["limitations"]})
    return {"schemaVersion": 1, "accepted": True, "scope": "supplied exact-run hosted evidence",
        "phase": m["phase"], "runId": m["runId"], "attempt": m["attempt"], "sourceSha": m["sourceSha"],
        "headSha": m["headSha"], "treeSha": m["treeSha"], "localSourceCommit": m["localSourceCommit"],
        "manifestSha256": digest(read(manifest_path)), "verifierSha256": digest(read(pathlib.Path(__file__))),
        "jobs": job_results, "artifacts": archive_results,
        "reviewerAuthorship": "repository_baseline authored the 141 pure runtime-plan tests in batch36, 10 production-route regression groups in batch38, 49 pure protocol groups in batch40 and 42 DEV edge groups in batch42; runtime_review authored batch40 reference integration source/tests and batch42 edge implementation; independent whole-source approval belongs to startup_mutations separately",
        "limits": ["Root fetched authenticated metadata/logs/artifacts; this verifier independently reads and cross-checks supplied bytes without network.",
                   "No product/test code, native observer, listener, upstream package or model was executed by this verifier.",
                   "Native current/listener tests cover one hosted OS account and an owned inert child, not two operational DEV/production accounts.",
                   "New reference integration uses ten synthetic-native cases and one owned DEV listener case with a synthetic production authority; it performs no live production listener probes.",
                   "Zero observed integration fs/promises writes does not exclude fixture setup/drift or native compiler temporary activity.",
                   "Requester/channel authentication, separate-account/profile ACL deployment and production runtime source remain operationally unqualified.",
                   "Dedicated DEV edge tests use signed fixture JWTs and observed fixture storage/fetch calls; provider App/DB allocation, independent live credentials and owner grant remain unverified.",
                   "All runtime reports remain unqualified; source CI is not activation, deployment, OAuth-grant or routed-runtime acceptance."]}

def cross_phase(candidate, main):
    require(candidate["accepted"] is True and main["accepted"] is True, "cross_phase_accepted_inputs")
    require(candidate["phase"] == "candidate" and main["phase"] == "main", "cross_phase_order")
    require(candidate["treeSha"] == main["treeSha"], "cross_phase_same_reviewed_tree")
    require(candidate["runId"] != main["runId"], "cross_phase_distinct_runs")
    candidate_jobs = {j["id"] for j in candidate["jobs"]}; main_jobs = {j["id"] for j in main["jobs"]}
    candidate_artifacts = {a["id"] for a in candidate["artifacts"]}; main_artifacts = {a["id"] for a in main["artifacts"]}
    require(len(candidate_jobs) == len(main_jobs) == 5 and candidate_jobs.isdisjoint(main_jobs), "cross_phase_distinct_five_jobs")
    require(len(candidate_artifacts) == len(main_artifacts) == 2 and candidate_artifacts.isdisjoint(main_artifacts), "cross_phase_distinct_two_artifacts")
    return {"schemaVersion": 1, "accepted": True, "scope": "both exact-run hosted verifications and cross-phase separation",
            "treeSha": main["treeSha"], "candidateRun": candidate["runId"], "mainRun": main["runId"],
            "candidateSourceSha": candidate["sourceSha"], "candidateHeadSha": candidate["headSha"], "mainSha": main["headSha"],
            "candidateManifestSha256": candidate["manifestSha256"], "mainManifestSha256": main["manifestSha256"],
            "candidateJobIds": sorted(candidate_jobs), "mainJobIds": sorted(main_jobs),
            "candidateArtifactIds": sorted(candidate_artifacts), "mainArtifactIds": sorted(main_artifacts),
            "distinctRuns": True, "allFiveJobIdsDisjoint": True, "bothArtifactIdsDisjoint": True}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--manifest", type=pathlib.Path)
    mode.add_argument("--compare-manifests", nargs=2, type=pathlib.Path, metavar=("CANDIDATE", "MAIN"))
    args = parser.parse_args()
    try:
        if args.manifest:
            result = verify(args.manifest.resolve())
        else:
            candidate_path, main_path = [p.resolve() for p in args.compare_manifests]
            require(js(candidate_path)["repoFullName"] == js(main_path)["repoFullName"], "cross_phase_same_repository")
            result = cross_phase(verify(candidate_path), verify(main_path))
        code = 0
    except FileNotFoundError as error:
        result = {"schemaVersion": 1, "accepted": False, "pending": True, "missing": pathlib.Path(error.filename).name}; code = 2
    except (Rejected, ValueError, KeyError, IndexError, TypeError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        result = {"schemaVersion": 1, "accepted": False, "pending": False, "error": type(error).__name__ + ":" + str(error)}; code = 1
    print(json.dumps(result, indent=2)); return code
if __name__ == "__main__": sys.exit(main())
