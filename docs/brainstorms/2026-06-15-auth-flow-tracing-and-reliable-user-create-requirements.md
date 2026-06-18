# Auth-flow tracing + reliable user-create — requirements

**Date:** 2026-06-15
**Status:** Brainstorm → ready for planning
**Branch / PR:** `feat/reliable-create-user-flow` (PR #39)
**Scope tier:** Deep — feature (co-scoped: defect fixes + new tracing capability)

## Context

A real signup (`webb.c.brandon@gmail.com`) created a Clerk user (`user_3F6wgxH7Mjr9Kuef18BRynAou3b`, sandbox `nice-fowl-6`, 2026-06-14T03:49:01Z) but **no row** in the identity DB (`kitchensink_identity`, 0 users). Both creation paths failed independently and silently:

1. **Synchronous read-through (PR #39's intended path).** The web profile page calls `api.get('/v1/users/me')` (`packages/apps/commise/web/src/app/profile/page.tsx:17`); `AuthMiddleware.use` → `UsersService.resolveOrCreateFromClaims` provisions the user on first authenticated request. It did not run to success — the identity service was crash-looping earlier on a NestJS DI error (`AuthMiddleware can't resolve ClerkAuthService`), and no creation/failure was reported.
2. **Async webhook backstop.** The only `user.created` delivery (API GW `POST /webhooks/users`, 2026-06-14T03:49:02Z) returned `200` with `responseLength:24` = the dedup body `{"ok":true,"dedup":true}` (success body `{"ok":true}` is 11 bytes). The upsert never ran: `recordOnce` saw the svix-id already claimed and short-circuited.
3. **No observability.** Neither failure surfaced. CloudWatch app logs are intentionally bare (logs routed to Sentry by design), but the crash loop produced no Sentry Issue, there are no alarms, and the reconciliation safety-net has never run. Diagnosis required reading API Gateway access logs and counting response bytes.

This is a defense-in-depth collapse, not an edge case. The fixes and the tracing capability ship together.

## Goals

- Make user provisioning reliable: no signup ends with a Clerk user and no DB row without something failing loudly.
- Make the signup + authentication flow traceable end-to-end by a human or an agent, across all four runtimes (web/mobile → identity service → webhook Lambda → reconciliation).
- Detect provisioning failures in prod without pre-knowledge of the failure.

## Non-goals

- Replacing the Sentry-first observability model (`identity-webhooks/src/common/observability.ts`). This extends it.
- General-purpose distributed tracing / APM. Scope is the auth + signup flow only.
- Reworking Clerk session-token verification or the `azp`/`aud` model (PR #39 / ADR-0001 stand).

## Part A — Confirmed defects to fix

- **A1. Reconciliation is not scheduled.** `ReconciliationFunction` (`packages/services/identity-webhooks/infra/lib/webhooks-stack.ts:222`) is wired to `SqsEventSource(deletionQueue)` (line 237) — the deletion worker's source — instead of an EventBridge schedule. The nightly Clerk↔DB drift-repair therefore never runs, and it competes with the deletion-worker as an SQS consumer. **Requirement:** reconciliation runs on a schedule (drift repair backfills missing users like this one); it must not consume the deletion queue.
- **A2. Webhook dedup claim orphans on hard failure.** `recordOnce` (`packages/services/identity/src/database/dao/webhook-events.dao.ts`) claims the svix-id _before_ processing; the claim is released only inside the handler's `catch`. A hard failure (deadlock per commit `d59e11c`, Lambda timeout/OOM) skips the release, so every Svix retry dedups and the event is lost permanently. **Requirement:** an unprocessed-but-claimed event must not permanently swallow retries — claims either confirm only after successful processing (handlers are already idempotent upserts) or self-expire so retries re-process.
- **A3. Read-through provisioning failures are not loud.** A `resolveOrCreateFromClaims` failure 500s every request (hard-locks the user) but isn't guaranteed to raise an actionable Sentry signal, and the web `api-client` may swallow it. **Requirement:** provisioning failure raises a distinct, actionable signal and does not fail silently to the user.
- **A4. The DI crash loop was unalarmed.** `AuthMiddleware`/`ClerkAuthService` wiring failed at boot, crash-looped for hours, produced no Sentry Issue (process died before flush) and no alarm. **Requirement:** a module-wiring guard (test that fails CI) plus a deploy/health alarm so a boot crash-loop pages instead of hiding.
- **A5. ~~Backfill the affected user~~ (resolved/moot).** `webb.c.brandon@gmail.com` was backfilled via reconciliation then deleted from the DB again at the user's request; sandbox is back to 0 users. The identity still exists in Clerk, so once A1 deploys, scheduled reconciliation will re-create the row unless the Clerk identity is removed. No further action required here.

## Part B — auth-flow tracing via OpenTelemetry

**Mechanism decision (2026-06-15):** OpenTelemetry spans, **not** the `debug` npm package. The `debug`/`debug:auth` idea from the original request is dropped — OTel is the single tracing mechanism in every runtime, including local dev. This is a deliberate divergence from the opening ask, chosen for true cross-runtime parent/child traces over per-component log lines.

### B1. Mechanism & exporter routing

- Adopt the OpenTelemetry SDK in each runtime (Next.js web, Expo mobile, NestJS identity service, Lambda webhooks/reconciliation). The signup + auth flow is modeled as spans, not log lines.
- Export by environment:
    - **local / development:** console span exporter (spans print to the terminal).
    - **sandbox + prod:** OTLP → Sentry. Sentry tracing is already partially wired (`SENTRY_TRACES_SAMPLE_RATE` set, an OTLP log-forwarder exists) — reuse that path rather than standing up new infra.
- "On-demand in prod" (B3 decision) is expressed as **sampling**: sandbox samples the auth flow at 100%; prod keeps a low head/tail sample by default with a mechanism to force-sample a specific session/user when reproducing. Exact sampling design is a planning task.
- The existing Sentry PII scrubbers must cover span attributes (no token/email leakage).

### B2. Correlation — "up and down"

- **Synchronous path:** propagate W3C trace context (`traceparent`) from the client (web/mobile) through the identity service, so client → service is one trace with real parent/child spans.
- **Async boundary:** the webhook and reconciliation are fired by Clerk/EventBridge outside our call chain, so they cannot inherit the sync `traceparent`. They start their own traces and are linked by a `clerk_user_id` span attribute stamped on every span in every runtime (plus a span link where an originating trace id is recoverable). Filtering by `clerk_user_id` reconstructs the full flow; the sync sub-trace stays a true waterfall.
- This entity-id linking across the async gap is expected and documented — it is the honest limit of distributed tracing when a third party triggers the downstream work.

### B3. Prod detection (always-on outcome signal)

- Independent of span sampling, **every** signup/auth provisioning flow emits **one** always-on terminal outcome signal in prod (a guaranteed-sampled root-span attribute set and/or a dedicated event): path taken (read-through vs webhook), user-created yes/no, success/error, `clerk_user_id`. Cheap, alarmable, and the trigger to go pull the full (force-sampled) trace. Closes the gap that sampling-only prod would otherwise reintroduce.

### B4. Span taxonomy (what "every step" means)

Each meaningful transition is a span (or span event) on the flow's trace:

- **Client:** signup submitted (Clerk), session/token acquired, authenticated API call issued (carries `traceparent`).
- **Identity service:** request received, bearer extracted, token verified (`azp`/`aud` outcome), resolve-or-create entered, branch taken (existing vs create), DB write result, account/profile backstop, response.
- **Webhook:** delivery received, svix verified, dedup claim outcome (first vs duplicate), event type, upsert result, account/profile backstop, terminal status.
- **Reconciliation:** run start, drift found, action taken per identity, run summary.

## Scope boundaries

**In scope:** signup + authentication (token verification / read-through provisioning) + webhook sync (created/updated/deleted) + reconciliation. Defect fixes A1–A5.

**Deferred for later:** sign-out and token-refresh-specific tracing; converting prod to always-on verbose (revisit after observing Sentry Logs volume from sandbox); a CloudWatch/Sentry alarm pack beyond A3/A4.

**Cross-platform:** client-side OTel instrumentation + `traceparent` propagation is a parity requirement for both web and mobile (per `CLAUDE.md §14`). Backend (identity service, webhooks) and web land first; mobile (Expo) OTel instrumentation follows in the same initiative.

## Success criteria

- A signup that fails to provision raises a loud, actionable signal in every environment (no silent Clerk-user-without-DB-row).
- Given a `clerk_user_id`, an engineer or agent can reconstruct the full signup/auth flow across all four runtimes from Sentry, with a true client→service waterfall on the sync path.
- Reconciliation runs on a schedule and backfills drift (verified by re-introducing then clearing a missing user).
- A webhook hard-failure no longer permanently dedups: a retried delivery re-processes.
- A provisioning failure produces an alarmable always-on prod outcome signal (no silent Clerk-user-without-DB-row).

## Dependencies / assumptions

- Sentry projects `kitchensink-identity` and `kitchensink-identity-webhook` (org `radicle-co`) are the OTLP span sinks; the existing `beforeSend`/`beforeSendLog` scrubbers must extend to span attributes (assumption — verify token/email never leak).
- The OTel JS SDK runs acceptably in all four runtimes — notably the Expo/Hermes RN bundle and the Lambda cold-start budget (assumption — verify; RN OTel support is the biggest unknown and may force a lighter client shim).
- Sentry's OTLP ingestion accepts our span shape via the existing forwarder path without new infra (assumption — verify against current `SENTRY_TRACES_SAMPLE_RATE` wiring).
- The web preview (`/pr-39`) actually reaches the sandbox identity service ALB (`API_BASE_URL`) — to be confirmed during A3 (the other candidate cause of the sync-path miss).

## Outstanding questions

- A2 fix shape: confirm-after-process vs TTL-expiring claim (migration `0007_webhook_events_ttl.sql` exists — does it already give expiry semantics, or is it inert in Postgres?). Resolve in planning.
- OTel sampling design: head vs tail sampling, and the force-sample mechanism for on-demand prod reproduction (header? per-user flag?). Pick in planning.
- Reconciliation cadence (hourly vs nightly) given it's also now the primary backfill safety net.
- RN/Expo OTel feasibility — if the full SDK is too heavy for Hermes, define the lighter client-side fallback that still emits the client spans + `traceparent`.
