# Implementation Plan: Recipe Digitization & Family Circles

**Branch**: `011-recipe-digitization` | **Date**: 2026-05-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-recipe-digitization/spec.md`

---

## Summary

Feature 011 delivers a photo-to-recipe digitization pipeline and a private Circle sharing primitive, with OCR async processing, side-by-side correction UX, and reusable audience contracts for features 001/006/007.

Planned implementation introduces four new packages (`@kitchensink/digitization-workers`, `@kitchensink/digitization-service`, `@kitchensink/circles-service`, `@kitchensink/audience`), adds Drizzle schema for circles and digitization jobs, extends recipe audience/versioning persistence, and deploys AWS infrastructure (Lambda + SQS/DLQ + S3 + CloudFront + RDS-backed APIs) aligned to 001/002 patterns.

**Must Have stories addressed**: US-001, US-002, US-003, US-004, US-005, US-006.

---

## Phase 0 Research Summary

- Competitive/UX research confirms correction UX quality is the differentiator vs OCR-only competitors.
- Codebase research identifies these required packages and contracts:
    - `@kitchensink/digitization-workers` (Lambda worker)
    - `@kitchensink/digitization-service` (NestJS)
    - `@kitchensink/circles-service` (NestJS)
    - `@kitchensink/audience` (shared types/guards for 001/006/007)
- Existing repo workspace layout registers `packages/tools/*`, `packages/services/*`, `packages/shared/*`, `packages/utils/*`, `packages/infra/*`, `packages/clients/*`, `packages/apps/commise/{web,mobile,ui,i18n}`, and `packages/apps/commise/features/*`. `packages/shared/*` **is** workspace-registered and already ships `clerk-verify`, `identity-core`, `identity-db`, and `recipe-core`. The empty leftover directory is `packages/api/`, which is **not** a workspace root — new backend services belong under `packages/services/<domain>-service`.

---

## Phase 1 Design Notes

- Canonical API contract follows `spec.md` (`/api/v1/recipes/digitize/*`, `/api/v1/circles/*`) with Clerk auth model inherited from 002.
- OCR path remains provider-pluggable; Textract default in v1 with circuit-breaker and degraded-mode queue retry.
- Circle invitations follow clarified reusable-link semantics (C-001), idempotent redemption, revocation by rotation.
- Circle deletion and owner deletion semantics are explicit and transactional (C-002, C-004).
- Data minimization/privacy enforced by `raw_ocr_json` 90-day purge pipeline (C-005).

### `OcrProvider` Interface Contract (added 2026-05-10 per pre-impl C-A-001)

The OCR pipeline is provider-pluggable. T093 defines the canonical interface in `packages/services/digitization-workers/src/providers/ocr-provider.interface.ts`; T050 (Textract adapter) and any future provider (Q-001 deferred) MUST implement it.

```ts
export interface OcrInput {
    jobId: string;
    s3Bucket: string;
    s3Key: string;
    contentType: 'image/jpeg' | 'image/png' | 'image/heic';
    hintLanguage?: string; // ISO-639-1, optional
    timeoutMs: number; // hard upper bound, provider must respect
}

export interface OcrTokenConfidence {
    text: string;
    confidence: number; // 0..1, normalized across providers
    bbox?: { x: number; y: number; w: number; h: number };
}

export interface OcrResult {
    rawProviderJson: unknown; // persisted to raw_ocr_json (90d retention)
    tokens: OcrTokenConfidence[];
    overallConfidence: number; // 0..1, derived per provider rules
    detectedLanguage?: string; // ISO-639-1
    pageCount: number;
}

export type OcrError =
    | { kind: 'TIMEOUT'; providerLatencyMs: number }
    | { kind: 'PROVIDER_UNAVAILABLE'; retriable: true; cause?: string }
    | { kind: 'INVALID_INPUT'; retriable: false; reason: string }
    | { kind: 'QUOTA_EXCEEDED'; retriable: true; retryAfterMs?: number }
    | { kind: 'UNKNOWN'; retriable: boolean; cause?: string };

export interface OcrProvider {
    readonly name: 'textract' | string;
    process(input: OcrInput): Promise<OcrResult>; // throws OcrError as Error subclass
}
```

Confidence normalization rule: providers that emit 0–100 scores MUST divide by 100 before returning. Token-level confidence is required when the provider supports it (Textract does); when absent, `tokens` is empty and `overallConfidence` falls back to the provider's document-level score.

### Transactional Isolation (added 2026-05-10 per pre-impl C-A-003)

Two paths require strict isolation:

- **FR-033 — Circle deletion → audience revert**: SERIALIZABLE transaction OR REPEATABLE READ with `SELECT … FOR UPDATE` on the `circles` row and every affected `recipes` row. Implementation in T033 deletion service; integration test in T095.
- **FR-035 — Owner-account deletion → promotion/soft-delete**: same isolation guarantee, with `FOR UPDATE` on the owner's `circles` rows ordered by `id` to prevent deadlock against concurrent invite redemption (T031). Implementation in T034; integration test in T095 covers concurrent owner deletion + invite redemption + recipe audience write.

---

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24.x
**Primary Dependencies**: NestJS 11, Drizzle ORM, `pg`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sqs`, AWS Textract SDK client, `@aws-lambda-powertools/logger`, `@sentry/aws-serverless`, Clerk networkless session-token verification stack from 002 (`@clerk/backend` `verifyToken` with `CLERK_JWT_KEY` + `CLERK_AUTHORIZED_PARTIES`)
**Storage**: RDS PostgreSQL 16, S3 objects (`digitization/...`), SQS + DLQ, CloudFront edge delivery of archived originals
**Testing**: Vitest (unit/integration/contract), Playwright + accessibility checks for web/mobile flows
**Target Platform**: AWS Lambda + NestJS APIs, web + mobile clients consuming API
**Project Type**: Monorepo, multi-package backend/shared + app clients
**Performance Goals**: NFR-001 p95 OCR latency ≤ 10s (4MB cold start), non-blocking upload/OCR queue behavior (NFR-006)
**Constraints**: `/api/v1/*` route convention, Clerk session-token auth, no proxied binary upload, RFC7807 errors, WCAG 2.1 AA
**Scale/Scope**: MVP must-have stories + should-have OCR queue/circle management support, with outlier alarms and purge jobs

---

## Constitution Check

| #   | Principle                       | Status  | Notes                                                                                                                                                                                              |
| --- | ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Correctness & Type Safety       | ✅ Pass | Strict TS required in all new packages; no `any`; typed RFC7807 DTOs and event payloads.                                                                                                           |
| II  | Readability & JSDoc             | ✅ Pass | Plan requires module-level and export-level JSDoc in all new TS modules.                                                                                                                           |
| III | Code Organization & Imports     | ✅ Pass | `packages/services/*` and `packages/shared/*` are already registered workspace globs; new directories under them are picked up automatically. Alias/TS project references still added per package. |
| IV  | Testing Discipline              | ✅ Pass | Pyramid + explicit integration/contract/a11y critical-path tests included.                                                                                                                         |
| V   | Monorepo & Workspace Governance | ✅ Pass | No root `workspaces` change required — the globs already cover both new package roots.                                                                                                             |
| VI  | Formatting & Tooling            | ✅ Pass | Turbo/ESLint/Prettier/typecheck gates inherited; generate/types ordering enforced by workspace scripts.                                                                                            |
| VII | Accessibility & UX Consistency  | ✅ Pass | NFR-004 encoded with role/label requirements and assistive tech acceptance paths.                                                                                                                  |

---

## Project Structure

Proposed structure, placed under the workspace roots the repo already registers:

```text
packages/
  services/
    digitization-service/       # package: @kitchensink/digitization-service
    circles-service/            # package: @kitchensink/circles-service
    digitization-workers/       # package: @kitchensink/digitization-workers  (Lambda OCR worker)
  shared/
    audience/                   # package: @kitchensink/audience
```

**Naming validation**:

- Placement follows the shipped convention: deployable HTTP services live in `packages/services/<domain>-service`
  (cf. `food-service`, `recipe-service`) and Lambda/worker bundles in `packages/services/<domain>-workers`
  (cf. `recipe-workers`), with shared libraries in `packages/shared/<name>` (cf. `recipe-core`).
- Package names follow the shipped `@kitchensink/<name>` form. Note this does **not** match GR-009's
  `@kitchensink/{group}-{name}` pattern — no shipped package does. See the GR-009 note in
  [`../governance-rules.md`](../governance-rules.md#gr-009-package-naming-convention); that rule needs
  ratification against reality and is tracked as an open governance item, not silently satisfied here.
- **No workspace-glob change is required.** `packages/services/*` and `packages/shared/*` are both already
  registered in the root `package.json` (an earlier revision of this plan claimed they were excluded — that
  was incorrect and is corrected here). New directories under those roots are picked up automatically.

---

## Architecture / Data Model

### Service Topology

1. Client requests job creation (`digitization-api`) → pre-signed S3 PUT URL returned (FR-001, FR-027, NFR-002).
2. Client uploads directly to S3 (`digitization/{user_id}/{job_id}/original.ext`).
3. Job enqueued to SQS (`digitization-ocr` queue), Lambda worker processes OCR (FR-006, FR-013, NFR-006).
4. Worker stores `raw_ocr_json`, `parsed_json`, confidence data, and status transitions.
5. User opens correction screen, submits corrections, then saves recipe to 001-owned recipe entity (`recipe_id` link).
6. Circle lifecycle and audience resolution handled by `circles-api` + `shared-audience`.

### Story Coverage by Architectural Slice

- Capture + OCR + correction: US-001, US-002, US-007, US-008, US-009
- Circle create/invite/join/share/read access: US-003, US-004, US-005, US-006, US-010, US-011

### Drizzle Schema Additions / Changes

1. `circles`
    - `id`, `owner_user_id`, `name`, `invite_token_hash`, `created_at`, `updated_at`, `deleted_at`
2. `circle_members`
    - composite PK (`circle_id`, `user_id`), `role`, `joined_at`, `removed_at`
3. `circle_invites` (rotation/audit history, including revoked links)
    - `id`, `circle_id`, `token_hash`, `created_by`, `revoked_at`, `last_redeemed_at`
4. `digitization_jobs`
    - `id`, `user_id`, `batch_id`, `s3_key`, `state`, `low_quality`, `language_code`, `raw_ocr_json`, `parsed_json`, `recipe_id`, `created_at`, `updated_at`, `deleted_at`
5. Recipe extension (feature 001 entity)
    - `recipes.audience` JSONB contract: `{"scope":"private|circle|public","ref_id":string|null}` (no `price_cents` — GR-014 v3.0.0)
6. `recipe_versions`
    - append-only version rows for correction/save changes (supports archival/audit behavior)
7. Raw OCR retention
    - daily purge process updates `digitization_jobs.raw_ocr_json = NULL` for rows older than 90 days (FR-036, NFR-008)

### Migration Notes

- Include indexes:
    - `digitization_jobs(user_id, created_at DESC)`
    - `digitization_jobs(state, created_at)`
    - `circle_members(user_id, circle_id)`
    - partial index for `circles(deleted_at IS NULL)`
- Circle deletion rewrite (FR-033) and owner-deletion promotion (FR-035) must execute in DB transaction boundaries.

---

## API Contracts

Auth model for all endpoints: **Clerk session token required** (feature 002), verified networklessly by `AuthMiddleware`/`ClerkAuthService` (`@clerk/backend` `verifyToken` against `CLERK_JWT_KEY`, with `azp` enforced via `CLERK_AUTHORIZED_PARTIES`), except the invitation token itself is path data and still requires an authenticated user to redeem.

### `@kitchensink/digitization-service` (NestJS)

| Method | Path                                           | Auth           | Purpose                                     | FR             |
| ------ | ---------------------------------------------- | -------------- | ------------------------------------------- | -------------- |
| POST   | `/api/v1/recipes/digitize/jobs`                | Bearer (Clerk) | Create job + pre-signed PUT URL             | FR-001, FR-027 |
| GET    | `/api/v1/recipes/digitize/jobs`                | Bearer         | List jobs (cursor pagination, page size 20) | FR-028         |
| GET    | `/api/v1/recipes/digitize/jobs/:id`            | Bearer         | Job status/result retrieval                 | FR-013, FR-029 |
| PATCH  | `/api/v1/recipes/digitize/jobs/:id/correction` | Bearer         | Submit inline corrections                   | FR-015         |
| POST   | `/api/v1/recipes/digitize/jobs/:id/save`       | Bearer         | Persist recipe + link `recipe_id`           | FR-021         |
| DELETE | `/api/v1/recipes/digitize/jobs/:id`            | Bearer         | Soft-delete/discard job                     | FR-022         |

### `@kitchensink/circles-service` (NestJS)

| Method | Path                                    | Auth         | Purpose                            | FR                                |
| ------ | --------------------------------------- | ------------ | ---------------------------------- | --------------------------------- |
| POST   | `/api/v1/circles`                       | Bearer       | Create Circle                      | FR-031 (creation context), US-003 |
| GET    | `/api/v1/circles`                       | Bearer       | List owned/member circles          | US-003/US-004 journey             |
| GET    | `/api/v1/circles/:id`                   | Bearer       | Circle details + members           | US-003/US-006                     |
| PATCH  | `/api/v1/circles/:id`                   | Bearer owner | Rename Circle                      | US-011                            |
| DELETE | `/api/v1/circles/:id`                   | Bearer owner | Delete Circle + audience revert    | FR-033                            |
| POST   | `/api/v1/circles/:id/invitation/rotate` | Bearer owner | Revoke/rotate reusable invite link | FR-031, C-001                     |
| POST   | `/api/v1/circles/join/:token`           | Bearer       | Join via invitation (idempotent)   | FR-032                            |
| DELETE | `/api/v1/circles/:id/members/:userId`   | Bearer owner | Remove member                      | US-010                            |

### Error Contract

- RFC 7807 Problem Details envelope on all 4xx/5xx (FR-030)
- Machine-readable `error_code` required for revoked invite, forbidden audience, validation failures, payload constraints.

---

## Frontend Components

### Web + Mobile UX Surfaces

1. **Digitization Upload Surface** (US-001, US-007; FR-001..FR-005)
2. **Correction Workspace (side-by-side)** (US-002, US-008, US-009; FR-014..FR-017, FR-023, FR-025)
3. **Circle Management** (US-003, US-010, US-011; FR-031..FR-035)
4. **Invite Acceptance Flow** (US-004; FR-026, FR-032)
5. **Audience Picker Integration into recipe save/share** (US-005, US-006)

### Accessibility Requirements (explicit)

- All inputs accessible by role/label and keyboard-only flow for queue + invite acceptance.
- Confidence indicators use icon+label+color; no color-only signaling.
- WCAG 2.1 AA gates in CI and manual assistive-tech pass on correction/invite workflows.

---

## Backend Services

### `@kitchensink/digitization-workers` Lambda

- SQS-triggered worker, batched receive with partial failure reporting.
- Calls Textract adapter with timeout budget and fallback states (`awaiting-correction + low_quality`).
- Writes parsed artifacts and confidence map to DB via internal API/DB client.
- Emits metrics and structured logs per job.

### `@kitchensink/digitization-service`

- Job orchestration, pre-signed URL minting, correction persistence, save/discard.
- Enforces file constraints before issuing upload URLs.
- Owns pagination/status/rfc7807 contracts.

### `@kitchensink/circles-service`

- Circle CRUD, invitation token rotation/redeem, member management.
- Audience resolution service consumed by 001/006/007 through `@kitchensink/audience` contracts.
- Handles owner deletion promotion semantics and deletion cascade behavior.

### `@kitchensink/audience`

- Exports `AudienceScope`, `Audience`, validators/guards, and helper resolvers.
- Shared contract test matrix with 001/006/007 to prevent drift.

---

## Migrations / Schema Changes

1. Create `circles`, `circle_members`, `circle_invites`, `digitization_jobs`, `recipe_versions`.
2. Alter `recipes` to include/normalize `audience` JSONB with circle scope support.
3. Add constraints:
    - one active invite per circle (enforced via active-token uniqueness strategy)
    - idempotent membership (`circle_id,user_id` PK)
4. Add transactional SQL routines for:
    - Circle delete audience fallback to private (FR-033, C-002)
    - Owner deletion promotion (FR-035, C-004)
5. Add scheduled purge operation for `raw_ocr_json` > 90d (FR-036, NFR-008).

---

## Resilience & Failure Handling

- **OCR timeouts/retries**: worker timeout budget + exponential backoff via SQS redrive policy; poison messages to DLQ with alarm (NFR-006).
- **Circuit breaker (OCR provider)**: open on repeated provider faults; jobs transitioned to retry/degraded queue state; no silent drop.
- **Idempotency**:
    - Invite redemption (`POST /api/v1/circles/join/:token`) idempotent for existing members (FR-032).
    - Save/correction operations use optimistic version checks on job state.
- **Public endpoint protections**: request throttling/rate limits on job creation and invitation redeem routes.
- **Transactional safety**: FR-033/FR-035 operations execute as atomic DB transactions with audit logging.

---

## Privacy, Data Lifecycle & Compliance

- `raw_ocr_json` is treated as sensitive OCR source artifact; auto-null/purge at 90d (FR-036, NFR-008, C-005).
- Circle membership changes and lifecycle events are audit-logged (NFR-003).
- Circle deletion reverts shared recipe audience to `private` in same transactional unit (FR-033, C-002).
- Owner deletion promotes oldest member or soft-deletes empty circle (FR-035, C-004).
- Reusable invitation link revoke/rotate behavior enforced and old token returns 410 (FR-031, FR-032, C-001).

---

## Observability

- Structured logging via Powertools logger (request/job IDs, user_id, circle_id, correlation_id).
- Sentry instrumentation for API and OCR Lambda exception tracking.
- Metrics:
    - OCR latency histogram
    - OCR confidence histogram (token confidence buckets)
    - queue depth, DLQ depth, retry counts
    - invite redemption outcomes (accepted/idempotent/revoked)
    - purge counts (`digitization.raw_ocr.purged.count`)
- Dashboards/alarms aligned to NFR-001, NFR-006, NFR-007, NFR-008.

---

## Deployment / Infrastructure (CDK v2)

### Stacks

1. **DigitizationDataStack**
    - S3 bucket for digitization originals
    - CloudFront distribution for controlled serving
    - lifecycle policy hooks for retention defaults
2. **DigitizationProcessingStack**
    - SQS queue + DLQ
    - OCR Lambda (`@kitchensink/digitization-workers`)
    - IAM least-privilege policies for S3 read, Textract, SQS consume, metrics/logs
3. **DigitizationApiStack**
    - NestJS service deployment (aligned with existing app infra pattern)
    - endpoint routing under `/api/v1/recipes/digitize/*`
4. **CirclesApiStack**
    - NestJS service deployment for `/api/v1/circles/*`
5. **SharedDataStack extension**
    - RDS Postgres schema migration orchestration resources
    - scheduled jobs (EventBridge Scheduler) for outlier alarm scans + OCR purge

**Retention policy note**: if any S3 cleanup behavior differs by environment, non-prod may allow auto-destroy while production retains data by policy.

---

## Testing Strategy

### Test Pyramid

- **Unit**: parsers, DTO validation, audience guards, token rotation logic.
- **Integration**: OCR pipeline (S3 upload event → SQS → Lambda → DB state), circle lifecycle transactions, owner-deletion promotion.
- **Contract**: `@kitchensink/audience` consumer contract tests for 001/006/007 compatibility.
- **E2E/UX**: correction flow + invite acceptance (web/mobile), including accessibility assertions.

### Critical Path Test Mapping

- US-001/US-002: upload → OCR parse → correction → save
- US-003/US-004: create circle → rotate invite → redeem link idempotently
- US-005/US-006: audience share/read enforcement
- C-002/C-004/C-005: deletion/promotion/purge jobs

### Coverage Goals

- `digitization-api` ≥85%
- `digitization-ocr` ≥80%
- `circles-api` ≥90%
- `shared-audience` 100% type/guard/contract surface

---

## FR Coverage Matrix

| Requirement Group   | IDs            | Planned In                                                 |
| ------------------- | -------------- | ---------------------------------------------------------- |
| Capture             | FR-001..FR-005 | Digitization API + upload client surfaces                  |
| OCR & Parsing       | FR-006..FR-013 | OCR Lambda + job state machine + polling APIs              |
| Review & Correction | FR-014..FR-018 | Correction UI + correction/save endpoints                  |
| Storage & Archive   | FR-019..FR-022 | S3/CloudFront + digitization_jobs + save/discard semantics |
| Accessibility       | FR-023..FR-026 | UI component accessibility + CI gates                      |
| API Contract        | FR-027..FR-030 | Versioned routes, pagination, job status, RFC7807 envelope |
| Circle Lifecycle    | FR-031..FR-035 | circles-api + transactional audience/member semantics      |
| Data Retention      | FR-036         | Scheduled purge + metric emission                          |

---

## NFR Coverage Matrix

| NFR     | Implementation Coverage                                      |
| ------- | ------------------------------------------------------------ |
| NFR-001 | OCR Lambda performance instrumentation + p95 dashboard/alarm |
| NFR-002 | Direct pre-signed S3 upload path; no API binary proxy        |
| NFR-003 | Membership/lifecycle audit events and structured logs        |
| NFR-004 | A11y-first component contracts + CI/manual verification      |
| NFR-005 | `/api/v1/*` contracts + Node 24 runtime baseline             |
| NFR-006 | SQS async pipeline, DLQ, queue alarms, retry behavior        |
| NFR-007 | Outlier detector job + 1-hour alarm window                   |
| NFR-008 | Daily 90-day purge job + purge metrics                       |

---

## Risks

| ID    | Risk                                                                              | Impact | Mitigation                                                               |
| ----- | --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| R-001 | OCR quality variance on difficult handwriting                                     | High   | Confidence highlighting + low-quality fallback + test corpus calibration |
| R-002 | Workspace registration drift for new packages                                     | Medium | Explicit root workspace updates + CI package discovery checks            |
| R-003 | Endpoint naming mismatch between legacy product-spec API table and canonical spec | Medium | Canonicalize to `spec.md`; provide migration aliases if needed           |
| R-004 | Circle lifecycle transactional complexity                                         | High   | Integration tests on FR-033/FR-035 transaction guarantees                |
| R-005 | Retention and purge job failure causing data over-retention                       | High   | Daily alarms on stale records + purge count metrics                      |

---

## Open Questions

No blocking open questions for Phase 5 approval.

Implementation-time decisions explicitly deferred/approved in `review.md` (provider tuning, entitlement gating, language rollout, queue sizing specifics) and will be resolved during tasks/pre-impl-review without blocking this technical plan.

---

## Cross-Validation vs product-spec

| Check                                                       | Status | Notes                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All Must Have user stories addressed in plan?               | ✅     | US-001..US-006 explicitly mapped in architecture, API, frontend/backend, and test sections.                                                                                                                      |
| Technical integration matches codebase-analysis findings?   | ✅     | All required packages from research included (`digitization-ocr`, `digitization-api`, `circles-api`, `shared-audience`) with consumer mapping for 001/006/007.                                                   |
| No unresolved open questions from product-spec?             | ✅     | Product-spec open questions were formally deferred and approved in `review.md`; no Phase 5 blocker remains.                                                                                                      |
| Data model / schema aligned with product-spec requirements? | ✅     | Includes circles, members, invites, digitization jobs, audience JSONB, recipe_versions, and raw OCR retention handling.                                                                                          |
| Non-functional requirements (perf, security) addressed?     | ✅     | NFR-001..NFR-008 each mapped to concrete implementation and observability strategy.                                                                                                                              |
| API contracts consistent with product-spec user journeys?   | ⚠️     | Product-spec API table uses `/api/v1/digitization/jobs`; canonical `spec.md` uses `/api/v1/recipes/digitize/jobs`. Plan follows authoritative `spec.md`; aliasing can be added if backward compatibility needed. |
| Workspace/package naming and registration consistency       | ⚠️     | Package names are compliant, but root workspace globs must be extended for `packages/services/*` and `packages/shared/*`.                                                                                        |

---

## Constitution Compliance

| Area                           | Check                                                    | Status | Notes                                                                                          |
| ------------------------------ | -------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Resilience & External Services | Every external service call has resilience strategy      | ✅     | Textract calls include retry/circuit-breaker/degraded state and DLQ path.                      |
| Resilience & External Services | Rate limiting addressed for public-facing endpoints      | ✅     | Job creation and invite redemption rate limits included in plan.                               |
| Resilience & External Services | Timeout configuration mentioned for external calls       | ✅     | OCR timeout budget and queue retry windows specified.                                          |
| Data & Privacy                 | Data deletion handler included where user data is stored | ✅     | Owner deletion flow (FR-035), circle delete fallback (FR-033), OCR purge (FR-036).             |
| Data & Privacy                 | Sensitive data fields + protection strategy described    | ✅     | `raw_ocr_json`, invite tokens, audit events identified with retention/hash/log discipline.     |
| Testing                        | Coverage targets specified per module                    | ✅     | Coverage targets defined for all new packages.                                                 |
| Testing                        | Integration test strategy described                      | ✅     | OCR pipeline + transactional circle lifecycle integration tests included.                      |
| Testing                        | At least one test case per critical path                 | ✅     | Critical path mapping for upload/correction/invite/share/deletion/purge provided.              |
| EDA                            | Event handlers do not throw to bus                       | ✅     | Worker error strategy uses catch/log/retry/DLQ, no event-bus propagation.                      |
| EDA                            | Events emitted only after persistence                    | ✅     | Plan requires transactional persistence before audit/domain event emission.                    |
| EDA                            | Correlation/trace IDs in event payloads                  | ✅     | Observability section mandates correlation IDs in logs/events.                                 |
| EDA                            | New events listed as planned work                        | ✅     | `circle.deleted`, `recipe.audience.changed`, `circle.size.outlier`, purge metrics captured.    |
| Code Quality                   | No circular dependencies introduced                      | ✅     | Shared audience package isolates shared contracts; APIs depend on shared, not vice versa.      |
| Code Quality                   | Function/module size conventions respected               | ⚠️     | Enforcement deferred to implementation lint/test gates; plan sets requirement but no code yet. |
