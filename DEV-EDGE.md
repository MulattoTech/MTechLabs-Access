# Closed DEV edge boundary

`src/mcp-dev-edge.js` implements a declaration validator, a runtime-plan declaration matcher, and an owner authorization check for the proposed DEV MCP resource. Every request ends at this boundary. A successful owner check returns HTTP 503 with `dev_activation_disabled`; it cannot dispatch an MCP operation, read the request body, or contact a manager backend.

`src/mcp-dev-entry.js` is a separate Worker entry containing only a `fetch` delegate. It has no scheduled handler. The existing application entry also reserves `mcp-dev.m-techlabs.com` and `mcp-dev-origin.m-techlabs.com` before website application lookup, including when DEV configuration is absent or invalid. Hostnames with one or more trailing dots are included only in this reservation: the dedicated handler rejects their nonexact URLs with HTTP 404. They cannot reach the generic gateway or become accepted DEV targets through normalization. The origin hostname always receives a terminal denial from this handler.

This is source preparation. It does not allocate resources, configure a Worker route, install a manager, change a token or permission, or activate DEV. Selecting a dedicated Worker entry and provisioning its bindings require a separately reviewed deployment. The existing production MCP verifier and forwarding implementation are unchanged.

## Public API

| Export | Result |
| --- | --- |
| `validateDevEdgeDescriptor(input)` | A new, deeply frozen descriptor in the canonical field order below; throws `Error('invalid_dev_edge_descriptor')` on invalid input. |
| `matchDevEdgeRuntimePlan(descriptor, plan)` | A frozen declaration-comparison result; invalid descriptors retain the descriptor error, while missing or mismatched plan declarations throw `Error('dev_edge_runtime_plan_mismatch')`. |
| `devRemoteMcp(request, env)` | A terminal, non-cacheable HTTP response with a fixed error code and the closed readiness flags below. |
| `DEV_MCP_HOST` | `mcp-dev.m-techlabs.com` |
| `DEV_MCP_ORIGIN_HOST` | `mcp-dev-origin.m-techlabs.com` |

The validator accepts ordinary or null-prototype data records. Required keys must be enumerable own data properties. Missing or extra keys, symbol keys, non-enumerable keys, accessors, arrays, class instances, and custom prototypes are rejected. It does not invoke descriptor getters. Its result contains only newly constructed records and primitive values, so later changes to the input do not affect it.

## Descriptor schema and canonical encoding

The top-level fields, in canonical order, are:

```text
schemaVersion, instanceId, authorizationMode, upstreamEnabled, owner,
production, development, accessIssuer, resourceMetadata
```

`schemaVersion` is `1`; `authorizationMode` is `owner-only`; `upstreamEnabled` is exactly `false`. `instanceId` is at most 48 characters and matches `^dev(?:-[a-z0-9]+)*$`.

`owner` has exactly `email` and `subject`, in that order. The email must already equal the existing security module's normalized email, with no wildcard or control character. Normalization preserves provider-independent dots and plus-addressing. The subject is an exact, case-sensitive, nonwhitespace ASCII string of 1–512 characters. Both must match the authenticated owner; email alone does not replace the subject check.

Both role records have these fields, in this order:

```text
resource, origin, backendId, accessAppId, audience, connectorAppId,
authorizationStoreId, credentialSha256, credentialBinding,
authorizationStoreBinding, managerPort, originHostHeader
```

| Role field | Production declaration | DEV declaration |
| --- | --- | --- |
| `resource` | `https://mcp.m-techlabs.com/mcp` | `https://mcp-dev.m-techlabs.com/mcp` |
| `origin` | `https://mcp-origin.m-techlabs.com/mcp` | `https://mcp-dev-origin.m-techlabs.com/mcp` |
| `backendId` | Lowercase label matching `^[a-z][a-z0-9-]{0,63}$` | Same format; distinct from production |
| `accessAppId` | Lowercase UUID | Distinct lowercase UUID |
| `audience` | 64 lowercase hexadecimal characters | Distinct 64-character value |
| `connectorAppId` | `asdk_app_` followed by 32 lowercase hexadecimal characters | Distinct value in the same format |
| `authorizationStoreId` | Lowercase UUID | Distinct lowercase UUID |
| `credentialSha256` | SHA-256 declaration, 64 lowercase hexadecimal characters | Distinct SHA-256 declaration in the same format |
| `credentialBinding` | `MCP_MANAGER_TOKEN` | `MCP_DEV_MANAGER_TOKEN` |
| `authorizationStoreBinding` | `DB` | `MCP_DEV_AUTH_DB` |
| `managerPort` | `19740` | Integer 1024–65535, excluding 19740 |
| `originHostHeader` | `mcp-origin.m-techlabs.com` or `127.0.0.1:19740` | Exactly `127.0.0.1:<managerPort>` |

