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
      -> Circles API (T-026..T-036, T-098)
      -> Digitization API (T-037..T-048)
        -> OCR Lambda (T-049..T-056)
          -> Frontend (T-057..T-067, T-096)
            -> Integration Tests (T-068..T-073)
              -> E2E Tests (T-074..T-076)
    -> Observability (T-077..T-081)
    -> Privacy / Cleanup (T-082..T-084)
Workspace + Schema + APIs + OCR + Frontend -> Deployment / CDK (T-085..T-092)
```

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
- [ ] **T-011\*\*** [P] Create Drizzle migration for `digitization_jobs` table with `raw_ocr_json`, `parsed_json`, `batch_id`, state fields and query indexes; **Files**: `packages/services/digitization-service/src/db/migrations/011_004_create_digitization_jobs.sql`, `packages/services/digitization-service/src/db/schema/digitization-jobs.ts`. **Depends on**: T002. [US-001, US-007, FR-013, FR-020, FR-028, FR-029]
- [ ] **T-012\*\*** [P] Create Drizzle migration for `recipe_versions` append-only history table used by correction/save flows; **Files**: `packages/services/digitization-service/src/db/migrations/011_005_create_recipe_versions.sql`, `packages/services/digitization-service/src/db/schema/recipe-versions.ts`. **Depends on**: T002. [US-002, FR-015, FR-021]
- [ ] **T-013\*\*** Create Drizzle migration to normalize/extend `recipes.audience` JSONB for `circle` scope with `ref_id`; **Files**: `packages/services/digitization-service/src/db/migrations/011_006_alter_recipes_audience.sql`, `packages/services/digitization-service/src/db/schema/recipes.ts`. **Depends on**: T011. [US-005, US-006, FR-033]
- [ ] **T-014\*\*** Add migration-level DB function/procedure for circle deletion audience fallback-to-private (single transaction semantics); **Files**: `packages/services/circles-service/src/db/migrations/011_007_circle_delete_audience_fallback.sql`. **Depends on**: T008, T009, T013. [US-005, FR-033, C-002]
- [ ] **T-015\*\*** Add migration-level DB function/procedure for owner deletion promotion (oldest member) and empty-circle soft-delete path; **Files**: `packages/services/circles-service/src/db/migrations/011_008_owner_deletion_promotion.sql`. **Depends on**: T008, T009. [US-006, FR-035, C-004]
- [ ] **T-016\*\*** Add migration-level retention procedure for `raw_ocr_json` nullification after 90 days and supporting index on `updated_at/created_at`; **Files**: `packages/services/digitization-service/src/db/migrations/011_009_raw_ocr_retention.sql`. **Depends on**: T011. [FR-036, NFR-008, C-005]
- [ ] **T-017\*\*** [P] Update Drizzle relation maps and typed repositories to include circles/members/invites/jobs/versions entities; **Files**: `packages/services/circles-service/src/db/schema/index.ts`, `packages/services/digitization-service/src/db/schema/index.ts`, repository files. **Depends on**: T008, T009, T010, T011, T012, T013. [FR-020, FR-031]
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

- [ ] **T-037\*\*** Implement digitization job domain/repository/state machine (`pending|processing|awaiting-correction|saved|discarded`) backed by `digitization_jobs`; **Files**: `packages/services/digitization-service/src/digitization/domain/*`, `src/digitization/repositories/*`. **Depends on**: T011, T017. [US-001, US-002, FR-029]
- [ ] **T-038\*\*** Implement `POST /api/v1/recipes/digitize/jobs` endpoint to validate payload constraints and return pre-signed S3 PUT URL + job metadata; **Files**: `packages/services/digitization-service/src/digitization/controllers/create-job.controller.ts`, upload service. **Depends on**: T037, T007. [US-001, FR-001, FR-004, FR-027, NFR-002]
- [ ] **T-039\*\*** [P] Implement `GET /api/v1/recipes/digitize/jobs` cursor pagination endpoint (default size 20) and ordering by recency; **Files**: `packages/services/digitization-service/src/digitization/controllers/list-jobs.controller.ts`. **Depends on**: T037. [US-007, FR-028, FR-029]
- [ ] **T-040\*\*** [P] Implement `GET /api/v1/recipes/digitize/jobs/:id` status/result retrieval endpoint with ownership checks; **Files**: `packages/services/digitization-service/src/digitization/controllers/get-job.controller.ts`. **Depends on**: T037. [US-001, FR-013, FR-029]
- [ ] **T-041\*\*** Implement `PATCH /api/v1/recipes/digitize/jobs/:id/correction` endpoint for inline edits to parsed fields and confidence overrides; **Files**: `packages/services/digitization-service/src/digitization/controllers/patch-correction.controller.ts`. **Depends on**: T037. [US-002, FR-015, FR-017]
- [ ] **T-042\*\*** Implement `POST /api/v1/recipes/digitize/jobs/:id/save` endpoint creating recipe + linking `recipe_id` + version row append; **Files**: `packages/services/digitization-service/src/digitization/controllers/save-job.controller.ts`, recipe integration service. **Depends on**: T012, T013, T041. [US-001, US-005, FR-021]
- [ ] **T-043\*\*** [P] Implement `DELETE /api/v1/recipes/digitize/jobs/:id` soft-discard endpoint preserving S3 object retention metadata; **Files**: `packages/services/digitization-service/src/digitization/controllers/discard-job.controller.ts`. **Depends on**: T037. [US-007, FR-022]
- [ ] **T-044\*\*** Implement upload-session batching (`batch_id`) service for up to 20 photos per session with per-photo job creation semantics; **Files**: `packages/services/digitization-service/src/digitization/services/batch-jobs.service.ts`. **Depends on**: T038. [US-007, FR-003, FR-005]
- [ ] **T-045\*\*** [P] Implement correction workflow helper for `accept-all` path when no low-confidence tokens are present; **Files**: `packages/services/digitization-service/src/digitization/services/accept-all.service.ts`. **Depends on**: T041. [US-002, FR-016]
- [ ] **T-046\*\*** [P] Implement standardized RFC7807 problem-details filter/middleware with `error_code` mapping for digitization API errors; **Files**: `packages/services/digitization-service/src/http/problem-details.filter.ts`, error code map. **Depends on**: T038, T040, T041, T043. [US-001, FR-030]
- [ ] **T-047\*\*** Implement circles-audience integration at save/share boundary so recipes can target `circle` audience via shared contract; **Files**: `packages/services/digitization-service/src/audience/*`, save/share service updates. **Depends on**: T019, T021, T042. [US-005, US-006, FR-033]
- [ ] **T-048\*\*** Add digitization-api unit/controller/integration tests across create/list/get/correction/save/discard/batch/accept-all and auth/path contract checks; **Files**: `packages/services/digitization-service/src/**/__tests__/*.test.ts`, `packages/services/digitization-service/tests/*.integration.test.ts`. **Depends on**: T039, T040, T041, T042, T043, T044, T045, T046, T047. [US-001, US-002, US-007, FR-027, FR-030]

---

## Phase 6 — `@kitchensink/digitization-workers` Lambda

- [ ] **T-049\*\*** Implement SQS event handler with partial batch failure reporting and idempotent job lock/update semantics; **Files**: `packages/services/digitization-workers/src/handlers/sqs-ocr.handler.ts`. **Depends on**: T011, T037. [US-001, FR-013, NFR-006]
- [ ] **T-050\*\*** [P] Implement Textract adapter module with timeout budget, retries, and provider abstraction seam for deferred Q-001 provider swaps; **Files**: `packages/services/digitization-workers/src/providers/textract.adapter.ts`, interface files. **Depends on**: T004, T007. [FR-006, NFR-001]
- [ ] **T-051\*\*** Implement OCR normalization parser mapping raw provider output into structured recipe fields (`title`, `ingredients`, `steps`, times, yield); **Files**: `packages/services/digitization-workers/src/parsing/normalize-ocr-result.ts`. **Depends on**: T050. [US-001, FR-007]
- [ ] **T-052\*\*** [P] Implement confidence extraction + `language_code` mapping and writeback to `parsed_json`/job fields; **Files**: `packages/services/digitization-workers/src/parsing/confidence-map.ts`. **Depends on**: T050, T051. [US-008, FR-008, FR-009, FR-010, FR-011, FR-012]
- [ ] **T-053\*\*** Implement low-quality fallback state transitions (`awaiting-correction + low_quality`) when OCR quality threshold is not met; **Files**: `packages/services/digitization-workers/src/workflow/quality-gate.ts`. **Depends on**: T052. [US-008, FR-011, FR-017]
- [ ] **T-054\*\*** [P] Implement persisted writeback service for `raw_ocr_json` + `parsed_json` + state transitions using internal DB/API client; **Files**: `packages/services/digitization-workers/src/persistence/job-writeback.service.ts`. **Depends on**: T049, T051, T052. [FR-020, FR-029]
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

- [ ] **T-082\*\*** Implement scheduled purge worker/service that nullifies `raw_ocr_json` older than 90 days while preserving `parsed_json`; **Files**: `packages/services/digitization-service/src/retention/raw-ocr-purge.job.ts`. **Depends on**: T016. [FR-036, NFR-008, C-005]
- [ ] **T-083\*\*** [P] Add purge metrics/events (`raw_ocr_json.purged.count`, failures, stale-record gauge) and structured audit logs for retention runs; **Files**: `packages/services/digitization-service/src/retention/metrics.ts`. **Depends on**: T082. [FR-036, NFR-008]
- [ ] **T-084\*\*** Add integration tests validating retention cutoff behavior (89d retain, 90d+ purge) and idempotent reruns; **Files**: `packages/services/digitization-service/tests/raw-ocr-retention.integration.test.ts`. **Depends on**: T082, T083. [FR-036, C-005]

---

## Phase 12 — Deployment / CDK

- [ ] **T-085\*\*** Add CDK stack scaffold under feature infra path for digitization + circles resources and environment wiring; **Files**: `specs/011-recipe-digitization/infra/stacks/recipe-digitization-stack.ts`, supporting `bin/*`. **Depends on**: T001, T007. [NFR-005]
- [ ] **T-086\*\*** [P] Add CDK resources for OCR Lambda deployment package, IAM execution role/policies, and environment variable bindings; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/ocr-lambda.ts`. **Depends on**: T085, T049, T050. [FR-006, NFR-001]
- [ ] **T-087\*\*** [P] Add CDK SQS queue + DLQ resources (redrive policy, visibility timeout, alarms) and event source mapping to OCR Lambda; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/ocr-queue.ts`. **Depends on**: T085, T049. [FR-013, NFR-006]
- [ ] **T-088\*\*** [P] Add CDK S3 bucket/prefix policy for digitization uploads (`digitization/{user_id}/{job_id}`), KMS/encryption defaults, and signed PUT constraints; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/digitization-bucket.ts`. **Depends on**: T085, T038. [FR-001, FR-019, NFR-002]
- [ ] **T-089\*\*** [P] Add CDK CloudFront distribution/behavior for serving archived original photos with restricted origin access; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/digitization-cloudfront.ts`. **Depends on**: T085, T088. [FR-019]
- [ ] **T-090\*\*** Add CDK wiring for `digitization-api` and `circles-api` runtime deployment integration (service env, secrets, IAM access to S3/SQS/DB); **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/apis.ts`. **Depends on**: T085, T038, T031, T047. [FR-027, NFR-005]
- [ ] **T-091\*\*** Add CDK/EventBridge schedules for daily raw OCR purge and outlier-monitor check jobs with alarm targets; **Files**: `specs/011-recipe-digitization/infra/stacks/constructs/schedules.ts`. **Depends on**: T081, T082, T085. [FR-036, NFR-007, NFR-008, C-003, C-005]
- [ ] **T-092\*\*** Add infra validation tests/synth checks and deployment runbook updates for 011 resources (Lambda, SQS/DLQ, S3, CloudFront, alarms); **Files**: `packages/services/digitization-service/infra/__tests__/*.test.ts`, `specs/011-recipe-digitization/infra/README.md`. **Depends on**: T086, T087, T088, T089, T090, T091. [NFR-001, NFR-006]

---

## Cross-Validation (Product Forge Step 4)

| Check                                                  | Status | Notes                                                                                                                     |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Every Must Have US-NNN has ≥1 implementation task?     | ✅     | US-001..US-006 all mapped in tasks and coverage matrix.                                                                   |
| Every FR-NNN has ≥1 corresponding task?                | ✅     | FR-001..FR-036 each mapped to at least one task ID.                                                                       |
| Every NFR has ≥1 corresponding task?                   | ✅     | NFR-001..NFR-008 each mapped.                                                                                             |
| Clarifications C-001..C-005 have explicit tasks?       | ✅     | C-001: T030/T031/T070; C-002: T014/T033/T071; C-003: T035/T081/T091; C-004: T015/T034/T072; C-005: T016/T082/T084/T091.   |
| Test / validation tasks included per task group?       | ✅     | Unit/integration/E2E/contract/migration/infra tests included (T018, T036, T048, T055, T056, T067, T068-T076, T084, T092). |
| No orphan tasks (tasks without traceable requirement)? | ✅     | All tasks include requirement brackets.                                                                                   |
| Task granularity appropriate (≤1-2h each)?             | ✅     | Large vertical slices split into API/DB/UI/test/infra sub-tasks.                                                          |
| Dependency order sensible?                             | ✅     | Setup → schema/shared → APIs/OCR → frontend → testing/observability/privacy/deploy.                                       |

---

## Coverage Matrix

### User Stories

| ID     | Task IDs                                                               |
| ------ | ---------------------------------------------------------------------- |
| US-001 | T002, T037, T038, T040, T042, T049, T051, T057, T067, T068, T074       |
| US-002 | T012, T041, T045, T059, T060, T062, T066, T067, T069, T074             |
| US-003 | T003, T008, T027, T028, T030, T036, T063, T067, T070, T075             |
| US-004 | T009, T031, T036, T064, T067, T070, T075                               |
| US-005 | T013, T014, T019, T033, T042, T047, T065, T071, T073                   |
| US-006 | T009, T019, T021, T026, T028, T032, T034, T047, T063, T065, T072, T073 |

### Functional Requirements

| ID     | Task IDs                     |
| ------ | ---------------------------- |
| FR-001 | T038, T088                   |
| FR-002 | T057                         |
| FR-003 | T044, T058                   |
| FR-004 | T038, T057                   |
| FR-005 | T044, T058                   |
| FR-006 | T050, T068, T086             |
| FR-007 | T051                         |
| FR-008 | T052                         |
| FR-009 | T052                         |
| FR-010 | T052                         |
| FR-011 | T052, T053, T080             |
| FR-012 | T052                         |
| FR-013 | T040, T049, T056, T068, T087 |
| FR-014 | T059, T074                   |
| FR-015 | T041, T060, T074             |
| FR-016 | T045, T062                   |
| FR-017 | T041, T053, T061             |
| FR-018 | T059                         |
| FR-019 | T038, T088, T089             |
| FR-020 | T011, T054                   |
| FR-021 | T042, T069, T074             |
| FR-022 | T043                         |
| FR-023 | T066, T076                   |
| FR-024 | T066, T076                   |
| FR-025 | T061, T076                   |
| FR-026 | T064, T066, T076             |
| FR-027 | T038, T046, T048, T063, T090 |
| FR-028 | T039                         |
| FR-029 | T037, T040, T054, T068       |
| FR-030 | T046, T048, T036, T079       |
| FR-031 | T010, T027, T030, T070, T073 |
| FR-032 | T031, T064, T070, T075       |
| FR-033 | T014, T033, T071, T073       |
| FR-034 | T032, T035, T081             |
| FR-035 | T015, T034, T072             |
| FR-036 | T016, T082, T083, T084, T091 |

### Non-Functional Requirements

| ID      | Task IDs                                 |
| ------- | ---------------------------------------- |
| NFR-001 | T050, T056, T077, T078, T080, T086, T092 |
| NFR-002 | T038, T088                               |
| NFR-003 | T029, T033, T034, T071, T072, T077, T079 |
| NFR-004 | T061, T066, T076                         |
| NFR-005 | T001, T006, T018, T090                   |
| NFR-006 | T049, T056, T078, T087, T092             |
| NFR-007 | T035, T081, T091                         |
| NFR-008 | T016, T082, T083, T091                   |

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
- [ ] **T-099\*\*** Add LaunchDarkly-style feature flags `digitization.enabled` and `circles.enabled` with config wiring in `digitization-api` + `circles-api` + web/mobile clients; gate `/api/v1/recipes/digitize/*`, `/api/v1/circles/*`, upload UI entry, and audience-picker Circle options behind these flags. Default OFF in production; ON in dev/preview. **Files**: `packages/services/digitization-service/src/config/feature-flags.ts`, `packages/services/circles-service/src/config/feature-flags.ts`, web/mobile flag wiring, CDK env binding. **Depends on**: T007. **Augments**: T088, T090. [NFR-005, R-001, R-002, R-005, R-008, C-R-002]
- [ ] **T-100\*\*** Document canary promotion gates (1% → 10% → 50% → 100%) and rollback runbook in release-readiness artifact: per-ring gates = (NFR-001 p95 OCR latency met, DLQ depth = 0 sustained over ring window, zero P0/P1 a11y findings, manual accuracy benchmark ≥ SC-001 on canary photo set); **Files**: `specs/011-recipe-digitization/release-readiness.md` (created at release-readiness phase) — placeholder note in `plan.md` Risks until then. **Depends on**: T099. [NFR-001, NFR-004, R-001, R-002, R-005, R-008, C-R-002]

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
