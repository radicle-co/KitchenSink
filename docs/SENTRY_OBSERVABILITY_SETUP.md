# Sentry Observability — Operator Setup

The code for Sentry across all four deployables + the CloudWatch→Sentry log drain has shipped (see
the plan at `docs/plans/2026-06-11-001-feat-sentry-observability-rollout-plan.md`). The integrations
stay **inert until the external configuration below is in place** — each SDK no-ops without its DSN,
and the source-map upload step no-ops without its token. None of these values are committed to the
repo.

## 1. Sentry org / projects

- Confirm the Sentry org plan includes **Logs** and **OTLP log ingestion** (the drain rides the OTLP
  logs endpoint, which is open beta).
- Projects (org `radicle-co`): `commise-web`, `commise-mobile`, plus the backend identity-service,
  identity-webhooks, and the dedicated **log-drain** project. Note each project's DSN and slug.

## 2. AWS SSM parameters (per stage — `prod` and `sandbox`)

The CDK reads these at deploy via `valueForStringParameter`, so create all of them as plain
`String` parameters. DSNs/keys are send-only and low-sensitivity, so `SecureString` is unnecessary —
and would not work here, since `valueForStringParameter` cannot resolve a `SecureString`.

Stage-scoped params use the org-standard **stage-first** layout `/kitchensink/{stage}/{service}/{key}`,
matching Secrets Manager (`kitchensink/{stage}/identity/keys`). For the per-service Sentry DSNs the same
DSN serves both stages; the `STAGE`-driven Sentry `environment` tag separates sandbox from prod events.
The clerk issuer/JWKS values are instance-specific (they must match each stage's live Clerk Frontend
API, **not** a brand domain): prod is the custom domain `clerk.commise.app`, sandbox is the Clerk dev
instance `nice-fowl-6.clerk.accounts.dev`.

The **log-drain** DSN is a single, stage-agnostic param under `global/` — there is one log-drain
Sentry project for all stages, and the forwarder tags each record's `environment` from the source
CloudWatch log group name (`kitchensink-identity-<component>-<stage>-…`). All of these are already
populated.

| Parameter                                                 | Used by                               |
| --------------------------------------------------------- | ------------------------------------- |
| `/kitchensink/{prod,sandbox}/clerk/jwks-url`              | authorizer JWT validation (`jose`)    |
| `/kitchensink/{prod,sandbox}/clerk/issuer`                | authorizer JWT validation (`jose`)    |
| `/kitchensink/{prod,sandbox}/clerk/audience`              | set as `IDP_AUDIENCE` (not validated) |
| `/kitchensink/{prod,sandbox}/sentry/webhook-dsn`          | identity-webhooks Lambdas + forwarder |
| `/kitchensink/{prod,sandbox}/sentry/identity-service-dsn` | identity service (ECS)                |
| `/kitchensink/global/sentry/log-drain-dsn`                | log forwarder (`LOG_DRAIN_DSN`)       |

## 3. GitHub Actions (prod-deploy)

- Secret `SENTRY_AUTH_TOKEN` — scoped minimally to `project:releases` + `sourcemaps:write` for the
  backend project(s). Without it, the Lambda source-map upload step is skipped.
- Repo variable `SENTRY_WEBHOOKS_PROJECT` — the webhook project slug (gates the upload step).
- `SENTRY_RELEASE` is already wired to the commit SHA on the webhooks deploy + the ECS image tag.

## 4. Vercel (web — source maps upload during `next build`)

- Env vars: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG=radicle-co`, `SENTRY_PROJECT=commise-web`,
  `SENTRY_AUTH_TOKEN`, and `SENTRY_RELEASE` (set to the deployed commit SHA so runtime and upload
  releases match).

## 5. EAS (mobile — source maps upload during the native build)

- EAS secret `SENTRY_AUTH_TOKEN`; `EXPO_PUBLIC_SENTRY_DSN` available to the build.
- Build with the new `production` EAS profile. Verify the Expo 53 native targets meet
  `@sentry/react-native` v8 minimums (iOS 15+).

## 6. Verification (staging)

- Trigger an unhandled error on each surface → exactly one **source-mapped** Issue in the correct
  per-service project.
- Confirm the log-drain project receives access/warning/error logs, with `START`/`END`/`REPORT` and
  EMF lines absent.
- Confirm `ReconciliationDrift` (and the user-event counts) still appear as CloudWatch metrics.
- Confirm runtime `release` equals the uploaded release on all four surfaces.

## DSN mapping

The concrete DSN values were provided out-of-band; place them in SSM (backend) / Vercel + EAS env
(web, mobile) / the apps' `.env.local`, never in source.

## Provisioning-failure alert (`auth.provisioning: failed`)

The create-user flow emits one distinct signal for a **genuine** provisioning failure — a DB/constraint
error that leaves a user without a complete `user + account + profile`. It is tagged
`auth.provisioning: failed` and carries only the Clerk identity id / app user id (never PII; a Postgres
23505 message embeds the email, so the message is run through `scrubText` before it becomes an
attribute). Emit sites: the read-through `AuthMiddleware`, `resolveUser` (present-but-incomplete
anomaly), the `user.created` webhook, and nightly reconciliation.

**Must page:** any event with `tags.auth.provisioning = failed`.
**Must NOT page (by construction, never tagged):** the expected email-collision placeholder fallback
(the routine returns `incomplete`, the webhook logs and skips), idempotent `onConflictDoNothing` no-ops,
and best-effort `setExternalId` failures (`webhook.set_external_id_failed`).

Create the alert rule in both projects (`kitchensink-identity`, `kitchensink-identity-webhook`): fire
on `tags.auth.provisioning = failed` → notify the on-call channel.

**Known gap (accepted):** this is an event-driven signal. A zero-request webhook-Lambda crash-loop
(a boot failure before any event is processed) emits no event and will not page. The identity **service**
already has a CloudWatch `healthyHostCount` crash-loop alarm for its own boot; the webhook Lambda has no
equivalent. Revisit with a CloudWatch metric-filter/no-data alarm if webhook-side boot failures recur.