`accessIssuer` is a canonical `https://<team>.cloudflareaccess.com` URL with a lowercase DNS-label team name, no path, trailing slash, query, fragment, credentials, or port. `resourceMetadata` is exactly `https://mcp-dev.m-techlabs.com/.well-known/oauth-protected-resource`.

Schema-required identifiers cannot be replaced with `null`, wildcards, or format-invalid placeholder strings. Syntactically valid fabricated identifiers and digests can pass validation; the validator cannot distinguish them from allocated values without separate authoritative evidence. Test identifiers are intentionally synthetic. Passing validation establishes only that supplied declarations meet this schema, not that provider resources exist or have those bindings.

The environment binding `MCP_DEV_EDGE_DESCRIPTOR` must contain at most 16,384 UTF-8 bytes of canonical JSON. Construct it from a separately reviewed descriptor:

```js
import {validateDevEdgeDescriptor} from './src/mcp-dev-edge.js';

const canonicalDescriptor = JSON.stringify(
  validateDevEdgeDescriptor(reviewedDescriptor),
);
```

The handler requires this serialization to match the environment text exactly. Whitespace variations, changed field order, duplicate keys, alternate escapes, omitted fields, unknown fields, and ambiguous representations are rejected. Treat the descriptor as protected configuration: it contains the owner identity and credential commitments, even though it contains no raw credential. Do not send it in a diagnostic response or record it in request logs.

## Captured bindings and credential checks

The dedicated handler uses these environment values only:

| Binding | Required value |
| --- | --- |
| `MCP_DEV_EDGE_DESCRIPTOR` | Canonical descriptor JSON as above |
| `MCP_DEV_MANAGER_TOKEN` | A 32–512-character printable ASCII string containing no whitespace |
| `MCP_DEV_AUTH_DB` | A D1-compatible object with a data-method `prepare` |

Before its first asynchronous operation, the handler copies and freezes the descriptor, captures the token string, and captures the DEV database handle with its bound `prepare` method. It also captures the JWT assertion and the fetch function used for the pinned JWKS lookup. It does not reread these selectors after hashing, fetching signing keys, or querying authorization. A later mutation of the environment or replacement of the database's `prepare` property cannot retarget this request.

Relevant DEV environment fields must be own data properties. Method capture supports an own `prepare` method or a data method on the database's prototype chain, bounded to eight objects. Accessor methods are refused. If `env.DB` is an own data property containing the exact same object as `MCP_DEV_AUTH_DB`, configuration is refused. This comparison never invokes a production binding getter, queries the production database, or reads the production bearer token.

The actual captured DEV token is SHA-256 hashed with Web Crypto. Its digest must equal the declared DEV digest and differ from the declared production digest. The production digest is supplied by trusted configuration; this module does not independently observe production or prove that this declaration matches its current credential. Separate object references and declared database IDs also do not prove that two live bindings address different D1 databases. Provider binding allocation and authoritative production-reference checks remain external prerequisites.

Opaque D1 objects can manage their own internal state. Capturing the object and method prevents selector replacement; it is not an isolation guarantee against a malicious replacement implementation. Deployment configuration and binding integrity must be established separately.

## Request and owner checks

The accepted parsed URL is exactly the HTTPS DEV public resource or its exact metadata URL. Other hosts, the backend-origin hostname, paths, query strings, fragments, or nondefault ports receive `dev_edge_not_found`. URL parsing can normalize spelling before the handler sees it; this check is against the parsed request URL.

The resource accepts only `POST`; the metadata URL accepts only `GET`. Other methods receive `dev_edge_method_not_allowed` with the appropriate `Allow` header. No request body is consumed, including for an authorized POST. A supplied `Origin` must be exactly the DEV public origin, `https://chatgpt.com`, or `https://claude.ai`; an absent `Origin` is allowed. This allowlist does not establish connector compatibility, successful browser CORS negotiation, OAuth integration, or Gemini qualification.

A configured metadata request returns HTTP 503 with `dev_activation_disabled` and `ownerAuthorized: false`. It publishes no OAuth discovery document. There is no authorization server, client registration endpoint, authorization-code exchange, refresh token, session creation, or grant mutation in this entry.

