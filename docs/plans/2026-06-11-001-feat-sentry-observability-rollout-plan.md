---
title: 'feat: Sentry observability rollout across the Commise stack'
date: 2026-06-11
type: feat
origin: docs/brainstorms/2026-06-11-observability-sentry-integration-requirements.md
---

# feat: Sentry Observability Rollout Across the Commise Stack

## Summary

Instrument all four Commise deployables with Sentry and build a CloudWatch→Sentry log drain. Each deployable initializes its own Sentry SDK (errors auto-captured + from `catch`, purposeful logs via `Sentry.logger`) reporting to its own project; a forwarder Lambda ships CloudWatch log events to the dedicated log-drain project over Sentry's OTLP-logs endpoint. Apps stop writing to stdout, so application logs and infrastructure logs never overlap. Delivered as one phased plan: finish/activate Lambda → build the drain → instrument ECS → web → mobile → release/source-map plumbing.

---

## Problem Frame

The stack has no working error reporting. The identity service runs uninstrumented (`packages/services/identity/src/main.ts` is a bare bootstrap; no global exception filter; plain Nest `Logger` to stdout). The identity-webhooks package has `@sentry/aws-serverless` scaffolded in `packages/services/identity-webhooks/src/common/observability.ts` but it is dormant — CDK never injects `SENTRY_DSN` — and the authorizer handler is unwrapped. Web and mobile have the Sentry env keys templated but no SDK. When something breaks in production there is no triaged Issue, no stack trace, and no single place to look.

Two log audiences are tangled in CloudWatch today (AWS infra/access logs and deliberate in-code logs) with 1-month retention and no downstream destination. This work separates them: app signal flows through per-service SDKs to per-service projects; AWS-generated CloudWatch content drains to the log-drain project.

See origin: `docs/brainstorms/2026-06-11-observability-sentry-integration-requirements.md`.

---

## Key Technical Decisions

- **KTD1 — Drain transport is a forwarder Lambda, not an OTel Collector.** The forwarder posts OTLP log records to Sentry's first-party CloudWatch ingest endpoint. It fits the existing CDK/Lambda stack with no long-running service. Trade-off: that endpoint is **open beta** in 2026 — so the forwarder is isolated as its own unit (U4) and is swappable for an OTel Collector `awscloudwatch` receiver later without touching the SDK work.
- **KTD2 — Filter noise at the subscription-filter level, not in-app.** The subscription filter pattern excludes `START`/`END`/`REPORT` platform lines and Powertools EMF payloads (`_aws`) so they never enter the pipeline (cheaper than `beforeSendLog`). Pattern: `FilterPattern.literal('-START -END -REPORT -"_aws"')`. Constraint: **max 2 subscription filters per log group, non-adjustable** — target groups have zero today, so one filter each is safe.
- **KTD3 — ECS uses `@sentry/nestjs`, not raw `@sentry/node`.** `SentryModule.forRoot()` in the root module and error capture via `SentryGlobalFilter` registered as `APP_FILTER`. Node 24 (service Docker base) satisfies the SDK's Node floor. **The service is native ESM (`"type": "module"`), so an import statement is hoisted and the "instrument as the literal first line of `main.ts`" trick does not reliably run `Sentry.init` before instrumented modules load.** Use the preload form instead: `node --import ./dist/src/instrument.js` in the Docker `CMD` (and the local `start` script). This is load-bearing, not optional — see U6.
- **KTD4 — Context parity is set explicitly on the scope, because auto-context only lands on error events, not logs.** The Lambda integration attaches request id / cold-start / ARN to _errors_ automatically, but `Sentry.logger` entries do not inherit them. Promote them via `Sentry.getIsolationScope().setAttributes({...})` in the handler wrapper (Lambda) and in a Nest middleware (ECS) so logs carry the same fields Powertools `Logger` used to inject.
- **KTD5 — Keep the EMF metrics path, drop Powertools `Logger`.** The custom counts (incl. `ReconciliationDrift`) stay as CloudWatch metrics; purposeful logging moves to `Sentry.logger`. **Caveat (P0 from review):** today `emitMetric` is implemented as `logger.info('metric', { _aws… })` on the _same_ Powertools `Logger` that this work removes — so it cannot be "left untouched." `emitMetric` must be rewritten to emit its EMF `_aws` payload to stdout independently of the Sentry-backed log facade (either `process.stdout.write(JSON.stringify(...))` or a retained metrics-only `Logger` instance reserved for EMF). The Sentry facade must not be named `logger` in a way that silently re-routes `emitMetric` to Sentry — that would delete the CloudWatch metrics. See U2.
- **KTD6 — Per-service DSNs as plain CDK env; the forwarder's drain credential via SSM.** Per-service Sentry DSNs are send-only/low-sensitivity, so plain `environment` injection matches the existing CDK convention. The forwarder's `LOG_DRAIN_DSN` is qualitatively different — it is the write credential for the project that receives _all_ drained CloudWatch content (including API Gateway access logs) — so it is sourced from an SSM parameter, not a hardcoded stack string, and gets a documented rotation note. `SENTRY_AUTH_TOKEN` (source-map upload) is scoped to the minimum permission (`project:releases` + `sourcemaps:write`) for only the relevant projects, ideally one token per surface.
- **KTD7 — `release` = git commit SHA, identical at build and runtime.** Source maps only symbolicate when the upload-time release matches the runtime release. The CI commit SHA (already the ECR/image tag) is stamped into both.
- **KTD8 — `sendDefaultPii: false` everywhere, plus a shared scrubber with an explicit denylist.** Identity-adjacent data flows through these surfaces; RN's quickstart defaults PII on, which we override. User is set explicitly as an opaque id (`Sentry.setUser({ id })`), never email. The `beforeSend`/`beforeSendLog` scrubbers are not left to intent — a shared scrubber module enumerates a concrete denylist (at minimum `email`, `password`, `token`, `authorization`, `name`, `picture`, `avatarUrl`, `imageUrl`, and a dot-separated-base64 bearer-token pattern) stripped from event `extra`/`contexts`/`tags` and log attributes, and every surface's tests assert against the full denylist. **The drain path needs its own scrubber:** API Gateway access logs (IP, caller, path-embedded user ids) bypass the per-SDK scrubbers entirely, so the forwarder Lambda (U4) sanitizes those fields before the OTLP POST.
- **KTD9 — `@sentry/react-native` is the v8 line, not v10.** Mobile uses `@sentry/react-native` v8 + its Expo config plugin + `getSentryExpoConfig` in a new `metro.config.js`. `sentry-expo` is deprecated and must not be introduced.

