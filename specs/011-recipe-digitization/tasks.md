# Tasks: Feature 011 — Recipe Digitization & Family Circles

**Feature**: `011-recipe-digitization`
**Generated**: 2026-06-02
**Source artifacts**: `plan.md`, `spec.md`, `product-spec/product-spec.md`, `pre-impl-review.md`
**Pre-impl-review decisions honored**: C-A-001 (OcrProvider interface → T-093), C-A-002 (CI workspace guard → T-094), C-A-003 (transactional isolation spec + race test → T-095), C-D-002 (offline-failure retry UI → T-096), C-D-004 (UI primitives enumeration → T-097), C-R-001 (Circle soft-delete 30-day retention → T-098), C-R-002 (feature flags + canary gates → T-099, T-100)

---

## User Stories Reference

| ID         | Title                             | Priority | Acceptance (summary)                                                                      |
| ---------- | --------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| **US-001** | Photo Import of a Recipe Card     | P0       | Upload → OCR → correction screen with editable parsed fields                              |
| **US-002** | Side-by-side Correction           | P0       | Original photo + parsed fields visible simultaneously; inline edits via PATCH             |
| **US-003** | Create a Circle and Invite Family | P1       | Named Circle created; single reusable invite link; rotation revokes old link (410)        |
| **US-004** | One-tap Invitation Acceptance     | P1       | Join via link is keyboard/screen-reader accessible; idempotent; immediate browse access   |
| **US-005** | Share a Recipe to Circles         | Must     | Audience picker lists Private + Circles; attaches `audience: { scope: 'circle', ref_id }` |
| **US-006** | Member Read-Only Access           | Must     | Member PATCH → 403; read access granted via Circle membership                             |
| **US-007** | Bulk Import from a Cookbook       | P2       | Up to 20 photos/session (`batch_id`); queue surfaces remaining count                      |
| **US-008** | Low-confidence Token Highlighting | P2       | Low-confidence tokens distinguished by color + icon/label; tap to edit                    |
| **US-009** | Accept-All for Clean Scans        | P2       | Enabled only when zero low-confidence tokens; commits parsed output unchanged             |
| **US-010** | Remove Circle Members             | P2       | Owner-only DELETE; removed member loses read access on next request                       |
| **US-011** | Rename a Circle                   | P2       | Owner-only PATCH; name propagates to all members immediately                              |

---

## Dependency Graph

```text
Workspace (T-001..T-007, T-093, T-094, T-097, T-099)
  -> Schema / Migrations (T-008..T-018)
    -> Shared Audience (T-019..T-025)
      -> Wire Contracts (T-101..T-104)          <- BOTH services, before their first endpoint
        -> Circles API (T-026..T-036, T-098)
        -> Digitization API (T-037..T-048)
          -> OCR Lambda (T-049..T-056)
            -> Typed Clients (T-105..T-108)
              -> Frontend (T-057..T-067, T-096)
                -> Integration Tests (T-068..T-073)
                  -> E2E Tests (T-074..T-076)
    -> Observability (T-077..T-081)
    -> Privacy / Cleanup (T-082..T-084)
Workspace + Schema + APIs + OCR + Frontend -> Deployment / CDK (T-085..T-092)
```

