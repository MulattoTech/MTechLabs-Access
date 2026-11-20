# Authenticated production references for read-only DEV inspection

The restricted reference API lets a DEV inspector use an authenticated,
request-bound production observation without directly opening production's
protected config, token or profile. It remains a read-only diagnostic. It never
enrolls a config in the manager's validated/owned writer capabilities, opens a
jobs database, starts an upstream or enables activation.

This source API has no HTTP/IPC listener, registration editor, key-file loader,
CLI key override or automatic fallback. An integrator supplies trusted bootstrap
objects and an exchange callback. The existing `manage-dev.ps1` / direct inspector
continue to use their original permissions and behavior. A restricted operational
entry point needs separately qualified bootstrap, transport and OS protections.

## Trust and registration

Trusted owner bootstrap calls `createProductionReferenceRegistration` from
`lib/dev-runtime-reference.mjs` with exactly:

```js
{
  id, generation,
  productionConfigPath, developmentConfigPath, planPath,
  production, development, plan
}
```

`production` and `development` are the complete expected normalized manager
configurations; `plan` is the strict runtime plan. The paths identify the exact
registered config and DEV plan files. The registration pins both sides, including
their controls, upstream runtime files and profile/manager declarations. An
independent generation and deterministic SHA-256 digest bind the registration.
The returned handle exposes only its digest and DEV instance ID.

Registration is expected configuration, not evidence that installed files match
or that its storage is protected. Place bootstrap code, registration and signing
material outside DEV's modification rights, including ancestor rename/delete and
inherited rights. The current production filesystem prerequisites identified in
the [readiness plan](../../docs/engineering/2026-11-20-dev-readiness/README.md)
remain unresolved by this source delivery. A DEV-writable key, registration or
observer cannot establish authority.

Create the owner-context authority with
`createRegisteredProductionReferenceAuthority(registration, privateKey)`. The
private key must be an Ed25519 `KeyObject` supplied by trusted bootstrap. The API
does not generate or persist operational keys. Separately create a pinned client
with `createProductionReferenceClient` from `lib/production-reference.mjs`:

```js
const referenceClient = createProductionReferenceClient({
  publicKey,
  registrationSha256: registration.sha256,
  instanceId: registration.instanceId,
});
```

The public key and expected registration digest must come from trusted
configuration, not from the DEV plan, request or response. The public-key object
must be Ed25519 and public-only. Changing a registration generation, any pinned
configuration, or the key requires corresponding trusted bootstrap changes.

## Exchange and inspection

Invoke the new Windows-only entry explicitly:

```js
const report = await inspectDevRuntimeWithReference(
  configPath, planPath, referenceClient, exchange,
);
```

`exchange(requestString, { signal })` returns a signed response string. A returned
authority function can be used directly as the callback in disposable in-process
fixtures. Such a fixture does not establish separate OS identities or protected
key storage. A deployed transport must authenticate and authorize the requester
before invoking the privileged authority and honor cancellation/bounds. A signed
response authenticates the reference; it does not authenticate the requester.

The consumer reads its selected DEV config, plan, controls and local topology.
It invokes the native helper with only the DEV role and preserves the independent
current process/token/profile checks. Production declarations remain data: the
consumer does not follow the production config/profile paths or ask the helper
to inspect the production process/token. The native helper still enumerates the
TCP table before filtering; this is not a claim that production TCP rows are
invisible to the process.

After the exchange, the consumer re-reads its own snapshots, rejects drift and
rechecks reference expiry before returning the report. It never falls back to
the direct inspector if reference exchange or verification fails. Existing
`loadConfig`, startup, admin and writer ownership checks remain unchanged.

## What the authority observes

For each request, the authority:

1. Validates the bounded request, registration/instance binding and time window,
   then reserves the nonce and observation slot before its first asynchronous work.
2. Opens the fixed registered config and plan files and compares actual values
   with registered expectations before following controls or runtime paths.
3. Uses only its immutable registered objects for subsequent privileged reads.
   It does not reuse the legacy validator that re-reads config and follows newly
   read paths after asynchronous boundaries.
4. Checks canonical state/profile separation, control placement and identities,
   runtime placement, links/hardlinks, and the bounded DEV state topology. DEV
   config, policy, token and inventory must remain direct children of DEV state
   with nonreserved names in both declared and canonical form. The plan has its
   separate exact `dev-runtime-plan.json` location check.
5. Reads both actual digest-only credential files and compares their effective
   digests internally. Plaintext credentials and equal credentials are refused.
