# Tasks: Commise Recipe Management Core

**Input**: Design documents from `/specs/001-commise-recipe-app/`
**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `contracts/`

## Format: `- [ ] T001 [P?] [Story?] Description with exact file path`

**TDD Convention**: Tasks suffixed with `-test` are test-first tasks. They MUST be completed before their corresponding implementation task. Implementation is not complete until tests pass (red-green-refactor per NFR-005).

---

## Phase 1: Setup

**Purpose**: Scaffold required workspaces, test infrastructure, and CI pipeline.

### Workspace Scaffolding

> **Scaffolding method**: Use the `bootstrap` agent skill (`load_skills=["bootstrap"]`) with workspace mode. Each task specifies the bootstrap parameters: `--name`, `--location`, `--type`, `--scope kitchensink`. The skill handles `package.json`, `tsconfig.json`, shared tooling extension, and CDK infra overlay per workspace type.

- [ ] T001 Scaffold recipe API workspace via bootstrap skill: `--name recipe --location packages/api/recipe --type nestjs --scope kitchensink` — produces NestJS skeleton + `infra/` CDK Fargate stack
- [ ] T001a Configure existing Next.js web app workspace via bootstrap skill: `--name commise-web --location packages/apps/commise/web --type nextjs --scope kitchensink` — bare `package.json` stub already exists, bootstrap populates full Next.js 15 App Router structure + `infra/` CDK stack
- [ ] T001b Configure existing Expo mobile app workspace via bootstrap skill: `--name commise-mobile --location packages/apps/commise/mobile --type react-native --scope kitchensink` — bare `package.json` stub already exists, bootstrap populates full Expo 53 structure
- [ ] T002 Scaffold serverless photo processor workspace via bootstrap skill: `--name photo-processor --location packages/api/photo-processor --type serverless --scope kitchensink` — produces Lambda handler skeleton + `infra/` CDK S3 event + IAM stack
- [ ] T003 **[BLOCKER: GR-007]** Scaffold and publish canonical shared recipe contract workspace via bootstrap skill: `--name recipe-core --location packages/shared/recipe-core --type library --scope kitchensink`. Package name MUST be `@kitchensink/shared-recipe-core`; it is the source of truth for shared recipe, ingredient, collection, visibility, and audience DTO/types before any API or UI feature imports local duplicate domain types
- [ ] T004 Scaffold shared config workspace via bootstrap skill: `--name config --location packages/shared/config --type library --scope kitchensink`
- [ ] T005 Scaffold shared db workspace via bootstrap skill: `--name db --location packages/shared/db --type library --scope kitchensink`
- [ ] T006 [P] Register new workspaces in root `package.json` by adding `"packages/api/*"` and `"packages/shared/*"` to the `workspaces` array (existing entries: `packages/tools/*`, `packages/apps/commise/web`, `packages/apps/commise/mobile`, `packages/ui`). Add `test:integration` task to `turbo.json` (`{ "outputs": [] }`) alongside existing `test` task. Verify all workspaces resolve with `npm ls --workspaces`
- [ ] T006a [P] Create `infra/docker/postgres-init.sql` with `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and `CREATE EXTENSION IF NOT EXISTS pgcrypto;` — referenced by `docker-compose.yml` init volume mount
- [ ] T006b [P] Create local dev `docker-compose.yml` at monorepo root (PostgreSQL 16 + LocalStack S3) per quickstart.md specification — distinct from `docker-compose.test.yml` (T088) which is CI-specific
- [ ] T007 [P] Add NestJS API module skeleton files in `packages/api/recipe/src/app.module.ts` and `packages/api/recipe/src/{auth,recipes,ingredients,versions,photos,collections,search}/` — use plural module directory names per NestJS convention
- [ ] T008 [P] Copy contract types into shared package and create barrel exports in `packages/shared/recipe-core/src/recipe.types.ts`, `packages/shared/recipe-core/src/config.types.ts`, and `packages/shared/recipe-core/src/index.ts` — source from `specs/001-commise-recipe-app/contracts/{recipe.types.ts,config.types.ts}`
- [ ] T009 Remove `@ts-expect-error` on zod import in `packages/shared/recipe-core/src/recipe.types.ts` (depends on T008 — file does not exist until contracts are copied)
- [ ] T010 [P] Add shared config package barrel and loader entrypoint in `packages/shared/config/src/index.ts` and `packages/shared/config/src/load-config.ts`

### Test Infrastructure

- [ ] T082 [P] Create backend fixture factories (`makeRecipe`, `makeIngredient`, `makeCollection`, `makeUser`, `makeVersion`, `makePhoto`) in `packages/api/recipe/src/__fixtures__/index.ts` — typed, overridable defaults, `make*` naming per constitution
- [ ] T083 [P] Create web frontend fixture factories (`makeRecipeViewModel`, `makeCollectionViewModel`) in `packages/apps/commise/web/src/__fixtures__/index.ts`
- [ ] T084 [P] Create mobile frontend fixture factories in `packages/apps/commise/mobile/src/__fixtures__/index.ts`
- [ ] T085 [P] Configure Vitest base config for API workspace with unit/integration/e2e splits in `packages/api/recipe/vitest.config.ts`, `packages/api/recipe/vitest.integration.config.ts`
- [ ] T086 [P] Configure Playwright project with `globalSetup.ts` (run migrations + seed, start API server) in `packages/apps/commise/web/playwright.config.ts` and `packages/apps/commise/web/tests/e2e/global-setup.ts`
- [ ] T087 [P] Create Maestro E2E flow directory structure and base config in `packages/apps/commise/mobile/tests/e2e/.maestro/config.yaml`
- [ ] T088 [P] Create `docker-compose.test.yml` for CI test infrastructure (PostgreSQL 16 + LocalStack S3 with bucket auto-provisioning) at monorepo root
- [ ] T089 [P] Implement test `globalSetup.ts` for integration tests: start LocalStack, provision S3 buckets, run Drizzle migrations, seed test data in `packages/api/recipe/tests/global-setup.ts`

### CI Pipeline

> **Note**: `.github/workflows/ci.yml` already exists with install, lint, format, typecheck, and test jobs using npm cache. Tasks below extend it — do NOT recreate from scratch. Preserve existing job structure and cache strategy.

- [ ] T090 [P] Extend existing `.github/workflows/ci.yml` with new jobs: `test-integration` (postgres:16-alpine + localstack/localstack:3 service containers, run migrations + seed, `turbo run test:integration`), `test-e2e-web` (Playwright), `test-e2e-mobile` (Maestro). Fix cache path globs to include deeply nested workspaces (`packages/*/*/*/node_modules`, `packages/*/*/*/*/node_modules`). Preserve existing install/lint/format/typecheck/test jobs
- [ ] T091 [P] Add Playwright browser binary caching (version + OS key) and failure-only trace/report artifact upload to `test-e2e-web` job in `.github/workflows/ci.yml`
- [ ] T092 [P] Add Maestro CLI installation and mobile E2E job (`test-e2e-mobile`) with Maestro Cloud or self-hosted emulator in `.github/workflows/ci.yml`

### Frontend API Configuration

- [ ] T093 [P] Configure `NEXT_PUBLIC_API_URL` env variable with local default in `packages/apps/commise/web/.env.local` and wire into shared API client
- [ ] T094 [P] Configure `EXPO_PUBLIC_API_URL` env variable with local default in `packages/apps/commise/mobile/.env` and wire into shared API client
- [ ] T095 [P] Update shared API client (`packages/shared/recipe-core/src/hooks/`) to read base URL from platform-appropriate env variable at initialization

---

## Phase 2: Foundational (Blocking)

**Purpose**: Complete core infrastructure that blocks all user stories. TDD: write tests for each module before implementation.

### Tests First (TDD Red)

- [ ] T011-test Write unit tests for Drizzle schema type inference (verify exported types compile and match data-model.md contracts) in `packages/shared/db/src/__tests__/schema.test.ts`
- [ ] T017-test Write unit tests for environment loader (valid env, missing required vars, SSM fallback) in `packages/shared/config/src/__tests__/load-config.test.ts`
- [ ] T019-test Write unit tests for the Clerk AuthMiddleware (valid session token, expired token, missing token, dev bypass) in `packages/api/recipe/src/auth/__tests__/auth.middleware.test.ts`
- [ ] T020-test Write unit tests for API exception filter (RecipeError mapping, unknown error fallback, HTTP status codes) in `packages/api/recipe/src/common/filters/__tests__/api-exception.filter.test.ts`
- [ ] T021-test Write unit tests for `isRecipeError` type guard in `packages/shared/recipe-core/src/__tests__/recipe.types.test.ts`
- [ ] T022-test Write unit tests for throttling configuration (verify rate limits applied to correct route groups) in `packages/api/recipe/src/__tests__/throttle.test.ts`

### Implementation (TDD Green)

- [ ] T011 Define users and recipes Drizzle tables in `packages/shared/db/src/schema/users.ts` and `packages/shared/db/src/schema/recipes.ts`
- [ ] T012 [P] Define ingredient-related Drizzle tables in `packages/shared/db/src/schema/ingredients.ts`
- [ ] T013 [P] Define versions and photos Drizzle tables in `packages/shared/db/src/schema/versions.ts` and `packages/shared/db/src/schema/photos.ts`
- [ ] T014 [P] Define collections Drizzle tables in `packages/shared/db/src/schema/collections.ts`
- [ ] T015 Create schema barrel and Drizzle client proxy in `packages/shared/db/src/schema/index.ts` and `packages/shared/db/src/client.ts`
- [ ] T016 Add initial drizzle migration with extensions, indexes, and FTS trigger SQL in `packages/shared/db/src/migrations/0001_initial.sql`
- [ ] T118 [P] Add `deleted_at timestamptz NULL` column + partial index `(owner_id) WHERE deleted_at IS NULL` to `recipes` table in `packages/shared/db/src/schema/recipes.ts` and migration `packages/shared/db/src/migrations/0002_soft_delete.sql` — moved from Phase 4.5 so Phase 3 DALs consume `deleted_at` from day one (avoids back-patching every read query)
- [ ] T119 Add collection provenance columns in `packages/shared/db/src/schema/collections.ts` + migration `0003_collection_provenance.sql` — moved from Phase 4.5: (a) `source_collection_id uuid NULL REFERENCES collections(id) ON DELETE SET NULL` on `collections` table; (b) `added_via` enum (`manual` | `clone` | `pull`) on `recipe_collections` membership table with existing rows backfilled to `manual`. (T120 merged into T119 — same file, same migration.)
- [ ] T121 [P] Create `recipe_version_pending_archives` table (id, recipe_id, version_number, snapshot JSONB, enqueued_at, attempt_count, last_error) in `packages/shared/db/src/schema/versions.ts` + migration `0004_pending_archives.sql` — moved from Phase 4.5
- [ ] T122 [P] Create `account_erasure_jobs` table (id, user_id, status enum: queued|running|completed|failed, requested_at, completed_at, error) in `packages/shared/db/src/schema/users.ts` + migration `0005_account_erasure.sql` — moved from Phase 4.5
- [ ] T017 Implement environment loader with Zod validation and optional SSM fallback in `packages/shared/config/src/load-config.ts`
- [ ] T018 Wire global DB provider module and injection token in `packages/api/recipe/src/db/db.module.ts`
- [ ] T019 Implement Clerk session-token AuthMiddleware (networkless verification via `CLERK_JWT_KEY` + `azp`, backed by `ClerkAuthService`) stub for spec-002 integration in `packages/api/recipe/src/auth/auth.middleware.ts`
- [ ] T020 Implement shared API exception filter and recipe-domain error mapping in `packages/api/recipe/src/common/filters/api-exception.filter.ts`
- [ ] T021 Add `isRecipeError(e: unknown): e is RecipeError` type guard in `packages/shared/recipe-core/src/recipe.types.ts`
- [ ] T022 Configure API throttling defaults (writes 30/min, photos 10/min, search 60/min) in `packages/api/recipe/src/app.module.ts`

### E2E Seed Data

- [ ] T096 Implement deterministic E2E seed script with stable IDs for 2 users (free + pro), 5 recipes, 1 collection in `packages/shared/db/src/seed.ts` — idempotent via `ON CONFLICT DO NOTHING`
- [ ] T097 Add `npm run seed` script to `packages/shared/db/package.json` and wire into Playwright/integration `globalSetup.ts`

**Checkpoint**: Foundation complete; user story phases can start.

---

## Phase 3: User Story 1 - Create and Manage Personal Recipes (P1) 🎯 MVP

**Goal**: Deliver recipe CRUD, ingredient handling, versioning, photos, collections, and search for owned/public recipes.

**Independent Test**: Create, edit, delete, search/filter recipes with ingredients/photos/collections and verify version/conflict behavior.

### Tests First (TDD Red) — Backend Unit Tests

- [ ] T024-test Write unit tests for recipe DAL (create, findById, findAll with pagination, update, delete, ownership check) using fixtures in `packages/api/recipe/src/recipes/dal/__tests__/recipes.dal.test.ts`
- [ ] T025-test Write unit tests for recipe service (CRUD orchestration, authorization, validation) using mocked DAL in `packages/api/recipe/src/recipes/__tests__/recipes.service.test.ts`
- [ ] T027-test Write unit tests for ingredient DAL (pg_trgm search, tsvector search, freeform creation) in `packages/api/recipe/src/ingredients/dal/__tests__/ingredients.dal.test.ts`
- [ ] T028-test Write unit tests for ingredient service (USDA lookup, freeform + nutrition, dedup) in `packages/api/recipe/src/ingredients/__tests__/ingredients.service.test.ts`
- [ ] T030-test Write unit tests for version DAL (snapshot create, list by recipe, retention query) in `packages/api/recipe/src/versions/dal/__tests__/versions.dal.test.ts`
- [ ] T031-test Write unit tests for version service (snapshot write, DB retention pruning, S3 archive call) using mocked S3 in `packages/api/recipe/src/versions/__tests__/versions.service.test.ts`
- [ ] T033-test Write unit tests for optimistic concurrency (version mismatch detection, 409 payload) in `packages/api/recipe/src/recipes/__tests__/conflict.service.test.ts`
- [ ] T034-test Write unit tests for photo DAL (metadata CRUD, 10-photo limit enforcement) in `packages/api/recipe/src/photos/dal/__tests__/photos.dal.test.ts`
- [ ] T035-test Write unit tests for photo service (presigned URL generation with mocked S3, confirmation, deletion) in `packages/api/recipe/src/photos/__tests__/photos.service.test.ts`
- [ ] T037-test Write unit tests for photo processor handler (S3 event parsing, Sharp invocation, output key generation) in `packages/api/photo-processor/src/__tests__/process.handler.test.ts`
- [ ] T038-test Write unit tests for Sharp resize utility (WebP conversion, variant dimensions) in `packages/api/photo-processor/src/lib/__tests__/sharp.lib.test.ts`
- [ ] T039-test Write unit tests for collections DAL (CRUD, membership add/remove, multi-membership) in `packages/api/recipe/src/collections/dal/__tests__/collections.dal.test.ts`
- [ ] T040-test Write unit tests for collections service (CRUD, membership, no-cascade delete) in `packages/api/recipe/src/collections/__tests__/collections.service.test.ts`
- [ ] T042-test Write unit tests for search DAL (FTS rank query, facet aggregation, empty result) in `packages/api/recipe/src/search/dal/__tests__/search.dal.test.ts`

### Implementation (TDD Green)

- [ ] T023 [P] [US1] Define create/update/list recipe DTOs in `packages/api/recipe/src/recipes/dto/{create-recipe.dto.ts,update-recipe.dto.ts,list-recipes.query.dto.ts}`
- [ ] T024 [P] [US1] Implement recipe DAL queries in `packages/api/recipe/src/recipes/dal/recipes.dal.ts`
- [ ] T025 [US1] Implement recipe create/list/get/update/delete service logic in `packages/api/recipe/src/recipes/recipes.service.ts`
- [ ] T026 [US1] Implement recipes controller endpoints for `/api/v1/recipes` and `/api/v1/recipes/{id}` in `packages/api/recipe/src/recipes/recipes.controller.ts`
- [ ] T027 [P] [US1] Implement ingredient search DAL with pg_trgm + tsvector strategy in `packages/api/recipe/src/ingredients/dal/ingredients.dal.ts`
- [ ] T028 [US1] Implement ingredient service for USDA-backed lookup and freeform creation in `packages/api/recipe/src/ingredients/ingredients.service.ts`
- [ ] T029 [US1] Implement ingredients controller endpoints for `/api/v1/ingredients/search` and `/api/v1/ingredients` in `packages/api/recipe/src/ingredients/ingredients.controller.ts`
- [ ] T030 [P] [US1] Implement recipe version snapshot DAL in `packages/api/recipe/src/versions/dal/versions.dal.ts`
- [ ] T031 [US1] Implement versioning service for snapshot writes, DB retention (last 10), and S3 archive writes in `packages/api/recipe/src/versions/versions.service.ts`
- [ ] T032 [US1] Implement versions controller endpoints for list/get/restore in `packages/api/recipe/src/versions/versions.controller.ts`
- [ ] T033 [US1] Implement optimistic concurrency conflict handling with HTTP 409 payload in `packages/api/recipe/src/recipes/recipes.service.ts`
- [ ] T034 [P] [US1] Implement photo metadata DAL with 10-photo limit checks in `packages/api/recipe/src/photos/dal/photos.dal.ts`
- [ ] T035 [US1] Implement photo upload URL and confirmation service logic in `packages/api/recipe/src/photos/photos.service.ts`
- [ ] T036 [US1] Implement photos controller endpoints for upload-url/confirm/list/delete/reorder in `packages/api/recipe/src/photos/photos.controller.ts`
- [ ] T037 [P] [US1] Implement S3 event handler for Sharp resize pipeline in `packages/api/photo-processor/src/handlers/process.handler.ts`
- [ ] T038 [P] [US1] Implement Sharp resize utility for thumb/card/full WebP variants in `packages/api/photo-processor/src/lib/sharp.lib.ts`
- [ ] T039 [P] [US1] Implement collections DAL queries in `packages/api/recipe/src/collections/dal/collections.dal.ts`
- [ ] T040 [US1] Implement collections service for CRUD and recipe membership in `packages/api/recipe/src/collections/collections.service.ts`
- [ ] T041 [US1] Implement collections controller endpoints in `packages/api/recipe/src/collections/collections.controller.ts`
- [ ] T042 [P] [US1] Implement search DAL with FTS rank sampling CTE and facet aggregation in `packages/api/recipe/src/search/dal/search.dal.ts`
- [ ] T043 [US1] Implement search service/controller for `/api/v1/search/recipes` in `packages/api/recipe/src/search/{search.service.ts,search.controller.ts}`

### Integration Tests (TDD — against real DB + LocalStack)

- [ ] T044 [US1] Add integration test for version retention (keep last 10 in DB, archive all to S3 via LocalStack) in `packages/api/recipe/__tests__/integration/versions/retention.integration.spec.ts`
- [ ] T045 [US1] Add integration test for optimistic conflict detection returning HTTP 409 with version metadata in `packages/api/recipe/__tests__/integration/recipes/conflict.integration.spec.ts`
- [ ] T098 [US1] Add integration test for recipe CRUD lifecycle (create → get → update → list → delete) against real PostgreSQL in `packages/api/recipe/__tests__/integration/recipes/crud.integration.spec.ts`
- [ ] T099 [US1] Add integration test for ingredient search (pg_trgm fuzzy + FTS exact) against real PostgreSQL in `packages/api/recipe/__tests__/integration/ingredients/search.integration.spec.ts`
- [ ] T100 [US1] Add integration test for photo upload flow (presigned URL → S3 upload via LocalStack → confirm) in `packages/api/recipe/__tests__/integration/photos/upload.integration.spec.ts`
- [ ] T101 [US1] Add integration test for collections CRUD + membership (add/remove recipes, no-cascade delete) in `packages/api/recipe/__tests__/integration/collections/crud.integration.spec.ts`
- [ ] T102 [US1] Add integration test for search endpoint (FTS + facets + pagination) in `packages/api/recipe/__tests__/integration/search/search.integration.spec.ts`

**Checkpoint**: US1 delivers complete personal recipe management MVP with full test coverage.

---

## Phase 4: User Story 2 - Share, Copy, and Clone Recipes (P1)

**Goal**: Deliver sharing and cloning with C-004 visibility policy, attribution retention, and substantive edit tracking.

**Independent Test**: User A shares public recipe, User B clones, edits clone, original unchanged, and visibility transitions enforce C-004.

### Tests First (TDD Red)

- [ ] T048-test Write unit tests for visibility policy evaluator (all C-004 scenarios: user-created, imported-public, imported-physical, paid-source, tier transitions, substantive edit unlock) in `packages/api/recipe/src/recipes/domain/__tests__/visibility-policy.test.ts`
- [ ] T047-test Write unit tests for clone service (attribution copy, owner reassignment, visibility inheritance) in `packages/api/recipe/src/recipes/__tests__/clone.service.test.ts`
- [ ] T049-test Write unit tests for substantive edit detection (ingredient change = substantive, title change = not substantive) in `packages/api/recipe/src/recipes/__tests__/substantive-edit.service.test.ts`
- [ ] T139-test Write unit tests for substantive-edit detection on **imported** recipes (FR-005 + C-004): editing ingredients/steps on an imported recipe MUST set `hasSubstantiveEdit=true` and unlock private-visibility transition for premium users per C-004; editing only metadata (title, description, tags, photos) MUST NOT in `packages/api/recipe/src/recipes/__tests__/substantive-edit-imported.test.ts`

### Implementation (TDD Green)

- [ ] T046 [P] [US2] Add clone and visibility DTOs in `packages/api/recipe/src/recipes/dto/{clone-recipe.dto.ts,set-visibility.dto.ts}`
- [ ] T047 [US2] Implement clone workflow with attribution copy and owner reassignment in `packages/api/recipe/src/recipes/recipes.service.ts`
- [ ] T048 [US2] Implement C-004 visibility policy evaluator for source type, tier, and substantive edit state in `packages/api/recipe/src/recipes/domain/visibility-policy.ts`
- [ ] T049 [US2] Implement substantive edit detection for ingredient/step mutations updating `hasSubstantiveEdit` in `packages/api/recipe/src/recipes/recipes.service.ts`
- [ ] T139 [US2] Extend substantive-edit detector to handle imported-recipe lineage per FR-005 + C-004 (preserve source-import flag through versioning so premium users can unlock private visibility only after a substantive edit) in `packages/api/recipe/src/recipes/recipes.service.ts`
- [ ] T050 [US2] Implement `/api/v1/recipes/{id}/clone` and `/api/v1/recipes/{id}/visibility` endpoints in `packages/api/recipe/src/recipes/recipes.controller.ts`

### Integration Tests

- [ ] T051 [US2] Add integration test for clone visibility + attribution + substantive-edit unlock rules in `packages/api/recipe/__tests__/integration/recipes/clone-visibility.integration.spec.ts`
- [ ] T103 [US2] Add integration test for collection cloning (public collection clone excludes private recipes) in `packages/api/recipe/__tests__/integration/collections/clone-collection.integration.spec.ts`

**Checkpoint**: US2 sharing and cloning behavior is independently functional and policy-compliant.

---

## Phase 4.5: Spec Clarification Deltas

**Purpose**: Implement behavior added by the 2026-04-29 spec clarifications — recipe soft-delete tombstones (C-007), collection clone provenance + pull-from-source (FR-011), async version-archive worker (FR-007b-i), and GDPR account erasure flow.

### Schema & Migrations

> **Note**: Schema tasks T118–T122 were moved to Phase 2 Foundational (after T016) so Phase 3 DALs consume the new columns/tables from day one. This section is intentionally empty; behavior tasks below depend on those Phase 2 schema tasks.

### Recipe Soft-Delete (C-007)

- [ ] T123-test Write unit tests for recipe DAL soft-delete (sets `deleted_at`, list/find/search exclude tombstones, owner can still see version history) in `packages/api/recipe/src/recipes/dal/__tests__/recipes.dal.soft-delete.test.ts`
- [ ] T123 Update recipe DAL to soft-delete (UPDATE … SET deleted_at = now()) and add `WHERE deleted_at IS NULL` filter to all read queries in `packages/api/recipe/src/recipes/dal/recipes.dal.ts`
- [ ] T124 Update search DAL to exclude tombstoned recipes (`WHERE deleted_at IS NULL`) in `packages/api/recipe/src/search/dal/search.dal.ts`
- [ ] T125 Update collections DAL to exclude tombstoned recipes from membership list responses in `packages/api/recipe/src/collections/dal/collections.dal.ts`
- [ ] T126 [US1] Add integration test asserting `DELETE /api/v1/recipes/{id}` returns 204, row remains with `deleted_at` set, and recipe is excluded from list/search/get/collection responses in `packages/api/recipe/__tests__/integration/recipes/soft-delete.integration.spec.ts`

### Collection Clone & Pull-from-Source (FR-011)

- [ ] T127-test Write unit tests for collection clone service (creates new collection with `source_collection_id`, copies memberships with `added_via=clone`, owner reassignment) in `packages/api/recipe/src/collections/__tests__/clone-collection.service.test.ts`
- [ ] T128-test Write unit tests for pull-from-source service (additive only, `added_via=pull`, no-op when no new recipes, 400 when collection has no source) in `packages/api/recipe/src/collections/__tests__/pull-from-source.service.test.ts`
- [ ] T127 [US2] Implement `cloneCollection` and `pullFromSource` in `packages/api/recipe/src/collections/collections.service.ts`
- [ ] T128 [US2] Add `CloneCollectionRequest` DTO + controller endpoints `POST /api/v1/collections/{id}/clone` and `POST /api/v1/collections/{id}/pull-from-source` in `packages/api/recipe/src/collections/{dto/clone-collection.dto.ts,collections.controller.ts}`
- [ ] T129 [US2] Update existing T103 collection-clone integration test to assert `source_collection_id` and `added_via=clone` are set, and add a follow-up `pull-from-source` integration test in `packages/api/recipe/__tests__/integration/collections/pull-from-source.integration.spec.ts`

### Async Version Archive Worker (FR-007b-i)

- [ ] T130-test Write unit tests for pending-archive enqueue (insert row when version snapshot is written) and worker handler (success → delete row, failure → increment attempt_count + last_error) in `packages/api/recipe/src/versions/__tests__/archive-worker.test.ts`
- [ ] T130 Update versioning service to insert into `recipe_version_pending_archives` instead of writing to S3 inline in `packages/api/recipe/src/versions/versions.service.ts`
- [ ] T131 Implement version-archive worker (SQS-triggered Lambda) that drains pending rows, writes snapshots to S3 versions bucket, and deletes the pending row on success in `packages/api/version-archive-worker/src/handlers/archive.handler.ts` (scaffold workspace via bootstrap skill: `--name version-archive-worker --location packages/api/version-archive-worker --type serverless --scope kitchensink`)
- [ ] T132 Add CDK infrastructure for version-archive SQS queue + DLQ + Lambda subscription in `packages/api/version-archive-worker/infra/`
- [ ] T133 Add integration test for the full async archive path (enqueue → worker drains → S3 object exists, pending row gone) using LocalStack SQS + S3 in `packages/api/version-archive-worker/__tests__/integration/archive.integration.spec.ts`
- [ ] T138 Add CloudWatch alarms for pending-archive backlog (per FR-007b-i SLO): backlog count > 100 sustained > 15 min, and oldest pending row age > 1 hour. Wire SNS topic for ops paging. Define in `packages/api/version-archive-worker/infra/lib/alarms.ts`

### GDPR Account Erasure

- [ ] T134-test Write unit tests for erasure service (queues job; duplicate request while job is `queued` or `running` returns HTTP 202 with existing job id; request after `completed` returns 410; request after `failed` enqueues a fresh job and returns 202; validates optional confirmation phrase) in `packages/api/recipe/src/account/__tests__/erasure.service.test.ts`
- [ ] T135-test Write unit tests for erasure worker (hard-deletes recipes incl. tombstoned, versions, photos, collections, S3 photo + version objects, marks job completed) in `packages/api/recipe/src/account/__tests__/erasure-worker.test.ts`
- [ ] T134 Implement `AccountModule` with `ErasureService` (job queueing) and `ErasureRequest` / `ErasureRequestAcceptedResponse` DTOs in `packages/api/recipe/src/account/{account.module.ts,erasure.service.ts,dto/erasure.dto.ts}`
- [ ] T135 Implement `POST /api/v1/account/erasure` controller in `packages/api/recipe/src/account/account.controller.ts`
- [ ] T136 Implement erasure worker that hard-deletes all user-owned data (recipes incl. tombstoned, versions, pending-archive rows, photos, collections, memberships, S3 photo objects, S3 version-archive objects) in `packages/api/recipe/src/account/erasure.worker.ts`
- [ ] T137 Add integration test for end-to-end erasure: seed user with recipes (some tombstoned), photos in LocalStack S3, version archives, collections → trigger erasure → assert all rows + S3 objects gone, job row marked `completed` in `packages/api/recipe/__tests__/integration/account/erasure.integration.spec.ts`

**Checkpoint**: Spec clarifications for soft-delete, collection clone provenance, async version archives, and GDPR erasure are implemented and tested.

---

## Phase 5: Frontend — Web (Next.js 15) & Mobile (Expo 53)

**Purpose**: Deliver platform-parity UI for recipe CRUD, search, collections, sharing/cloning, photo management, and the post-login Home screen. Every task in this phase must satisfy the parity rule from FR-044a: cover both platforms explicitly, have a paired task for the other platform, or carry a `[PARITY-EXCEPTION]` note.

### Parity Checklist (Phase 5 gate)

Before Phase 5 is marked complete, verify every implementation task below satisfies one of:

- [ ] **Both platforms named** in the task description (file paths or "web + mobile" explicit)
- [ ] **Paired tasks** exist and reference each other (e.g., T104-web + T104-mobile)
- [ ] **`[PARITY-EXCEPTION]`** note present in the task body with reason and future spec reference

This checklist is a blocking gate. Phase 6 cannot start until all Phase 5 tasks pass.

---

### Setup & Shared

- [ ] T061 [P] Configure Next.js 15 App Router with Clerk web SDK (`@clerk/nextjs`: `<ClerkProvider>` + `middleware.ts`) in `packages/apps/commise/web/src/app/layout.tsx`
- [ ] T062 [P] Configure Expo 53 with Clerk native SDK (`@clerk/expo`, tokens in `expo-secure-store`) in `packages/apps/commise/mobile/src/app/_layout.tsx`
- [ ] T063 [P] Set up shared design tokens (colors, spacing, typography) in `packages/ui/src/tokens/` consumable by both web (Tailwind v4) and mobile (Tamagui)
- [ ] T064 [P] Create shared API client (TanStack Query v5) with typed hooks for recipe endpoints in `packages/shared/recipe-core/src/hooks/` — reads `NEXT_PUBLIC_API_URL` / `EXPO_PUBLIC_API_URL` for base URL (NFR-009)

### Home Screen (US-011) — P1

> **Parity**: Both web and mobile tasks are required. They are listed as separate tasks so each can be tracked, reviewed, and tested independently.

- [ ] T104-shared [P] Create shared Home section components in `packages/ui/src/home/` — `RecentRecipesSection`, `MealPlanSummarySection`, `NutritionSnapshotSection`, `ShoppingListStatusSection`, `AiSuggestionSection`, `ResumeCookingCard`, `SubscriptionNudge` — each with accessible names, skeleton loader variant, and empty state variant; exported from `packages/ui/src/index.ts`
- [ ] T104-web [US11] Implement Home screen web — `packages/apps/commise/web/src/app/(home)/page.tsx` — parallel TanStack Query calls for all six sections (recent recipes, meal plan summary, nutrition snapshot, shopping list status, AI suggestion, resume-cooking card); skeleton loaders per section; responsive 2-column grid ≥768px / 1-column below; subscription nudge bottom sheet on premium-gated tap (once per session, component state only)
- [ ] T104-mobile [US11] Implement Home screen mobile — `packages/apps/commise/mobile/src/screens/HomeScreen.tsx` — parallel TanStack Query calls for all six sections; skeleton loaders per section; vertical ScrollView; resume-cooking card at top when active session present; subscription nudge modal on premium-gated tap (once per session, component state only)
- [ ] T104-test-web Write component tests for Home screen web (all six sections: loading state, empty state, populated state; nudge appears once per session; resume card hidden when no active session) in `packages/apps/commise/web/src/app/(home)/__tests__/page.test.tsx` — MSW mocks for all six endpoints
- [ ] T104-test-mobile Write component tests for Home screen mobile (all six sections: loading state, empty state, populated state; nudge appears once per session; resume card hidden when no active session) in `packages/apps/commise/mobile/src/__tests__/HomeScreen.test.tsx` — MSW mocks for all six endpoints
- [ ] T104-e2e-web Add Playwright E2E test for Home screen: login → verify all six sections render → tap each entry point → verify navigation in `packages/apps/commise/web/tests/e2e/home.spec.ts`
- [ ] T104-e2e-mobile Add Maestro E2E flow for Home screen: login → verify all six sections render → tap each entry point → verify navigation in `packages/apps/commise/mobile/tests/e2e/home.yaml`

### Frontend Unit/Component Tests (TDD Red — mocks + fixtures only)

- [ ] T104 Write unit tests for shared API client hooks (useRecipes, useRecipe, useCreateRecipe, etc.) using MSW mocks in `packages/shared/recipe-core/src/hooks/__tests__/`
- [ ] T105 Write component tests for recipe list (loading, empty, populated, search filter) in `packages/apps/commise/web/src/app/recipes/__tests__/page.test.tsx`
- [ ] T106 Write component tests for recipe create/edit form (validation, ingredient autocomplete, photo upload) in `packages/apps/commise/web/src/app/recipes/__tests__/form.test.tsx`
- [ ] T107 Write component tests for collection views (list, detail, add/remove) in `packages/apps/commise/web/src/app/collections/__tests__/`
- [ ] T108 Write component tests for clone/visibility flow (attribution display, tier restrictions) in `packages/apps/commise/web/src/app/recipes/__tests__/clone.test.tsx`

### Recipe CRUD (US1)

- [ ] T065 [US1] Implement recipe list screen with search/filter bar — web: `packages/apps/commise/web/src/app/recipes/page.tsx`, mobile: `packages/apps/commise/mobile/src/screens/RecipeListScreen.tsx`
- [ ] T066 [US1] Implement recipe detail view with ingredients, instructions, photos, and nutrition summary — web + mobile
- [ ] T067 [US1] Implement recipe create/edit form with ingredient autocomplete (USDA + freeform), step editor, photo upload, and tag picker — web + mobile
- [ ] T068 [US1] Implement recipe delete confirmation flow — web + mobile
- [ ] T069 [US1] Implement version history view with restore action — web + mobile
- [ ] T070 [US1] Implement concurrent edit conflict resolution UI (present both versions, choose/merge) — web + mobile

### Collections (US1)

- [ ] T071 [US1] Implement collection list and detail views — web + mobile
- [ ] T072 [US1] Implement add/remove recipe from collection flow — web + mobile
- [ ] T073 [US1] Implement collection create/rename/delete — web + mobile

### Sharing & Cloning (US2)

- [ ] T074 [US2] Implement recipe visibility toggle (public/private) with tier restrictions — web + mobile
- [ ] T075 [US2] Implement clone recipe flow with attribution display — web + mobile
- [ ] T076 [US2] Implement public recipe discovery/browse view — web + mobile

### Web E2E Tests (Playwright)

- [ ] T077 Verify all interactive elements have accessible names (`getByRole`/`getByLabel`) — web Playwright E2E tests in `packages/apps/commise/web/tests/e2e/`
- [ ] T078 Verify color is never sole state conveyor (icon/text pairing) across all screens — web + mobile
- [ ] T079 Add Playwright E2E tests for recipe CRUD happy path (create → view → edit → delete) in `packages/apps/commise/web/tests/e2e/recipe-crud.spec.ts`
- [ ] T080 Add Playwright E2E tests for clone/visibility flow in `packages/apps/commise/web/tests/e2e/clone-visibility.spec.ts`
- [ ] T109 Add Playwright E2E tests for collections (create → add recipe → view → remove → delete) in `packages/apps/commise/web/tests/e2e/collections.spec.ts`
- [ ] T110 Add Playwright E2E tests for search and filter in `packages/apps/commise/web/tests/e2e/search.spec.ts`

### Mobile E2E Tests (Maestro)

- [ ] T111 Add Maestro E2E flow for recipe CRUD (create → view → edit → delete) in `packages/apps/commise/mobile/tests/e2e/recipe-crud.yaml`
- [ ] T112 Add Maestro E2E flow for collections management in `packages/apps/commise/mobile/tests/e2e/collections.yaml`
- [ ] T113 Add Maestro E2E flow for clone/visibility in `packages/apps/commise/mobile/tests/e2e/clone-visibility.yaml`
- [ ] T114 Add Maestro E2E flow for search and navigation in `packages/apps/commise/mobile/tests/e2e/search-nav.yaml`
- [ ] T115 Add Maestro E2E accessibility flow (screen reader labels, tap targets) in `packages/apps/commise/mobile/tests/e2e/accessibility.yaml`

**Checkpoint**: Frontend delivers platform-parity UI for all in-scope user stories with full Playwright + Maestro E2E coverage.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Final compliance, validation, CI verification, and documentation updates.

- [ ] T052 Update backend quickstart runbook for API, DB migrations, photo processor flow, CI setup, and test commands in `specs/001-commise-recipe-app/quickstart.md`
- [ ] T053 Align OpenAPI examples and response/error payloads with implemented API behavior in `specs/001-commise-recipe-app/contracts/api.openapi.yaml`

### Success Criteria Validation

- [ ] T081 Add k6 or Artillery load test script targeting p95 ≤ 500ms under 10k concurrent users (SC-009) in `packages/api/recipe/tests/load/`
- SC-001 (recipe creation < 5 min) — validated via manual QA / usability testing (no buildable task)
- SC-005 (80% engagement in first week) — validated post-launch via analytics (no buildable task)

### CI Verification

- [ ] T116 Run full GitHub Actions CI pipeline end-to-end and verify all jobs pass (quality, test-unit, test-integration, test-e2e-web, test-e2e-mobile)
- [ ] T117 Verify test pyramid ratios: ≥70% unit / ≤20% integration / ≤10% E2E across all workspaces

### Constitution Compliance Checklist (I–VII)

- [ ] T054 Verify strict TypeScript, no `any`, and typed custom errors/type guards across `packages/api/recipe/src/**/*.ts` and `packages/shared/**/src/**/*.ts` (Principle I)
- [ ] T055 Verify module-level and exported-symbol JSDoc coverage in `packages/api/recipe/src/**/*.ts` and `packages/shared/**/src/**/*.ts` (Principle II)
- [ ] T056 Verify aliased imports with `.js` extensions and no forbidden cross-workspace relative imports in `packages/api/recipe/src/**/*.ts` and `packages/shared/**/src/**/*.ts` (Principle III)
- [ ] T057 Verify integration tests include requirement traceability comments and avoid prohibited test patterns in `packages/api/recipe/__tests__/integration/**/*.spec.ts` (Principle IV)
- [ ] T058 Verify workspace governance entries and task pipelines remain correct in `/home/brandon/Development/KitchenSink/package.json` and `/home/brandon/Development/KitchenSink/turbo.json` (Principle V)
- [ ] T059 Run and validate `turbo run typecheck lint format:check test` from `/home/brandon/Development/KitchenSink` with all exit codes 0 (Principle VI)
- [ ] T060 Verify platform parity (FR-044 / FR-044a) across all Phase 5 frontend tasks: (a) confirm every implementation task covers both web and mobile explicitly, has a paired task, or carries a `[PARITY-EXCEPTION]` note; (b) confirm the Home screen (T104-web + T104-mobile) is present and tested on both platforms; (c) confirm no user-facing screen exists on one platform without a corresponding screen on the other; (d) confirm API contracts and shared models in `specs/001-commise-recipe-app/contracts/{api.openapi.yaml,recipe.types.ts}` reflect all Home screen endpoints (Principle VII)

---

## Dependencies & Execution Order

### Phase Dependency Graph

- Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1 Backend) → Phase 4 (US2 Backend) → Phase 4.5 (Spec Clarifications) → Phase 5 (Frontend) → Phase 6 (Polish)
- Phase 4.5 depends on US1 (recipes/versions/photos/collections) and US2 (clone primitives); Phase 5 frontend should consume Phase 4.5 schema additions (`deletedAt`, `sourceCollectionId`, `addedVia`) and surface the new endpoints.
- Phase 1 includes test infrastructure + CI pipeline setup — these MUST complete before any test tasks run.
- Phase 2 blocks all story work.
- Phase 5 (Frontend) can start after Phase 3 (US1 Backend) delivers stable API endpoints. Phase 4 (US2) and Phase 5 can run in parallel.
- Phase 6 starts only after all prior phases are complete.

### TDD Ordering (Within Each Phase)

- `T0XX-test` tasks execute BEFORE their corresponding `T0XX` implementation tasks.
- Test tasks may run in parallel with other test tasks.
- Implementation begins only after the relevant test task is complete (red → green).

### User Story Dependencies

- **US1**: Starts after Phase 2; no dependency on US2.
- **US2**: Depends on US1 recipe model and recipe CRUD/version primitives; must remain independently testable via clone/visibility flows.

### Within-Story Ordering

- Order each story as: **unit tests → models/DTO/DAL → services/domain policies → controllers/endpoints → integration tests**.
- For US1, implement recipes core before versions/photos/collections/search controllers that depend on recipe ownership checks.
- For US2, implement policy evaluator before visibility endpoint wiring.

### Parallel Opportunities

- Setup: T006, T007, T008, T010 can run in parallel after workspace scaffolding tasks. T082–T092 (test infra + CI) can run in parallel with module skeleton work.
- Foundational: schema split tasks T012–T014 parallelize; config/auth/error tasks T017–T020 parallelize after baseline packages exist. Test tasks (T011-test through T022-test) parallelize.
- US1: DAL test tasks parallelize. DAL implementation tasks (T024, T027, T030, T034, T039, T042) and photo-processor tasks (T037, T038) are parallelizable.
- US2: T046 and policy/service prep can run in parallel before controller/test tasks.
- Frontend: Component test tasks (T104–T108) can run in parallel. Playwright E2E and Maestro E2E run independently.

---

## Implementation Strategy

### TDD-First (NFR-005)

All phases follow red-green-refactor:

1. Write failing tests that encode the requirement.
2. Implement minimum code to pass.
3. Refactor while green.
4. Run `turbo run test` to confirm no regressions.

### MVP-First (US1 First)

1. Complete Phase 1 Setup (including test infra + CI pipeline).
2. Deliver US1 end-to-end (unit tests → implementation → integration tests).
3. Validate US1 independently with full test suite passing in CI.
4. Only then proceed to US2.

### Incremental Delivery

1. Foundation complete and stable with CI green.
2. Ship US1 as first production increment with test coverage verified.
3. Add US2 clone/visibility rules as second increment without regressing US1.
4. Finish with Phase 5 frontend + E2E (Playwright + Maestro) + compliance pass.

### Parallel Team Approach

1. Team aligns on Setup + Foundational baseline (including test infra).
2. Parallelize US1 by module verticals (recipes, ingredients/search, versions, photos, collections) — each vertical writes tests first.
3. Start US2 after recipes domain model and ownership/visibility primitives stabilize.
4. Frontend team starts after US1 backend API is stable; web E2E (Playwright) and mobile E2E (Maestro) run in parallel.
5. Reserve final pass for CI verification, constitution checks, and quickstart/API contract sync.

---

## Task Count Summary

| Phase                     | Implementation | Unit Tests | Integration Tests | E2E Tests | Infrastructure | Total   |
| ------------------------- | -------------- | ---------- | ----------------- | --------- | -------------- | ------- |
| Phase 1: Setup            | 14             | 0          | 0                 | 0         | 14             | 28      |
| Phase 2: Foundational     | 12             | 6          | 0                 | 0         | 6              | 24      |
| Phase 3: US1              | 21             | 14         | 7                 | 0         | 0              | 42      |
| Phase 4: US2              | 6              | 4          | 2                 | 0         | 0              | 12      |
| Phase 4.5: Clarifications | 10             | 6          | 4                 | 0         | 2              | 22      |
| Phase 5: Frontend         | 23             | 9          | 0                 | 13        | 0              | 45      |
| Phase 6: Polish           | 11             | 0          | 0                 | 0         | 2              | 13      |
| **Total**                 | **97**         | **39**     | **13**            | **13**    | **24**         | **186** |

> Phase 5 count includes 7 Home screen tasks (T104-shared, T104-web, T104-mobile, T104-test-web, T104-test-mobile, T104-e2e-web, T104-e2e-mobile) added 2026-05-10 for FR-046 (post-login Home screen) and FR-044a (parity enforcement). Previous total was 173.