⛔ **T-101…T-104 gate T-027 and T-038** (each service's first endpoint). A new deployable that lands without its
schema package, its `CONTRACT_HASH` boot assertion or `nestjs-zod`'s pipe is **in violation on day one** —
GR-017 §17-a's obligations are not deferred to "when it has clients".

---

## Phase 1 — Setup

- [ ] **T-001\*\*** Add workspace globs for `packages/services/*` and `packages/shared/*` in root `package.json` so new 011 packages are discoverable by Turborepo and package manager; **Files**: `package.json`. **Depends on**: none. [FR-027, NFR-005]
- [ ] **T-002\*\*** [P] Scaffold `packages/services/digitization-service` package config (`package.json`, `tsconfig*.json`, `vitest.config.ts`, `eslint.config.js`) with Node 24/NestJS 11 baseline; **Files**: `packages/services/digitization-service/*`. **Depends on**: T001. [US-001, FR-027, NFR-005]
- [ ] **T-003\*\*** [P] Scaffold `packages/services/circles-service` package config (`package.json`, `tsconfig*.json`, `vitest.config.ts`, `eslint.config.js`) with Clerk session-token middleware conventions from 002; **Files**: `packages/services/circles-service/*`. **Depends on**: T001. [US-003, FR-031, NFR-005]
- [ ] **T-004\*\*** [P] Scaffold `packages/services/digitization-workers` Lambda workspace with build/test scripts and Node 24 runtime config; **Files**: `packages/services/digitization-workers/*`. **Depends on**: T001. [US-001, FR-006, NFR-005]
- [ ] **T-005\*\*** [P] Scaffold `packages/shared/audience` package and export surface placeholders for `AudienceScope`/`Audience`; **Files**: `packages/shared/audience/*`. **Depends on**: T001. [US-005, FR-031]
- [ ] **T-006\*\*** Register TS path aliases and project references for new packages in root/base tsconfig files used by API/web/mobile workspaces; **Files**: `tsconfig*.json`, package-level `tsconfig.json`. **Depends on**: T002, T003, T004, T005. [FR-027, NFR-005]
- [ ] **T-007\*\*** [P] Add feature-level env schema placeholders and `.env.example` entries for S3/SQS/Textract/CloudFront and invite token settings; **Files**: `packages/services/digitization-service/src/config/*`, `packages/services/circles-service/src/config/*`, `packages/services/digitization-workers/src/config/*`, `.env.example*`. **Depends on**: T002, T003, T004. [FR-006, FR-019, NFR-001, NFR-006]

---

## Phase 2 — Schema / Migrations

- [ ] **T-008\*\*** Create Drizzle migration for `circles` table (`id`, `owner_user_id`, `name`, `invite_token_hash`, timestamps, `deleted_at`) and active-circle partial index; **Files**: `packages/services/circles-service/src/db/migrations/011_001_create_circles.sql`, `packages/services/circles-service/src/db/schema/circles.ts`. **Depends on**: T003. [US-003, FR-031, FR-033]
- [ ] **T-009\*\*** [P] Create Drizzle migration for `circle_members` table with composite PK `(circle_id,user_id)`, role/join/remove columns, and `user_id,circle_id` index; **Files**: `packages/services/circles-service/src/db/migrations/011_002_create_circle_members.sql`, `packages/services/circles-service/src/db/schema/circle-members.ts`. **Depends on**: T003. [US-004, US-006, FR-032, FR-034]
- [ ] **T-010\*\*** [P] Create Drizzle migration for `circle_invites` audit/rotation history table and one-active-invite uniqueness strategy; **Files**: `packages/services/circles-service/src/db/migrations/011_003_create_circle_invites.sql`, `packages/services/circles-service/src/db/schema/circle-invites.ts`. **Depends on**: T003. [US-003, FR-031, FR-032, C-001]
- [x] **T-011\*\*** [P] ⛔ **SUPERSEDED 2026-08-16 — do NOT create a `digitization_jobs` table.** — ~~`packages/services/digitization-service/src/db/migrations/011_004_create_digitization_jobs.sql`~~, ~~`.../schema/digitization-jobs.ts`~~
    - **What it said**: a Drizzle migration for `digitization_jobs` with `raw_ocr_json`, `parsed_json`, `batch_id`, state fields and query indexes.
    - **Why it is superseded**: the image-processing service **owns no database** ([ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md) §3; `spec.md` §"Ownership of the photo channel", 2026-08-14). A table here is a second durable record of an import whose authoritative record is the recipe — two places to reconcile, for no gain. It is the same argument this file already accepted for `recipe_versions` in T-012, applied to the row that creates it.
    - **What replaces it**: job state is **in flight**. Artifacts live in object storage under `digitization/{user_id}/{job_id}/`; status is **published to the message substrate**; the durable record is the recipe, created by 004's convergence point. Reaped at three days — T-109.
    - **Kept as a row** so nobody rediscovers the table from a stale artifact and builds it.
- [ ] **T-012\*\*** [P] Record a digitization correction as a new recipe version **through `@kitchensink/recipe-service-client`** — do **NOT** create a `recipe_versions` table; **Files**: `packages/services/digitization-service/src/corrections/correction-version.service.ts`. **Depends on**: T002. [US-002, FR-015, FR-021]
    - ⛔ **CORRECTED 2026-08-12.** This task used to create `packages/services/digitization-service/src/db/migrations/011_005_create_recipe_versions.sql` + `.../schema/recipe-versions.ts`. `recipe_versions` **already ships** at `packages/services/recipe-service/src/database/schema/versions.ts`, and a second table of that name in another database forks a `(recipe_id, version_number)` sequence that is supposed to be single-writer — see `plan.md` §Data Model item 6 and [GR-021](../governance-rules.md#gr-021-one-declarer-per-table-name-and-one-definition-per-task-id).
    - **Acceptance**: a correction produces exactly one new version **in the recipe service**, with `version_number` allocated by that service; the digitization service persists **nothing of its own** — its state is in-flight object-storage artifacts plus published status, and the `recipe_id` comes back from 004's submit response _(corrected 2026-08-16 with T-011)_. No migration and no Drizzle schema file for `recipe_versions` exists under `packages/services/digitization-service/`.
    - **Tests**: unit (the client is called once per correction; a client failure surfaces rather than being swallowed) **AND** integration (against a booted recipe service, two successive corrections yield `version_number` n and n+1 with no gap and no duplicate).
- [ ] **T-013\*\*** Create Drizzle migration to normalize/extend `recipes.audience` JSONB for `circle` scope with `ref_id`; **Files**: `packages/services/recipe-service/src/database/migrations/00NN_recipes_audience_circle_scope.sql`, `packages/services/recipe-service/src/database/schema/recipes.ts`. ⚠️ **Repointed 2026-08-12**: `recipes` is owned by `@kitchensink/recipe-service` and has a single writer, so this DDL ships as a **recipe-service** migration — 011 requests the column shape, the owner ships it. Issuing it from `digitization-service` would fork schema ownership and race the owner's migration ordering. **Depends on**: T011. [US-005, US-006, FR-033]
- [ ] **T-014\*\*** Add migration-level DB function/procedure for circle deletion audience fallback-to-private (single transaction semantics); **Files**: `packages/services/circles-service/src/db/migrations/011_007_circle_delete_audience_fallback.sql`. **Depends on**: T008, T009, T013. [US-005, FR-033, C-002]
- [ ] **T-015\*\*** Add migration-level DB function/procedure for owner deletion promotion (oldest member) and empty-circle soft-delete path; **Files**: `packages/services/circles-service/src/db/migrations/011_008_owner_deletion_promotion.sql`. **Depends on**: T008, T009. [US-006, FR-035, C-004]
- [x] **T-016\*\*** ⛔ **SUPERSEDED 2026-08-16 — subsumed by the 3-day reaper (T-109).** — ~~`packages/services/digitization-service/src/db/migrations/011_009_raw_ocr_retention.sql`~~
    - **What it said**: a migration-level procedure nullifying `raw_ocr_json` after 90 days.
    - **Why it is superseded**: there is no row to null out once T-011 is withdrawn, and the reaper is **strictly stronger** — nothing survives three days to reach ninety. FR-036's data-minimisation intent is satisfied a priori; only its mechanism dies.
- [ ] **T-017\*\*** [P] Update Drizzle relation maps and typed repositories for the **Circles** entities only — circles, members, invites; **Files**: `packages/services/circles-service/src/db/schema/index.ts`, repository files. **Depends on**: T008, T009, T010, T013. [FR-031] ⚠️ _Corrected 2026-08-16: the `digitization-service` schema index and the jobs/versions entities are gone with T-011 and T-012 — the image service has no Drizzle schema at all._
- [ ] **T-018\*\*** Add migration/integration smoke test ensuring all 011 migrations apply in-order and rollback cleanly in test DB; **Files**: `packages/services/*/tests/011-migrations.integration.test.ts`. **Depends on**: T014, T015, T016, T017. [FR-030, NFR-005]

---

## Phase 3 — `@kitchensink/audience`

- [ ] **T-019\*\*** Implement `AudienceScope` enum and `Audience` interface (`private|circle|public-profile|published-lesson`) in shared package; **Files**: `packages/shared/audience/src/types/audience.ts`, `packages/shared/audience/src/index.ts`. **Depends on**: T005. [US-005, US-006, FR-031]
- [ ] **T-020\*\*** [P] Implement runtime validators/guards (`isAudience`, `assertAudience`, scope-specific checks) for API boundary safety; **Files**: `packages/shared/audience/src/guards/*.ts`. **Depends on**: T019. [FR-030, NFR-005]
- [ ] **T-021\*\*** [P] Implement `audienceQueryFilter(viewerUserId)` helper contract and docs for consumers 001/006/007; **Files**: `packages/shared/audience/src/query/audience-query-filter.ts`, `README.md`. **Depends on**: T019, T020. [US-006, FR-033]
- [ ] **T-022\*\*** [P] Add `AudienceGuard` base integration helper for NestJS consumers and export from package public surface; **Files**: `packages/shared/audience/src/nest/audience-guard.ts`, `src/index.ts`. **Depends on**: T020. [US-006, FR-027]
- [ ] **T-023\*\*** Add contract tests that lock shared-audience public API stability and backward compatibility expectations for 001/006/007; **Files**: `packages/shared/audience/tests/public-api.contract.integration.test.ts`. **Depends on**: T021, T022. [US-005, US-006, FR-031]
- [ ] **T-024\*\*** [P] Add consumer contract fixture tests proving circle-scope fallback behavior when circles service unavailable; **Files**: `packages/shared/audience/tests/fallback.contract.integration.test.ts`. **Depends on**: T021. [US-006, FR-033]
- [ ] **T-025\*\*** Wire package exports/version metadata and add changelog entry for new shared audience contract artifact; **Files**: `packages/shared/audience/package.json`, `packages/shared/audience/CHANGELOG.md`. **Depends on**: T023, T024. [FR-031, NFR-005]

---

## Phase 4 — `@kitchensink/circles-service`

- [ ] **T-026\*\*** Implement circles domain entities/repositories (`Circle`, `CircleMember`, `CircleInvite`) and ownership authorization primitives; **Files**: `packages/services/circles-service/src/circles/domain/*`, `src/circles/repositories/*`. **Depends on**: T017, T019. [US-003, US-006, FR-031]
- [ ] **T-027\*\*** Implement `POST /api/v1/circles` create-circle endpoint with initial active invitation token generation; **Files**: `packages/services/circles-service/src/circles/controllers/create-circle.controller.ts`, service/DTO files. **Depends on**: T026. [US-003, FR-031]
- [ ] **T-028\*\*** [P] Implement `GET /api/v1/circles` and `GET /api/v1/circles/:id` endpoints with owned/member visibility filtering; **Files**: `packages/services/circles-service/src/circles/controllers/get-circles*.controller.ts`. **Depends on**: T026. [US-003, US-006, FR-027]
- [ ] **T-029\*\*** Implement `PATCH /api/v1/circles/:id` rename endpoint (owner-only) with validation and audit event; **Files**: `packages/services/circles-service/src/circles/controllers/rename-circle.controller.ts`. **Depends on**: T026. [FR-027, NFR-003]
- [ ] **T-030\*\*** Implement invitation rotate endpoint `POST /api/v1/circles/:id/invitation/rotate` using revoke+rotate reusable-link semantics; **Files**: `packages/services/circles-service/src/invitations/controllers/rotate-invitation.controller.ts`, `src/invitations/services/rotate.service.ts`. **Depends on**: T010, T026. [US-003, FR-031, C-001]
- [ ] **T-031\*\*** Implement invitation redeem endpoint `POST /api/v1/circles/join/:token` with idempotent member add and revoked-token 410 behavior; **Files**: `packages/services/circles-service/src/invitations/controllers/join-circle.controller.ts`, `src/invitations/services/join.service.ts`. **Depends on**: T009, T010, T030. [US-004, FR-032, C-001]
- [ ] **T-032\*\*** [P] Implement member removal endpoint `DELETE /api/v1/circles/:id/members/:userId` with owner-only checks and post-removal access invalidation hooks; **Files**: `packages/services/circles-service/src/members/controllers/remove-member.controller.ts`. **Depends on**: T026. [US-006, FR-034]
- [ ] **T-033\*\*** Implement circle deletion endpoint `DELETE /api/v1/circles/:id` invoking transactional audience revert routine from T014; **Files**: `packages/services/circles-service/src/circles/controllers/delete-circle.controller.ts`, deletion service. **Depends on**: T014, T026. [US-005, FR-033, C-002]
- [ ] **T-034\*\*** Implement owner-account-deletion handler in circles-api that executes promotion/soft-delete semantics via T015 routine; **Files**: `packages/services/circles-service/src/lifecycle/owner-deletion.handler.ts`. **Depends on**: T015, T026. [US-006, FR-035, C-004]
- [ ] **T-035\*\*** [P] Implement outlier detection emission for circle/user growth thresholds (>=100 members or >=25 owned circles) with warning event shape; **Files**: `packages/services/circles-service/src/monitoring/outlier-monitor.service.ts`. **Depends on**: T026. [FR-034, NFR-007, C-003]
- [ ] **T-036\*\*** Add circles-api unit + controller tests for create/list/rename/rotate/join/delete/member-remove/owner-deletion flows and RFC7807 errors; **Files**: `packages/services/circles-service/src/**/__tests__/*.test.ts`, `packages/services/circles-service/tests/*.integration.test.ts`. **Depends on**: T027, T028, T029, T030, T031, T032, T033, T034, T035. [US-003, US-004, US-006, FR-030]

---

## Phase 5 — `@kitchensink/digitization-service`

- [ ] **T-037\*\*** Implement the digitization job domain and state machine (`pending|processing|awaiting-correction|submitted|discarded`) over **in-flight object-storage artifacts plus published status** — no repository, no table; **Files**: `packages/services/digitization-service/src/digitization/domain/*`, `src/digitization/artifacts/*`. **Depends on**: T007. [US-001, US-002, FR-029] ⚠️ _Corrected 2026-08-16: `saved` is renamed `submitted`, because 011 does not save — it submits to 004._
- [ ] **T-038\*\*** Implement `POST /api/v1/recipes/digitize/jobs` endpoint to validate payload constraints and return pre-signed S3 PUT URL + job metadata; **Files**: `packages/services/digitization-service/src/digitization/controllers/create-job.controller.ts`, upload service. **Depends on**: T037, T007. [US-001, FR-001, FR-004, FR-027, NFR-002]
- [ ] **T-039\*\*** [P] Implement `GET /api/v1/recipes/digitize/jobs` cursor pagination endpoint (default size 20) and ordering by recency; **Files**: `packages/services/digitization-service/src/digitization/controllers/list-jobs.controller.ts`. **Depends on**: T037. [US-007, FR-028, FR-029]
- [ ] **T-040\*\*** [P] Implement `GET /api/v1/recipes/digitize/jobs/:id` status/result retrieval endpoint with ownership checks; **Files**: `packages/services/digitization-service/src/digitization/controllers/get-job.controller.ts`. **Depends on**: T037. [US-001, FR-013, FR-029]
- [ ] **T-041\*\*** Implement `PATCH /api/v1/recipes/digitize/jobs/:id/correction` endpoint for inline edits to parsed fields and confidence overrides; **Files**: `packages/services/digitization-service/src/digitization/controllers/patch-correction.controller.ts`. **Depends on**: T037. [US-002, FR-015, FR-017]
- [ ] **T-042\*\*** Implement `POST /api/v1/recipes/digitize/jobs/:id/submit` — **submits the corrected candidates to 004's bulk import contract** (`004-FR-047`) and returns the resulting `recipe_id`; **Files**: `packages/services/digitization-service/src/digitization/controllers/submit-job.controller.ts`, the 004 import client. **Depends on**: T013, T041. [US-001, US-005, FR-021]
    - ⛔ **Renamed and rescoped 2026-08-16.** It was `/save`, "creating recipe + linking `recipe_id` + version row append" — 011 creating a recipe row directly. That is the second write path ADR-0019 exists to prevent, and it contradicted this feature's own `spec.md` §"Ownership of the photo channel", which has said since 2026-08-14 that 011 "does **not** create its own path to a saved recipe".
    - ⛔ **`sourceType = imported_paid`, never `imported_physical`.** A client-declared `imported_physical` is **not representable** in 004's DTO (`004-FR-025`, HAZ-057), so `imported_paid` is the only non-public class 011 is permitted to declare. The premium gate keeps its enforcement point either way: both classes are private-only under the shipped C-004 `evaluateVisibility` policy, and 004's convergence point — not 011 — enforces provenance and quota.
    - **Acceptance**: submitting produces exactly **one** recipe, created by the recipe service; 011 issues no recipe INSERT and no `recipe_versions` write; a submit failure surfaces to the user rather than being swallowed; a redelivered submit is idempotent on 004's `Idempotency-Key`.
- [ ] **T-043\*\*** [P] Implement `DELETE /api/v1/recipes/digitize/jobs/:id` soft-discard endpoint preserving S3 object retention metadata; **Files**: `packages/services/digitization-service/src/digitization/controllers/discard-job.controller.ts`. **Depends on**: T037. [US-007, FR-022]
- [ ] **T-044\*\*** Implement upload-session batching (`batch_id`) service for up to 20 photos per session with per-photo job creation semantics; **Files**: `packages/services/digitization-service/src/digitization/services/batch-jobs.service.ts`. **Depends on**: T038. [US-007, FR-003, FR-005]
- [ ] **T-045\*\*** [P] Implement correction workflow helper for `accept-all` path when no low-confidence tokens are present; **Files**: `packages/services/digitization-service/src/digitization/services/accept-all.service.ts`. **Depends on**: T041. [US-002, FR-016]
- [ ] **T-046\*\*** [P] Implement standardized RFC7807 problem-details filter/middleware with `error_code` mapping for digitization API errors; **Files**: `packages/services/digitization-service/src/http/problem-details.filter.ts`, error code map. **Depends on**: T038, T040, T041, T043. [US-001, FR-030]
- [ ] **T-047\*\*** Implement circles-audience integration at the **submit**/share boundary so recipes can target `circle` audience via the shared contract; **Files**: `packages/services/digitization-service/src/audience/*`, submit/share service updates. **Depends on**: T019, T021, T042. [US-005, US-006, FR-033]
- [ ] **T-048\*\*** Add digitization-api unit/controller/integration tests across create/list/get/correction/save/discard/batch/accept-all and auth/path contract checks; **Files**: `packages/services/digitization-service/src/**/__tests__/*.test.ts`, `packages/services/digitization-service/tests/*.integration.test.ts`. **Depends on**: T039, T040, T041, T042, T043, T044, T045, T046, T047. [US-001, US-002, US-007, FR-027, FR-030]

---

## Phase 6 — `@kitchensink/digitization-workers` Lambda

- [ ] **T-049\*\*** Implement SQS event handler with partial batch failure reporting and idempotent job lock/update semantics; **Files**: `packages/services/digitization-workers/src/handlers/sqs-ocr.handler.ts`. **Depends on**: T011, T037. [US-001, FR-013, NFR-006]
- [ ] **T-050\*\*** [P] Implement Textract adapter module with timeout budget, retries, and provider abstraction seam for deferred Q-001 provider swaps; **Files**: `packages/services/digitization-workers/src/providers/textract.adapter.ts`, interface files. **Depends on**: T004, T007. [FR-006, NFR-001]
- [ ] **T-051\*\*** Implement OCR normalization parser mapping raw provider output into structured recipe fields (`title`, `ingredients`, `steps`, times, yield); **Files**: `packages/services/digitization-workers/src/parsing/normalize-ocr-result.ts`. **Depends on**: T050. [US-001, FR-007]
- [ ] **T-052\*\*** [P] Implement confidence extraction + `language_code` mapping and writeback to `parsed_json`/job fields; **Files**: `packages/services/digitization-workers/src/parsing/confidence-map.ts`. **Depends on**: T050, T051. [US-008, FR-008, FR-009, FR-010, FR-011, FR-012]
- [ ] **T-053\*\*** Implement low-quality fallback state transitions (`awaiting-correction + low_quality`) when OCR quality threshold is not met; **Files**: `packages/services/digitization-workers/src/workflow/quality-gate.ts`. **Depends on**: T052. [US-008, FR-011, FR-017]
- [ ] **T-054\*\*** [P] Implement the artifact writeback service: `raw_ocr_json` + `parsed_json` + the confidence map to **object storage**, and each state transition **published to the message substrate**; **Files**: `packages/services/digitization-workers/src/artifacts/job-writeback.service.ts`. **Depends on**: T049, T051, T052. [FR-020, FR-029] ⚠️ _Corrected 2026-08-16: this read "persisted writeback … using internal DB/API client"._
- [ ] **T-055\*\*** [P] Add Lambda unit tests for queue handler, parser normalization, confidence maps, low-quality path, and retry semantics; **Files**: `packages/services/digitization-workers/src/**/__tests__/*.test.ts`. **Depends on**: T049, T051, T052, T053, T054. [FR-006, FR-013, NFR-006]
- [ ] **T-056\*\*** Add failure-mode tests for provider timeout, DLQ redrive eligibility, and idempotent reprocessing of duplicate queue messages; **Files**: `packages/services/digitization-workers/tests/failure-modes.integration.test.ts`. **Depends on**: T055. [FR-013, NFR-001, NFR-006]

---

## Phase 7 — Frontend (Web + Mobile)

- [ ] **T-057\*\*** Implement upload entry UI (camera capture + web file picker) with validation feedback for image constraints before requesting upload URL; **Files**: `packages/apps/commise/web/src/features/digitization/upload/*`, `packages/apps/commise/mobile/src/features/digitization/upload/*`. **Depends on**: T038. [US-001, FR-002, FR-004]
- [ ] **T-058\*\*** [P] Implement multi-photo queue UI and submission flow supporting up to 20 photos/session and shared `batch_id`; **Files**: `packages/apps/commise/web/src/features/digitization/queue/*`, `packages/apps/commise/mobile/src/features/digitization/queue/*`. **Depends on**: T044. [US-007, FR-003, FR-005]
- [ ] **T-059\*\*** Implement correction workspace layout with side-by-side photo + parsed fields and pinch-to-zoom/photo preview behavior; **Files**: `packages/apps/commise/web/src/features/digitization/correction/*`, `packages/apps/commise/mobile/src/features/digitization/correction/*`. **Depends on**: T040, T041. [US-002, FR-014]
- [ ] **T-060\*\*** [P] Implement inline edit controls wired to correction PATCH API with optimistic UI + rollback; **Files**: correction form components/hooks in web/mobile. **Depends on**: T041, T059. [US-002, FR-015]
- [ ] **T-061\*\*** [P] Implement low-confidence token highlight UX using icon+label+color and token-level edit affordances; **Files**: correction token components (web/mobile). **Depends on**: T052, T059. [US-008, FR-017, FR-025, NFR-004]
- [ ] **T-062\*\*** Implement Accept-All CTA for clean scans when low-confidence token count is zero; **Files**: correction action components/hooks (web/mobile). **Depends on**: T045, T061. [US-009, FR-016]
- [ ] **T-063\*\*** [P] Implement circles management UI (create/list/details/rename/remove member/delete) using canonical `/api/v1/circles/*` endpoints; **Files**: `packages/apps/commise/web/src/features/circles/*`, `packages/apps/commise/mobile/src/features/circles/*`. **Depends on**: T027, T028, T029, T032, T033. [US-003, US-006, FR-027, FR-033]
- [ ] **T-064\*\*** Implement invite acceptance flow (`join/:token`) with idempotent success state and revoked-token error UX; **Files**: circles invite route/screens web/mobile. **Depends on**: T031. [US-004, FR-032, FR-026]
- [ ] **T-065\*\*** [P] Implement audience picker integration in recipe save/share flows to include named circles and read-access messaging for members; **Files**: recipe share/save UI in web/mobile. **Depends on**: T047, T063. [US-005, US-006, FR-031]
- [ ] **T-066\*\*** Add frontend accessibility hardening for correction/queue/invite flows (labels, keyboard nav, screen-reader semantics); **Files**: impacted web/mobile UI components/tests. **Depends on**: T058, T059, T061, T064. [US-002, US-004, FR-023, FR-024, FR-026, NFR-004]
- [ ] **T-067\*\*** Add frontend feature tests for upload→poll→correct→save and circles invite→join→browse flow; **Files**: web/mobile feature tests under `src/features/**/__tests__`. **Depends on**: T060, T062, T063, T064, T065, T066. [US-001, US-002, US-003, US-004, US-005, US-006]

---

## Phase 8 — Integration Tests

- [ ] **T-068\*\*** Add integration test for digitization pipeline API + OCR worker handshake (`POST jobs` → S3 key → SQS → OCR writeback → `GET job` status progression); **Files**: `packages/services/digitization-service/tests/digitization-pipeline.integration.test.ts`. **Depends on**: T038, T040, T049, T054. [US-001, FR-006, FR-013, FR-029]
- [ ] **T-069\*\*** [P] Add integration test for correction/save path validating recipe creation, `recipe_id` linkage, and version row append; **Files**: `packages/services/digitization-service/tests/save-flow.integration.test.ts`. **Depends on**: T042. [US-002, FR-021]
- [ ] **T-070\*\*** [P] Add integration test for circle invitation lifecycle (create, rotate, join, revoked-token 410, idempotent rejoin); **Files**: `packages/services/circles-service/tests/invitation-lifecycle.integration.test.ts`. **Depends on**: T030, T031. [US-003, US-004, FR-031, FR-032, C-001]
- [ ] **T-071\*\*** Add integration test for circle deletion transactional audience fallback to private and audit event emission; **Files**: `packages/services/circles-service/tests/circle-delete-fallback.integration.test.ts`. **Depends on**: T033. [US-005, FR-033, C-002, NFR-003]
- [ ] **T-072\*\*** [P] Add integration test for owner deletion promotion semantics (oldest member promoted, empty circle soft-deleted); **Files**: `packages/services/circles-service/tests/owner-deletion-promotion.integration.test.ts`. **Depends on**: T034. [US-006, FR-035, C-004, NFR-003]
- [ ] **T-073\*\*** Add shared-audience contract tests in consumers 001/006/007 to guarantee cross-feature compatibility for `circle` scope filters/guards; **Files**: `packages/apps/commise/*/tests/shared-audience-011.contract.integration.test.ts`, `packages/shared/audience/tests/consumer-matrix.integration.test.ts`. **Depends on**: T023, T024, T025, T047. [US-005, US-006, FR-031, FR-033]

---

## Phase 9 — E2E Tests

- [ ] **T-074\*\*** Add Playwright E2E for US-001/US-002 happy path (upload photo, poll status, correct fields, save recipe, recipe visible in library); **Files**: `packages/apps/commise/web/tests/e2e/011-digitization-save.spec.ts`. **Depends on**: T067, T068, T069. [US-001, US-002, FR-014, FR-015, FR-021]
- [ ] **T-075\*\*** [P] Add Playwright E2E for US-003/US-004 invite flow (create circle, rotate invite, join second user, revoked link fails, member can browse shared recipe); **Files**: `packages/apps/commise/web/tests/e2e/011-circles-invite.spec.ts`. **Depends on**: T067, T070. [US-003, US-004, FR-031, FR-032]
- [ ] **T-076\*\*** [P] Add Playwright + axe checks for correction and invite flows (keyboard-only + screen-reader semantics regression gates); **Files**: `packages/apps/commise/web/tests/e2e/011-accessibility.spec.ts`. **Depends on**: T066, T074, T075. [FR-023, FR-024, FR-025, FR-026, NFR-004]

---

## Phase 10 — Observability

- [ ] **T-077\*\*** Instrument digitization-api and circles-api with structured logging + correlation IDs using Powertools logger and request context middleware; **Files**: `packages/services/digitization-service/src/observability/*`, `packages/services/circles-service/src/observability/*`. **Depends on**: T048, T036. [NFR-001, NFR-003]
- [ ] **T-078\*\*** [P] Instrument OCR Lambda with Powertools logger + metrics and add Sentry error capture wrappers for handler failures; **Files**: `packages/services/digitization-workers/src/observability/*`, handler bootstrap files. **Depends on**: T055. [NFR-001, NFR-006]
- [ ] **T-079\*\*** [P] Add Sentry instrumentation for NestJS APIs (problem-details exceptions, invite/join errors, audience authorization failures) with environment tagging; **Files**: API bootstrap + exception filter wiring in circles/digitization packages. **Depends on**: T046, T036, T048. [FR-030, NFR-003]
- [ ] **T-080\*\*** Emit OCR confidence histogram metric (`ocr.confidence.histogram`) and low-quality rate counters per batch/job; **Files**: `packages/services/digitization-workers/src/metrics/ocr-confidence.metrics.ts`. **Depends on**: T052, T078. [US-008, FR-011, NFR-001]
- [ ] **T-081\*\*** Add soft-monitoring alert signal pipeline for circle/member outliers and user-owned-circle outliers with 1-hour alarm window; **Files**: `packages/services/circles-service/src/monitoring/*`, alert config docs. **Depends on**: T035. [FR-034, NFR-007, C-003]

---

## Phase 11 — Privacy / Cleanup Jobs

- [x] **T-082\*\*** ⛔ **SUPERSEDED 2026-08-16 — replaced by the 3-day reaper, T-109.** The 90-day `raw_ocr_json` nullification has nothing to null once T-011/T-016 are withdrawn, and a reaper that deletes every in-flight artifact at three days is strictly stronger. — ~~`packages/services/digitization-service/src/retention/raw-ocr-purge.job.ts`~~
- [ ] **T-083\*\*** [P] Add reaper metrics/events (`digitization.artifacts.reaped.count`, failures, **stale-job gauge**) and structured audit logs for every reaper run; **Files**: `packages/services/digitization-service/src/retention/metrics.ts`. **Depends on**: T109. [FR-036, NFR-008] ⚠️ ⛔ **Never dimension a metric on a job id or a group id** — the repo's EMF cardinality gate rejects it, and moving the id to a metric _property_ fixes only the cost half. Emit a scrubbed log line instead.
- [ ] **T-084\*\*** Add integration tests validating the reaper cutoff (an artifact at 71 h is retained, at 73 h is deleted), idempotent reruns, and that a job **still awaiting correction** is reaped on the same schedule as any other — the window is a promise about how long an artifact lives, **not** a budget the user's inactivity can top up; **Files**: `packages/services/digitization-service/tests/artifact-reaper.integration.test.ts`. **Depends on**: T109. [FR-036, C-005]

---

## Phase 12 — Deployment / CDK

- [ ] **T-085\*\*** Add CDK stack scaffold under feature infra path for digitization + circles resources and environment wiring; **Files**: `specs/011-recipe-digitization/infra/stacks/recipe-digitization-stack.ts`, supporting `bin/*`. **Depends on**: T001, T007. [NFR-005]
- [ ] **T-086\*\*** [P] Add CDK resources for OCR Lambda deployment package, IAM execution role/policies, and environment variable bindings; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/ocr-lambda.ts`. **Depends on**: T085, T049, T050. [FR-006, NFR-001]
- [ ] **T-087\*\*** [P] Add CDK SQS queue + DLQ resources (redrive policy, visibility timeout, alarms) and event source mapping to OCR Lambda; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/ocr-queue.ts`. **Depends on**: T085, T049. [FR-013, NFR-006]
- [ ] **T-088\*\*** [P] Add CDK S3 bucket/prefix policy for digitization uploads (`digitization/{user_id}/{job_id}`), KMS/encryption defaults, and signed PUT constraints; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/digitization-bucket.ts`. **Depends on**: T085, T038. [FR-001, FR-019, NFR-002]
- [ ] **T-089\*\*** [P] Add CDK CloudFront distribution/behavior for serving archived original photos with restricted origin access; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/digitization-cloudfront.ts`. **Depends on**: T085, T088. [FR-019]
- [ ] **T-090\*\*** Add CDK wiring for `digitization-api` and `circles-api` runtime deployment integration (service env, secrets, IAM access to S3/SQS, and to RDS **for `circles-api` only** — `digitization-api` gets **no** database grant, because it owns no database); **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/apis.ts`. **Depends on**: T085, T038, T031, T047. [FR-027, NFR-005]
- [ ] **T-091\*\*** Add CDK/EventBridge schedules for the **daily artifact reaper** (T-109) and the outlier-monitor check job, with alarm targets; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/schedules.ts`. **Depends on**: T081, T109, T085. [FR-036, NFR-007, NFR-008, C-003, C-005]
- [ ] **T-092\*\*** Add infra validation tests/synth checks and deployment runbook updates for 011 resources (Lambda, SQS/DLQ, S3, CloudFront, alarms); **Files**: `packages/services/digitization-service/infra/__tests__/*.test.ts`, `specs/011-recipe-digitization/infra/README.md`. **Depends on**: T086, T087, T088, T089, T090, T091. [NFR-001, NFR-006]

---

## Cross-Validation (Product Forge Step 4)

| Check                                                   | Status | Notes                                                                                                                                |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Every Must Have US-NNN has ≥1 implementation task?      | ✅     | US-001..US-006 all mapped in tasks and coverage matrix.                                                                              |
| Every FR-NNN has ≥1 corresponding task?                 | ✅     | FR-001..FR-036 each mapped to at least one task ID.                                                                                  |
| Every NFR has ≥1 corresponding task?                    | ✅     | NFR-001..NFR-008 each mapped.                                                                                                        |
| Clarifications C-001..C-005 have explicit tasks?        | ✅     | C-001: T030/T031/T070; C-002: T014/T033/T071; C-003: T035/T081/T091; C-004: T015/T034/T072; C-005: T016/T082/T084/T091.              |
| Test / validation tasks included per task group?        | ✅     | Unit/integration/E2E/contract/migration/infra tests included (T018, T036, T048, T055, T056, T067, T068-T076, T084, T092, T101-T108). |
| No orphan tasks (tasks without traceable requirement)?  | ✅     | All tasks include requirement brackets.                                                                                              |
| Task granularity appropriate (≤1-2h each)?              | ✅     | Large vertical slices split into API/DB/UI/test/infra sub-tasks.                                                                     |
| Dependency order sensible?                              | ✅     | Setup → schema/shared → **wire contracts** → APIs/OCR → **typed clients** → frontend → testing/observability/privacy/deploy.         |
| Wire contract owned per service (GR-015 §15-a)?         | ✅     | T101 (circles), T102 (digitization) — zod authored in each service, copied to `packages/schemas/{circles,digitization}`.             |
| All three drift gates wired per service (GR-015 §15-c)? | ✅     | T103 — `contract:generate`, turbo `$TURBO_ROOT$` `inputs`, `CONTRACT_HASH` boot assertion.                                           |
| Client half TASKED, not just stated (GR-017 §17-e.12)?  | ✅     | T105, T106 (typed clients + skew guards), T108 (consumers derive, never re-declare). **Was ❌ before 2026-08-12.**                   |
| Third-party boundary preserved (GR-015 §15-d)?          | ✅     | T107 — the OCR provider is boundary-validated with its own zod and is **never** converged.                                           |
| k6 tier for each deployable (§7.1, GR-017 §17-a.8)?     | ✅     | T104 — both services are deployables and owe unit + integration + e2e + k6.                                                          |
| Maestro flow per mobile story (§14.1)?                  | ❌     | **GAP.** T057–T065 build mobile surfaces; no Maestro flow is specified in this file. Flagged in T108.                                |

---

## Coverage Matrix

### User Stories

| ID     | Task IDs                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------- |
| US-001 | T002, T037, T038, T040, T042, T049, T051, T057, T067, T068, T074, T102, T104, T106, T107       |
| US-002 | T012, T041, T045, T059, T060, T062, T066, T067, T069, T074, T102, T104, T106                   |
| US-003 | T003, T008, T027, T028, T030, T036, T063, T067, T070, T075, T101, T103, T105, T108             |
| US-004 | T009, T031, T036, T064, T067, T070, T075, T101, T105, T108                                     |
| US-005 | T013, T014, T019, T033, T042, T047, T065, T071, T073, T101, T108                               |
| US-006 | T009, T019, T021, T026, T028, T032, T034, T047, T063, T065, T072, T073, T101, T103, T105, T108 |

### Functional Requirements

| ID     | Task IDs                                             |
| ------ | ---------------------------------------------------- |
| FR-001 | T038, T088                                           |
| FR-002 | T057                                                 |
| FR-003 | T044, T058                                           |
| FR-004 | T038, T057                                           |
| FR-005 | T044, T058                                           |
| FR-006 | T050, T068, T086, T107                               |
| FR-007 | T051, T107                                           |
| FR-008 | T052, T107                                           |
| FR-009 | T052                                                 |
| FR-010 | T052                                                 |
| FR-011 | T052, T053, T080                                     |
| FR-012 | T052                                                 |
| FR-013 | T040, T049, T056, T068, T087, T104                   |
| FR-014 | T059, T074                                           |
| FR-015 | T041, T060, T074                                     |
| FR-016 | T045, T062                                           |
| FR-017 | T041, T053, T061                                     |
| FR-018 | T059                                                 |
| FR-019 | T038, T088, T089                                     |
| FR-020 | T011, T054                                           |
| FR-021 | T042, T069, T074                                     |
| FR-022 | T043                                                 |
| FR-023 | T066, T076                                           |
| FR-024 | T066, T076                                           |
| FR-025 | T061, T076                                           |
| FR-026 | T064, T066, T076                                     |
| FR-027 | T038, T046, T048, T063, T090, T101, T102, T105, T106 |
| FR-028 | T039, T102                                           |
| FR-029 | T037, T040, T054, T068, T102                         |
| FR-030 | T046, T048, T036, T079, T102, T104                   |
| FR-031 | T010, T027, T030, T070, T073, T101, T105, T108       |
| FR-032 | T031, T064, T070, T075, T101, T105                   |
| FR-033 | T014, T033, T071, T073, T108                         |
| FR-034 | T032, T035, T081                                     |
| FR-035 | T015, T034, T072                                     |
| FR-036 | T016, T082, T083, T084, T091                         |

### Non-Functional Requirements

| ID      | Task IDs                                       |
| ------- | ---------------------------------------------- |
| NFR-001 | T050, T056, T077, T078, T080, T086, T092, T107 |
| NFR-002 | T038, T088                                     |
| NFR-003 | T029, T033, T034, T071, T072, T077, T079       |
| NFR-004 | T061, T066, T076                               |
| NFR-005 | T001, T006, T018, T090, T103, T104             |
| NFR-006 | T049, T056, T078, T087, T092                   |
| NFR-007 | T035, T081, T091                               |
| NFR-008 | T016, T082, T083, T091                         |

### Clarifications

| ID    | Task IDs               |
| ----- | ---------------------- |
| C-001 | T010, T030, T031, T070 |
| C-002 | T014, T033, T071       |
| C-003 | T035, T081, T091       |
| C-004 | T015, T034, T072       |
| C-005 | T016, T082, T084, T091 |

---

## Phase 13 — Pre-Impl Review Conditions (Addendum, 2026-05-10)

> Source: `pre-impl-review.md` (status: APPROVED WITH CONDITIONS). These tasks resolve conditions C-A-001 through C-R-002 before or alongside implementation. Tasks reference existing T0xx tasks they augment.

- [ ] **T-093\*\*** Define `OcrProvider` TypeScript interface (input shape, confidence schema per token+overall, language detection output, error taxonomy, timeout contract) and require T050 to implement it; **Files**: `packages/services/digitization-workers/src/providers/ocr-provider.interface.ts`. **Depends on**: T004. **Blocks**: T050, T051. [FR-006, NFR-001, A-003, R-001, C-A-001]
- [ ] **T-094\*\*** Add CI guard that fails when a `packages/services/*` or `packages/shared/*` directory exists without a matching workspace entry in root `package.json` and a TS project reference in the relevant `tsconfig*.json`; **Files**: `.github/workflows/workspace-guard.yml` (or equivalent), `scripts/check-workspace-registration.ts`. **Depends on**: T001, T006. [NFR-005, A-001, C-A-002]
- [ ] **T-095\*\*** Specify transactional isolation for FR-033 (Circle deletion → audience revert) and FR-035 (owner-account deletion path) as SERIALIZABLE (or REPEATABLE READ + `SELECT … FOR UPDATE` on the owner row), document in T033 / T036 task notes, and add an integration test exercising concurrent owner-account deletion + invite redemption + recipe audience write; **Files**: `packages/services/circles-service/tests/owner-deletion-race.integration.test.ts`, code-comment notes in T033/T036 services. **Depends on**: T033, T034, T036. [FR-033, FR-035, A-002, C-A-003]
- [ ] **T-096\*\*** Add explicit offline-failure copy + retry behavior (network-loss banner, queued-locally state, retry-on-reconnect with idempotency key) to upload (T057) and queue (T058) UI; **Files**: web/mobile upload + queue components + tests. **Depends on**: T057, T058. [US-001, US-007, FR-002, FR-003, NFR-004, D-002, C-D-002]
- [ ] **T-097\*\*** Annotate T057–T067 with a "check `packages/apps/commise/ui` first" requirement: each frontend task must enumerate primitives consumed from `packages/apps/commise/ui` and explicitly document any new primitives introduced (with rationale); **Files**: PR-template note + tasks.md cross-reference + new primitives index `packages/apps/commise/ui/INDEX.md`. **Depends on**: none (process). **Augments**: T057, T058, T059, T060, T061, T062, T063, T064, T065, T066, T067. [NFR-004, NFR-005, D-004, C-D-004]
- [ ] **T-098\*\*** Implement Circle soft-delete with default 30-day retention window (`circles.deleted_at` already migrated in T008): hard-delete worker + restore endpoint, audit event on both transitions, and integration test exercising soft-deleted Circle behavior (audience revert deferred until hard-delete); **Files**: `packages/services/circles-service/src/circles/lifecycle/soft-delete.service.ts`, `packages/services/circles-service/src/circles/lifecycle/hard-delete.job.ts`, `packages/services/circles-service/tests/circle-soft-delete.integration.test.ts`. **Depends on**: T008, T033. **Augments**: T036, T070. [FR-033, NFR-003, R-008, C-R-001]
- [ ] **T-099\*\*** Add LaunchDarkly-style feature flags `digitization.enabled` and `circles.enabled` with config wiring in `digitization-api` + `circles-api` + web/mobile clients; gate `/api/v1/recipes/digitize/*`, `/api/v1/circles/*`, upload UI entry, and audience-picker Circle options behind these flags. Default OFF in production; ON in dev/preview. **Files**: `packages/services/digitization-service/src/config/featureFlags.ts`, `packages/services/circles-service/src/config/featureFlags.ts`, web/mobile flag wiring, CDK env binding. **Depends on**: T007. **Augments**: T088, T090. [NFR-005, R-001, R-002, R-005, R-008, C-R-002]
- [ ] **T-100\*\*** Document canary promotion gates (1% → 10% → 50% → 100%) and rollback runbook in release-readiness artifact: per-ring gates = (NFR-001 p95 OCR latency met, DLQ depth = 0 sustained over ring window, zero P0/P1 a11y findings, manual accuracy benchmark ≥ SC-001 on canary photo set); **Files**: `specs/011-recipe-digitization/release-readiness.md` (created at release-readiness phase) — placeholder note in `plan.md` Risks until then. **Depends on**: T099. [NFR-001, NFR-004, R-001, R-002, R-005, R-008, C-R-002]

---

## Phase 14 — Wire Contracts, Validation & Typed Clients (GR-015, GR-016, GR-017)

> ⛔ **011 creates TWO new deployable services, so GR-017 §17-a binds each of them separately.** Before this
> revision this file had **no** task for `packages/schemas/digitization`, `packages/schemas/circles`,
> `packages/clients/digitization`, `packages/clients/circles`, or a `CONTRACT_HASH` boot assertion — GR-017
> §17-e.12's failure mode, and the portfolio's most common violation.
>
> ⚠️ **A schema package is per SERVICE, not per feature**, so 011 gets **two**:
> `@kitchensink/schema-digitization` and `@kitchensink/schema-circles`. `@kitchensink/audience` is **unaffected**
> and stays exactly as specified (T-019…T-025) — it is a **type-only domain** package on the GR-007 axis, not a
> wire contract. A schema package **reuses it `import type`** and never re-declares its types.
>
> ⚠️ **ADR-0017 does NOT ratify these two services.** It decided 006/007/009/010 only, and explicitly declines to
> decide 011's `digitization-service` / `circles-service`. The question _does this need its own deployable, given
> that a per-PR ECS task measures ≈ $8.25/month per open PR (ADR-0010) on a $300/month account budget?_ is worth
> asking before either is built. Nothing here should be read as ratification.
>
> **Task count: 108** (T-001…T-100, plus T-101…T-108 added 2026-08-12).

- [ ] **T-101\*\*** Author `circles-service`'s wire contract as zod and generate `@kitchensink/schema-circles`; **Files**: `packages/services/circles-service/src/circles/circles.schema.ts`, `src/invitations/invitations.schema.ts`, `src/members/members.schema.ts`, `packages/schemas/circles/*`. **Depends on**: T003, T019. **Blocks**: T027, T028, T029, T030, T031, T032, T033. [US-003, US-004, US-006, FR-027, FR-031, FR-032, GR-015 §15-a, GR-017 §17-a.1/§17-a.3]
    - **Acceptance**: Circle, member and invitation request/response shapes authored **beside the controller each serves** (⛔ **not** in the "service/DTO files" T-027 mentions — §15.2 requires `src/**/*.schema.ts` beside the controller, never a `dto/` directory); every `*.schema.ts` imports **only `zod`, other `*.schema.ts` files, and `@kitchensink/audience` `import type`**. `packages/schemas/circles` (`@kitchensink/schema-circles`) exports `src/schemas.ts`, `src/types.ts` (`z.infer` only), `src/contractHash.ts`, `src/index.ts` and a **derived** `openapi.yaml`, with **no** runtime dependency on NestJS/drizzle/aws-sdk. Reference shape: `packages/schemas/recipe`.
    - **⛔ Three things that look wrong and are not**: the schema package is a literal file **COPY** (zod are runtime values and cannot be derived from themselves); `openapi.yaml` is **DERIVED** output for `oasdiff`/docs/integrators and is **NEVER a codegen input**; the copy is wired with turbo `$TURBO_ROOT$` **`inputs`**, never `dependsOn` (that edge closes the cycle `client → schema → service → client`).
    - **⚠️ The invite token is the sharpest shape here.** `POST /api/v1/circles/join/:token` takes an attacker-supplied path segment that decides membership. It is parsed **before** it is looked up, bounded to the token's real format, and an unresolvable or revoked token is a **rejection** (`410` per T-031), never a fallback to a default circle — GR-019 forbids the sentinel that would make it one.
    - **Tests**: unit (each schema accepts a valid fixture and rejects every malformed variant) **AND** integration (regenerate-and-diff clean; the generated package's exports resolve and its `CONTRACT_HASH` equals the service's).

- [ ] **T-102\*\*** Author `digitization-service`'s wire contract as zod and generate `@kitchensink/schema-digitization`; **Files**: `packages/services/digitization-service/src/digitization/digitization.schema.ts`, `src/digitization/jobs.schema.ts`, `packages/schemas/digitization/*`. **Depends on**: T002, T019. **Blocks**: T038, T039, T040, T041, T042, T043. [US-001, US-002, US-007, FR-027, FR-028, FR-029, GR-015 §15-a, GR-017 §17-a.1/§17-a.3]
    - **Acceptance**: Job creation, cursor-paginated list, status/result retrieval, correction PATCH, save and discard shapes authored **beside their controllers**, with the same import constraint and the same generated package shape as T-101. The **`parsed_json` correction payload** and the **job-status projection** are the load-bearing shapes: both cross the API↔worker↔UI boundary, and a per-surface re-declaration drifts silently.
    - **⛔ `raw_ocr_json` is the OCR provider's raw shape and does NOT belong in the schema package** as though we owned it — see T-104. Only our own job/correction/save envelopes are ours.
    - **⚠️ RFC7807 problem-details (T-046) is a response contract**, so its shape is authored here once and shared with `circles-service` rather than re-typed per service. ⛔ But authoring it does **not** license **server-side response validation**, which GR-016 §16-g **defers** — a producing service parsing what it emits is an owner decision, not an unfinished task. Do not add it.
    - **Tests**: unit (each schema accepts a valid fixture and rejects every malformed variant; the correction payload rejects an unknown field) **AND** integration (regenerate-and-diff clean; `CONTRACT_HASH` parity).

- [ ] **T-103\*\*** Wire all three drift gates for BOTH services — `contract:generate`, turbo `$TURBO_ROOT$` `inputs`, and a `CONTRACT_HASH` boot assertion; **Files**: `packages/services/circles-service/package.json`, `packages/services/digitization-service/package.json`, `turbo.json`, both services' `src/main.ts`. **Depends on**: T101, T102. [FR-027, NFR-005, GR-015 §15-c, GR-017 §17-a.2/§17-a.4]
    - **Acceptance**: Each service declares `contract:generate` so `scripts/contractOwners.mjs` `discoverContractOwners` finds it **with no list edit** (a hardcoded list of services is itself the defect GR-017 names), and `npm run contract:verify` regenerates and fails on any diff. `turbo.json` gives each `schema-*#build` `$TURBO_ROOT$`-anchored **`inputs`** covering that service's `src/**/*.schema.ts`. Each service asserts `CONTRACT_HASH` equality against its schema package **at boot** and **refuses to start** on mismatch, **before** the HTTP listener binds.
    - **⛔ NOT `dependsOn`** — `schema-<service>#build` `dependsOn` `<service>#build` closes the cycle `client → schema → service → client` and turbo rejects the graph. The generated files are committed, so ordering was never the requirement; content-hashed `inputs` are.
    - **⚠️ The boot assertion is the gate that matters most for 011**, because `circles-service` ships **independently of** 001/006/007 — the consumers of its `circle` audience scope — so it is the layer that catches circles deploying ahead of a consumer's pinned schema, including a released mobile binary.
    - **Tests**: unit (per service: `src/__tests__/buildInputs.test.ts` asserting every authored `*.schema.ts` is covered by the declared glob, and `src/__tests__/mainBootOrder.test.ts` asserting the hash check precedes `listen()` and a skewed hash throws — modelled on `packages/services/recipe-service/src/__tests__/{build-inputs,main-boot-order}.test.ts`) **AND** integration (`scripts/contractDriftGate.mjs` clean on a fresh checkout, red on a hand-edited schema package; boot with a skewed hash binds no port).

- [ ] **T-104\*\*** Register **`nestjs-zod`'s** `ZodValidationPipe` on both services with `z.strictObject()` mutating bodies, add the storage-floor parity tests, and parse every non-HTTP ingress; **Files**: both services' `src/app.module.ts`, `src/**/__tests__/storageCapacity.test.ts`, `packages/services/digitization-workers/src/handlers/sqs-ocr.handler.ts`, `packages/services/digitization-workers/src/providers/*.schema.ts`. **Depends on**: T101, T102, T017, T049, T050. [FR-030, NFR-005, GR-016, GR-017 §17-a.5/§17-c/§17-d, GR-018, GR-019]
    - ⛔ **DO NOT BUILD A NEW GATE — the mechanism already EXISTS.** `@kitchensink/contract-gen` exports `auditStorageCapacity` / `collectBoundedColumns` / `formatStorageCapacityFindings` (`packages/tools/contract-gen/src/storageCapacity.ts`), and a `storageCapacity.test.ts` already wires it in **all three** shipped services (recipe `src/database/__tests__/`, food `src/db/schema/__tests__/`, identity `src/types/schema/__tests__/`). Copy that pattern; do not hand-roll a second one — a second mechanism for one invariant is the failure GR-016 §16-a.2 forbids, one layer up. It reads drizzle **structurally** via `Symbol.for('drizzle:Columns')` (so `contract-gen` needs no `drizzle-orm` dependency) and zod bounds via the **public** `z.toJSONSchema`; it is already **exhaustive over columns**, with `stale-account` / `duplicate-account` findings as the reverse-direction check. The work here is the **mapping**: every bounded column bound to the wire fields that write it, or declared not-client-writable **with a reason** (GR-017 §17-d).
    - **Acceptance (pipe)**: Each service binds **`nestjs-zod`'s** `ZodValidationPipe` via `APP_PIPE` and every route takes a `createZodDto` DTO for body, path params and query params. **One** mechanism per service; **no `class-validator` DTO** anywhere in either — a new service starts with one mechanism, and recipe-service's **19 residual `class-validator` files** (measured 2026-08-12) are the two-mechanism state these must not reproduce. Every mutating body uses **`z.strictObject()`**.
    - **⚠️ Invisible-by-construction failure**: under Nest's **own** `ValidationPipe` a `createZodDto` DTO **validates nothing while looking correctly wired** — schema present, DTO referenced, route reads as validated, no input checked. This already bit identity's `PATCH /users/me`. The **only** observation is a test that posts a known-bad body to a **real** route and asserts the `400`.
    - **Acceptance (storage floor)**: One parity test **per service**, living **in the service**, importing **both** the drizzle schema and the authored zod (a test is not a wire schema, so §16-d's ban on the _production_ coupling is untouched), **deriving** the bounded-column enumeration from the drizzle schema, and asserting each writing wire field **rejects** a value the column cannot hold — circle `name` length, member role and job-state enum domains (`pending|processing|awaiting-correction|saved|discarded`), `batch_id` and the **20-photos-per-session** cap, cursor page size (default 20), confidence numeric range, `language_code`, nullability. Mapping completeness asserted in **BOTH** directions: every bounded column has an entry or an explicit reasoned exemption, and every entry names a column that exists. **⛔ Asserted, never derived** — no zod from drizzle, no storage type in a `*.schema.ts`.
    - **Acceptance (non-HTTP ingress, enumerated)**: (1) the **SQS OCR queue consumer** (T-049); (2) the **OCR provider's response** — see the third-party note below; (3) the **owner-account-deletion** lifecycle event (T-034); (4) the **scheduled** raw-OCR purge (T-082) and outlier-monitor runs (T-081). Each parses its payload against an authored zod before it becomes work — **including the scheduled ones**, because "the payload is ours" is an assumption about a deploy that has already drifted once. Rejections take **one** path per ingress with the cause in a **`reason`** field; a shape failure and a credential failure are **equally invalid** and differ only in `reason`.
    - **⚠️ GR-018 vs T-049's partial-batch-failure reporting — these interact, and getting it wrong is the defect.** An **invalid** payload is **NEVER retried**: it is recorded and the message **completed** (or dead-lettered **once** with the `reason`), so it must **not** be reported in `batchItemFailures`, which is a request for redrive. A **transient** failure — provider timeout, DB error, a `5xx` — is a **different** `reason` and **is** legitimately reported for redrive. T-056's DLQ-redrive test must distinguish the two rather than treating every failure as retryable. **⛔ A rejected event is NOT recorded as a row**, and an unresolvable `job_id`/`user_id` is a **rejection**, never `'unknown'`/`''`/`0` — including as a metrics dimension, where a sentinel fuses every unattributable job into one fictitious subject (GR-019).
    - **Tests**: unit (per-DTO accept/reject and unknown-key rejection; each ingress envelope rejects every malformed variant; the rejection shape differs only in `reason`; the parity assertions) **AND** integration (a known-bad body on a **real** route yields `400` naming the field, modelled on `packages/services/identity/tests/appValidation.test.ts`; a ceiling-exceeding value yields `400` not a failed `INSERT`; an **invalid** queue payload is asserted **not** redriven while a **transient** failure **is**, **and** a valid payload still succeeds — both halves) **AND** e2e (each service's `tests/e2e/*.e2e.test.ts` over HTTP against real Postgres + LocalStack) **AND** k6 (`packages/tools/loadtest/` — both services are deployables and owe the tier per §7.1/GR-017 §17-a.8).

- [ ] **T-105\*\*** Create `packages/clients/circles` — typed, declaring no wire shape, validating responses on receipt and bodies before send; **Files**: `packages/clients/circles/*`. **Depends on**: T101, T027, T028. **Blocks**: T063, T064, T065. [US-003, US-004, US-006, FR-027, GR-015 §15-b, GR-016 §16-c.2/§16-c.3, GR-017 §17-b.1–§17-b.4]
    - **Acceptance**: Imports wire **types and runtime zod** from `@kitchensink/schema-circles`; its own `types.ts` holds only config, options and its own error shapes — **no** wire shape, including type-only. **Every response is parsed the moment it arrives**; **every outbound body is validated against the callee's schema-package zod before the call**, so a malformed payload fails in the caller with a usable stack rather than as a remote `400`. RFC7807 problem-details responses are parsed too, not just happy paths. Reference: `packages/clients/recipe-service`.
    - **⛔ Do NOT add server-side response validation** — GR-016 §16-g defers a **producing service** parsing what it **emits**. This task is the **consumer** parsing what it **received** (GR-017 §17-f); only this half is required.
    - **Tests**: unit (each method's happy path and every mapped error status, including the revoked-token `410`; a response with a missing, renamed or wrong-typed field raises the typed parse error; an invalid outbound body is rejected before any fetch) **AND** integration (`src/__integration__/*.integration.test.ts` against a booted service, modelled on `packages/clients/recipe-service/src/__integration__/client.integration.test.ts`).

- [ ] **T-106\*\*** Create `packages/clients/digitization` on the same terms, plus contract-skew guards for BOTH clients; **Files**: `packages/clients/digitization/*`, `packages/clients/circles/src/contractSkew.ts`, `packages/clients/digitization/src/contractSkew.ts`. **Depends on**: T102, T105, T038, T040. **Blocks**: T057, T058, T059, T060, T062. [US-001, US-002, US-007, GR-015 §15-b/§15-c, GR-017 §17-b.1–§17-b.5]
    - **Acceptance**: Same obligations as T-105 for the digitization endpoints. **Each** client carries a **contract-skew guard** so a pinned-stale schema package is **detected rather than inferred** from a runtime parse failure, modelled on `packages/clients/food-service/src/contractSkew.ts` and `packages/clients/recipe-service/src/contractSkew.ts`. Each guard reports only what it actually compared — it must not overclaim.
    - **Tests**: unit (`src/__tests__/contractSkew.test.ts` per client, modelled on the two existing ones: matching hash passes, skewed hash is reported, the report names both hashes; plus each method's happy path and mapped errors) **AND** integration (each guard run against its live service's advertised hash).

- [ ] **T-107\*\*** ⛔ Boundary-validate the OCR provider — the §15-d OPPOSITE case — and never converge it; **Files**: `packages/services/digitization-workers/src/providers/textract-response.schema.ts`, `src/providers/textract.adapter.ts`. **Depends on**: T050, T093. **Augments**: T050, T051, T052. [FR-006, FR-007, FR-008, NFR-001, GR-015 §15-d, GR-016 §16-b, GR-017 §17-b.6]
    - **⛔ Textract (and any provider swapped in behind T-093's `OcrProvider` seam) is an API we do NOT serve.** There is no service of ours to own its types and its contract can change without telling us.
    - **Acceptance**: The adapter **validates the raw upstream shape at the boundary with its own zod**, the moment a body arrives — blocks, geometry, per-token confidences, detected language. It **MAY declare its own types**, and the normalized `parsed_json` it produces (T-051, T-052) **deliberately differs** from the raw provider shape: that difference **is** the normalization, not drift. **NO OpenAPI document is written** for the provider. Rules 17-b.1–17-b.5 do **not** apply to this adapter, and `raw_ocr_json` is stored as the provider's shape rather than pretending to be ours.
    - **⛔ "Converging" this adapter under §15-b DELETES a validation boundary — a security regression, not a consistency win.** `packages/clients/usda/src/schemas.ts` is the reference implementation and must **NEVER** be touched in this rule's name. ⚠️ **OCR output is INPUT to us**: it is attacker-influenced (the user supplies the photo), it drives the confidence gate that decides `awaiting-correction + low_quality` (T-053), and its boundary parse is **required** by GR-016 — not merely permitted by §15-d.
    - **Tests**: unit (the boundary schema rejects a renamed, missing, wrong-typed and null-valued upstream field; an absent confidence is a rejection, never a defaulted `0` — a sentinel confidence would silently pass the quality gate; the normalized output is asserted **independent** of the raw shape) **AND** integration (recorded real provider payloads parse clean; a mutated payload is rejected at the boundary and drives **no** writeback).

- [ ] **T-108\*\*** Make every consumer depend on the schema/client LEAF — never on `@kitchensink/circles-service` — and derive divergent shapes; **Files**: `packages/apps/commise/web/src/features/{digitization,circles}/*`, `packages/apps/commise/mobile/src/features/{digitization,circles}/*`, `packages/services/digitization-service/src/audience/*`, consumer packages in 001/006/007. **Depends on**: T105, T106. **Augments**: T047, T063, T064, T065, T073. [US-005, US-006, FR-031, FR-033, GR-015 §15-b.2/§15-b.3/§15-b.4, GR-017 §17-b.1, CODING_STANDARDS §14.1]
    - **⛔ A consumer MUST NOT depend on `@kitchensink/circles-service` itself**, per `plan.md` L346 and `spec.md` L353. The `CirclesService` interface those documents sketch describes the **capability**, not the dependency edge. Importing the deployable is ADR-0014's **rejected alternative 2**: it drags NestJS, Drizzle and the AWS SDK into web, mobile and every consuming service, and **inverts the build order**. Consumers depend on **`packages/clients/circles` + `@kitchensink/schema-circles`**, and `packages/infra/global/__tests__/appServiceDependency.test.ts` already forbids the app→service edge.
    - **⚠️ FLAGGED, NOT FIXED HERE — a contradicting acceptance criterion survives upstream.** 011's **`spec.md` _Acceptance Criteria_ item 2 still says 001 "imports `@kitchensink/circles-service`"**, which `spec.md` L353 itself then corrects. `spec.md` is **not** editable from this task list; this note is the record that the criterion contradicts the ratified rule and must be amended by that document's owner. **Do not implement item 2 as written.**
    - **Acceptance**: No file in `packages/clients/*`, `@commise/web`, `@commise/mobile`, any feature package, or any _other_ service declares a circles or digitization request/response body type. Divergent consumer shapes — the correction workspace's token view model, the job-queue list item, the audience picker's circle option — are **DERIVED** with `Pick`/`Omit`/`Partial`/mapped types. Reference implementation: `packages/apps/commise/features/recipes/src/filters/model.ts`. Web and mobile ship in the **same release** (§14.1), with `.native.ts(x)` for platform-specific files, and all copy goes through the localization path.
    - **Tests**: unit (each derived model asserted **assignable from** its wire parent, so a wire change breaks the derivation instead of drifting past it) **AND** integration (a parser-based guard over `git ls-files` asserting no client/app/consumer file declares one of these wire shapes, modelled on `packages/infra/global/__tests__/appServiceDependency.test.ts` — ⚠️ this repo-wide guard **does not exist yet**; see GR-017's enforcement table) **AND** **vitest component tests for EVERY path/state on BOTH platforms** (extending T-067) **AND** **Playwright** (extending T-074, T-075) **AND** a **Maestro** flow per story — ⚠️ 011 currently specifies **no** Maestro flow at all, which §14.1 requires for every mobile surface T-057…T-065 builds.

## Phase 15 — On-device-first OCR, the escape hatch, and the reaper (added 2026-08-16)

> Three things the 2026-08-16 amendment in [`spec.md`](./spec.md) adds. They are one phase because they are
> one causal chain: on-device OCR is what makes digitization cheap and private; a confidence heuristic
> **cannot** catch a result that is wrong-but-confident, so an escape hatch is mandatory rather than a nicety;
> and moving state out of a database gives every artifact a lifetime, which needs a reaper.

- [ ] **T-109\*\*** [P] Implement the **3-day reaper** over in-flight digitization artifacts — a scheduled sweep deleting every object under `digitization/{user_id}/{job_id}/` older than 72 h, whatever state its job is in, with an S3 lifecycle rule as the backstop; **Files**: `packages/services/digitization-service/src/retention/artifact-reaper.job.ts`. **Depends on**: T-054. **Replaces**: T-016, T-082. [FR-036, NFR-008, C-005]
    - **Why 3 days, and why it is not a new number**: it is [ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md)'s window — its title, its §2 (`expiresAt = publishedAt + 72h`), and its 2026-08-16 amendment table, whose **message substrate** row reads "3-day TTL, reaped". 011's status messages for a job live in that substrate and expire with it. An artifact that outlived the messages describing it would be unreachable state: nothing left to tell a consumer it exists. Aligning them means one window to reason about, not two.
    - ⛔ **Nothing refreshes the clock.** Not a retry, not a poll, not the user reopening the correction screen. The 72 hours are a promise about how long an artifact **lives**, not a budget inactivity can top up — the same rule ADR-0016 §2 states for a notification, and for the same reason: a refreshable expiry has no bound.
    - ⚠️ **A reaped job is a USER-VISIBLE outcome, not a silent cleanup.** A job still awaiting correction at 72 h loses its photo and its parse. The UI MUST say so, in localized copy, before it happens and after; a job that simply vanishes reads as data loss. The corrected recipe is unaffected — once submitted (T-042) it is the recipe service's, and no reaper touches it.
    - **Acceptance**: an artifact at 71 h survives a run and at 73 h does not; reruns are idempotent; a failed delete alarms rather than being retried forever; the S3 lifecycle rule deletes anything the sweep missed.
    - **Tests**: unit (cutoff arithmetic across a DST boundary and a leap second, and the "state does not matter" branch) **AND** integration (against LocalStack S3, asserting deletion on every job state including `awaiting-correction`, and that a submitted job's recipe is untouched).

- [ ] **T-110\*\*** Implement the **on-device-first OCR tier**: run the platform text recognizer on the device (Vision on iOS, ML Kit on Android) before any upload; if it yields a usable parse the image **never leaves the device** and no cloud OCR is billed; **Files**: `packages/apps/commise/mobile/src/features/digitization/ocr/*.native.ts`, `packages/apps/commise/features/digitization/src/ocr/*`. **Depends on**: T-037. [US-001, FR-006, NFR-002]
    - **Escalation is by CAPABILITY, not by score**: no recognizer available, an unsupported script, a device-side failure, or a user-initiated escalation (T-111) sends the job to the cloud tier. A confidence threshold MAY route a _low_-confidence result to the cloud, but MUST NOT be the only path there — see T-111 for why.
    - ⛔ **A device result is still UNTRUSTED INPUT.** It is parsed with zod at the service boundary exactly as a cloud result is (GR-016). A client that can post arbitrary "OCR output" is a client that can post arbitrary recipe content, and the fact that our own code produced it on the user's phone changes nothing about who controls the phone.
    - ⚠️ **An absent confidence MUST REJECT, never default to `0`** — the same rule the cloud adapter inherits from 004's T-018. A sentinel confidence silently passes the quality gate.
    - **Acceptance**: a legible printed page completes with **zero** network calls to the OCR provider; an unsupported script escalates; a device failure escalates rather than failing the job.
    - **Tests**: unit against a faked recognizer (clear print, handwriting, empty result, missing confidence, unsupported script) **AND** vitest component tests for **every** state on both platforms **AND** a **Maestro** flow covering the on-device path end to end.

- [ ] **T-111\*\*** Implement the **manual "re-run in the cloud" escape hatch**: an always-available control on the correction screen that re-runs OCR on the cloud tier for a job whose on-device parse the user judges wrong, regardless of what the confidence said; **Files**: `packages/apps/commise/features/digitization/src/correction/RerunInCloud*.tsx`, `packages/services/digitization-service/src/digitization/controllers/rerun-job.controller.ts`. **Depends on**: T-110, T-041. [US-002, FR-011, FR-017]
    - ⛔ **THE FAILURE MODE THIS EXISTS FOR, stated so it is not optimised away: a confidence heuristic cannot catch a result that is WRONG BUT CONFIDENT.** Confidence measures how sure the recognizer is that it read the _glyphs_ correctly — it says nothing about whether it read the _right_ glyphs. A recognizer that confidently reads `1 tsp salt` as `1 tbsp salt`, or drops a line it never saw, returns a high score for a wrong answer. Every automatic path in this feature keys off that score, so **every automatic path is blind to this class**. The user is the only detector, and the escape hatch is the only thing that lets them act on it. **It MUST NOT be gated behind a low-confidence condition** — that gate is precisely the blind spot.
    - The control is **not** an error state: it is available on a job the system considers a success, because those are the ones that need it.
    - Re-running is **idempotent per attempt** and rate-limited; it does not create a second job or a second recipe.
    - **Acceptance**: the control is reachable on a job with a **perfect** confidence score; a re-run replaces the parse in place and preserves corrections the user already made; two rapid taps produce one cloud call.
    - **Tests**: unit (the control's enablement does **not** depend on confidence — a mutation lens: raising the fixture's score to 1.0 must not hide it) **AND** component tests for every state on both platforms **AND** an integration test asserting one provider call per re-run.

- [ ] **T-112\*\*** Publish 011's per-job status to the message substrate under the group key `('import', jobId)`, and assert the **single-writer-per-group** invariant that makes consumer-side timestamp selection safe; **Files**: `packages/services/digitization-workers/src/status/publish.ts`. **Depends on**: T-054. [FR-013, FR-029]
    - ⛔ **The invariant, from [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md) §4 as amended 2026-08-16**: selection per group is consumer-side, **most-recent-by-timestamp wins**, and that is correct **only while one writer produces a group's messages**. 011 satisfies it because a digitization job is created by one request, processed by one worker invocation, and owned end to end by that job — no other producer writes `('import', jobId)`. The escape hatch (T-111) re-runs **in sequence**, never concurrently, which is part of why it is idempotent per attempt rather than fire-and-forget.
    - ⛔ **No monotonic sequence.** The envelope carries none; a fire-and-forget producer cannot issue one, and there is no single writer of "the last sequence I used" across concurrent tasks.
    - **Acceptance**: two writers for one job id is unrepresentable in the design, and the test that proves it is a **concurrency** test, not an assertion about a comment.
    - **Tests**: unit (the group key is derived from the job id and nothing else) **AND** an integration test running two overlapping re-runs and asserting they serialise rather than interleaving.

### Condition → Task Map

| Condition | Resolved By                                                                              | Status                     |
| --------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| C-A-001   | T093                                                                                     | Pending                    |
| C-A-002   | T094                                                                                     | Pending                    |
| C-A-003   | T095                                                                                     | Pending                    |
| C-D-001   | Decision recorded in `pre-impl-review.md` Notes (code-first review at code-review phase) | **Decided 2026-05-10**     |
| C-D-002   | T096                                                                                     | Pending                    |
| C-D-003   | Already covered by existing **T062** (Accept-All CTA for US-009)                         | **Resolved (no new task)** |
| C-D-004   | T097                                                                                     | Pending                    |
| C-R-001   | T098                                                                                     | Pending                    |
| C-R-002   | T099 + T100                                                                              | Pending                    |