6. Checks the request's config/plan fingerprints and nonce-bound DEV snapshot
   commitment, obtains the registered production native observation, and repeats
   the same fixed snapshots and topology checks after observation.
7. Signs a bounded comparison result only while the original request is fresh.

The private DEV snapshot includes the actual token, policy, inventory, config and
plan snapshots, as well as relevant canonical metadata/topology. Config and plan
hashes alone would miss a token-only change. Only a nonce-bound aggregate
commitment crosses the interface; individual credential fingerprints, production
bearers and production digests are not returned.

Opened-file identity and before/after path checks detect observed drift. They
are point-in-time checks, not a Windows handle-relative filesystem sandbox
against hostile concurrent ancestor replacement. Protected registered paths and
ancestors remain operational prerequisites. A receipt also does not attest the
source bytes loaded by an existing process or guarantee future liveness.

## Protocol and resource bounds

The protocol uses canonical ordered JSON with exact schemas. Unknown or duplicate
keys, alternate encodings, noncanonical base64url, malformed time fields and
oversized strings are refused. Requests are at most 2048 UTF-8 bytes; response
envelopes at most 8192 bytes; decoded payloads at most 2048 bytes. Keys and algorithms
cannot be selected by received data.

Each request has an internally generated 32-byte random nonce and binds the
registration digest, DEV instance, exact config/plan fingerprints and nonce-bound
control commitment. It contains no filesystem path, command, URL, key location
or caller authorization assertion. The signed payload binds the SHA-256 of those
exact request bytes, registration, observation window and expiry.

Ed25519 signs the exact payload bytes prefixed with
`MTerm-CLI production reference v1\n`. The signature is verified with the pinned
public key before trusting the payload. The nonce-bound control commitment is
SHA-256 over `MTerm-CLI DEV controls v1\n`, the nonce, a newline and the private
aggregate snapshot digest. These are protocol domain separators, not inputs
chosen by a remote peer.

Requests live for at most 30 seconds. The client checks both wall time and elapsed
monotonic time, consumes a single internally generated verification attempt, and
rechecks freshness when the opaque proof is read. Expired/invalid proofs cannot
be revived by a later clock change. An observation must lie inside the request's
window; the producer rechecks its deadline before and after signing. This local
protocol assumes coherent clocks; unsupported skew fails closed.

Each authority has a maximum of 64 retained nonces and eight active observations;
each client has eight active exchanges. Independent challenges can proceed
concurrently. Duplicate, failed and in-flight requests retain their nonce through
the valid window. Capacity exhaustion rejects new work instead of evicting live
entries. There is no automatic retry or target fallback.

Cancellation and timeout abort the supplied signal. A callback that ignores
cancellation retains its concurrency slot until it actually settles; caller
timeout alone cannot admit unlimited hidden work. The installed native helper has
its own bounded process timeout. Replay state and pending challenges are in memory
and are not restored after restart. This interface is not a durable issuance,
execution or activation service.

Optional clock functions are trusted test/bootstrap dependencies. They are not
wire fields or a CLI escape hatch. Production defaults use `Date.now()` and
Node's high-resolution process clock. The implementation uses Node's built-in
signature and randomness APIs; see the primary
[Node 24 crypto documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html)
and [performance API documentation](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html).

## Reports and acceptance limits

A valid signature may carry a production listener status of `matched`,
`mismatched`, `absent` or `unverified`. Authentication and observation match are
distinct. Failed topology/credential comparisons do not produce an accepted
reference. The public report carries bounded status, timestamps and fingerprints,
and labels production evidence `authenticated-point-in-time`; it does not
manufacture a raw native observation from a signed status.

The existing `qualified`, `upstreamEnabled`, `runningSourceVerified`,
`routing.liveVerified` and `routing.oauthGrantsVerified` remain false. Local DEV
identity/profile/listener failures and the unresolved operational prerequisites
remain visible. The report grants no writer capability, manager ownership or
permission to start work. Errors expose fixed categories rather than private
callback, path or crypto diagnostics.

Pure protocol tests exercise real ephemeral Ed25519 fixtures, strict wire and key
validation, signature/binding failures, freshness/replay, cancellation and bounded
concurrency. Disposable Windows integration tests qualify fixed-path snapshots,
credential/control drift, production-access refusal on the consumer, actual
native role selection, privacy and the absence of writer authority. The exact
results, immutable review and distinct candidate/main receipts are retained on
[Access #40](https://github.com/MulattoTech/MTechLabs-Access/issues/40).

Those tests do not establish two-account OS isolation, a protected operational
registration/key, an authenticated deployed transport, loaded production source,
live DEV routes/grants or activation readiness. These remain separate gates.
