# Access security and responsibility

Cloudflare Access authenticates the Google/Cloudflare identity and performs the perimeter decision. The application database independently authorizes each registered application. An approved identity does not imply any application grant. The verified owner remains protected by the original Cloudflare owner policy; new policies are additive.

Explicit per-user grants override inherited group permissions. An explicit user **Denied** blocks all group inheritance. Without an explicit user grant, any inherited **Denied** defeats inherited allows; otherwise the highest inherited supported role wins. The owner cannot be suspended or delegated through the dashboard.

## Protocol contracts

`verifyAccessJWT(token, {teamDomain, audiences, fetcher?, now?})` accepts only RS256 human application tokens with the exact team issuer, an explicitly expected application audience, a subject, email, and unexpired numeric expiry. `now` is Unix seconds. It fetches signing keys only from the configured `*.cloudflareaccess.com` team, caches for five minutes, coordinates concurrent key fetches, and limits unknown-key refreshes. It never trusts an unsigned email header, an embedded JWK, a user-selected issuer, or an ordinary cookie value without validation.

JWKS requests use Workers-supported `redirect: "manual"` and require a successful HTTP status. Redirect responses fail closed even if their bodies contain valid-looking keys; no redirect can change the trusted key host. The regression suite also covers Cloudflare's documented human-token shape, including `type: "app"`, `identity_nonce`, and `nbf`. The application token's `identity_nonce` is distinct from the external-evaluation protocol's `nonce`.

`externalEvaluation(request, env, authorizeCallback, options?)` implements Cloudflare's separate external-evaluation protocol. This is **not** an application login endpoint. Cloudflare posts `{ "token": "<signed JWT>" }`; the verified payload contains `identity.email`, `nonce`, and `exp`. Cloudflare's published example does not require an `aud` or `iss` claim for this protocol. If `iss` exists, this implementation requires the configured team. The callback must return literal `true`; it receives normalized email and verified claims. Bind the desired application in the callback closure from the server's trusted route map. Never accept a request-body application ID as authority.

The response is `{ "token": "<RS256-signed JWT>" }` with `success`, the unchanged `nonce`, `iat`, and a 60-second `exp`. `EVALUATION_PRIVATE_JWK` is a Worker secret containing an RSA private JWK of at least 2048 bits. Generate this at deployment, never in a public request. `evaluationPublicKeys(env)` emits only public RSA fields. The public key endpoint must be accessible to Access without authentication, while no private key or signed request contents are logged.

Example additive policy (the owner policy is preserved):

```json
{
  "name": "Central application grants",
  "decision": "allow",
  "include": [{
    "external_evaluation": {
      "evaluate_url": "https://codes.m-techlabs.com/__access/evaluate/codes",
      "keys_url": "https://codes.m-techlabs.com/.well-known/access-evaluation-keys"
    }
  }],
  "require": [{ "login_method": { "id": "<verified Google IdP ID>" } }]
}
```

No broad Gmail-domain or everyone rule is necessary. Google setup requires a real OAuth client ID and secret from the owner's Google project. It uses the exact callback `https://broken-breeze-d0bb.cloudflareaccess.com/cdn-cgi/access/callback`; credentials must go directly into Google/Cloudflare settings, never the repository or chat. Until configured and tested, the UI must describe Google sign-in as unavailable.

## Authorization and session requirements

External evaluation runs at login. Therefore gateway/backend authorization must read the current database status and application grant on every protected request; login-time evaluation alone cannot deliver immediate revocation. Authorization reads must use the primary database, with no stale permission cache. The host and route select the expected Access audience. A JWT issued for Code Bot cannot authorize owner routes or a different application.

Cloudflare can revoke tokens per application or per user through its management API. If the runtime has no scoped revocation credential, show that limitation accurately. Application session revocation is still enforced by current database status and session version. Existing WebSocket connections or independent native app sessions need their own termination integration; do not claim they are closed by changing the Access policy.

Legacy applications without integrated roles expose an application gate, not backend editor/viewer privileges. Do not offer a read-only role that merely hides buttons. Native authorization adapters require separate backend verification before advertising granular support.

Use host-only `__Host-` session cookies with `Secure; HttpOnly; SameSite=Lax; Path=/` and no `Domain` attribute. Guild sessions must be accepted only on the Code Bot hostname, have a short expiry, and recheck the passphrase version. They do not identify a unique human and must never be accepted as Google users. Store hashes of random session tokens. Do not send session tokens in query strings or logs.

Browser mutations require **both** `sameOrigin(request)` and a session-bound CSRF token in a custom header; JSON endpoints should reject unexpected content types. The origin check rejects missing/null/cross-origin origins, including sibling subdomains. Return private/auth responses with `Cache-Control: no-store`. Escape all externally supplied code/reward text when rendering and apply a restrictive content-security policy.

## Shared guild passphrase

`hashPassphrase(passphrase)` stores PBKDF2-HMAC-SHA256 with 100,000 iterations, a fresh 128-bit salt, and a 256-bit derived key. `verifyPassphrase` accepts only this versioned representation and compares without a direct early-exit string comparison. Creation requires at least 16 characters; a generated 32-byte random value is preferred. The shared passphrase is for low-privilege Code Bot access. A globally coordinated attempt limiter is required before performing the KDF, with per-IP/session limits as an additional layer. Rotation must atomically increment the version and invalidate existing guild sessions. The KDF is deliberately bounded for Workers compatibility; it does not justify allowing unlimited online guesses or weak shared phrases.

## Rollout and rollback

Keep the original owner policies and Cloudflare IdP unchanged. Add and test a new Worker/domain/login path first. Save policy and route configurations before changing them. If a gateway route fails, removing the new route restores the original Access-protected origin; remove the additive delegated policy too so the fallback stays owner-only. Do not enable Worker `passThroughOnException` on authorization routes. A separate path that preserves Cloudflare owner authentication remains the recovery control plane.

## Resource limits

The authentication path fails closed if its database or signing keys are unavailable. Do not bypass authorization to preserve availability. Access runs before hostname-protected Worker routes. Use hostname/path protection for the login endpoint; protecting the entire Code Bot Worker would also block the public evaluator/key endpoints and optional passphrase login.

Record real Worker CPU and D1 row usage after deployment. Source parsing and the guild KDF must fit the chosen Workers plan. Unchanged source snapshots skip redundant code and evidence rewrites. Changed snapshots, scan records, source-check metadata, audit entries, and index maintenance still consume D1 writes; measure actual rows at the configured 48 scans per day. Permission reads intentionally remain uncached. If usage approaches limits, reduce redundant data writes or source frequency before considering a paid plan. Never silently purchase an upgrade.

HTTP `waitUntil` provides at most 30 seconds after a response. Source adapters use parallel five-second timeouts, but production CPU/quota failures must remain visible as failed/stale scans rather than fabricated success. The 120-second lease and global 15-minute cooldown recover abandoned jobs without starting an upstream request storm.

## Primary references

- [Cloudflare Google identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)
- [Cloudflare External Evaluation protocol](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/external-evaluation/)
- [Official example source](https://github.com/cloudflare/workers-access-external-auth-example/blob/main/index.js)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Policy selectors and continuous evaluation](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Workers Access ordering and path protection](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Workers execution context and waitUntil limits](https://developers.cloudflare.com/workers/runtime-apis/context/)
- [Cloudflare plan limits](https://www.cloudflare.com/plans/)
