# Production operations

This repository updates the existing `mtechlabs-access-codes` Worker and D1 database recorded in `deployment.json`. The manifest also records the exact six legacy gateway routes, their six central Access policy IDs, the two owner dashboard routes, and the separate Code Bot login policy/domain. Review the manifest before any operation; scripts refuse mismatched scope or ownership.

Use Node.js 24 or newer. No package installation is needed. Run commands from the repository root. Supply `CLOUDFLARE_API_TOKEN` through your shell or a trusted secret manager. Never commit tokens, Google client secrets, private JWKs, browser cookies, or guild passphrases. Do not use shell tracing while injecting credentials. The Worker itself has no Cloudflare management token.

All three scripts default to a dry run. `deploy.mjs` performs a local build/plan; the other two read live Cloudflare configuration to verify the proposed change. Only `--apply` permits remote mutations. Error output contains HTTP status and API error codes, not complete API responses or identity-provider credentials. Operation receipts are written under ignored `dist/operations/` with restrictive local permissions.

## Deployment

```bash
npm test
npm run check
node scripts/deploy.mjs
node scripts/deploy.mjs --apply
```

The deployment script builds the embedded UI assets, uploads the existing Worker as JavaScript modules using multipart form data, preserves all `secret_text` bindings, retains other remote-only bindings through strict inheritance, updates the configured plain-text variables/D1 binding, and applies the existing cron schedule. It requires the existing `EVALUATION_PRIVATE_JWK` secret and the expected live database binding. It does not create or delete Access applications, routes, custom domains, databases, Google providers, users, or grants. It leaves the existing workers.dev and preview exposure settings alone.

The initial SQL file is reapplied only after checking its reviewed additive form: `CREATE TABLE/INDEX IF NOT EXISTS`, the foreign-key pragma, and the two exact `INSERT OR IGNORE` singleton initializers. Existing user and application data is retained. **This is not a general migration runner.** `CREATE IF NOT EXISTS` cannot add a new column to an existing table. If additional SQL migration files exist, the script stops. Review evolving schemas and use a separate migration procedure before deploying code that needs them. The script does not initialize a new installation's owner, applications, or source records.

Use an account-scoped API token with **Workers Scripts Write** and **D1 Write** for deployment. No DNS or Access write permission is needed for this script. The API user must be able to read the existing Worker settings; the write role includes the relevant read access. Credentials belong in the deployment operator's environment, never in Worker plain-text variables.

After deployment, verify these specific behaviors:

- `https://codes.m-techlabs.com/health` returns the correct service and `aiInference: false`.
- `https://codes.m-techlabs.com/.well-known/access-evaluation-keys` returns public RSA keys and no private-key components.
- The owner's original Cloudflare login still opens `https://m-techlabs.com/admin/access`.
- A fresh approved identity can open only its assigned application. Missing grants and revoked/suspended users remain denied.
- Existing owner-only hubs and independent application logins retain their behavior.

An API upload or cron update can partially succeed before a later check fails. Read the error and inspect the Worker before retrying; do not assume every failure means nothing changed. Redeploy a reviewed earlier commit to roll back code. The script intentionally does not roll back D1 data.

## Finish Google sign-in

Google OAuth credentials have **not** been supplied in the task. No usable Ashley email was supplied either. Neither a Google provider nor a user grant should be invented from those missing details.

First create a real Google OAuth web client in an account/project you control, following the [Cloudflare Google identity-provider setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/). Configure the consent screen and any test-user restrictions appropriate to that Google project. Use this exact authorized redirect URI:

```text
https://broken-breeze-d0bb.cloudflareaccess.com/cdn-cgi/access/callback
```

Configure the Google client ID and secret directly in the Cloudflare Google identity-provider settings. Keep the existing Cloudflare owner provider `7ce61789-b506-4480-bf8d-7138a1765165` enabled. Do not put OAuth credentials in this repository, a command argument, a ticket, or chat. Copy only the resulting **Cloudflare identity-provider UUID** into `GOOGLE_IDP_ID` in your environment.

```bash
node scripts/finish-google.mjs
node scripts/finish-google.mjs --apply
```

The dry run requires both `GOOGLE_IDP_ID` and `CLOUDFLARE_API_TOKEN`. It verifies the provider exists in the recorded account and has type `google`. The script is restricted to these seven managed applications:

| Application | Access scope |
| --- | --- |
| BabyTracker Preview | `tracker-preview.m-techlabs.com` |
| Fleet Control Hub | `fleet.m-techlabs.com` |
| Portainer | `portainer.m-techlabs.com` |
| BabyTracker | `tracker.m-techlabs.com` |
| HomeBox | `homebox.m-techlabs.com` |
| MJobs | `mjobs.m-techlabs.com` |
| Tacticus Code Watch | `codes.m-techlabs.com/auth/access` |