For a resource request, the handler verifies `Cf-Access-Jwt-Assertion` using the existing RS256 verifier and the descriptor's exact Access issuer and DEV audience. Signing keys come only from the pinned issuer's `/cdn-cgi/access/certs` endpoint through the verifier's existing bounded JWKS loader. The DEV boundary additionally requires:

1. The signed claim `type` is exactly `app`.
2. `aud` is the exact DEV audience string or an array containing that one audience exactly once. Production, mixed, duplicate, and multiple audiences are refused.
3. `sub` equals the pinned owner subject and the normalized claim email equals the pinned owner email.
4. The DEV authorization store returns an approved owner row for that exact email, with `is_owner === 1` and a nonnegative safe-integer `revoke_before` strictly less than the token's issuance time.
5. The token remains unexpired after the asynchronous authorization lookup.

The sole database query is:

```sql
SELECT id,email,status,is_owner,revoke_before FROM users WHERE email=?
```

Its parameter is the pinned owner email. There is no website application lookup, website permission fallback, generic gateway invocation, audit insertion, session write, or backend request. A valid owner result remains terminal and does not process the MCP body.

## Fixed response contract

Every response is JSON with `Cache-Control: no-store`. It contains `error`, `ownerAuthorized`, and each of the following flags set to `false`:

```text
activationAuthorized, qualified, upstreamEnabled, productionReferenceVerified,
authorizationStoreVerified, liveRoutingVerified, grantsVerified, sourceVerified
```

Only an authenticated, approved, unrevoked owner result sets `ownerAuthorized: true`. That flag describes the local authorization decision for this request, not deployment readiness or independent provider verification.

| Status | Error code | Meaning |
| --- | --- | --- |
| 404 | `dev_edge_not_found` | Wrong public resource URL, including use of the backend-origin hostname |
| 405 | `dev_edge_method_not_allowed` | Unsupported method on an otherwise valid URL |
| 403 | `dev_edge_origin_denied` | Explicit browser origin is outside the exact allowlist |
| 503 | `dev_edge_unconfigured` | Invalid descriptor, binding, token, or credential commitment |
| 401 | `dev_edge_unauthorized` | Missing, invalid, wrongly scoped, or expired Access assertion |
| 403 | `dev_edge_owner_denied` | Wrong pinned owner, missing or invalid owner row, or revoked assertion |
| 503 | `dev_edge_authorization_unavailable` | Authorization store operation failed |
| 503 | `dev_activation_disabled` | Configured metadata request, or fully authorized owner request with forwarding disabled |

Unauthorized responses include `WWW-Authenticate: Bearer resource_metadata="https://mcp-dev.m-techlabs.com/.well-known/oauth-protected-resource", error="invalid_token"`. That URL identifies the reserved DEV metadata location; it does not assert that discovery is operational. Responses never contain assertion claims, owner identifiers, descriptor text, database rows, bearer tokens, credential hashes, backend URLs, or raw error messages.

## Runtime-plan comparison and remaining prerequisites

`matchDevEdgeRuntimePlan` compares schema version, Windows platform declaration, instance ID, owner-only mode, each role's manager port, and each role's resource, origin, backend, Access App, audience, connector App, and Host-header declaration. Both plan roles must match the descriptor exactly. A successful result contains:

```js
{
  matched: true,
  evidence: 'declared-routing-only',
  runtimePlanValidated: false,
  activationAuthorized: false,
  qualified: false,
  upstreamEnabled: false,
  productionReferenceVerified: false,
  authorizationStoreVerified: false,
  liveRoutingVerified: false,
  grantsVerified: false,
  sourceVerified: false
}
```

This matcher intentionally has no Node imports or filesystem access. It does not check Windows identities, profiles, paths, process arguments, listeners, ACLs, or whether the full plan is valid. Its caller must separately run the manager's strict runtime-plan validation and obtain authoritative observations. Store and credential declarations are edge additions and are not inferred from the older routing-plan schema.

The previously documented [DEV readiness prerequisites](docs/engineering/2026-11-20-dev-readiness/README.md) remain in force. Distinct provider resources and bindings, trustworthy production-reference bootstrap, dedicated owner authorization state, protected runtime paths, runtime identity evidence, deployed-source evidence, and actual connector grants all require separate qualification. There is no flag or environment option in this module that enables forwarding after those checks: activation would require a separately reviewed source change.

## Provider references

- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) describes assertion validation against the team issuer and application audience.
- [Cloudflare Access application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/) documents application-token claims, including `type: app`.
- [D1 database Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/) documents `prepare` and related binding methods; it does not provide a database-ID introspection check for this boundary.
