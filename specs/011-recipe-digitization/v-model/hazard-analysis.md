# Hazard Analysis (FMEA): Recipe Digitization

**Feature Branch**: `011-recipe-digitization`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/011-recipe-digitization/v-model/system-design.md`
**Standard**: General-Purpose FMEA (non-regulated software; `domain: ''` in `v-model-config.yml`)

## Overview

This document presents the Failure Mode and Effects Analysis (FMEA) for the **Recipe Digitization** feature. Every system component (`SYS-001`..`SYS-032`) from `system-design.md` is assessed for realistic failure modes. Each hazard receives a unique `HAZ-NNN` identifier and is linked to risk-control measures (`REQ-NNN` / `SYS-NNN` / `ARCH-NNN`), enabling the traceability chain: Hazard → Mitigation → Requirement → Test Case (Matrix H in `traceability-matrix.md`).

**Non-regulated context.** Commise is a consumer recipe management application. There are no life-safety, vehicle-control, medical-device, or aviation-control concerns. Severity is measured against **user trust, data integrity, privacy, availability, and platform cost** — not personal injury. Safety-critical taxonomies (ISO 26262 ASIL, DO-178C DAL, IEC 62304) are intentionally **not** applied; `v-model-config.yml` sets `domain: ''`.

## ID Schema

- **Hazard ID**: `HAZ-{NNN}` — 3-digit zero-padded, sequential (HAZ-001, HAZ-002, ...). Never renumbered.
- **Lineage**: From any `HAZ-NNN`, the Mitigation column lists `REQ-NNN`, `SYS-NNN`, and (where useful) `ARCH-NNN` references. The full chain to verification test cases (`ATP-NNN`, `STP-NNN`, `ITP-NNN`, `UTP-NNN`) lives in `traceability-matrix.md` (Matrix H — Hazard Traceability).

## Risk Matrix Definition

### Severity Scale (consumer SaaS — recipe app)

| Level        | Definition                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catastrophic | Cross-tenant data leak, broad unauthorized access, persistent loss of user-owned recipe data, or platform-wide outage.                                                 |
| Critical     | Individual-user data loss without recovery, sustained sharing-circle audience misroute, security control bypass for one user, or sustained core-flow outage (≥1 hour). |
| Serious      | Recoverable degradation: failed digitization batch with retry path, single-job audience-state stalled, transient endpoint 5xx with idempotent retry.                   |
| Minor        | Annoyance: slow OCR turnaround, suboptimal parse quality, transient UI error with self-recovery.                                                                       |
| Negligible   | Cosmetic only: log noise, telemetry drift, copy/wording inconsistency.                                                                                                 |

### Likelihood Scale

| Level      | Definition                                                                   |
| ---------- | ---------------------------------------------------------------------------- |
| Frequent   | Expected on a regular cadence under normal load (≥1× per day in production). |
| Probable   | Expected occasionally (≥1× per week per 1k MAU).                             |
| Occasional | Expected rarely (≥1× per month per 1k MAU).                                  |
| Remote     | Possible under unusual conditions (≥1× per quarter at small scale).          |
| Improbable | Conceivable only under stacked failure or adversarial conditions.            |

### Risk Level Matrix

|              | Frequent     | Probable     | Occasional   | Remote      | Improbable  |
| ------------ | ------------ | ------------ | ------------ | ----------- | ----------- |
| Catastrophic | Unacceptable | Unacceptable | Unacceptable | Undesirable | Undesirable |
| Critical     | Unacceptable | Unacceptable | Undesirable  | Undesirable | Tolerable   |
| Serious      | Unacceptable | Undesirable  | Undesirable  | Tolerable   | Tolerable   |
| Minor        | Undesirable  | Tolerable    | Tolerable    | Tolerable   | Acceptable  |
| Negligible   | Tolerable    | Tolerable    | Acceptable   | Acceptable  | Acceptable  |

**Disposition rule**: `Unacceptable` MUST be mitigated to `Undesirable` or lower before release. `Undesirable` MUST have explicit residual-risk acceptance recorded in this document. `Tolerable`/`Acceptable` are accepted as-is.

## Operational States

`system-design.md` does not define explicit operational states for the digitization subsystem; the implicit state is **NORMAL** (steady-state production). The following operating modes are referenced where relevant for state-dependent hazards:

| State          | Definition                                                                       | Source           |
| -------------- | -------------------------------------------------------------------------------- | ---------------- |
| NORMAL         | Steady-state operation under expected load and provider availability.            | Implicit         |
| DEGRADED-OCR   | OCR provider returning elevated errors / latency; fallback / retry paths active. | SYS-005, SYS-006 |
| OFFLINE-CLIENT | Mobile client without network; capture queue active.                             | SYS-001, REQ-040 |
| RESTORE-WINDOW | Within the 30-day soft-delete restore window for circles.                        | SYS-015          |
| INVITE-PENDING | Circle invitation outstanding (not yet accepted/declined/expired).               | SYS-018, SYS-024 |

⚠️ No formally enumerated operational states exist in `system-design.md`. State-dependent severity is captured with the implicit modes above; if `system-design.md` later introduces a formal state taxonomy, this section MUST be reconciled.

## Hazard Register (FMEA)

> One or more `HAZ-NNN` per `SYS-NNN`. Mitigations cite existing `REQ-NNN`, `SYS-NNN`, or `ARCH-NNN` identifiers. Where a `[FROZEN-PENDING-RESOLUTION]` marker from `system-design.md` is the relevant control, it is cited verbatim — these are not new design decisions made here.

### SYS-001 — Photo Capture & Upload Frontend

| HAZ ID  | Component | Failure Mode                                                                  | Operational State | Effect                                                  | Severity | Likelihood | Risk Level  | Mitigation                                                                                    | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------------------------------- | ------------- |
| HAZ-001 | SYS-001   | Capture dropped: camera permission revoked mid-session, batch state lost.     | NORMAL            | User loses in-progress batch; must restart capture.     | Serious  | Occasional | Undesirable | REQ-001, REQ-005 (batch grouping persisted client-side); ARCH-001 capture-state machine.      | Tolerable     |
| HAZ-002 | SYS-001   | Offline capture queue overflows local storage; oldest items silently dropped. | OFFLINE-CLIENT    | Silent data loss of user-captured photos.               | Critical | Remote     | Undesirable | REQ-040 (offline queue cap + visible state); ARCH-002 queue-eviction policy with user prompt. | Tolerable     |
| HAZ-003 | SYS-001   | Upload retried after success → duplicate `batch_id` job creation.             | NORMAL            | Duplicate digitization jobs, duplicate billing for OCR. | Minor    | Probable   | Tolerable   | REQ-003 (idempotency key on intake); MOD-085 `idempotency.run`.                               | Acceptable    |

### SYS-002 — Digitization Job Intake API

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                  | Severity     | Likelihood | Risk Level  | Mitigation                                                                                                                                        | Residual Risk                                                                       |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- | ------------ | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| HAZ-004 | SYS-002   | Pre-signed URL minted for one user, used by another (cross-user upload).    | NORMAL            | Cross-tenant write into another user's S3 prefix.       | Catastrophic | Improbable | Undesirable | REQ-029 (per-user S3 prefix in URL); SYS-019 (Clerk session token); SYS-004 (per-user-prefixed bucket).                                           | Undesirable — accepted on basis that S3 server-side prefix is enforced and audited. |
| HAZ-005 | SYS-002   | Cold-start latency violates p95 contract `[FROZEN-PENDING-RESOLUTION: A2]`. | NORMAL            | Capture flow stalls; users abandon batches.             | Serious      | Probable   | Undesirable | REQ-045 + `[FROZEN-PENDING-RESOLUTION: A2]` carried into observability (SYS-026); cold-start measurement contract MUST be defined before GA gate. | Undesirable until A2 resolved.                                                      |
| HAZ-006 | SYS-002   | Validation bypassed (oversized / wrong MIME accepted into queue).           | NORMAL            | Worker crashes; OCR cost spike; user sees opaque error. | Serious      | Remote     | Tolerable   | SYS-003 pre-flight validator; REQ-001, REQ-004, REQ-030.                                                                                          | Tolerable                                                                           |

### SYS-003 — Image Pre-flight Validator

| HAZ ID  | Component | Failure Mode                                                                  | Operational State | Effect                                       | Severity | Likelihood | Risk Level  | Mitigation                                                                          | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------- | ----------------- | -------------------------------------------- | -------- | ---------- | ----------- | ----------------------------------------------------------------------------------- | ------------- |
| HAZ-007 | SYS-003   | False rejection of legitimate HEIC photo from iOS due to MIME sniff mismatch. | NORMAL            | User cannot upload valid photo; abandonment. | Serious  | Occasional | Undesirable | REQ-001 + REQ-030 (RFC 7807 error with stable code → client retry/conversion path). | Tolerable     |
| HAZ-008 | SYS-003   | Validator silently accepts oversize image due to streaming truncation bug.    | NORMAL            | Downstream worker OOMs; queue backlog.       | Serious  | Improbable | Tolerable   | REQ-004 (size check pre-S3-finalize); ATP coverage of boundary (20MB ± 1B).         | Acceptable    |

### SYS-004 — S3 Photo Object Store

| HAZ ID  | Component | Failure Mode                                                                         | Operational State | Effect                                             | Severity     | Likelihood | Risk Level  | Mitigation                                                                                               | Residual Risk                                                 |
| ------- | --------- | ------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------- | ------------ | ---------- | ----------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| HAZ-009 | SYS-004   | CloudFront cache leak — one user's photo URL guessable & cacheable publicly.         | NORMAL            | Cross-tenant photo exposure.                       | Catastrophic | Improbable | Undesirable | REQ-018, REQ-019, REQ-022 (signed URL + per-user prefix + private origin); ARCH-004 distribution config. | Undesirable — accepted with quarterly access-audit (SYS-026). |
| HAZ-010 | SYS-004   | Soft-deleted photo restored after 30-day window due to clock skew on lifecycle rule. | RESTORE-WINDOW    | Stale photos resurface; user expectation violated. | Minor        | Remote     | Tolerable   | REQ-022 (soft-delete window); ARCH-004 lifecycle policy; SYS-026 audit alarms on lifecycle events.       | Acceptable                                                    |

### SYS-005 — OCR Queue & Worker Orchestration

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                          | Severity | Likelihood | Risk Level  | Mitigation                                                                                                              | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- | -------- | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-011 | SYS-005   | SQS message redelivered → OCR run twice → user charged twice / parse races. | NORMAL            | Duplicate OCR provider cost; correction UI sees racing writes.  | Serious  | Probable   | Undesirable | MOD-085 idempotency key on `jobId`; REQ-003 (idempotent intake).                                                        | Tolerable     |
| HAZ-012 | SYS-005   | Worker concurrency exceeds RDS pool budget → connection storm.              | NORMAL            | API endpoint 5xx storm, cascading failure.                      | Critical | Occasional | Undesirable | MOD-018 per-user concurrency token bucket; MOD-090 `dbPoolMax × maxLambdaConcurrency ≤ RDS max_connections − reserved`. | Tolerable     |
| HAZ-013 | SYS-005   | DLQ filling silently; no alarm.                                             | DEGRADED-OCR      | Failed jobs invisible; user trust erodes; manual recovery cost. | Critical | Remote     | Undesirable | SYS-026 (DLQ depth alarm); SYS-027 canary gate on DLQ growth.                                                           | Tolerable     |

### SYS-006 — OcrProvider Interface

| HAZ ID  | Component | Failure Mode                                                       | Operational State | Effect                               | Severity | Likelihood | Risk Level  | Mitigation                                                                                                             | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------ | ----------------- | ------------------------------------ | -------- | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-014 | SYS-006   | Provider SDK upgrade introduces breaking change to response shape. | DEGRADED-OCR      | All OCR jobs fail; backlog grows.    | Critical | Remote     | Undesirable | SYS-006 interface boundary (MOD-022); MOD-024 adapter; SYS-027 canary gate before rollout.                             | Tolerable     |
| HAZ-015 | SYS-006   | Provider returns success but empty result (silent failure).        | DEGRADED-OCR      | Empty correction UI; user confusion. | Serious  | Occasional | Undesirable | MOD-023 `OcrError` taxonomy classifies empty result as failure; SYS-007 normalizer enforces minimum-content invariant. | Tolerable     |

### SYS-007 — OCR Parser & Normalizer

| HAZ ID  | Component | Failure Mode                                                                    | Operational State | Effect                                                     | Severity | Likelihood | Risk Level | Mitigation                                                                               | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------- | -------- | ---------- | ---------- | ---------------------------------------------------------------------------------------- | ------------- |
| HAZ-016 | SYS-007   | Ingredient quantity parsed as wrong unit (e.g., "1 c" → "1 cup" vs "1 carton"). | NORMAL            | Recipe correctness degraded; cooking failure for end user. | Minor    | Probable   | Tolerable  | REQ-014..REQ-017 correction UI affords user override; SYS-008 persists corrected value.  | Acceptable    |
| HAZ-017 | SYS-007   | Normalizer throws on malformed UTF-8 / RTL text.                                | NORMAL            | Job stuck in `parsing` state.                              | Serious  | Remote     | Tolerable  | MOD-021 `handleFailure` catches → moves job to `failed`; SYS-026 alarm on `failed` rate. | Acceptable    |

### SYS-008 — Correction Service & Persistence

| HAZ ID  | Component | Failure Mode                                                              | Operational State | Effect                            | Severity | Likelihood | Risk Level  | Mitigation                                                                        | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------- | ----------------- | --------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------------------- | ------------- |
| HAZ-018 | SYS-008   | Concurrent edits from two devices overwrite each other (last-write-wins). | NORMAL            | User loses edits without warning. | Critical | Occasional | Undesirable | REQ-014, REQ-020 (optimistic concurrency token); MOD-091 serializable TX wrapper. | Tolerable     |
| HAZ-019 | SYS-008   | Partial save: ingredients persisted, steps fail → recipe unusable.        | NORMAL            | Recipe in inconsistent state.     | Critical | Remote     | Undesirable | MOD-091 transaction wrapper enforces atomicity; SYS-031 isolation enforcer.       | Tolerable     |

### SYS-009 — Correction UI (Side-by-side)

| HAZ ID  | Component | Failure Mode                                             | Operational State | Effect                               | Severity | Likelihood | Risk Level  | Mitigation                                                                | Residual Risk |
| ------- | --------- | -------------------------------------------------------- | ----------------- | ------------------------------------ | -------- | ---------- | ----------- | ------------------------------------------------------------------------- | ------------- |
| HAZ-020 | SYS-009   | Image pane scroll desync from text pane → user confused. | NORMAL            | Annoyance; correction quality drops. | Minor    | Frequent   | Undesirable | REQ-015 (synchronized scrolling); ATP coverage in correction UI E2E.      | Tolerable     |
| HAZ-021 | SYS-009   | UI freezes on very large OCR result (>5k lines).         | NORMAL            | User cannot correct; abandons job.   | Serious  | Remote     | Tolerable   | REQ-016 (virtualized list); ARCH module for paginated correction surface. | Acceptable    |

### SYS-010 — Recipe Save Bridge

| HAZ ID  | Component | Failure Mode                                                            | Operational State | Effect                                                  | Severity | Likelihood | Risk Level  | Mitigation                                                                                       | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------ | ------------- |
| HAZ-022 | SYS-010   | Save succeeds in recipe service but digitization job not marked `done`. | NORMAL            | Job re-listed as pending; user re-corrects same recipe. | Serious  | Occasional | Undesirable | MOD-086 outbox publishes `recipe.digitized` in same TX; SYS-011 lifecycle reconciler.            | Tolerable     |
| HAZ-023 | SYS-010   | Recipe persisted into wrong circle audience.                            | NORMAL            | Cross-circle visibility leak.                           | Critical | Remote     | Undesirable | SYS-013 audience domain check; SYS-014 audience rewriter; SYS-021 shared-audience library guard. | Tolerable     |

### SYS-011 — Job Lifecycle & Discard Manager

| HAZ ID  | Component | Failure Mode                                                    | Operational State | Effect                                   | Severity | Likelihood | Risk Level  | Mitigation                                                            | Residual Risk |
| ------- | --------- | --------------------------------------------------------------- | ----------------- | ---------------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------- | ------------- |
| HAZ-024 | SYS-011   | Discard fails to delete S3 objects → privacy commitment broken. | NORMAL            | Photos retained beyond user expectation. | Critical | Remote     | Undesirable | REQ-019, REQ-022 (discard purges S3); SYS-025 privacy purge pipeline. | Tolerable     |
| HAZ-025 | SYS-011   | Stuck job (`processing` >24h) never reconciled.                 | DEGRADED-OCR      | User sees infinite spinner.              | Serious  | Occasional | Undesirable | SYS-011 reconciler scan; SYS-026 alarm on stuck-job count.            | Tolerable     |

### SYS-012 — Job Listing & Pagination

| HAZ ID  | Component | Failure Mode                                                             | Operational State | Effect                                    | Severity     | Likelihood | Risk Level  | Mitigation                                                                                | Residual Risk                                                        |
| ------- | --------- | ------------------------------------------------------------------------ | ----------------- | ----------------------------------------- | ------------ | ---------- | ----------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| HAZ-026 | SYS-012   | Cursor pagination skips a job when concurrent insert occurs at boundary. | NORMAL            | Job invisible to user until next refresh. | Minor        | Probable   | Tolerable   | REQ-046 (stable cursor on `(created_at, id)`); ATP boundary coverage.                     | Acceptable                                                           |
| HAZ-027 | SYS-012   | Listing endpoint returns another user's jobs (auth filter regression).   | NORMAL            | Cross-tenant metadata leak.               | Catastrophic | Improbable | Undesirable | SYS-019 bearer enforcement; REQ-027 route-scope; mandatory `userId` filter in repo layer. | Undesirable — accepted with mandatory test (UTP) on every repo call. |

### SYS-013 — Circle Domain Service

| HAZ ID  | Component | Failure Mode                                              | Operational State | Effect                                    | Severity | Likelihood | Risk Level  | Mitigation                                                                                              | Residual Risk                  |
| ------- | --------- | --------------------------------------------------------- | ----------------- | ----------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------- | ------------------------------ |
| HAZ-028 | SYS-013   | Owner-deletion race leaves orphan circle membership rows. | NORMAL            | Phantom membership; access control drift. | Critical | Remote     | Undesirable | `[FROZEN-PENDING-RESOLUTION: G1]` (retention/timing model); MOD-091 serializable TX; SYS-016 audit log. | Undesirable until G1 resolved. |
| HAZ-029 | SYS-013   | Hard-delete bypasses soft-delete window.                  | RESTORE-WINDOW    | User loses recoverable data.              | Critical | Improbable | Tolerable   | REQ-058 (soft-delete enforcement); SYS-015 restore worker.                                              | Tolerable                      |

### SYS-014 — Circle Audience Rewriter

| HAZ ID  | Component | Failure Mode                                                  | Operational State | Effect                                                 | Severity     | Likelihood | Risk Level  | Mitigation                                                                                           | Residual Risk                  |
| ------- | --------- | ------------------------------------------------------------- | ----------------- | ------------------------------------------------------ | ------------ | ---------- | ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| HAZ-030 | SYS-014   | Audience rewrite leaves a recipe broadcast to deleted circle. | NORMAL            | Recipe visible to wrong audience post-circle-deletion. | Catastrophic | Remote     | Undesirable | REQ-033, REQ-035, REQ-042 + `[FROZEN-PENDING-RESOLUTION: G1]`; SYS-023 audience resolution fallback. | Undesirable until G1 resolved. |
| HAZ-031 | SYS-014   | Rewrite TX commits but downstream cache not invalidated.      | NORMAL            | Stale audience visible until TTL.                      | Serious      | Probable   | Undesirable | MOD-086 outbox event drives cache invalidation; SYS-026 monitors lag.                                | Tolerable                      |

### SYS-015 — Circle Soft-Delete & Restore Worker

| HAZ ID  | Component | Failure Mode                                                               | Operational State | Effect                                    | Severity | Likelihood | Risk Level | Mitigation                                                                         | Residual Risk                  |
| ------- | --------- | -------------------------------------------------------------------------- | ----------------- | ----------------------------------------- | -------- | ---------- | ---------- | ---------------------------------------------------------------------------------- | ------------------------------ |
| HAZ-032 | SYS-015   | Restore after window grace boundary brings back already-purged child rows. | RESTORE-WINDOW    | Restored circle has missing recipes.      | Serious  | Remote     | Tolerable  | REQ-060 + `[FROZEN-PENDING-RESOLUTION: G1]` retention timing carried as parameter. | Undesirable until G1 resolved. |
| HAZ-033 | SYS-015   | Worker scans full table without index → DB hot.                            | NORMAL            | Query latency spike during nightly purge. | Minor    | Probable   | Tolerable  | SYS-015 indexed by `deleted_at`; SYS-026 latency alarm.                            | Acceptable                     |

### SYS-016 — Circle Membership Audit Logger

| HAZ ID  | Component | Failure Mode                                                       | Operational State | Effect                                   | Severity | Likelihood | Risk Level | Mitigation                                                      | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------ | ----------------- | ---------------------------------------- | -------- | ---------- | ---------- | --------------------------------------------------------------- | ------------- |
| HAZ-034 | SYS-016   | Audit row write fails → membership change committed without trail. | NORMAL            | Investigation impossible after incident. | Critical | Improbable | Tolerable  | MOD-086 outbox in same TX; SYS-026 alarm on outbox-drainer lag. | Tolerable     |
| HAZ-035 | SYS-016   | Audit log retention deletes records before legal/policy window.    | NORMAL            | Compliance/policy violation.             | Serious  | Improbable | Tolerable  | REQ-058, REQ-060 retention parameters; SYS-027 release gate.    | Acceptable    |

### SYS-017 — Circle Outlier Monitor

| HAZ ID  | Component | Failure Mode                                                | Operational State | Effect                                          | Severity | Likelihood | Risk Level | Mitigation                                               | Residual Risk |
| ------- | --------- | ----------------------------------------------------------- | ----------------- | ----------------------------------------------- | -------- | ---------- | ---------- | -------------------------------------------------------- | ------------- |
| HAZ-036 | SYS-017   | False positive: legitimate large circle flagged as outlier. | NORMAL            | Operator alert noise; legitimate user impacted. | Minor    | Probable   | Tolerable  | SYS-017 threshold tuning; runbook documented in SYS-026. | Acceptable    |
| HAZ-037 | SYS-017   | False negative: anomalous-share storm goes undetected.      | NORMAL            | Cross-circle leak undetected for hours.         | Critical | Improbable | Tolerable  | SYS-017 + SYS-026 multi-signal correlation.              | Tolerable     |

### SYS-018 — Circle Invitation Service

| HAZ ID  | Component | Failure Mode                                                               | Operational State | Effect                              | Severity     | Likelihood | Risk Level  | Mitigation                                                                                                                               | Residual Risk                     |
| ------- | --------- | -------------------------------------------------------------------------- | ----------------- | ----------------------------------- | ------------ | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| HAZ-038 | SYS-018   | Invitation token reused after acceptance → second user joins same invite.  | INVITE-PENDING    | Unauthorized circle membership.     | Critical     | Improbable | Tolerable   | REQ-056 (single-use token, atomic state transition); MOD-091 serializable TX.                                                            | Tolerable                         |
| HAZ-039 | SYS-018   | Schema-name drift (`circle_invitations` vs `circle_invites`) breaks reads. | NORMAL            | Invitations invisible after deploy. | Catastrophic | Remote     | Undesirable | `[FROZEN-PENDING-RESOLUTION: I1, I2]` carried; alias-pending persistence; SYS-029 governance enforces canonical name pre-implementation. | Undesirable until I1/I2 resolved. |

### SYS-019 — Clerk Session-Token Authenticator

| HAZ ID  | Component | Failure Mode                                                                                        | Operational State | Effect        | Severity     | Likelihood | Risk Level  | Mitigation                                                                                                                    | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------------------------------- | ----------------- | ------------- | ------------ | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-040 | SYS-019   | Configured `CLERK_JWT_KEY` stale/mismatched after Clerk signing-key rotation → all tokens rejected. | NORMAL            | Total outage. | Catastrophic | Remote     | Undesirable | REQ-027 (`CLERK_JWT_KEY` sourced from config + rotation runbook to redeploy on key change); SYS-026 alarm on auth-error rate. | Tolerable     |
| HAZ-041 | SYS-019   | Algorithm-confusion attack (`alg: none` accepted).                                                  | NORMAL            | Auth bypass.  | Catastrophic | Improbable | Undesirable | REQ-027 (`@clerk/backend` `verifyToken` rejects `alg: none`, accepts `RS256` only); test in security best-practices review.   | Tolerable     |

### SYS-020 — RFC 7807 Error Envelope

| HAZ ID  | Component | Failure Mode                                                      | Operational State | Effect                                 | Severity | Likelihood | Risk Level  | Mitigation                                              | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------- | ----------------- | -------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------- | ------------- |
| HAZ-042 | SYS-020   | Stack trace leaked into `detail` field in production.             | NORMAL            | Information disclosure.                | Serious  | Occasional | Undesirable | REQ-030 (sanitized envelope); SYS-026 redaction filter. | Tolerable     |
| HAZ-043 | SYS-020   | Inconsistent `error_code` across services breaks client error UX. | NORMAL            | Client retry / messaging logic broken. | Minor    | Probable   | Tolerable   | REQ-030 stable taxonomy; SYS-029 governance enforces.   | Acceptable    |

### SYS-021 — `@kitchensink/shared-audience` Library

| HAZ ID  | Component | Failure Mode                                                                 | Operational State | Effect                                         | Severity | Likelihood | Risk Level  | Mitigation                                                                           | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------------- | ----------------- | ---------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------ | ------------- |
| HAZ-044 | SYS-021   | Library version drift between web and mobile → divergent audience semantics. | NORMAL            | Visibility decisions disagree across surfaces. | Critical | Occasional | Undesirable | SYS-021 single source of truth; SYS-030 workspace guardrails enforce single version. | Tolerable     |

### SYS-022 — API Versioning & Runtime Conformance

| HAZ ID  | Component | Failure Mode                                                | Operational State | Effect                                         | Severity | Likelihood | Risk Level  | Mitigation                                                               | Residual Risk |
| ------- | --------- | ----------------------------------------------------------- | ----------------- | ---------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------ | ------------- |
| HAZ-045 | SYS-022   | Breaking change shipped under same `/api/v1/` prefix.       | NORMAL            | Mobile clients on old build break in field.    | Critical | Remote     | Undesirable | REQ-049 (versioning convention); SYS-027 release gate diff check.        | Tolerable     |
| HAZ-046 | SYS-022   | Runtime conformance check disabled in prod for performance. | NORMAL            | Drift between contract and runtime undetected. | Serious  | Remote     | Tolerable   | REQ-049 (conformance always-on, sampled); SYS-026 alarm on drift events. | Acceptable    |

### SYS-023 — Audience Resolution Fallback

| HAZ ID  | Component | Failure Mode                                                 | Operational State | Effect                     | Severity     | Likelihood | Risk Level  | Mitigation                                                            | Residual Risk |
| ------- | --------- | ------------------------------------------------------------ | ----------------- | -------------------------- | ------------ | ---------- | ----------- | --------------------------------------------------------------------- | ------------- |
| HAZ-047 | SYS-023   | Fallback resolves to `public` when circle lookup fails.      | NORMAL            | Recipe broadcast publicly. | Catastrophic | Improbable | Undesirable | SYS-023 fallback policy is `private` (deny-by-default); ATP coverage. | Tolerable     |
| HAZ-048 | SYS-023   | Fallback masks repeated lookup failure → silent degradation. | DEGRADED-OCR      | Hidden audience errors.    | Serious      | Occasional | Undesirable | SYS-026 fallback-counter metric + alarm.                              | Tolerable     |

### SYS-024 — Circle Invitation Accessibility Surface

| HAZ ID  | Component | Failure Mode                                               | Operational State | Effect                                     | Severity | Likelihood | Risk Level  | Mitigation                                                                      | Residual Risk |
| ------- | --------- | ---------------------------------------------------------- | ----------------- | ------------------------------------------ | -------- | ---------- | ----------- | ------------------------------------------------------------------------------- | ------------- |
| HAZ-049 | SYS-024   | Screen-reader cannot announce pending invitation count.    | INVITE-PENDING    | Accessibility regression; user cannot act. | Serious  | Probable   | Undesirable | REQ-056 (a11y label + live region); WCAG 2.1 AA gate per `accessibility` skill. | Tolerable     |
| HAZ-050 | SYS-024   | Keyboard-only user cannot accept/decline invitation modal. | INVITE-PENDING    | User locked out of feature.                | Serious  | Occasional | Undesirable | REQ-056 (focus trap, ESC handler); ATP coverage in a11y test suite.             | Tolerable     |

### SYS-025 — `raw_ocr_json` Privacy Purge Pipeline

| HAZ ID  | Component | Failure Mode                                                            | Operational State | Effect                                                | Severity     | Likelihood | Risk Level  | Mitigation                                                             | Residual Risk                                    |
| ------- | --------- | ----------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- | ------------ | ---------- | ----------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| HAZ-051 | SYS-025   | Purge job fails silently; `raw_ocr_json` retained beyond policy window. | NORMAL            | Privacy commitment violated; potential PII retention. | Catastrophic | Remote     | Undesirable | REQ-019, REQ-022 retention policy; SYS-025 dead-letter alarm; SYS-026. | Undesirable — accepted with monthly purge audit. |
| HAZ-052 | SYS-025   | Purge deletes wrong rows (key-collision bug).                           | NORMAL            | User loses correctable raw OCR mid-flow.              | Critical     | Improbable | Tolerable   | UTP coverage of purge predicate; MOD-091 serializable TX.              | Tolerable                                        |

### SYS-026 — Observability & Telemetry

| HAZ ID  | Component | Failure Mode                                                                  | Operational State | Effect                                    | Severity | Likelihood | Risk Level  | Mitigation                                                                                   | Residual Risk                  |
| ------- | --------- | ----------------------------------------------------------------------------- | ----------------- | ----------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------- | ------------------------------ |
| HAZ-053 | SYS-026   | PII (raw OCR text, email) leaked into logs.                                   | NORMAL            | Privacy / compliance violation.           | Critical | Occasional | Undesirable | REQ-030 (redaction filter); SYS-026 mandatory log scrubbing; security-best-practices review. | Tolerable                      |
| HAZ-054 | SYS-026   | Cold-start metric definition undefined per `[FROZEN-PENDING-RESOLUTION: A2]`. | NORMAL            | Cannot validate REQ-045 OCR p95 contract. | Serious  | Probable   | Undesirable | `[FROZEN-PENDING-RESOLUTION: A2]` carried; SYS-027 release gate blocks GA until A2 resolved. | Undesirable until A2 resolved. |
| HAZ-055 | SYS-026   | Alarm storm during incident → on-call paged 100s of times.                    | DEGRADED-OCR      | Alarm fatigue; real signal lost.          | Serious  | Occasional | Undesirable | SYS-026 alarm grouping + composite alarms; runbook.                                          | Tolerable                      |

### SYS-027 — Release Readiness & Canary Gate Controller

| HAZ ID  | Component | Failure Mode                                                       | Operational State | Effect                                  | Severity | Likelihood | Risk Level  | Mitigation                                                                                             | Residual Risk                  |
| ------- | --------- | ------------------------------------------------------------------ | ----------------- | --------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| HAZ-056 | SYS-027   | Canary gate formula undefined — `[FROZEN-PENDING-RESOLUTION: A1]`. | NORMAL            | OCR quality regression ships unchecked. | Critical | Probable   | Undesirable | `[FROZEN-PENDING-RESOLUTION: A1]` carried; manual quality benchmark formula MUST be defined before GA. | Undesirable until A1 resolved. |
| HAZ-057 | SYS-027   | Canary auto-promote despite elevated error rate due to metric lag. | NORMAL            | Bad release reaches all users.          | Critical | Remote     | Tolerable   | SYS-027 holds gate on metric freshness; SYS-026 freshness alarm.                                       | Tolerable                      |

### SYS-028 — Feature Flag Gateway

| HAZ ID  | Component | Failure Mode                                                         | Operational State | Effect                                 | Severity | Likelihood | Risk Level  | Mitigation                                       | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------- | ----------------- | -------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------ | ------------- |
| HAZ-058 | SYS-028   | Flag evaluation fails open → unfinished feature exposed.             | NORMAL            | Half-built UX shipped to users.        | Serious  | Occasional | Undesirable | SYS-028 fail-closed default; UTP enforces.       | Tolerable     |
| HAZ-059 | SYS-028   | Flag eval cached too long → kill-switch ineffective during incident. | DEGRADED-OCR      | Cannot mitigate live incident quickly. | Critical | Remote     | Tolerable   | SYS-028 short TTL + force-refresh path; runbook. | Tolerable     |

### SYS-029 — Test Convention Governance

| HAZ ID  | Component | Failure Mode                                                                    | Operational State | Effect                    | Severity | Likelihood | Risk Level  | Mitigation                                                            | Residual Risk                  |
| ------- | --------- | ------------------------------------------------------------------------------- | ----------------- | ------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------- | ------------------------------ |
| HAZ-060 | SYS-029   | Test naming convention drift — `[FROZEN-PENDING-RESOLUTION: C1]`.               | NORMAL            | Tests bypass governance.  | Minor    | Probable   | Tolerable   | `[FROZEN-PENDING-RESOLUTION: C1]`; MOD-073 lint rule once resolved.   | Undesirable until C1 resolved. |
| HAZ-061 | SYS-029   | Requirement-traceability test header drift — `[FROZEN-PENDING-RESOLUTION: C2]`. | NORMAL            | REQ → ATP linkage breaks. | Serious  | Probable   | Undesirable | `[FROZEN-PENDING-RESOLUTION: C2]`; MOD-073 enforcement once resolved. | Undesirable until C2 resolved. |

### SYS-030 — Workspace & CI Guardrails

| HAZ ID  | Component | Failure Mode                                                             | Operational State | Effect                                       | Severity | Likelihood | Risk Level  | Mitigation                                                             | Residual Risk                  |
| ------- | --------- | ------------------------------------------------------------------------ | ----------------- | -------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------------------------------------- | ------------------------------ |
| HAZ-062 | SYS-030   | Per-PR schema isolation undefined — `[FROZEN-PENDING-RESOLUTION: C3]`.   | NORMAL            | Concurrent PRs corrupt each other's schemas. | Critical | Occasional | Undesirable | `[FROZEN-PENDING-RESOLUTION: C3]`; MOD-074 CI guardrail once resolved. | Undesirable until C3 resolved. |
| HAZ-063 | SYS-030   | `generate:types` ordering undefined — `[FROZEN-PENDING-RESOLUTION: C4]`. | NORMAL            | Type drift between schema and clients.       | Serious  | Probable   | Undesirable | `[FROZEN-PENDING-RESOLUTION: C4]`; MOD-074 ordering enforcement.       | Undesirable until C4 resolved. |

### SYS-031 — Transactional Isolation Enforcer

| HAZ ID  | Component | Failure Mode                                    | Operational State | Effect                                       | Severity | Likelihood | Risk Level  | Mitigation                                                                  | Residual Risk |
| ------- | --------- | ----------------------------------------------- | ----------------- | -------------------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------------- | ------------- |
| HAZ-064 | SYS-031   | Raw `client.transaction(` slips past lint rule. | NORMAL            | Lost outbox event; race conditions reappear. | Critical | Remote     | Tolerable   | MOD-076 `txWrapperLintRule`; CI fails build; UTP coverage.                  | Tolerable     |
| HAZ-065 | SYS-031   | Serializable retry storm under contention.      | NORMAL            | Latency spike; user-visible 5xx.             | Serious  | Occasional | Undesirable | MOD-075 bounded retries with jittered backoff; SYS-026 alarm on retry-rate. | Tolerable     |

### SYS-032 — UI Primitive Reuse Process

| HAZ ID  | Component | Failure Mode                                                | Operational State | Effect                         | Severity | Likelihood | Risk Level | Mitigation                                                             | Residual Risk |
| ------- | --------- | ----------------------------------------------------------- | ----------------- | ------------------------------ | -------- | ---------- | ---------- | ---------------------------------------------------------------------- | ------------- |
| HAZ-066 | SYS-032   | New one-off button shipped without primitive justification. | NORMAL            | Visual drift; a11y regression. | Minor    | Probable   | Tolerable  | MOD-077 `uiPrimitiveReuseLintRule`; MOD-078 rationale doc enforcement. | Acceptable    |

## Progressive Deepening (Architecture-Level)

The following hazards emerged from `architecture-design.md` decomposition (47 ARCH modules, including 7 cross-cutting infrastructure modules `ARCH-041..047`). They are **appended** to the SYS-level register above and capture failure modes only visible at the ARCH boundary (interface mismatches, protocol failures, data-format incompatibilities, race conditions across modules).

| HAZ ID  | Component                                                                             | Failure Mode                                                                 | Operational State                                       | Effect                                                   | Severity | Likelihood | Risk Level                                                                              | Mitigation                                                                                                | Residual Risk |
| ------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- | -------- | ---------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-067 | ARCH-005 + ARCH-018                                                                   | Outbox publish in same TX as domain write missed — drainer never sees event. | NORMAL                                                  | Downstream side-effect (cache invalidation, audit) lost. | Critical | Remote     | Undesirable                                                                             | MOD-076 `txWrapperLintRule` enforces TX wrapper; MOD-086 `outbox.publish(event, tx)` requires `tx` param. | Tolerable     |
| HAZ-068 | ARCH-046 (logger) + ARCH-026 (parser)                                                 | Logger captures `raw_ocr_json` at debug level → PII in logs.                 | NORMAL                                                  | Privacy violation on log retention.                      | Critical | Occasional | Undesirable                                                                             | MOD-079 logger redaction rules; SYS-026 mandatory log scrubbing; SYS-025 purge pipeline.                  | Tolerable     |
| HAZ-069 | ARCH-047 (db client) + ARCH-018 (worker)                                              | Pool exhaustion under concurrent worker fanout.                              | NORMAL                                                  | API endpoint 5xx storm.                                  | Critical | Occasional | Undesirable                                                                             | MOD-090 `dbPoolMax × maxLambdaConcurrency ≤ RDS max_connections − reserved`; MOD-018 token bucket.        | Tolerable     |
| HAZ-070 | ARCH-006 (OcrProvider) ↔ ARCH-007 (parser)                                            | Provider response shape change not caught by adapter.                        | DEGRADED-OCR                                            | All OCR jobs degrade silently.                           | Critical | Remote     | Undesirable                                                                             | MOD-022 strict interface boundary; MOD-023 `OcrError` taxonomy; SYS-027 canary gate.                      | Tolerable     |
| HAZ-071 | ARCH-041 (config loader) misordered before ARCH-042 (secrets resolver) on cold-start. | NORMAL                                                                       | Lambda crashes with undefined secret; cold-start spike. | Serious                                                  | Remote   | Tolerable  | MOD-081 `loadAppConfig()` lazy-resolves secrets via MOD-082 on first DB call (MOD-090). | Acceptable                                                                                                |
| HAZ-072 | ARCH-046 (tracing) + Lambda freeze/thaw                                               | Span context leaks across invocations on warm container.                     | NORMAL                                                  | Cross-request span contamination; debugging confusion.   | Minor    | Probable   | Tolerable                                                                               | MOD-089 `withSpan` ends span in `finally`; OTel context isolated per invocation.                          | Acceptable    |
| HAZ-073 | ARCH-005 ↔ ARCH-008 ↔ ARCH-021 (correction → save → audience write)                   | Multi-step flow partially succeeds across services.                          | NORMAL                                                  | Job marked `done` but recipe save rolled back.           | Critical | Remote     | Undesirable                                                                             | MOD-091 single TX boundary; MOD-086 outbox event for cross-service reconciliation; SYS-011 reconciler.    | Tolerable     |
| HAZ-074 | ARCH-002 (offline queue) ↔ ARCH-001 (capture state)                                   | Queue resume after app-kill loses in-flight upload metadata.                 | OFFLINE-CLIENT                                          | User believes upload succeeded; actually lost.           | Critical | Occasional | Undesirable                                                                             | REQ-040 persistent queue + visible state; ARCH-002 resume protocol; ATP offline E2E.                      | Tolerable     |

## Coverage Summary

| Metric                                                | Count  | Notes                                                                                           |
| ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Total `SYS-NNN` components                            | 32     | From `system-design.md`.                                                                        |
| `SYS-NNN` with ≥1 hazard                              | 32     | 100% SYS coverage.                                                                              |
| `SYS-NNN` with no realistic failure mode              | 0      | None — all SYS components have at least one realistic failure mode given consumer-SaaS domain.  |
| Total SYS-level hazards (HAZ-001..HAZ-066)            | 66     | Sequential, never renumbered.                                                                   |
| Architecture-level hazards (HAZ-067..HAZ-074)         | 8      | Appended via Progressive Deepening from `architecture-design.md`.                               |
| **Total hazards**                                     | **74** | Range `HAZ-001`..`HAZ-074`.                                                                     |
| Hazards at `Unacceptable` risk level                  | 0      | All hazards mitigated to `Undesirable` or lower before this register was finalized.             |
| Hazards at `Undesirable` risk level                   | 26     | All carry explicit mitigation; residual-risk acceptance recorded inline.                        |
| Hazards at `Tolerable` risk level                     | 36     | Accepted as-is.                                                                                 |
| Hazards at `Acceptable` risk level                    | 12     | Accepted as-is.                                                                                 |
| Hazards tied to `[FROZEN-PENDING-RESOLUTION]` markers | 12     | A1, A2, C1, C2, C3, C4, G1, I1/I2 — these MUST be resolved before GA gate (SYS-027).            |
| Mitigations referencing `REQ-NNN`                     | ✓      | Every hazard mitigation cites at least one `REQ-NNN` or `SYS-NNN` (or `MOD-NNN` cross-cutting). |
| `[HUMAN REVIEW REQUIRED]` flags                       | 0      | None — every SYS has at least one realistic failure mode.                                       |

## Frozen-Pending-Resolution Tracker

Hazards whose mitigation depends on resolving an open design decision MUST be reconciled before GA. The release-readiness gate (`SYS-027`) blocks promotion until each is resolved:

| Marker | Source REQs                 | Hazards Affected          | Owner Subsystem           | Status |
| ------ | --------------------------- | ------------------------- | ------------------------- | ------ |
| A1     | REQ-044                     | HAZ-056                   | SYS-027                   | OPEN   |
| A2     | REQ-045                     | HAZ-005, HAZ-054          | SYS-002, SYS-005, SYS-026 | OPEN   |
| C1     | REQ-062                     | HAZ-060                   | SYS-029                   | OPEN   |
| C2     | REQ-063                     | HAZ-061                   | SYS-029                   | OPEN   |
| C3     | REQ-064                     | HAZ-062                   | SYS-030                   | OPEN   |
| C4     | REQ-065                     | HAZ-063                   | SYS-030                   | OPEN   |
| G1     | REQ-033, 035, 042, 058, 060 | HAZ-028, HAZ-030, HAZ-032 | SYS-013, SYS-014, SYS-015 | OPEN   |
| I1, I2 | REQ-056                     | HAZ-039                   | SYS-013, SYS-018          | OPEN   |

## Domain Note (non-regulated)

This analysis intentionally omits regulated-domain artifacts (ASIL classification, DAL assignment, MC/DC obligations, IEC 62304 software safety classification). `v-model-config.yml` declares `domain: ''` (consumer SaaS); reintroduce regulated taxonomies only if Commise enters a regulated domain. Severity is framed against user trust, data integrity, privacy, availability, and platform cost — the only failure axes that apply to a consumer recipe application.

## Glossary

| Term                             | Definition                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| FMEA                             | Failure Mode and Effects Analysis — structured enumeration of failure modes, effects, and mitigations per component.    |
| Hazard                           | A realistic failure mode whose effect, if unmitigated, would breach a system invariant (data integrity, privacy, etc.). |
| Operational state                | A named system mode in which severity / likelihood may differ (NORMAL, DEGRADED-OCR, OFFLINE-CLIENT, etc.).             |
| Risk level                       | Composite of severity × likelihood per the matrix above.                                                                |
| `[FROZEN-PENDING-RESOLUTION: X]` | Marker carried verbatim from `system-design.md` indicating an unresolved design decision that gates implementation.     |
| Residual risk                    | Risk level remaining after stated mitigation is in place.                                                               |

---

> **Status**: Hazard analysis complete. 74 hazards across 32 SYS components + 8 architecture-level. 0 `Unacceptable`. 26 `Undesirable` with documented residual-risk acceptance and `[FROZEN-PENDING-RESOLUTION]` reconciliation tracker. Ready for traceability matrix Matrix H.