---

## High-Level Technical Design

```mermaid
flowchart TB
  subgraph SDKpath[App signal -- per-service SDKs]
    direction LR
    ECS[identity service / ECS\n@sentry/nestjs]
    LAM[identity-webhooks\n@sentry/aws-serverless]
    WEB[web / @sentry/nextjs]
    MOB[mobile / @sentry/react-native v8]
  end
  ECS --> PECS[(identity-service project)]
  LAM --> PLAM[(webhook project)]
  WEB --> PWEB[(web project)]
  MOB --> PMOB[(mobile project)]

  subgraph drainpath[Infra signal -- log drain]
    direction TB
    CW[CloudWatch log groups\nLambda + API GW access + ECS]
    SUB[SubscriptionFilter\n-START -END -REPORT -\"_aws\"]
    FWD[Forwarder Lambda\nCW Logs payload -> OTLP log records]
    CW --> SUB --> FWD
  end
  FWD -->|OTLP POST + x-sentry-auth| PDRAIN[(log-drain project\nOTLP /v1/logs -- beta)]
```

Forwarder OTLP target derived from the log-drain DSN: POST to `https://o<org-id>.ingest.us.sentry.io/api/<log-drain-project-id>/integration/otlp/v1/logs` with header `x-sentry-auth: sentry sentry_key=<log-drain-public-key>`. Concrete org/project ids and key come from the `LOG_DRAIN_DSN` SSM parameter at runtime (KTD6) — not hardcoded here.

---

## Requirements Traceability