For each application it checks the original owner provider and owner policy, the exact recorded central policy ID, and its evaluator/key URLs. It preserves the supported writable application settings and all existing provider IDs, then appends the Google provider. Automatic single-provider redirection is disabled because two providers are available. It adds `require: [{"login_method":{"id":"<Google IdP UUID>"}}]` to the **central evaluation policy only**, retaining any other existing requirements. The central policy is constrained before the Google login choice is exposed. Owner policies are never sent to a policy-update endpoint, and their contents are verified unchanged after each application update.

Only after all seven applications and policies verify successfully does one D1 statement set `google_idp_id` and `google_status=configured`. This records configuration completion; it is not evidence that browser OAuth has been tested. A failed run leaves the readiness marker unwritten for that run, but completed remote steps can remain. Repeat the dry run and investigate any configuration drift before continuing. Do not run this concurrently with dashboard edits.

The operator token needs **Access: Apps and Policies Write**, **Access: Organizations, Identity Providers, and Groups Read**, and **D1 Write** in this account. The script does not read out or store the IdP's OAuth configuration.

After configuration, use a fresh browser session to test an approved Google identity and a different, unapproved identity. Approval and per-application grants are separate: Google authentication alone grants nothing. Ask the owner for Ashley's exact Google email before creating or approving that person. Add users and grants through the owner dashboard, and confirm a tracker-only grant does not unlock the Code Bot or other services.

## Roll back the six legacy gateways safely

The Code Bot, D1 data, owner dashboard routes, and original owner Access policies remain in place. This rollback removes only the six manifest-recorded central policies and the six manifest-recorded legacy gateway routes. A route's current pattern and Worker name must still match the manifest. Any other policy that can admit non-owner traffic causes the script to stop.

**Existing Cloudflare Access tokens must be dealt with before removing a gateway.** Removing an allow policy does not turn an already issued JWT into an expired token. D1 session revocation alone is insufficient once the per-request gateway is gone. Use this two-stage sequence:

```bash
node scripts/rollback-gates.mjs
node scripts/rollback-gates.mjs --apply
```

The first apply removes and verifies all six central policies, then intentionally exits with code **2**, leaving every gateway route intact. Original owner policies stay active. In Cloudflare, revoke existing **non-owner** Access sessions that could reach these six applications. Do this after removing the policies so a user cannot immediately obtain another delegated token. Do not revoke the owner's sessions merely to complete this operation. If non-owner revocation cannot be confirmed, leave the gateways installed. If external users were never admitted, explicitly verify that condition before acknowledging it.

After completing or verifying the revocation step:

```bash
node scripts/rollback-gates.mjs --sessions-revoked
node scripts/rollback-gates.mjs --apply --sessions-revoked
```

`--sessions-revoked` is an operator attestation, not an automated revocation API call. The script refuses to remove routes if any central policy was still present at the start of that run; complete revocation and rerun after policy removal. Route deletion happens only after all six central policy IDs are absent and all remaining policies match the verified owner-only configuration. Existing independent origin sessions or open WebSocket connections may need separate application-level termination.

Use **Access: Apps and Policies Write** and zone-scoped **Workers Routes Write** for this procedure. No D1 write or DNS permission is required. Do not delete the Worker or database as part of a gateway rollback. Re-enabling delegation after rollback requires a separately reviewed recreation of the policies/routes and updated manifest IDs; `deploy.mjs` intentionally does not recreate them.

## Runtime capacity and source operations

The Worker uses deterministic source adapters and D1, with no AI inference dependency. Cron is scheduled every 30 minutes. A real timer invocation in the October 31, 2026 02:00 UTC window returned `ok`; it respected the manual cooldown ending at 02:01:40 UTC and created no duplicate scan. A full source scan initiated by Cron remains to be observed. Scheduled and manual requests share a 15-minute cooldown and an atomic scan lease. Unchanged source snapshots skip repeated code/evidence rewrites; source checks and scan/accounting records still consume writes. Monitor actual D1 read/write rows and Worker CPU rather than assuming that a quiet UI means zero usage.

Representative observed CPU durations of approximately **66 ms, 33 ms, and 17 ms** exceed the Workers Free plan's **10 ms** CPU allowance. Those measurements require resolution before treating the corresponding paths as reliably supported on Free. First confirm the current Workers subscription and its actual CPU limits, then determine whether further optimization or an explicitly approved plan change is needed. No paid upgrade has been purchased or authorized by these scripts. Repeat affected authenticated, guild-login, and scan checks after any capacity change. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for current limits.

Failures must remain visible as denied authorization or stale/failed scans. Never remove the permission check to work around a quota issue. Review the dashboard's per-source last-success/error fields; a parser error must not erase cached evidence. The initial historical seed and first successful source baseline suppress old-code notifications. Subsequent genuinely new codes can create notification records; do not replay historical seeds to generate announcements.

## API and protocol references

- [Worker multipart upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/)
- [Worker script upload API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)
- [Access application update API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/update/)
- [Access external evaluation](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/external-evaluation/)
- [Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Google identity-provider setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)

API request fields were checked against the Cloudflare OpenAPI schema during implementation. The operations scripts stop on unexpected resource identity or drift. If Cloudflare changes a request schema, review the current API contract instead of removing these checks.