Origin requirements R1–R24 and acceptance examples AE1–AE4 map to units as follows: drain pipeline R1–R5 → U4, U5; Lambda R6–R10 → U1 (R6), U2 (R8, R9, R10), U3 (R7); ECS R11–R15 → U6, U7, U8 (R11 is satisfied via `@sentry/nestjs`, a superset of the origin's literal `@sentry/node` — see KTD3); web R16–R18 → U9, U11; mobile R19–R21 → U10, U11; cross-cutting R22 → U2, U6, U7, U9, U10; R23 established by U2/U6/U8 and formalized by U11; R24 → U9 and U10 (paired delivery per §14). AE1 (filter) → U5; AE2 (no double-count) → U7; AE3 (log context) → U2; AE4 (authorizer parity) → U3.

---

## Implementation Units

### Phase 1 — Activate and complete Lambda (identity-webhooks)

### U1. Inject Sentry config into the webhooks Lambdas via CDK

- **Goal:** Activate the dormant `Sentry.init` by injecting `SENTRY_DSN` (webhook project), `STAGE`, `SENTRY_TRACES_SAMPLE_RATE`, and `SENTRY_RELEASE` into all four functions.
- **Requirements:** R6; advances R23.
- **Dependencies:** none.
- **Files:** `packages/services/identity-webhooks/infra/lib/WebhooksStack.ts`, `packages/services/identity-webhooks/infra/__tests__/stacks.test.ts`.
- **Approach:** Add the vars to the shared `commonEnv` map (and the authorizer's separate `environment`) following the existing plain-string injection pattern. DSN as a plain env var (KTD6). Note `STAGE` is **not** in `commonEnv` today, so `observability.ts`'s `process.env['STAGE'] ?? 'dev'` currently resolves to `'dev'` in every environment — wire `STAGE` to the stack's `deployStage`, not a hardcoded literal. `SENTRY_RELEASE` is the commit SHA, threaded in via U11 (the webhooks `cdk deploy` step passes no SHA today — U11 adds it). Sample-rate default `0` to start, tunable per `STAGE`. The infra test file is currently `describe.skip` and stale — when adding assertions, rewrite the `beforeAll` to construct the stack with the _current_ flat-ARN `WebhooksStackProps` (flat string props: `vpcId`, `lambdaSecurityGroupId`, `dbSecretArn`, `authSecretArn`, etc.), not the old `{ network, data, certificate, hostedZone }` object props.
- **Patterns to follow:** the `...commonEnv` spread and `environment:` maps already in `WebhooksStack.ts`.
- **Test scenarios:**
    - CDK `Template.fromStack` asserts each of the four functions has `Environment.Variables.SENTRY_DSN`, `STAGE`, `SENTRY_TRACES_SAMPLE_RATE`, and `SENTRY_RELEASE` set.
    - Asserts `STAGE` resolves to `deployStage` (the value is correct, not just present — not a hardcoded `'dev'`).
    - Asserts the authorizer function (separate from the shared three) also receives `SENTRY_DSN`.
- **Verification:** `npm run infra:synth --workspace=packages/services/identity-webhooks` succeeds and synthesized template shows the env vars on all four functions.

### U2. Enable Logs, context parity, and drop Powertools Logger in the observability module

- **Goal:** Turn on `Sentry.logger`, promote Lambda context onto logs, route purposeful logging through Sentry, and stop logging to stdout — while keeping the EMF metrics path.
- **Requirements:** R8, R9, R10, R22; advances R23.
- **Dependencies:** U1.
- **Files:** `packages/services/identity-webhooks/src/common/observability.ts`, `packages/services/identity-webhooks/src/common/sentryScrubbers.ts` (new — shared denylist scrubber), `packages/services/identity-webhooks/src/common/__tests__/observability.test.ts`, and the three handlers that import `logger` (`src/handlers/identityWebhook.ts`, `src/handlers/deletionWorker.ts`, `src/handlers/reconciliation.ts`).
- **Approach:** Add `enableLogs: true` plus `beforeSend`/`beforeSendLog` scrubbers wired to the shared `sentryScrubbers.ts` denylist (KTD8). Fix the existing dot-notation env read to bracket notation (`process.env['SENTRY_DSN']`) per coding standards. Replace the purposeful-logging side of Powertools `Logger` with a thin `log` facade backed by `Sentry.logger` (info/warn/error). **Decouple `emitMetric` from the removed logger (P0):** `emitMetric` currently calls `logger.info('metric', { _aws… })` on the Powertools `Logger` instance — rewrite it to emit the EMF `_aws` payload to stdout directly (or via a retained metrics-only `Logger` reserved for EMF), so CloudWatch metrics survive and are _not_ re-routed into Sentry. Do not name the new facade `logger` in a way that recaptures `emitMetric`. In `withObservability`, before invoking the inner handler, set isolation-scope attributes from the Lambda `context` arg — `aws_request_id`, `cold_start`, `function_name`, `function_version`, plus `serviceName: 'identity-webhooks'` — so they appear on both errors and logs (KTD4). Mark Sentry-touching functions with `@sideEffect` JSDoc.
- **Patterns to follow:** the existing `withObservability` wrapper signature; the handlers' current `logger.info/warn` call shape (keep the facade API close to it to minimize edits).
- **Test scenarios:**
    - `Covers AE3.` Given a wrapped handler invoked with a Lambda context, the isolation scope receives `aws_request_id`, `cold_start`, `function_name`, `serviceName` attributes (assert via a mocked Sentry scope).
    - `beforeSend`/`beforeSendLog` strip every key in the shared denylist (`email`, `password`, `token`, `authorization`, `name`, `picture`, `avatarUrl`, `imageUrl`, bearer-token pattern) from `extra`/`contexts`/`tags`/log attributes — assert against the full list, not one key.
    - The `log` facade forwards info/warn/error to `Sentry.logger` with the passed structured attributes.
    - `emitMetric` writes the EMF `_aws` payload to **stdout**, not to `Sentry.logger` (regression guard for KTD5 — proves metrics still reach CloudWatch).
    - No purposeful-log code path writes to `console.*`/stdout (only `emitMetric`'s EMF line does).
- **Verification:** unit tests pass; grep shows no remaining `@aws-lambda-powertools/logger` import while `@aws-lambda-powertools/metrics`/`emitMetric` remain.

### U3. Wrap the authorizer handler

- **Goal:** Bring the authorizer to error-capture parity with the other three handlers.
- **Requirements:** R7.
- **Dependencies:** U2.
- **Files:** `packages/services/identity-webhooks/src/authorizer/handler.ts`, `packages/services/identity-webhooks/src/authorizer/__tests__/handler.test.ts`.
- **Approach:** Export the handler wrapped in `withObservability(...)`. Replace raw `throw new Error('Unauthorized')` paths with capture-then-throw so JWT-validation failures surface in the webhook project. **Sanitize before capture (security P1):** the current code throws `new Error('Unauthorized', { cause: err })` and the handler builds an `AuthorizerContext` containing `email: claims.email` — Sentry serializes `cause` chains and local scope, so the raw bearer token, JWT claims, and email can leak into the event. Capture a new error carrying only a safe message (not the raw cause object), and rely on the shared scrubber denylist (U2) to strip `email`/token fields. To limit noise, distinguish routine auth rejections (expired/malformed token — capture at a low level or tag, do not page) from unexpected failures (JWKS fetch error, DB error — capture as errors). Reuse the existing `vi.mock('../../common/observability.js', …)` identity-passthrough test pattern.
- **Patterns to follow:** `src/handlers/__tests__/deletionWorker.test.ts` mock shape; the other three handlers' `export const handler = withObservability(inner)`.
- **Test scenarios:**
    - `Covers AE4.` Given the authorizer throws during JWT validation, `Sentry.captureException` is called (mocked) and the error propagates.
    - The captured event contains no value matching a bearer-token pattern and no `email` field (PII guard).
    - Happy path: a valid token still returns the existing allow policy unchanged (no behavior regression).
- **Verification:** authorizer unit tests pass; handler export is wrapped.

### Phase 2 — CloudWatch → Sentry log drain

### U4. Forwarder Lambda: CloudWatch Logs → OTLP → log-drain project

- **Goal:** A new Lambda that decodes CloudWatch Logs subscription payloads and POSTs them as OTLP log records to the log-drain project.
- **Requirements:** R1, R4, R5.
- **Dependencies:** none (independent of U1–U3; can build in parallel).
- **Files:** `packages/services/identity-webhooks/src/handlers/logForwarder.ts` (new), `packages/services/identity-webhooks/src/common/otlp.ts` (new — payload transform), `packages/services/identity-webhooks/src/handlers/__tests__/logForwarder.test.ts`, `packages/services/identity-webhooks/src/common/__tests__/otlp.test.ts`.
- **Approach:** Handler receives the `awslogs.data` field (gzip+base64), gunzips and parses to `{ logGroup, logStream, logEvents[] }`. Map each event to an OTLP log record, carrying `log_group`, `log_stream`, and the event timestamp as attributes (R4). **Sanitize access-log PII (security P1):** the two API Gateway groups use `jsonWithStandardFields()`, which includes caller IP and path (potentially with user ids); strip/hash `ip`, `caller`, and user-id/UUID path segments before building OTLP records, since these bypass the per-SDK scrubbers (KTD8). POST OTLP (HTTP/JSON) to the endpoint derived from the log-drain DSN (see HTD) with `x-sentry-auth: sentry sentry_key=…`; endpoint host/project/key come from the `LOG_DRAIN_DSN` **SSM parameter** parsed at init (KTD6). Fail safe (R5): catch transport errors without throwing so a drain outage never back-pressures the source — **and emit a forwarder-failure CloudWatch metric via the retained `emitMetric` path**, so a silent total drain outage is detectable even when no log lines arrive at the log-drain project (the forwarder's own Sentry is not a sufficient health signal since it shares the failure mode). Keep the forwarder dependency-light; isolate OTLP specifics in `otlp.ts` so the transport is swappable to a collector later (KTD1).
- **Patterns to follow:** existing raw-handler shape and `@sideEffect` JSDoc; bracket-notation env access.
- **Technical design (directional, not spec):**
    - `parseCloudWatchPayload(event.awslogs.data) -> { logGroup, logStream, logEvents }`
    - `toOtlpLogs(parsed) -> OtlpLogsRequest` (severity mapped from a best-effort level parse; raw message preserved)
    - `postOtlp(request)` with timeout + single retry, errors captured not thrown
- **Test scenarios:**
    - Decodes a realistic gzip+base64 `awslogs.data` fixture into the expected events.
    - Maps N log events to N OTLP records preserving `log_group`/`log_stream`/timestamp attributes.
    - Given a real `jsonWithStandardFields` API Gateway access-log fixture, the produced OTLP record has `ip`/`caller`/path user-ids stripped or hashed (PII guard).
    - Transport failure (mocked non-200) is caught, the handler resolves without throwing, AND a forwarder-failure metric is emitted (R5 + health signal).
    - Empty/malformed payload resolves without throwing.
- **Verification:** unit tests pass; a manual `sam`/local invoke with a sample payload produces a well-formed OTLP body.

### U5. Subscription filters wiring all service log groups to the forwarder

- **Goal:** Subscribe every relevant CloudWatch log group to the forwarder with the noise-exclusion pattern.
- **Requirements:** R2, R3.
- **Dependencies:** U4.
- **Files:** `packages/services/identity-webhooks/infra/lib/WebhooksStack.ts`, `packages/services/identity-webhooks/infra/lib/api-stack.ts`, `packages/services/identity/infra/lib/IdentityServiceStack.ts`, plus the matching infra `__tests__`.
- **Approach:** Define the forwarder `lambda.Function` (mirror the `fromAsset(distPath)` pattern; new handler entry `handlers/logForwarder.handler`) in the **webhooks stack**. Add one `logs.SubscriptionFilter` per target group with `destination: new aws_logs_destinations.LambdaDestination(forwarder)` and `filterPattern: FilterPattern.literal('-START -END -REPORT -"_aws"')` (KTD2). Targets: `AuthorizerLogGroup`, `WebhooksLogGroup`, the two API Gateway access-log groups (`api-stack.ts` `IdentityApiLogGroup`, webhooks `IdentityWebhooksApiLogGroup`), and the ECS `IdentityServiceLogGroup`. **Deploy-order correctness (feasibility/adversarial P1):** prod-deploy.yml deploys identity-service _before_ identity-webhooks, so the consumer must be the later stack. Define **all** subscription filters (including the ECS one) **in the webhooks stack**, and reference the ECS group via `logs.LogGroup.fromLogGroupName(...)` using the existing `IdentityServiceLogGroupName` export — NOT a filter in the identity-service stack importing the forwarder ARN (that would make the earlier-deploying stack depend on an export that doesn't exist yet, failing the first deploy). Verify the `-"_aws"` term actually excludes the EMF lines (nested-key term matching can be brittle). Respect the 2-filters-per-group quota — one filter each (all target groups have zero today).
- **Patterns to follow:** existing `CfnOutput`/`Fn.importValue` cross-stack convention; existing `LogGroup` constructs.
- **Test scenarios:**
    - `Covers AE1.` `Template.fromStack` asserts a `SubscriptionFilter` exists for each target group with `FilterPattern` excluding `START`/`END`/`REPORT`/`_aws`.
    - Asserts the destination is the forwarder Lambda (by ref/ARN).
    - Asserts no log group receives more than one subscription filter (quota guard).
- **Verification:** `infra:synth` for both webhooks and identity succeeds; synthesized templates show the filters and destinations.

### Phase 3 — Identity service (ECS / NestJS)

### U6. Initialize `@sentry/nestjs` and extend the env schema

- **Goal:** Add the SDK, the first-import instrument file, module wiring, and the env contract.
- **Requirements:** R11, R13; advances R23.
- **Dependencies:** none (independent of Phase 1/2).
- **Files:** `packages/services/identity/package.json` (deps + `start`/`dev` scripts), `packages/services/identity/Dockerfile` (CMD), `packages/services/identity/src/instrument.ts` (new), `packages/services/identity/src/main.ts`, `packages/services/identity/src/app.module.ts`, `packages/services/identity/src/observability/sentryScrubbers.ts` (new — shared denylist), `packages/services/identity/src/config/env.schema.ts`, `packages/services/identity/src/config/__tests__/env.schema.test.ts`.
- **Approach:** Add `@sentry/nestjs` (v10 line). `instrument.ts` calls `Sentry.init({ dsn: process.env['SENTRY_DSN'], environment: process.env['STAGE'], tracesSampleRate, enableLogs: true, sendDefaultPii: false, release: process.env['SENTRY_RELEASE'], beforeSend, beforeSendLog })` wired to the shared scrubber denylist (KTD3, KTD7, KTD8). **ESM preload, not first-line import (feasibility P1):** the service is `"type": "module"`, so a top-of-file `import './instrument.js'` is hoisted and does not guarantee `Sentry.init` runs before instrumented modules load. Load it via `node --import ./dist/src/instrument.js` in the Docker `CMD` (currently `node packages/services/identity/dist/src/main.js`, no `--import`) and in the local `start`/`dev` scripts. Add `SentryModule.forRoot()` to `app.module.ts` imports. Extend `EnvironmentSchema` with optional `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_RELEASE` (Sentry stays inert when DSN is absent, preserving local-dev ergonomics).
- **Patterns to follow:** the Zod `EnvironmentSchema` shape and `ConfigModule.forRoot({ validate })` usage; bracket-notation env access.
- **Test scenarios:**
    - `EnvironmentSchema` parses with Sentry vars present and with them absent (optional).
    - `EnvironmentSchema` rejects a non-numeric `SENTRY_TRACES_SAMPLE_RATE`.
    - Test expectation: instrument/module wiring covered indirectly by U7's filter test; no standalone behavior here beyond schema.
- **Verification:** service builds (`nest build`); app boots locally with and without `SENTRY_DSN`.

### U7. Global exception filter, per-request context, and migrate Logger off stdout

- **Goal:** Capture unhandled exceptions, attach per-request context to errors and logs, and route purposeful logs to Sentry instead of stdout.
- **Requirements:** R12, R14, R15, R22.
- **Dependencies:** U6.
- **Files:** `packages/services/identity/src/observability/sentry.filter.ts` (new), `packages/services/identity/src/observability/sentryContext.middleware.ts` (new), `packages/services/identity/src/observability/log.ts` (new — `Sentry.logger` facade), `packages/services/identity/src/app.module.ts`, the three current `Logger` sites (`admin/admin.service.ts`, `users/users.service.ts`, `queue/sqs.service.ts`), and `__tests__` for the filter and middleware.
- **Approach:** Register `SentryGlobalFilter` (from `@sentry/nestjs/setup`) as `APP_FILTER` — or a thin subclass — so unhandled exceptions reach Sentry while `HttpException` control-flow stays intact (R12); verify no other `APP_FILTER` competes. Add a `@Injectable() NestMiddleware` that sets isolation-scope attributes (`serviceName: 'identity-service'`, a per-request id, ECS task/instance id from env) and `Sentry.setUser({ id })` from `req.user` after `AuthMiddleware` runs (R15, KTD4); register it in `app.module.ts configure()` after `AuthMiddleware`, and guard `setUser` against the unauthenticated `/health` path (no `req.user`). Replace the three `new Logger(...)` purposeful-log sites with the `Sentry.logger`-backed facade (R14). **Silence framework stdout (adversarial P1):** purposeful logs aren't the only stdout source — Nest's default `ConsoleLogger` (bootstrap/route-mapping lines) and Node's uncaught-exception/unhandled-rejection prints also hit the ECS log group and would drain alongside the SDK Issue, breaking AE2's exactly-once guarantee. Bootstrap with the Nest logger disabled or replaced by a Sentry-backed logger (`NestFactory.create(AppModule, { logger: … })`). Process-level crash output printed by Node before any handler is a documented residual (see AE2 and Risks). This establishes the repo's first NestJS DI test pattern (`Test.createTestingModule`).
- **Patterns to follow:** `AuthMiddleware` (`auth/middleware/auth.middleware.ts`) `@Injectable() NestMiddleware` shape and its `configure()` registration; custom-error conventions.
- **Test scenarios:**
    - `Covers AE2.` Given an unhandled (non-HTTP) exception passes through the filter, `Sentry.captureException` is called exactly once (mocked); a thrown `HttpException` (e.g. `NotFoundException`) is NOT captured (control flow preserved).
    - Middleware sets `serviceName`, request id, and `Sentry.setUser({ id })` from `req.user`; skips/handles the unauthenticated `/health` path gracefully.
    - The log facade forwards info/warn/error to `Sentry.logger`; migrated service sites no longer instantiate Nest `Logger`; bootstrap disables/replaces the default Nest logger so framework lines don't hit stdout.
    - Integration: a request flowing AuthMiddleware → context middleware yields an isolation scope carrying both the user id and request id (mocks alone won't prove ordering — assert via the registered middleware chain).
- **Verification:** unit/integration tests pass; grep confirms purposeful-log sites use the facade, not Nest `Logger`/stdout.

### U8. Inject Sentry config into the ECS task (CDK)

- **Goal:** Provide `SENTRY_DSN`, `STAGE`, sample rate, and `SENTRY_RELEASE` to the running container.
- **Requirements:** R11, R13; advances R23.
- **Dependencies:** U6.
- **Files:** `packages/services/identity/infra/lib/IdentityServiceStack.ts`, `packages/services/identity/infra/__tests__/stacks.test.ts`.
- **Approach:** Add the vars to the container `environment` map (plain env, KTD6). `SENTRY_RELEASE` is sourced from the deploy commit SHA (wired in U11). Mirror the existing `environment:`/`secrets:` split; DSN stays in plain `environment`.
- **Patterns to follow:** the container `environment` block already in `IdentityServiceStack.ts`.
- **Test scenarios:**
    - `Template.fromStack` asserts the task definition's container has `SENTRY_DSN`, `STAGE`, `SENTRY_TRACES_SAMPLE_RATE` env vars.
    - Asserts `SENTRY_RELEASE` is present (value wired from build context).
- **Verification:** `infra:synth --workspace=packages/services/identity` shows the env vars on the container definition.

### Phase 4 — Web (Next.js)

### U9. Add `@sentry/nextjs` to the web app

- **Goal:** Client + server + edge error capture, App Router instrumentation, a global error boundary, and source-map upload config — without breaking Clerk middleware.
- **Requirements:** R16, R17, R22, R24; source-map upload R18 (release/secret plumbing in U11).
- **Dependencies:** none (independent; pairs with U10 per §14 — ship same release).
- **Files (all repo-relative under `packages/apps/commise/web`):** `package.json`, `next.config.ts`, `instrumentation.ts` (new), `instrumentation-client.ts` (new), `sentry.server.config.ts` (new), `sentry.edge.config.ts` (new), `src/app/global-error.tsx` (new), `src/middleware.ts` (Clerk matcher tweak), `src/app/__tests__/global-error.test.tsx`.
- **Approach:** Install `@sentry/nextjs` (v10). Create `instrumentation.ts` with `register()` (dynamic-import server/edge by `NEXT_RUNTIME`) and `export const onRequestError = Sentry.captureRequestError`. Use `instrumentation-client.ts` (NOT the legacy `sentry.client.config.ts`) with `onRouterTransitionStart`. Each init: `enableLogs: true`, `sendDefaultPii: false`, `beforeSend`/`beforeSendLog` scrubbers, `environment`, `release` (KTD7, KTD8). Wrap `next.config.ts` in `withSentryConfig(nextConfig, { org: 'radicle-co', project: 'commise-web', authToken: process.env['SENTRY_AUTH_TOKEN'], tunnelRoute: '/sentry-tunnel', widenClientFileUpload: true, silent: !process.env['CI'] })`. Add `app/global-error.tsx` (`'use client'`) capturing in `useEffect`. **Clerk interplay (pitfall):** ensure the Clerk `clerkMiddleware` matcher does not intercept the Sentry `tunnelRoute` — keep the two paths non-overlapping. DSN from `NEXT_PUBLIC_SENTRY_DSN` (already templated).
- **Patterns to follow:** existing `src/middleware.ts` matcher; `next.config.ts` current shape; App Router root `src/app/layout.tsx`.
- **Test scenarios:**
    - `global-error.tsx` renders its fallback and calls `Sentry.captureException` (mocked) on mount.
    - The Clerk middleware matcher excludes the Sentry tunnel route (assert the matcher config does not match `/sentry-tunnel`).
    - Test expectation: config-only files (`instrumentation*.ts`, `sentry.*.config.ts`) — none beyond a smoke import that `Sentry.init` is called with `enableLogs`/`sendDefaultPii:false`.
- **Verification:** `npm run build --workspace=packages/apps/commise/web` succeeds with `withSentryConfig`; dev server boots and a forced client error reaches the web project (manual, staging).

### Phase 5 — Mobile (Expo)

### U10. Add `@sentry/react-native` to the mobile app

- **Goal:** Native + JS error capture, the Expo config plugin, Metro source-map support, root wrap with an error boundary, and PII off.
- **Requirements:** R19, R20, R22, R24; source-map upload R21 (EAS secret in U11).
- **Dependencies:** none (pairs with U9 per §14 — ship same release).
- **Files (all repo-relative under `packages/apps/commise/mobile`):** `package.json`, `app.json` (plugins + config), `metro.config.js` (new), `App.tsx`, `src/observability/sentry.ts` (new — init), `src/__tests__/sentry-init.test.ts`.
- **Approach:** Install `@sentry/react-native` **v8** (KTD9) via `npx expo install`. Register `['@sentry/react-native/expo', { url, project: 'commise-mobile', organization: 'radicle-co' }]` in `app.json` `plugins` (currently empty). Create `metro.config.js` using `getSentryExpoConfig(__dirname)` (none exists today). `Sentry.init({ dsn: process.env['EXPO_PUBLIC_SENTRY_DSN'], enableLogs: true, tracesSampleRate, sendDefaultPii: false, environment, release, beforeSend, beforeSendLog })` and `export default Sentry.wrap(App)` in `App.tsx` (the wrap provides the error boundary + nav instrumentation). Verify Expo 53 native targets meet v8 minimums (iOS 15+). Add the Apple privacy-manifest records.
- **Patterns to follow:** `App.tsx` provider nesting (wrap outermost); bracket-notation env; §14 paired delivery with U9.
- **Test scenarios:**
    - `Sentry.init` is called with `enableLogs: true` and `sendDefaultPii: false` (assert via mock).
    - `App` export is wrapped by `Sentry.wrap`.
    - Test expectation: `metro.config.js`/`app.json` are config — none beyond the init assertions above.
- **Verification:** `expo` config validates (plugin resolves); an EAS/dev build boots and a forced error reaches the mobile project (manual).

### Phase 6 — Release identity and source maps

### U11. Stamp `release` and upload source maps across CI/EAS

- **Goal:** Make source maps symbolicate by stamping a consistent `release` (git SHA) at build and runtime, and wiring upload at each surface's _actual_ build host.
- **Requirements:** R18, R21, R23.
- **Dependencies:** U6/U8 (ECS), U9 (web), U10 (mobile); U2 (Lambda).
- **Files:** `.github/workflows/prod-deploy.yml` (webhooks build/deploy job — Lambda sentry-cli upload + `SENTRY_RELEASE`), `packages/apps/commise/mobile/eas.json` (add a production build profile — only `e2e` exists today), and Vercel project env config for web (`SENTRY_AUTH_TOKEN` + `SENTRY_RELEASE`).
- **Approach:** Each surface uploads at its own build host — `prod-deploy.yml` does **not** build web or mobile (feasibility P1), so it is the wrong host for their maps. **Web:** `withSentryConfig` uploads automatically during `next build`, which runs on **Vercel** — set `SENTRY_AUTH_TOKEN` and `SENTRY_RELEASE` (commit SHA) as Vercel env vars. **Mobile:** the Expo plugin uploads during the **EAS** build — add a real `production` (and likely `preview`) EAS profile and store `SENTRY_AUTH_TOKEN` as an **EAS secret**; the runtime `release` must match. **Lambda:** add a `sentry-cli sourcemaps upload` step to the webhooks job against the webhook project + SHA release; the `.js.map` files already emit (base tsconfig sets `sourceMap: true`) — verify they ship in the `fromAsset(dist)` artifact. **Release consistency (adversarial P1):** the webhooks `cdk deploy` step passes no SHA today and `commonEnv` has no release var — add `SENTRY_RELEASE=${{ github.sha }}` to that deploy step and to `commonEnv` (U1) so runtime `release` matches the uploaded release; ECS already gets it via U8. Scope minimal-permission, per-surface `SENTRY_AUTH_TOKEN`s (KTD6).
- **Patterns to follow:** existing `prod-deploy.yml` tag-by-SHA step (the SHA is already the ECR image tag — reuse it as the release everywhere).
- **Test scenarios:**
    - Test expectation: none — CI/build configuration. Verified operationally below.
- **Verification:** each surface's build uploads source maps under the commit-SHA release; a deliberately thrown error in staging shows symbolicated frames in the correct project; runtime `release` equals the uploaded release on all four surfaces.

---

## Scope Boundaries

**Deferred for later** (from origin):

- Sentry alert rules, dashboards, and SLO/monitor configuration (Sentry UI).
- CloudWatch metric alarms on the retained custom metrics (e.g. paging on `ReconciliationDrift`).
- Tracing/performance depth beyond a default, environment-configurable sample rate.

**Outside this effort's identity** (from origin):

- Replacing CloudWatch as the durable log store — the drain is additive.
- Migrating Powertools `Metrics` to a different backend.
- Observability for services that do not yet exist.

**Deferred to follow-up work** (plan-local):

- Swapping the forwarder Lambda for an OTel Collector `awscloudwatch` receiver if/when that is preferred over the beta OTLP-direct path.
- Un-skipping and modernizing the stale `infra/__tests__/stacks.test.ts` suites beyond the assertions this plan adds.

---

## Risks & Dependencies

- **OTLP-logs ingest is open beta (KTD1).** The drain rides an endpoint Sentry may change. Mitigation: OTLP specifics isolated in `otlp.ts` + a single drain unit (U4) so a swap to a collector is contained; SDK error/log reporting (the higher-value path) does not depend on it.
- **ESM import-ordering footgun (P1).** The identity service is native ESM, so `instrument.ts` as a top-of-file import is hoisted and unreliable — it must be a `node --import` preload in the Docker `CMD` and `start`/`dev` scripts (U6, KTD3). Lambda keeps `wrapHandler` (manual), avoiding the preload issue.
- **Cross-stack deploy order (P1).** prod-deploy.yml deploys identity-service before identity-webhooks. The forwarder and _all_ subscription filters (incl. the ECS one, referencing the ECS log group by its `IdentityServiceLogGroupName` export) live in the later-deploying webhooks stack, so the producer always precedes the consumer (U5).
- **`emitMetric` coupling (P0).** `emitMetric` rides the Powertools `Logger` this work removes; it must be rewritten to emit EMF to stdout independently or the CloudWatch metrics vanish (U2, KTD5).
- **Source maps upload at each surface's build host, not prod-deploy.yml (P1).** Web → Vercel `next build`; mobile → EAS build (needs a production EAS profile); Lambda → sentry-cli in the webhooks job. Runtime `release` (commit SHA) must match the uploaded release on all four, including the webhooks Lambda whose deploy step needs `SENTRY_RELEASE` added (U11, KTD7).
- **PII into a third party (P1).** Identity data can reach Sentry via errors, logs, and drained API Gateway access logs. Mitigations: a shared scrubber denylist on every SDK (KTD8), authorizer error sanitization (U3), and forwarder-side scrubbing of access-log IP/caller/path ids (U4). The drain credential (`LOG_DRAIN_DSN`) is held in SSM, not plain env (KTD6).
- **2 subscription filters per log group (non-adjustable).** Target groups have zero today; the plan adds exactly one each. Any future second consumer must account for this.
- **Drain rides a single beta endpoint.** R5 fail-safe stops back-pressure but a contract change would silently drop all drained logs — the forwarder-failure CloudWatch metric (U4) is the tripwire that should trigger the deferred collector swap.
- **Process-level crash output residual.** U7 silences app + Nest-framework stdout, but raw Node crash prints before any handler can still drain (accepted; AE2 scoped accordingly).
- **Stale infra tests.** `infra/__tests__/stacks.test.ts` (both packages) are `describe.skip` with outdated prop shapes; new assertions must construct stacks with current flat-ARN props (U1).
- **Dependencies:** Sentry org plan must include **Logs** and **OTLP ingest** for the log-drain and per-service projects; `SENTRY_AUTH_TOKEN` (minimal scope, per-surface) must exist as a Vercel env var (web), an EAS secret (mobile), and a CI secret (Lambda); org slug `radicle-co`, projects `commise-web` / `commise-mobile` (backend projects addressed by DSN).

**DSN → project mapping** (concrete values live only in env / SSM / `.env.local`, never committed — public keys already elided here, org/project ids replaced with placeholders):

- Log-drain project: `<log-drain-dsn>` (forwarder reads it from the `LOG_DRAIN_DSN` SSM parameter).
- identity-webhooks project: `<webhook-dsn>` (CDK env `SENTRY_DSN`).
- identity-service project: `<identity-service-dsn>` (CDK env `SENTRY_DSN`).
- Web / mobile: `NEXT_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN` in the apps' `.env.local`.

---

## Sources & Research

- Origin requirements: `docs/brainstorms/2026-06-11-observability-sentry-integration-requirements.md`.
- Sentry NestJS setup (instrument-first, `SentryModule`, `SentryGlobalFilter`): https://docs.sentry.io/platforms/javascript/guides/nestjs/
- Sentry AWS Lambda + Logs (auto-context lands on errors; scope attributes for logs): https://docs.sentry.io/platforms/javascript/guides/aws-lambda/ , https://docs.sentry.io/platforms/javascript/guides/aws-lambda/logs/
- Sentry CloudWatch OTLP ingest (open beta) + endpoint/auth: https://docs.sentry.io/concepts/otlp/direct/logs/ , https://docs.sentry.io/concepts/otlp/forwarding/sources/aws-cloudwatch/
- Sentry Next.js (App Router, `instrumentation-client.ts`, `onRequestError`, `withSentryConfig`): https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
- Clerk + Sentry tunnel/middleware interplay: https://github.com/getsentry/sentry-javascript/issues/19600
- Sentry React Native / Expo (v8 line, config plugin, `getSentryExpoConfig`, `sentry-expo` deprecated): https://docs.sentry.io/platforms/react-native/manual-setup/expo/
- CDK `SubscriptionFilter` / `FilterPattern` + CloudWatch quota (2 filters/group): https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_logs.SubscriptionFilter.html , https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html
