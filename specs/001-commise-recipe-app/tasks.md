# Tasks: Commise Recipe Management Core

**Input**: Design documents from `/specs/001-commise-recipe-app/`
**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `contracts/`

## Format: `- [ ] T001 [P?] [Story?] Description with exact file path`

**TDD Convention**: Tasks suffixed with `-test` are test-first tasks. They MUST be completed before their corresponding implementation task. Implementation is not complete until tests pass (red-green-refactor per NFR-005).

---

## Test Coverage Policy (TDD — binds to CODING_STANDARDS §7.1)

**Binding authority: `docs/CODING_STANDARDS.md §7.1` + the Testing policy in `CLAUDE.md`.** Test-first: every test below is authored and failing (TDD red) **before** its implementation (TDD green). `T117` enforces the pyramid (≥70% unit / ≤20% integration / ≤10% E2E; **k6 is a separate performance gate**) and `T059` gates the tree green.

| Work                                                                                                                                  | Required tests (test-first — ALL of them)                                                                                                                                                                     | Location                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Non-UI code — services, DALs, domain evaluators, **controllers**, workers, type guards, config/env loaders, DTO validation, libraries | **Unit** (mocks + fixtures) **AND Integration** (real PostgreSQL + LocalStack)                                                                                                                                | `src/**/__tests__/*.test.ts` + `__tests__/integration/**/*.integration.spec.ts` |
| The recipe **service** as a deployable HTTP API                                                                                       | additionally **Service e2e** (boot the Nest app vs real Postgres + LocalStack, drive over HTTP) **AND k6** load/performance (SLOs)                                                                            | `tests/e2e/` + `tests/load/*.load.ts`                                           |
| Drizzle schema + migrations                                                                                                           | Schema **type-inference unit test** (`T011-test`) + exercised by every DB-hitting integration/e2e test                                                                                                        | `src/database/__tests__/`                                                       |
| CDK infra (Fargate, ALB rule, SQS/DLQ, `RecipeDbBootstrap`, alarms)                                                                   | **`cdk synth`** assertions + LocalStack integration for runtime behavior                                                                                                                                      | `infra/**/__tests__` / integration                                              |
| UI — components, screens, hooks, the Home widget surface                                                                              | a **vitest component test for EVERY path/state** (loading / empty / populated / error / gated / disabled) **AND a Playwright test for EVERY happy-path/user story** (web; **Maestro** flow for mobile parity) | `src/**/__tests__/*.test.tsx` + `tests/e2e/`                                    |

A feature is **not done** until every category its code touches has all the required tests passing. Where an implementation task builds code lacking a paired `-test` task, that test task is authored (test-first) **before** the code — it is never skipped. (This supersedes the earlier "thin layers are integration-only" carve-out: per §7.1, controllers/DTOs get unit **and** integration tests.)

---

## Phase 1: Setup

**Purpose**: Scaffold required workspaces, test infrastructure, and CI pipeline.

### Workspace Scaffolding

> **Scaffolding method**: Use the `bootstrap` agent skill (`load_skills=["bootstrap"]`) with workspace mode. Each task specifies the bootstrap parameters: `--name`, `--location`, `--type`, `--scope`. Naming follows the **platform/product split** (CODING_STANDARDS §5.1): the recipe **backend** is KitchenSink platform — `@kitchensink/recipe-service` · `-workers` · `-service-client` · `recipe-core` (`--scope kitchensink`, matching the existing `@kitchensink/food-service` style); the recipe **widget / feature UI** is the Commise product — `@commise/features-recipes` + `@commise/features-core` under `packages/apps/commise/features/*` (`--scope commise`). The skill handles `package.json`, `tsconfig.json`, shared tooling extension, and CDK infra overlay per workspace type. Config and database are modules **inside** the recipe service — there is no separate shared `config`/`db` workspace. The recipe tables live in their own logical database `kitchensink_recipes` on the **shared** RDS instance (mirrors `kitchensink_food`; no new RDS instance).

- [x] T001 Scaffold recipe service workspace via bootstrap skill: `--name recipe-service --location packages/services/recipe-service --type nestjs --scope kitchensink` — package name MUST be `@kitchensink/recipe-service`; produces NestJS skeleton + `infra/` CDK Fargate stack. The service uses the **shared RDS instance with its own logical database `kitchensink_recipes`** (provisioned by a `RecipeDbBootstrap` custom resource in the DataStack, mirroring `kitchensink_food`); the CDK `infra/` **`Fn.importValue`s** the shared RDS endpoint (exactly like the food service) and authenticates via **RDS IAM** (passwordless), not provisioning an instance — and includes internal `config/` and `database/` modules
- [x] T001-alb Attach the recipe service to the **EXISTING shared ALB** (`SharedAlbStack`, `kitchensink-alb-{stage}`) in the recipe service's `infra/` — **NO new ALB (no cost increase)**: `Fn.importValue` the shared ALB's HTTPS listener ARN and add an `ApplicationListenerRule` at **priority 300** (identity = 100, food = 200, recipe = 300 — priorities must be unique across the shared listener) host-routing the recipe subdomain to the recipe service's **own target group**, plus the Route 53 **A-record** aliased to the shared ALB. The shared `serviceSecurityGroup` already allows ALB ingress on :3000 (no SG change). The global ALB must deploy before this rule (cross-stack listener-ARN import). Tag `Environment=pr-{N}` per ADR-0005 (per-PR cleanup by tag/name). See ADR-0003
- [x] T001a Configure existing Next.js web app workspace via bootstrap skill: `--name commise-web --location packages/apps/commise/web --type nextjs --scope commise` — bare `package.json` stub already exists, bootstrap populates full Next.js 15 App Router structure + `infra/` CDK stack
- [x] T001b Configure existing Expo mobile app workspace via bootstrap skill: `--name commise-mobile --location packages/apps/commise/mobile --type react-native --scope commise` — bare `package.json` stub already exists, bootstrap populates full Expo 53 structure
- [x] T002 Scaffold recipe worker Lambdas workspace via bootstrap skill: `--name recipe-workers --location packages/services/recipe-workers --type serverless --scope kitchensink` — package name MUST be `@kitchensink/recipe-workers`; single workspace (pattern of `identity-webhooks`) housing the `version-archive-worker` Lambda (SQS-triggered, FR-007b-i — reads the shared RDS (`kitchensink_recipes`) → VPC-attached t4g.nano NAT consumer) and the `account-erasure-worker` Lambda (SQS-triggered, GDPR — reads the shared RDS (`kitchensink_recipes`) + S3 → VPC-attached NAT consumer, D7) + `infra/` CDK (S3 event, SQS, IAM)
- [x] T002a **[global-infra]** Extend the shared **DataStack** (`packages/infra/global/lib/platform/data-stack.ts`) to add the recipe service's logical database on the **existing shared RDS instance**, mirroring the feature-003 `kitchensink_food` provisioning **exactly** (**no new instance/cluster**): a public `recipeDatabaseName = 'kitchensink_recipes'` and a **`RecipeDbBootstrap` custom resource** (a master-connected Lambda mirroring `FoodDbBootstrap`) that creates the **passwordless IAM-auth `recipe_app` LOGIN role** (`GRANT rds_iam`) and the base `kitchensink_recipes` database. **No password secret** — the recipe service authenticates with **short-lived RDS IAM tokens**, its Fargate task role granted `rds-db:connect` scoped to the `recipe_app` db-user (via the shared instance resource id); it reuses the existing `DatabaseEndpoint`/`DatabasePort` and exports `RecipeDatabaseName`. This is an **additive `Environment=global`** change that deploys **before** the recipe service stack; it does NOT replace the instance. Per-PR deploys provision `kitchensink_recipes` per ADR-0006
- [x] T003 **[BLOCKER: GR-007]** Scaffold and publish canonical shared recipe contract workspace via bootstrap skill: `--name recipe-core --location packages/shared/recipe-core --type library --scope kitchensink`. Package name MUST be `@kitchensink/recipe-core` (pure TS types + zod only, no UI, no runtime deps); it is the source of truth for shared recipe, ingredient, collection, visibility, and audience DTO/types before any API or UI feature imports local duplicate domain types
- [x] T004 Scaffold typed recipe API client workspace via bootstrap skill: `--name recipe-service-client --location packages/clients/recipe-service --type library --scope kitchensink` — package name MUST be `@kitchensink/recipe-service-client`; mirrors the existing `@kitchensink/food-service-client` (typed client + TanStack Query hooks; reads base URL from env)
- [x] T005 Scaffold frontend feature UI workspace via bootstrap skill: `--name features-recipes --location packages/apps/commise/features/recipes --type library --scope commise` — package name MUST be `@commise/features-recipes`; exports `.`, `./widget/web`, `./widget/mobile` + building-block components (NO page exports); platform files use the `.native.ts(x)` suffix
- [x] T005-core Scaffold the Commise home-surface contract workspace via bootstrap skill: `--name features-core --location packages/apps/commise/features/core --type library --scope commise` — package name MUST be `@commise/features-core`; holds the Home **widget contract** (`HomeWidgetId`, `HomeWidgetDescriptor`, `curateHomeWidgets`) + the `appShell` ditox DI-token types. Imported by both apps and every `@commise/features-*` package. This is **Commise product** infra — NOT the platform `@kitchensink/recipe-core` (which holds the shared recipe DTO/types)
- [x] T006 [P] Register new workspaces in root `package.json` by adding `"packages/clients/*"` (covers `recipe-service-client`) and `"packages/apps/commise/features/*"` to the `workspaces` array (existing entries: `packages/{tools,services,shared,utils,infra}/*`, `packages/apps/commise/web`, `packages/apps/commise/mobile`, `packages/apps/commise/ui`, `packages/clients/usda`, `packages/clients/food-service` — `packages/services/*` is already present, so no need to re-add it; the `packages/clients/*` glob subsumes the existing per-client entries). Add `test:integration` task to `turbo.json` (`{ "outputs": [] }`) alongside existing `test` task. Verify all workspaces resolve with `npm ls --workspaces`
- [x] T006a [P] Create `infra/docker/postgres-init.sql` with `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and `CREATE EXTENSION IF NOT EXISTS pgcrypto;` — referenced by `docker-compose.yml` init volume mount
- [x] T006b [P] Create local dev `docker-compose.yml` at monorepo root (PostgreSQL 16 + LocalStack S3) per quickstart.md specification — distinct from `docker-compose.test.yml` (T088) which is CI-specific
- [x] T007 [P] Add NestJS API module skeleton files in `packages/services/recipe-service/src/app.module.ts` and `packages/services/recipe-service/src/{auth,recipes,ingredients,versions,photos,collections,search,account,config,database,health,common}/` — use plural module directory names per NestJS convention. No `users` module: the recipe service owns no users table (D2); GDPR erasure lives under `account/` (T134–T137)
- [x] T008 [P] Copy the shared **recipe DTO/types** into the shared package and create barrel exports in `packages/shared/recipe-core/src/recipe.types.ts` and `packages/shared/recipe-core/src/index.ts` — source from `specs/001-commise-recipe-app/contracts/recipe.types.ts`. `recipe.types.ts` holds **ONLY the recipe / ingredient / step / collection / version DTOs** (plus visibility + audience). **`config.types.ts` is NOT shared** — the recipe service's env-config schema is service-internal and lives in its own `config/` module (T010), like identity/food; do **not** copy or export it from `recipe-core`. The **Home-widget contract is NOT here either** — it lives in `@commise/features-core` (`contracts/home-widget.contract.ts`, T104-shared), not `@kitchensink/recipe-core`
- [x] T009 Remove `@ts-expect-error` on zod import in `packages/shared/recipe-core/src/recipe.types.ts` (depends on T008 — file does not exist until contracts are copied)
- [x] T010 [P] Add the recipe-service **config module** (service-internal — no shared config package, matching identity/food): copy the env-config schema into `packages/services/recipe-service/src/config/config.types.ts` (source from `specs/001-commise-recipe-app/contracts/config.types.ts`), plus barrel `packages/services/recipe-service/src/config/index.ts` and loader `packages/services/recipe-service/src/config/load-config.ts`

### Test Infrastructure

- [x] T082 [P] Create backend fixture factories (`makeRecipe`, `makeIngredient`, `makeCollection`, `makeUser`, `makeVersion`, `makePhoto`) in `packages/services/recipe-service/src/__fixtures__/index.ts` — typed, overridable defaults, `make*` naming per constitution
- [x] T083 [P] Create web frontend fixture factories (`makeRecipeViewModel`, `makeCollectionViewModel`) in `packages/apps/commise/web/src/__fixtures__/index.ts`
- [x] T084 [P] Create mobile frontend fixture factories in `packages/apps/commise/mobile/src/__fixtures__/index.ts`
- [x] T085 [P] Configure Vitest base config for API workspace with unit/integration/e2e splits in `packages/services/recipe-service/vitest.config.ts`, `packages/services/recipe-service/vitest.integration.config.ts`
- [x] T086 [P] Configure Playwright project with `globalSetup.ts` (run migrations + seed, start API server) in `packages/apps/commise/web/playwright.config.ts` and `packages/apps/commise/web/tests/e2e/global-setup.ts`
- [x] T087 [P] Create Maestro E2E flow directory structure and base config in `packages/apps/commise/mobile/tests/e2e/.maestro/config.yaml`
- [x] T088 [P] Create `docker-compose.test.yml` for CI test infrastructure (PostgreSQL 16 + LocalStack S3 with bucket auto-provisioning) at monorepo root
- [x] T089 [P] Implement test `globalSetup.ts` for integration tests: start LocalStack, provision S3 buckets, run Drizzle migrations, seed test data in `packages/services/recipe-service/tests/global-setup.ts`

### CI Pipeline

> **Note**: `.github/workflows/ci.yml` already exists with install, lint, format, typecheck, and test jobs using npm cache. Tasks below extend it — do NOT recreate from scratch. Preserve existing job structure and cache strategy.

- [x] T090 [P] Extend existing `.github/workflows/ci.yml` with new jobs: `test-integration` (postgres:16-alpine + localstack/localstack:3 service containers, run migrations + seed, `turbo run test:integration`), `test-e2e-web` (Playwright), `test-e2e-mobile` (Maestro). Fix cache path globs to include deeply nested workspaces (`packages/*/*/*/node_modules`, `packages/*/*/*/*/node_modules`). Preserve existing install/lint/format/typecheck/test jobs
- [x] T091 [P] Add Playwright browser binary caching (version + OS key) and failure-only trace/report artifact upload to `test-e2e-web` job in `.github/workflows/ci.yml`
- [x] T092 [P] Add Maestro CLI installation and mobile E2E job (`test-e2e-mobile`) with Maestro Cloud or self-hosted emulator in `.github/workflows/ci.yml`

### Frontend API Configuration

- [x] T093 [P] Configure `NEXT_PUBLIC_API_URL` env variable with local default in `packages/apps/commise/web/.env.local` and wire into shared API client
- [x] T094 [P] Configure `EXPO_PUBLIC_API_URL` env variable with local default in `packages/apps/commise/mobile/.env` and wire into shared API client
- [x] T095 [P] Update the typed recipe API client (`packages/clients/recipe-service/src/`, `@kitchensink/recipe-service-client`) to read base URL from platform-appropriate env variable at initialization

---

## Phase 2: Foundational (Blocking)

**Purpose**: Complete core infrastructure that blocks all user stories. TDD: write tests for each module before implementation.

### Tests First (TDD Red)

- [x] T011-test Write unit tests for Drizzle schema type inference (verify exported types compile and match data-model.md contracts) in `packages/services/recipe-service/src/database/__tests__/schema.test.ts`
- [x] T017-test Write unit tests for environment loader (valid env, missing required vars, SSM fallback) in `packages/services/recipe-service/src/config/__tests__/load-config.test.ts`
- [x] T019-test Write unit tests for the Clerk AuthMiddleware (valid session token, expired token, missing token, **absent `external_id`/`userId` claim → fail closed with 401, never falls back to `sub`**, dev bypass) in `packages/services/recipe-service/src/auth/__tests__/auth.middleware.test.ts`
- [x] T020-test Write unit tests for API exception filter (RecipeError mapping, unknown error fallback, HTTP status codes) in `packages/services/recipe-service/src/common/filters/__tests__/api-exception.filter.test.ts`
- [x] T021-test Write unit tests for `isRecipeError` type guard in `packages/shared/recipe-core/src/__tests__/recipe.types.test.ts`
- [x] T022-test Write unit tests for throttling configuration (verify rate limits applied to correct route groups) in `packages/services/recipe-service/src/__tests__/throttle.test.ts`

### Implementation (TDD Green)

- [x] T011 Define the recipes Drizzle table in `packages/services/recipe-service/src/database/schema/recipes.ts` **and the `recipe_steps` table in `packages/services/recipe-service/src/database/schema/steps.ts`** (ordered instruction steps FK → `recipes(id)` `ON DELETE CASCADE`; export it from the schema barrel in T015). **No local `users` table** (D2): `owner_id` (and `recipe_versions.created_by`, `collections.owner_id`) store the app-user ULID (from the token claim) directly as `VARCHAR(255) NOT NULL` — no FK, no read-through user replication
- [x] T012 [P] Define ingredient-related Drizzle tables (`ingredients`, `recipe_ingredients`) in `packages/services/recipe-service/src/database/schema/ingredients.ts` — each ingredient carries `food_id` (the food service's internal **ULID**, stored as an **opaque reference**; NEVER an upstream provider record id, NO cross-DB FK to the food DB) plus a **`food_resolution_status`** field (`foodResolutionStatus` in `@kitchensink/recipe-core`, UPPER_SNAKE, CHECK `IN ('PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED')` — mirrors the shipped food client `FoodStatus`, incl. the terminal `NOT_FOUND`/`FAILED`) and a **SEPARATE `is_user_entered` boolean** (freeform / user-entered nutrition per FR-007a — NOT a resolution-status value) so async food resolution and freeform (FR-007/FR-007a) are first-class. 001 owns these tables
- [x] T013 [P] Define versions and photos Drizzle tables in `packages/services/recipe-service/src/database/schema/versions.ts` and `packages/services/recipe-service/src/database/schema/photos.ts`
- [x] T014 [P] Define collections Drizzle tables in `packages/services/recipe-service/src/database/schema/collections.ts`
- [x] T015 Create schema barrel and Drizzle client proxy in `packages/services/recipe-service/src/database/schema/index.ts` and `packages/services/recipe-service/src/database/client.ts`
- [x] T016 Add initial drizzle migration in `packages/services/recipe-service/src/database/migrations/0001_initial.sql` — runs against the recipe service's own logical database `kitchensink_recipes` (default `public` schema): extensions (`pg_trgm`, `pgcrypto`), tables (**including `recipe_steps` from `schema/steps.ts`**), indexes, and the FTS trigger SQL
- [x] T118 [P] Add `deleted_at timestamptz NULL` column + partial index `(owner_id) WHERE deleted_at IS NULL` to `recipes` table in `packages/services/recipe-service/src/database/schema/recipes.ts` and migration `packages/services/recipe-service/src/database/migrations/0002_soft_delete.sql` — moved from Phase 4.5 so Phase 3 DALs consume `deleted_at` from day one (avoids back-patching every read query)
- [x] T119 Add collection provenance columns in `packages/services/recipe-service/src/database/schema/collections.ts` + migration `0003_collection_provenance.sql` — moved from Phase 4.5: (a) `source_collection_id uuid NULL REFERENCES collections(id) ON DELETE SET NULL` on `collections` table; (b) `added_via` enum (`manual` | `clone_seed` | `pull`) on `recipe_collections` membership table with existing rows backfilled to `manual`. (T120 merged into T119 — same file, same migration.)
- [x] T121 **(sequential — after T013; same file `schema/versions.ts`, so NOT `[P]`)** Create `recipe_version_pending_archives` table (FK design per data-model.md — columns: `id`, `recipe_version_id` FK → `recipe_versions(id)` `ON DELETE CASCADE`, `recipe_id`, `version_number`, `status` (`pending`|`in_flight`|`failed`|`dlq`), `attempts`, `last_error`, `next_attempt_at`, `sqs_message_id`, `sqs_receipt`, `created_at`, `updated_at`, `UNIQUE (recipe_version_id)`) in `packages/services/recipe-service/src/database/schema/versions.ts` + migration `0004_pending_archives.sql` — moved from Phase 4.5. **No duplicated `snapshot` column** — the replay payload IS `recipe_versions.snapshot` (same-TX row)
- [x] T122 [P] Create `account_erasure_jobs` table (id, `owner_id` VARCHAR(255) NOT NULL — app-user ULID (from the token claim), no FK/no local users table per D2, status enum: queued|running|completed|failed, attempts, last_error, created_at, updated_at) in `packages/services/recipe-service/src/database/schema/account.ts` + migration `0005_account_erasure.sql` — moved from Phase 4.5
- [x] T017 Implement environment loader with Zod validation and optional SSM fallback in `packages/services/recipe-service/src/config/load-config.ts`
- [x] T018 Wire global DB provider module and injection token in `packages/services/recipe-service/src/database/database.module.ts`
- [x] T000-prereq **[BLOCKER — 001; Clerk session-token config + first-token sync-race handling]** The shared-verifier surfacing is **DONE (PR #60)**: `@kitchensink/clerk-verify` (`VerifiedClerkClaims` + `ClerkAuthService`) already reads the Clerk `external_id` (app-user ULID) claim and sets it as `userId` on the verified Principal. This is a `@kitchensink` **platform** package (not `@commise`). When the claim is absent the shipped verifier leaves `userId` **undefined** and delegates the fail-closed decision to **per-service policy** — it does **NOT** itself fail verification (that assertion lives in the recipe AuthMiddleware, T019). This task therefore covers only the genuinely-remaining work: **(a)** add the app-user ULID to the Clerk **session-token customization** on **both** Clerk instances (prod + sandbox) — a **manual** Clerk-dashboard change so the token actually carries `external_id`; **(b)** handle the **first-token sync race** — a just-created user whose `external_id` is not yet backfilled to Clerk — so a token missing the claim is handled (retry/refresh) rather than silently resolving to a `sub`-shaped owner key. `sub` is retained for trace/audit only, NEVER for ownership. **DONE (2026-07):** (a) the Clerk session-token `external_id` claim is configured on both instances; (b) the first-token sync race is handled in code — the recipe `AuthMiddleware` emits a **distinguishable `401`** carrying `code: IDENTITY_SYNC_PENDING` (the shared constant in `@kitchensink/recipe-core`), and `RecipeServiceClient` **retries with a force-refreshed token + backoff** (`maxIdentitySyncRetries`, default 3), never falling back to `sub`. Residual is app-side only: wiring each app's `TokenSource` to Clerk `getToken({ skipCache: true })` on `forceRefresh`, which lands with the app Clerk setup in **T061/T062**
- [x] T019 **(depends on T000-prereq)** Implement Clerk session-token AuthMiddleware (networkless verification via `CLERK_JWT_KEY` + `azp`, backed by `ClerkAuthService`) in `packages/services/recipe-service/src/auth/auth.middleware.ts` — verifies the Bearer session token and produces the canonical Principal whose `userId` is the **app-user ULID** read from the verified token's `external_id` claim (identity (002) syncs the ULID to Clerk `external_id`). `userId` is THE owner key and ownership everywhere compares `owner_id == principal.userId` (ULID == ULID); `sub` (the Clerk subject) is retained for trace/audit only and is **never** an owner key. The shared `@kitchensink/clerk-verify` already surfaces `userId` from `external_id` (PR #60) but leaves it **undefined** when the claim is absent; this middleware is the **fail-closed enforcement point** — when `principal.userId` is absent/undefined it MUST **reject the request (401)** and MUST NOT fall back to `sub`. Requires the ULID in the session token (T000-prereq adds the Clerk session-token customization). **No `resolveOrCreateFromClaims`, no read-through user creation, no local `users` table**; author display/profile is resolved via the identity client (002) when needed, never stored
- [x] T020 Implement shared API exception filter and recipe-domain error mapping in `packages/services/recipe-service/src/common/filters/api-exception.filter.ts`
- [x] T021 Add `isRecipeError(e: unknown): e is RecipeError` type guard in `packages/shared/recipe-core/src/recipe.types.ts`
- [x] T022 Configure API throttling defaults (writes 30/min, photos 10/min, search 60/min) in `packages/services/recipe-service/src/app.module.ts`

### E2E Seed Data

- [x] T096 Implement deterministic E2E seed script with stable IDs for 5 recipes + 1 collection owned by 2 stable Clerk test subjects (free + pro), keyed by `owner_id` (no `users` rows to seed — D2, the recipe service owns no users table), in `packages/services/recipe-service/src/database/seed.ts` — idempotent via `ON CONFLICT DO NOTHING`
- [x] T097 Add `npm run seed` script to `packages/services/recipe-service/package.json` and wire into Playwright/integration `globalSetup.ts`

**Checkpoint**: Foundation complete; user story phases can start.

---

## Phase 3: User Story 1 - Create and Manage Personal Recipes (P1) 🎯 MVP

**Goal**: Deliver recipe CRUD, ingredient handling, versioning, photos, collections, and search for owned/public recipes.

**Independent Test**: Create, edit, delete, search/filter recipes with ingredients/photos/collections and verify version/conflict behavior.

### Tests First (TDD Red) — Backend Unit Tests

- [x] T024-test Write unit tests for recipe DAL (create, findById, findAll with pagination, update, delete, ownership check) using fixtures in `packages/services/recipe-service/src/recipes/dal/__tests__/recipes.dal.test.ts`
- [x] T025-test Write unit tests for recipe service (CRUD orchestration, authorization, validation) using mocked DAL in `packages/services/recipe-service/src/recipes/__tests__/recipes.service.test.ts`
- [x] T027-test Write unit tests for ingredient DAL (pg_trgm search, tsvector search, freeform creation) in `packages/services/recipe-service/src/ingredients/dal/__tests__/ingredients.dal.test.ts`
- [x] T028-test Write unit tests for ingredient service (food-service-client resolution: typeahead `search`, `addByName` → async `PENDING`/`UNRESOLVED`, poll `getById`/`getStatus`, disambiguation `getCandidates`/`resolve(id, candidateIds)`; **terminal `NOT_FOUND`/`FAILED` → surface error + freeform fallback + allow removal**; freeform + user-entered nutrition via the separate `isUserEntered` flag; dedup) in `packages/services/recipe-service/src/ingredients/__tests__/ingredients.service.test.ts`
- [x] T030-test Write unit tests for version DAL (snapshot create, list by recipe, retention query) in `packages/services/recipe-service/src/versions/dal/__tests__/versions.dal.test.ts`
- [x] T031-test Write unit tests for version service (snapshot write, DB retention pruning, S3 archive call) using mocked S3 in `packages/services/recipe-service/src/versions/__tests__/versions.service.test.ts`
- [x] T033-test Write unit tests for optimistic concurrency (version mismatch detection, 409 payload) in `packages/services/recipe-service/src/recipes/__tests__/conflict.service.test.ts`
- [x] T034-test Write unit tests for photo DAL (metadata CRUD, 10-photo limit enforcement) in `packages/services/recipe-service/src/photos/dal/__tests__/photos.dal.test.ts`
- [x] T035-test Write unit tests for photo service (presigned URL generation with mocked S3 — allowlisted ContentType + 5 MB ContentLengthRange; confirm = **magic-byte signature validation** (jpeg/png/webp, NOT the client Content-Type) + S3 HEAD size ≤ 5 MB → insert; list; delete; reorder) in `packages/services/recipe-service/src/photos/__tests__/photos.service.test.ts`
- [x] T039-test Write unit tests for collections DAL (CRUD, membership add/remove, multi-membership) in `packages/services/recipe-service/src/collections/dal/__tests__/collections.dal.test.ts`
- [x] T040-test Write unit tests for collections service (CRUD, membership, no-cascade delete) in `packages/services/recipe-service/src/collections/__tests__/collections.service.test.ts`
- [x] T140-test Write unit tests for set-collection-visibility (FR-010): toggles `collections.visibility` public↔private, ownership enforced, invalid value rejected, response reflects new visibility in `packages/services/recipe-service/src/collections/__tests__/collection-visibility.service.test.ts`
- [x] T042-test Write unit tests for search DAL (FTS rank query, facet aggregation, empty result) in `packages/services/recipe-service/src/search/dal/__tests__/search.dal.test.ts`

### Implementation (TDD Green)

- [x] T023 [P] [US1] Define create/update/list recipe DTOs in `packages/services/recipe-service/src/recipes/dto/{create-recipe.dto.ts,update-recipe.dto.ts,list-recipes.query.dto.ts}`
- [x] T024 [P] [US1] Implement recipe DAL queries in `packages/services/recipe-service/src/recipes/dal/recipes.dal.ts`
- [x] T025 [US1] Implement recipe create/list/get/update/delete service logic in `packages/services/recipe-service/src/recipes/recipes.service.ts`
- [x] T026 [US1] Implement recipes controller endpoints for `/v1/recipes` and `/v1/recipes/{id}` in `packages/services/recipe-service/src/recipes/recipes.controller.ts`
- [x] T027 [P] [US1] Implement ingredient search DAL with pg_trgm + tsvector strategy in `packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts`
- [x] T028 [US1] Implement ingredient service backed by the source-agnostic food service (003) via `@kitchensink/food-service-client` (`FoodServiceClient`) — typeahead `search`, `addByName` (→ `202 { id, status: PENDING | UNRESOLVED }`, async resolution), poll `getById`/`getStatus`, disambiguation `getCandidates`/`resolve(id, candidateIds)` — persisting `food_id` (opaque food ULID) + `food_resolution_status` (`PENDING`|`UNRESOLVED`|`RESOLVED`|`NOT_FOUND`|`FAILED`); a terminal `NOT_FOUND`/`FAILED` surfaces an error and offers the freeform fallback (removal allowed), plus freeform (FR-007a, user-entered nutrition via the separate `is_user_entered` flag) creation, in `packages/services/recipe-service/src/ingredients/ingredients.service.ts`
- [x] T029 [US1] Implement ingredients controller endpoints for `/v1/ingredients/search` and `/v1/ingredients` in `packages/services/recipe-service/src/ingredients/ingredients.controller.ts`
- [x] T030 [P] [US1] Implement recipe version snapshot DAL in `packages/services/recipe-service/src/versions/dal/versions.dal.ts`
- [x] T031 [US1] Implement versioning service for snapshot writes, DB retention (last 10), and S3 archive writes in `packages/services/recipe-service/src/versions/versions.service.ts`
- [x] T032 [US1] Implement versions controller endpoints for list/get/restore in `packages/services/recipe-service/src/versions/versions.controller.ts`
- [x] T033 [US1] Implement optimistic concurrency conflict handling with HTTP 409 payload in `packages/services/recipe-service/src/recipes/recipes.service.ts`
- [x] T034 [P] [US1] Implement photo metadata DAL with 10-photo limit checks in `packages/services/recipe-service/src/photos/dal/photos.dal.ts`
- [x] T035 [US1] Implement photo upload-url + confirm service logic in `packages/services/recipe-service/src/photos/photos.service.ts` — `upload-url` presigns an S3 PUT (allowlisted `ContentType` ∈ `image/jpeg | image/png | image/webp`; `ContentLengthRange` ≤ 5 MB); `confirm` validates the uploaded object by **magic-byte signature** (jpeg/png/webp, NOT the client Content-Type) + an S3 HEAD size ≤ 5 MB, then INSERTs the `recipe_photos` row (single `s3_key`, `content_type`, `size_bytes`). Object is served as-is via CloudFront — no resizing, no variants, no processing state
- [x] T036 [US1] Implement photos controller endpoints for upload-url/confirm/list/delete/reorder in `packages/services/recipe-service/src/photos/photos.controller.ts`
- [x] T039 [P] [US1] Implement collections DAL queries in `packages/services/recipe-service/src/collections/dal/collections.dal.ts`
- [x] T040 [US1] Implement collections service for CRUD and recipe membership in `packages/services/recipe-service/src/collections/collections.service.ts`
- [x] T041 [US1] Implement collections controller endpoints in `packages/services/recipe-service/src/collections/collections.controller.ts`
- [x] T140 [US1] Implement **set-collection-visibility** (FR-010; FR-011 clone-public-collection depends on it): a `PATCH /v1/collections/{id}` (visibility field) controller endpoint + service method that writes the `collections.visibility` column (public/private), ownership-enforced, in `packages/services/recipe-service/src/collections/{collections.controller.ts,collections.service.ts}`. The `collections.visibility` **column** (schema/migration) and the OpenAPI field are added by other agents (T014 schema / T053 OpenAPI); this task consumes them
- [x] T042 [P] [US1] Implement search DAL with FTS rank sampling CTE and facet aggregation in `packages/services/recipe-service/src/search/dal/search.dal.ts`
- [x] T043 [US1] Implement search service/controller for `/v1/search/recipes` in `packages/services/recipe-service/src/search/{search.service.ts,search.controller.ts}`

### Recipe ↔ Ingredient Composition (cross-vertical reconciliation)

- [x] T043b-test [US1] Write unit + integration tests for recipe↔ingredient composition: recipe create/update persists `recipe_ingredients` link rows (each line resolved to an `ingredients` row — food-backed by `food_id` or freeform by name — via the ingredients DAL), and `GET /v1/recipes/{id}` composes the response `ingredients` array (join `recipe_ingredients` → `ingredients`). In `src/recipes/__tests__/recipe-ingredients.composition.test.ts` + `__tests__/integration/recipes/ingredients-composition.integration.spec.ts`
- [x] T043b [US1] **[cross-vertical reconciliation — closes the parallel-agent seam]** Persist `recipe_ingredients` on recipe create/update and compose them on read. The recipes vertical (T024/T025) currently persists only `recipes` + `recipe_steps` + the denormalized `ingredient_names_text` and emits an **empty `ingredients` array**; the ingredients vertical (T027/T028) owns the `ingredients` table but not the recipe link. Add a `RecipeIngredientsDal` (owns the `recipe_ingredients` junction) wired into `RecipesService`, collaborating with the ingredients DAL to resolve/create each line, so `POST/PATCH /v1/recipes` and `GET /v1/recipes/{id}` handle ingredients end-to-end. Also add `FOOD_SERVICE_URL` / `FOOD_SERVICE_TOKEN` to the recipe-service config schema (`src/config/config.types.ts`) so the ingredients food-client env is validated (currently read from raw `process.env`)

### Integration Tests (TDD — against real DB + LocalStack)

- [x] T044 [US1] Add integration test for version retention AS SHIPPED post-T130 (save-time prunes NOTHING — every version stays in Postgres; each version beyond the newest 10 is recorded in the `recipe_version_pending_archives` outbox for the async version-archive worker; enqueue is idempotent across repeated saves — no S3 write on the save path) in `packages/services/recipe-service/__tests__/integration/versions/retention.integration.spec.ts`
- [x] T045 [US1] Add integration test for optimistic conflict detection returning HTTP 409 with version metadata in `packages/services/recipe-service/__tests__/integration/recipes/conflict.integration.spec.ts`
- [x] T098 [US1] Add integration test for recipe CRUD lifecycle (create → get → update → list → delete) against real PostgreSQL in `packages/services/recipe-service/__tests__/integration/recipes/crud.integration.spec.ts`
- [x] T099 [US1] Add integration test for ingredient search (pg_trgm fuzzy + FTS exact) against real PostgreSQL in `packages/services/recipe-service/__tests__/integration/ingredients/search.integration.spec.ts`
- [x] T100 [US1] Add integration test for photo upload flow (presigned URL → S3 upload via LocalStack → confirm validates magic bytes + S3 HEAD size ≤ 5 MB → `recipe_photos` row with single `s3_key`; served as-is, no processing) in `packages/services/recipe-service/__tests__/integration/photos/upload.integration.spec.ts`
- [x] T101 [US1] Add integration test for collections CRUD + membership (add/remove recipes, no-cascade delete) in `packages/services/recipe-service/__tests__/integration/collections/crud.integration.spec.ts`
- [x] T102 [US1] Add integration test for search endpoint (FTS + facets + pagination) in `packages/services/recipe-service/__tests__/integration/search/search.integration.spec.ts`

**Checkpoint**: US1 delivers complete personal recipe management MVP with full test coverage.

---

## Phase 4: User Story 2 - Share, Copy, and Clone Recipes (P1)

**Goal**: Deliver sharing and cloning with C-004 visibility policy, attribution retention, and substantive edit tracking.

**Independent Test**: User A shares public recipe, User B clones, edits clone, original unchanged, and visibility transitions enforce C-004.

### Tests First (TDD Red)

- [x] T048-test Write unit tests for visibility policy evaluator (all C-004 scenarios: user-created, imported-public, imported-physical, paid-source, tier transitions, substantive edit unlock) in `packages/services/recipe-service/src/recipes/domain/__tests__/visibility-policy.test.ts`
- [x] T047-test Write unit tests for clone service (attribution copy, owner reassignment, visibility inheritance) in `packages/services/recipe-service/src/recipes/__tests__/clone.service.test.ts`
- [x] T049-test Write unit tests for substantive edit detection (ingredient change = substantive, title change = not substantive) in `packages/services/recipe-service/src/recipes/__tests__/substantive-edit.service.test.ts`
- [x] T139-test Write unit tests for substantive-edit detection on **imported** recipes (FR-005 + C-004): editing ingredients/steps on an imported recipe MUST set `hasSubstantiveEdit=true` and unlock private-visibility transition for premium users per C-004; editing only metadata (title, description, tags, photos) MUST NOT in `packages/services/recipe-service/src/recipes/__tests__/substantive-edit-imported.test.ts`

### Implementation (TDD Green)

- [x] T046 [P] [US2] Add clone and visibility DTOs in `packages/services/recipe-service/src/recipes/dto/{clone-recipe.dto.ts,set-visibility.dto.ts}`
- [x] T047 [US2] Implement clone workflow with attribution copy and owner reassignment in `packages/services/recipe-service/src/recipes/recipes.service.ts`
- [x] T048 [US2] Implement C-004 visibility policy evaluator for source type, tier, and substantive edit state in `packages/services/recipe-service/src/recipes/domain/visibility-policy.ts`
- [x] T049 [US2] Implement substantive edit detection for ingredient/step mutations updating `hasSubstantiveEdit` in `packages/services/recipe-service/src/recipes/recipes.service.ts`
- [x] T139 [US2] Extend substantive-edit detector to handle imported-recipe lineage per FR-005 + C-004 (preserve source-import flag through versioning so premium users can unlock private visibility only after a substantive edit) in `packages/services/recipe-service/src/recipes/recipes.service.ts`
- [x] T050 [US2] Implement `/v1/recipes/{id}/clone` and `/v1/recipes/{id}/visibility` endpoints in `packages/services/recipe-service/src/recipes/recipes.controller.ts`

### Integration Tests

- [x] T051 [US2] Add integration test for clone visibility + attribution + substantive-edit unlock rules in `packages/services/recipe-service/__tests__/integration/recipes/clone-visibility.integration.spec.ts`
- [x] T103 [US2] Add integration test for collection cloning (public collection clone excludes private recipes) in `packages/services/recipe-service/__tests__/integration/collections/clone-collection.integration.spec.ts`

**Checkpoint**: US2 sharing and cloning behavior is independently functional and policy-compliant.

---

## Phase 4.5: Spec Clarification Deltas

**Purpose**: Implement behavior added by the 2026-04-29 spec clarifications — recipe soft-delete tombstones (C-007), collection clone provenance + pull-from-source (FR-011), async version-archive worker (FR-007b-i), and GDPR account erasure flow.

### Schema & Migrations

> **Note**: Schema tasks T118–T122 were moved to Phase 2 Foundational (after T016) so Phase 3 DALs consume the new columns/tables from day one. This section is intentionally empty; behavior tasks below depend on those Phase 2 schema tasks.

### Recipe Soft-Delete (C-007)

- [x] T123-test Write unit tests for recipe DAL soft-delete (sets `deleted_at`; find/list/update/setVisibility exclude tombstones; re-delete is idempotent) in `packages/services/recipe-service/src/recipes/dal/__tests__/recipes.dal.soft-delete.test.ts`. **Corrected 2026-07-15**: the original text also said "owner can still see version history" — that contradicts FR-002 ("no longer accessible via normal APIs") and was NOT implemented. `VersionsService.list` gates on `RecipesService.getById`, so a tombstoned recipe 404s its version history; C-007 retention means the rows SURVIVE for erasure/S3, not that they stay reachable. Search/collection tombstone exclusion is owned by T124/T125's own DAL specs and is not duplicated here.
- [x] T123 Update recipe DAL to soft-delete (UPDATE … SET deleted_at = now()) and add `WHERE deleted_at IS NULL` filter to all read queries in `packages/services/recipe-service/src/recipes/dal/recipes.dal.ts`
- [x] T124 Update search DAL to exclude tombstoned recipes (`WHERE deleted_at IS NULL`) in `packages/services/recipe-service/src/search/dal/search.dal.ts`
- [x] T125 Update collections DAL to exclude tombstoned recipes from membership list responses in `packages/services/recipe-service/src/collections/dal/collections.dal.ts`
- [x] T126 [US1] Add integration test asserting `DELETE /v1/recipes/{id}` returns 204, row remains with `deleted_at` set, and recipe is excluded from list/search/get/collection responses in `packages/services/recipe-service/__tests__/integration/recipes/soft-delete.integration.spec.ts`. Covers the previously-unpinned C-007 retention guarantee (the row SURVIVES — a hard `DELETE FROM recipes` passed the whole suite before this) plus owner-list exclusion and idempotent re-delete. The search / collection / GET-404 clauses were already owned by `search/search.integration.spec.ts`, `collections/crud.integration.spec.ts`, and `recipes/crud.integration.spec.ts` respectively, so they are referenced rather than duplicated.

### Collection Clone & Pull-from-Source (FR-011)

- [x] T127-test Write unit tests for collection clone service (creates new collection with `source_collection_id`, copies memberships with `added_via=clone_seed`, owner reassignment) in `packages/services/recipe-service/src/collections/__tests__/clone-collection.service.test.ts`
- [x] T128-test Write unit tests for pull-from-source service (additive only, `added_via=pull`, no-op when no new recipes, 400 when collection has no source) in `packages/services/recipe-service/src/collections/__tests__/pull-from-source.service.test.ts`
- [x] T127 [US2] Implement `cloneCollection` and `pullFromSource` in `packages/services/recipe-service/src/collections/collections.service.ts`
- [x] T128 [US2] Add `CloneCollectionRequest` DTO + controller endpoints `POST /v1/collections/{id}/clone` and `POST /v1/collections/{id}/pull-from-source` in `packages/services/recipe-service/src/collections/{dto/clone-collection.dto.ts,collections.controller.ts}`
- [x] T129 [US2] Update existing T103 collection-clone integration test to assert `source_collection_id` and `added_via=clone_seed` are set, and add a follow-up `pull-from-source` integration test in `packages/services/recipe-service/__tests__/integration/collections/pull-from-source.integration.spec.ts`

### Async Version Archive Worker (FR-007b-i)

- [x] T130-test Write unit tests for pending-archive enqueue — insert one idempotent row (`UNIQUE(recipe_version_id)` + `ON CONFLICT DO NOTHING`) when a version goes over-retention — in `packages/services/recipe-service/src/versions/dal/__tests__/pending-archives.dal.test.ts`. Retries are NOT tracked in-DB: the shipped design re-drives a failed archive via SQS redelivery and, on exhaustion, the DLQ (worker handler tested in recipe-workers `version-archive-worker.test.ts`: success → DELETE outbox row, failure → throw → SQS redelivery → DLQ). No `attempts`/`last_error` DAL mutation path — the outbox row is the source of truth, the SQS message derived
- [x] T130 Update versioning service to record over-retention versions in the `recipe_version_pending_archives` outbox (no S3 write, no prune at save time) instead of writing to S3 inline — the version-archive worker archives-then-prunes across the async boundary — in `packages/services/recipe-service/src/versions/versions.service.ts`
- [x] T131 Implement version-archive worker (SQS-triggered Lambda) that drains pending rows, writes snapshots to S3 versions bucket, and deletes the pending row on success in `packages/services/recipe-workers/src/version-archive-worker/handler.ts` (workspace `@kitchensink/recipe-workers` scaffolded in T002; this Lambda reads the shared RDS (`kitchensink_recipes`) → VPC-attached t4g.nano NAT consumer)
- [x] T132 Add CDK infrastructure for version-archive SQS queue + DLQ + Lambda subscription in `packages/services/recipe-workers/infra/`
- [x] T133 Add integration test for the full async archive path (enqueue → worker drains → S3 object exists, pending row gone) using LocalStack SQS + S3 in `packages/services/recipe-workers/__tests__/integration/archive.integration.spec.ts`
- [x] T138 Add CloudWatch alarms for pending-archive backlog (per FR-007b-i SLO): backlog count > 100 sustained > 15 min, and oldest pending row age > 1 hour. Wire SNS topic for ops paging. Define in `packages/services/recipe-workers/infra/lib/alarms.ts`

### GDPR Account Erasure

> **✅ COMPLETE & VERIFIED (2026-07-16). The stub-hazard note this replaces is obsolete.**
>
> The entire GDPR erasure group shipped and is verified at every tier: `eraseRecipeRows` performs the
> real FK-safe delete inside a transaction (NULL-ing foreign `cloned_from_id` first, then `recipes`
> incl. tombstones, `collections`, and `recipe_ratings WHERE user_id` — the third owner-scoped root);
> the handler sweeps `ownerMediaPrefix(ownerId)` in **both** the media and archive buckets; the queue +
> DLQ + subscription + cron sweeper are wired (T136b); an archive-orphan-sweep backstop closes the
> archive-resurrection race; and the whole path is proven by unit (mutation-verified 19/19), integration
> (real Postgres 16 + LocalStack), and e2e tiers. The prior ordering hazard (worker-body-before-trigger)
> was honored during implementation and no longer applies.

- [x] T134-test Write unit tests for erasure service (queues job; duplicate request while job is `queued` or `running` returns HTTP 202 with existing job id; request after `completed` returns 410; request after `failed` enqueues a fresh job and returns 202; validates optional confirmation phrase) in `packages/services/recipe-service/src/account/__tests__/erasure.service.test.ts`
- [x] T135-test Write unit tests for erasure worker (hard-deletes recipes incl. tombstoned, versions, photos, collections, S3 photo + version objects, marks job completed) in `packages/services/recipe-workers/src/account-erasure-worker/__tests__/handler.test.ts`
- [x] T134 Implement `AccountModule` with `ErasureService` (inserts the `account_erasure_jobs` row and **enqueues to the SQS `account-erasure` queue**, D7) and `ErasureRequest` / `ErasureRequestAcceptedResponse` DTOs in `packages/services/recipe-service/src/account/{account.module.ts,erasure.service.ts,dto/erasure.dto.ts}`
- [x] T135 Implement `POST /v1/account/erasure` controller in `packages/services/recipe-service/src/account/account.controller.ts`
- [x] T136 Implement the **SQS-triggered, VPC-attached** erasure worker Lambda that hard-deletes all user-owned data (recipes incl. tombstoned, versions, pending-archive rows, photos, collections, memberships, S3 photo objects, S3 version-archive objects) and marks the `account_erasure_jobs` row `completed`/`failed` in `packages/services/recipe-workers/src/account-erasure-worker/handler.ts` (D7 — moved out of the Fargate service; reads the shared RDS (`kitchensink_recipes`) + S3 → VPC-attached NAT consumer)
- [x] T136b Add CDK infrastructure for the **`account-erasure` SQS queue + DLQ + VPC-attached erasure-worker Lambda subscription + a scheduled cron sweeper** (EventBridge rule) that re-drains stuck `queued`/`running` jobs (mirrors the version-archive pattern, D7) in `packages/services/recipe-workers/infra/`
- [x] T137 Add integration test for end-to-end erasure: seed user with recipes (some tombstoned), photos in LocalStack S3, version archives, collections → trigger erasure → assert all rows + S3 objects gone, job row marked `completed` in `packages/services/recipe-service/__tests__/integration/account/erasure.integration.spec.ts`

**Checkpoint**: Spec clarifications for soft-delete, collection clone provenance, async version archives, and GDPR erasure are implemented and tested.

---

## Phase 5: Frontend — Web (Next.js 15) & Mobile (Expo 53)

**Purpose**: Deliver platform-parity UI for recipe CRUD, search, collections, sharing/cloning, photo management, and the post-login Home screen. Every task in this phase must satisfy the parity rule from FR-044a: cover both platforms explicitly, have a paired task for the other platform, or carry a `[PARITY-EXCEPTION]` note.

### Parity Checklist (Phase 5 gate)

Before Phase 5 is marked complete, verify every implementation task below satisfies one of:

1. **Both platforms named** in the task description (file paths or "web + mobile" explicit)
2. **Paired tasks** exist and reference each other (e.g., T104-web + T104-mobile)
3. **`[PARITY-EXCEPTION]`** note present in the task body with reason and future spec reference

This checklist is a blocking gate. Phase 6 cannot start until all Phase 5 tasks pass. Verification is
tracked by **T060**, not by this rubric.

> **Numbered, not `- [ ]`, on purpose (2026-07-15).** These three are a rubric applied _to_ the tasks
> below — they are not work items. As checkboxes they were counted by every `- [ ]` / `- [x]` tally,
> which is why the ledger long read "190 tasks" when only **187** exist, and why they showed as three
> permanently-open tasks that no one could ever close.

---

### Setup & Shared

- [x] T061 [P] Configure Next.js 15 App Router with Clerk web SDK (`@clerk/nextjs`: `<ClerkProvider>` + `middleware.ts`) in `packages/apps/commise/web/src/app/layout.tsx`
- [x] T062 [P] Configure Expo 53 with Clerk native SDK (`@clerk/expo`, tokens in `expo-secure-store`) in `packages/apps/commise/mobile/src/app/_layout.tsx`
- [x] T063 [P] Set up shared design tokens (colors, spacing, typography) in `packages/apps/commise/ui/src/tokens/` (`@commise/ui`) consumable by both web (Tailwind v4) and mobile (Tamagui)
- [x] T064-test Write unit tests for the typed recipe API client hooks (useRecipes, useRecipe, useCreateRecipe, etc.) using MSW mocks in `packages/clients/recipe-service/src/hooks/__tests__/` — **TDD red for T064; complete before T064** (renumbered from a bare `T104` that collided with the Home-widget `T104-*` family)
- [x] T064 [P] Create the typed recipe API client (`@kitchensink/recipe-service-client`, TanStack Query v5) with typed hooks for recipe endpoints in `packages/clients/recipe-service/src/hooks/` — reads `NEXT_PUBLIC_API_URL` / `EXPO_PUBLIC_API_URL` for base URL (NFR-009); mirrors `@kitchensink/food-service-client`

### Home Screen (US-0) — Widget Surface — P1

> **Design authority**: [`research/home-widget-architecture.md`](./research/home-widget-architecture.md) (the `## DECISION (2026-07-06)` section) and the plan's "Post-Login Home Screen — Widget Surface" section. Home is a **widget surface** (Discovery → Composition → Render), NOT a hardcoded fan-out of parallel calls to a fixed set of endpoints.
> **Parity**: Both web and mobile tasks are required. They are listed as separate tasks so each can be tracked, reviewed, and tested independently.

- [x] T104-shared [P] [US0] Define the shared Home **widget contract** (`HomeWidgetId` union, `HomeWidgetDescriptor` with `load`/`capability`/`minTier`/`defaultWeight`, `curateHomeWidgets(widgets, ctx)` types) in `apps/commise/features/core/src/{contract.ts,curate-home-widgets.ts}` (the **`@commise/features-core`** package — Commise home-surface infra, NOT the platform `@kitchensink/recipe-core`; pure types + zod + a pure composition fn — gate by capability + tier, order by personalization), and implement the recent-recipes **recipe widget** (`widget.web.tsx` + `widget.native.tsx`, `.native` suffix — never `.mobile`) with its descriptor/loader `load: () => import('@commise/features-recipes/widget/{web|mobile}')` in `apps/commise/features/recipes/src/widget/`, exported via `@commise/features-recipes` `./widget/web` + `./widget/mobile`. Accessible names, skeleton + empty-state variants (empty state applies only to this live widget)
- [x] T104-web [US0] Implement the Home widget-surface **host** on web — `packages/apps/commise/web/src/app/page.tsx` + `packages/apps/commise/web/src/components/home/` — the composition root is a **Client Component (`'use client'`)** under RSC (state the server/client boundary: the `page.tsx` server route renders the client host; the client host holds the widget composition). It registers features via explicit startup registration (`.use(addFeature)`), wires the **ditox `appShell`** container (`ditox` + `@ditox/react`: `CustomDependencyContainer` + `useDependency`; RSC/server uses the core `ditox` container), runs `curateHomeWidgets` (capability + tier gating, personalization order), and renders each curated widget via **`next/dynamic(reg.load)`** (not `React.lazy`) + `Suspense` + per-widget `ErrorBoundary` (unknown ids skipped). **Only the recipe widget is registered in v1**; the meal-plan/nutrition/shopping/AI/resume-cooking widgets are **absent** — each is added (with its `import('@commise/features-*/widget/web')` loader) only when its feature package (005–009) ships, and auto-appears then via capability gating. Responsive 2-column grid ≥768px / 1-column below; subscription nudge bottom sheet on premium-gated tap (once per session, component state only)
- [x] T104-mobile [US0] Implement the Home widget-surface **host** on mobile — `packages/apps/commise/mobile/src/screens/HomeScreen.tsx` + `packages/apps/commise/mobile/src/components/home/` — same composition root + ditox `appShell` (core `ditox` container + `@ditox/react` provider), `curateHomeWidgets`, and `React.lazy(reg.load)` + `Suspense` + per-widget `ErrorBoundary` render (unknown ids skipped). **Only the recipe widget is registered in v1**; the gated widgets are **absent** — each is added (with its `import('@commise/features-*/widget/mobile')` loader) only when its feature package (005–009) ships, and auto-appears then via capability gating. Vertical ScrollView; resume-cooking card only appears once its service (008) is live and a session is active; subscription nudge modal on premium-gated tap (once per session, component state only)
- [x] T104-curate-test [P] [US0] Write **unit** tests for the pure `curateHomeWidgets(widgets, ctx)` composition fn **directly** (not only via the host component): hidden widgets dropped; capability-gating (widget dropped when its `capability` is absent from the context's live capabilities); tier-gating (`minTier` above the viewer tier dropped, at/below kept); ordering (viewer `order`, then descending `defaultWeight`); input array/objects not mutated; fail-closed on an unknown tier — in `packages/apps/commise/features/core/src/__tests__/curate-home-widgets.test.ts`. **TDD red before T104-shared's `curate-home-widgets.ts`** (this pure fn is the Home-surface design authority and must be unit-tested, not only exercised through the web/mobile hosts)
- [x] T104-test-web [US0] Write component tests for the Home widget surface web (recipe widget: loading/empty/populated; **gated widgets are absent — not present-with-empty-state**; unknown widget id is skipped; nudge appears once per session) in `packages/apps/commise/web/src/app/__tests__/page.test.tsx` — MSW mocks for the recipe widget's data only
- [x] T104-test-mobile [US0] Write component tests for the Home widget surface mobile (recipe widget: loading/empty/populated; **gated widgets are absent — not present-with-empty-state**; unknown widget id is skipped; nudge appears once per session; resume card absent while its service is not live) in `packages/apps/commise/mobile/src/__tests__/HomeScreen.test.tsx` — MSW mocks for the recipe widget's data only
- [x] T104-e2e-web [US0] Add Playwright E2E test for the Home widget surface: login → recipe (recent-recipes) widget renders → assert the gated widgets are **absent** → tap the recipe widget entry point → verify navigation in `packages/apps/commise/web/tests/e2e/home.spec.ts`
- [x] T104-e2e-mobile [US0] Add Maestro E2E flow for the Home widget surface: login → recipe widget renders → assert gated widgets are **absent** → tap the recipe widget entry point → verify navigation in `packages/apps/commise/mobile/tests/e2e/home.yaml`

### Frontend Unit/Component Tests (TDD Red — mocks + fixtures only)

> **Note**: The typed API client hooks unit test is **T064-test** (in "Setup & Shared" above, immediately before its implementation T064) — it was renumbered from a bare `T104` that collided with the Home-widget `T104-*` family.

- [x] T105 Write component tests for recipe list (loading, empty, populated, search filter) in `packages/apps/commise/web/src/app/recipes/__tests__/page.test.tsx`
- [x] T106 Write component tests for recipe create/edit form (validation, ingredient autocomplete, photo upload) in `packages/apps/commise/web/src/app/recipes/__tests__/form.test.tsx`
- [x] T107 Write component tests for collection views (list, detail, add/remove) in `packages/apps/commise/web/src/app/collections/__tests__/`
- [x] T108 Write component tests for clone/visibility flow (attribution display, tier restrictions) in `packages/apps/commise/web/src/app/recipes/__tests__/clone.test.tsx`
- [x] T108b [US1/US2] Write component tests for the remaining logic-bearing screens not covered by T105–T108 — recipe **detail** (nutrition summary + async "nutrition pending" state; T066), **delete** confirmation (T068), **version history**/restore (T069), **conflict-resolution** UI (present-both / choose-merge; T070), **visibility toggle** with tier restrictions (T074), and **public discovery/browse** (T076) — web + mobile, mocks + fixtures only. **TDD red before each screen's impl.** (These previously had only E2E coverage — this closes the component-test gap so the unit pyramid holds per T117.)

### Recipe CRUD (US1)

- [x] T065 [US1] Implement recipe list screen with search/filter bar — web: `packages/apps/commise/web/src/app/recipes/page.tsx`, mobile: `packages/apps/commise/mobile/src/screens/RecipeListScreen.tsx`
- [x] T066 [US1] Implement recipe detail view with ingredients, instructions, photos, and nutrition summary — web + mobile
- [x] T067 [US1] Implement recipe create/edit form with ingredient autocomplete (food-service `search` typeahead + freeform), step editor, photo upload, and tag picker — web + mobile. The picker MUST handle async resolution: a just-added food (`addByName`) may show "nutrition pending" (`PENDING`/`UNRESOLVED`) and resolve later, and an `UNRESOLVED` food offers disambiguation candidates (`getCandidates`/`resolve(id, candidateIds)`); a terminal `NOT_FOUND`/`FAILED` surfaces an error, offers the freeform fallback, and allows removal; a recipe may temporarily show partial nutrition
- [x] T068 [US1] Implement recipe delete confirmation flow — web + mobile
- [x] T069 [US1] Implement version history view with restore action — web + mobile
- [x] T070 [US1] Implement concurrent edit conflict resolution UI (present both versions, choose/merge) — web + mobile

### Collections (US1)

- [x] T071 [US1] Implement collection list and detail views — web + mobile
- [x] T072 [US1] Implement add/remove recipe from collection flow — web + mobile
- [x] T073 [US1] Implement collection create/rename/delete — web + mobile

### Sharing & Cloning (US2)

- [x] T074 [US2] Implement recipe visibility toggle (public/private) with tier restrictions — web + mobile
- [x] T075 [US2] Implement clone recipe flow with attribution display — web + mobile
- [x] T076 [US2] Implement public recipe discovery/browse view — web + mobile

### Web E2E Tests (Playwright)

- [x] T077 Verify all interactive elements have accessible names (`getByRole`/`getByLabel`) — web Playwright E2E tests in `packages/apps/commise/web/tests/e2e/`
- [x] T078 Verify color is never sole state conveyor (icon/text pairing) across all screens — web + mobile
- [x] T079 Add Playwright E2E tests for recipe CRUD happy path (create → view → edit → delete) in `packages/apps/commise/web/tests/e2e/recipe-crud.spec.ts`
- [x] T080 Add Playwright E2E tests for clone/visibility flow in `packages/apps/commise/web/tests/e2e/clone-visibility.spec.ts`
- [x] T109 Add Playwright E2E tests for collections (create → add recipe → view → remove → delete) in `packages/apps/commise/web/tests/e2e/collections.spec.ts`
- [x] T110 Add Playwright E2E tests for search and filter in `packages/apps/commise/web/tests/e2e/search.spec.ts`

### Mobile E2E Tests (Maestro)

- [x] T111 Add Maestro E2E flow for recipe CRUD (create → view → edit → delete) in `packages/apps/commise/mobile/tests/e2e/recipe-crud.yaml`
- [x] T112 Add Maestro E2E flow for collections management in `packages/apps/commise/mobile/tests/e2e/collections.yaml`
- [x] T113 Add Maestro E2E flow for clone/visibility in `packages/apps/commise/mobile/tests/e2e/clone-visibility.yaml`
- [x] T114 Add Maestro E2E flow for search and navigation in `packages/apps/commise/mobile/tests/e2e/search-nav.yaml`
- [x] T115 Add Maestro E2E accessibility flow (screen reader labels, tap targets) in `packages/apps/commise/mobile/tests/e2e/accessibility.yaml`

**Checkpoint**: Frontend delivers platform-parity UI for all in-scope user stories with full Playwright + Maestro E2E coverage.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Final compliance, validation, CI verification, and documentation updates.

- [x] T052 Update backend quickstart runbook for API, DB migrations, photo processor flow, CI setup, and test commands in `specs/001-commise-recipe-app/quickstart.md` — DONE (2026-07-17): rewrote quickstart.md for shipped v1 — added the photo processor flow (presigned upload → confirm → sharp cover-thumbnail, COALESCE fallback), the background workers (version-archive + account-erasure), all test tiers incl. k6/load with `prepare-db`, and the real CI structure (`_ci.yml` + `ci-pr`/`ci-main`/`ci-full`).
- [x] T053 Align OpenAPI examples and response/error payloads with implemented API behavior in `specs/001-commise-recipe-app/contracts/api.openapi.yaml`

### Success Criteria Validation

- [x] T081 Add **k6** load test script (`*.load.ts`) targeting p95 ≤ 500ms under 10k concurrent users (SC-009) in `packages/services/recipe-service/tests/load/` — k6 is the chosen tool (not Artillery); also cover search latency (< 2s) and the recipe-save-under-S3-archive path (FR-007b-i)
- SC-001 (recipe creation < 5 min) — validated via manual QA / usability testing (no buildable task)
- SC-005 (80% engagement in first week) — validated post-launch via analytics (no buildable task)

### CI Verification

- [ ] T116 Run full GitHub Actions CI pipeline end-to-end and verify all jobs pass (quality, test-unit, test-integration, test-e2e-web, test-e2e-mobile) — PROGRESS (2026-07-17): the standard PR/main pipeline (quality, unit, integration [service + workers], service-e2e, web-Playwright, mobile-Vitest) is GREEN on every run. The two heavyweight tiers were gated off; both now have a real entry point via **`ci-full.yml`** (`workflow_dispatch`, both flags on). **k6 SC-009 gate: FIXED + validated** — the job never passed (booted via `npm run start` which can't resolve the workspace bare specifiers outside the image; no migrations/seed; single-user 429s). Rewrote it to build the proven Docker image + `prepare-db` + dev-bypass auth + raised rate limits; validated end-to-end locally (all 3 k6 scenarios 100% checks / 0% failed / p95 ≪ 500ms). **BLOCKERS to a full check-off:** (1) `ci-full.yml` (and `recipe-loadtest.yml`) are only `workflow_dispatch`-able once on the **default branch** — so the complete pipeline can be run+demonstrated green in CI only **after this branch merges**; (2) the **Maestro** real-device tier drives real Clerk **native** sign-in (no app-side bypass) against a deployed recipe API, so its reliable green needs the Clerk-native-in-emulator wiring + a reachable sandbox recipe deploy (the same deploy-automation gap in release-readiness.md). Check off after merge → dispatch `ci-full.yml` → k6 green + Maestro wired.
- [x] T117 Verify test pyramid ratios: ≥70% unit / ≤20% integration / ≤10% E2E across all workspaces

### Constitution Compliance Checklist (I–VII)

- [x] T054 Verify strict TypeScript, no `any`, and typed custom errors/type guards across `packages/{services,clients,features}/**/src/**/*.ts` and `packages/shared/**/src/**/*.ts` (Principle I)
- [x] T055 Verify module-level and exported-symbol JSDoc coverage in `packages/{services,clients,features}/**/src/**/*.ts` and `packages/shared/**/src/**/*.ts` (Principle II)
- [x] T056 Verify aliased imports with `.js` extensions and no forbidden cross-workspace relative imports in `packages/{services,clients,features}/**/src/**/*.ts` and `packages/shared/**/src/**/*.ts` (Principle III)
- [x] T057 Verify integration tests include requirement traceability comments and avoid prohibited test patterns in `packages/services/*/__tests__/integration/**/*.spec.ts` (Principle IV)
- [x] T058 Verify workspace governance entries and task pipelines remain correct in `/home/brandon/Development/KitchenSink/package.json` and `/home/brandon/Development/KitchenSink/turbo.json` (Principle V)
- [x] T059 Run and validate `turbo run typecheck lint format:check test` from `/home/brandon/Development/KitchenSink` with all exit codes 0 (Principle VI)
- [x] T060 Verify platform parity (FR-044 / FR-044a) across all Phase 5 frontend tasks: (a) confirm every implementation task covers both web and mobile explicitly, has a paired task, or carries a `[PARITY-EXCEPTION]` note; (b) confirm the Home widget surface (T104-web + T104-mobile) is present and tested on both platforms, with only the recipe widget live and gated widgets absent; (c) confirm no user-facing screen exists on one platform without a corresponding screen on the other, and every **live** widget ships on both platforms behind one id (`.native.tsx` split); (d) confirm the Home widget TS contract lives in `@commise/features-core` (the `HomeWidgetId` / `HomeWidgetDescriptor` / `curateHomeWidgets` types — Commise home-surface infra, not the platform `@kitchensink/recipe-core`), and that per-user layout persistence uses `PATCH /v1/profiles/me` which is **owned by the identity service (002) and consumed here** — it is deliberately **NOT** required in 001's `contracts/api.openapi.yaml` (Principle VII)

### Deferred / Cross-Feature Decisions

- [ ] T150 [DECISION — deferred; cross-feature 001 ↔ 003] **Recipe → food-DB write-back ("resulting food").** Decide whether a _finished_ recipe should be registered as a food entity in the source-agnostic food service (`kitchensink_food`, 003), so the composed dish can itself be referenced as an ingredient in another recipe and/or logged as a food. **Current design reads only**: ingredients reference the food service by opaque `food_id` via `@kitchensink/food-service-client`, and 001 computes a recipe-side nutrition summary — the finished dish is **never** written back to the food DB. Enabling this needs a new recipe → food-service **write** path plus (almost certainly) a **003 change** to accept a recipe-derived / composed food. Raise as a formal change-request spanning 001 + 003; **out of scope for 001 v1** unless approved. (Placed last intentionally — do not start before the v1 build lands.)

---

## Phase 7: CR-001 — Mockup Parity (2026-07-16)

**Purpose**: Implement the four decisions of [`change-requests/CR-001-mockup-parity.md`](./change-requests/CR-001-mockup-parity.md) — difficulty (D-A / FR-001b), ratings (D-B / FR-013·013a·013b), the derived PRO badge (D-C / FR-003a), and skeleton-placeholder Home widgets (D-D / amended FR-046) — plus the list cover photo (FR-001c) and the erasure×ratings interaction (C-007). Every `-test` task is TDD-red and lands before its impl (§7.1). Every user-facing task names web + mobile or is paired (FR-044 / FR-044a).

> **Ordering hazards.** (1) Ratings depend on the `recipe_ratings` table + aggregate trigger (T154) before the service (T155) and before the erasure extension (T169). (2) The Home placeholder tasks **amend** the "gated widgets are absent" clause of T104-web/T104-mobile/T104-test-web/T104-test-mobile/T104-e2e-web/T104-e2e-mobile and T060(b) — for capability-gated widgets the new truth is **skeleton placeholder**, while **tier**-gated widgets remain **absent**; do not revert those T104 tasks, extend them per D-D. (3) The erasure ratings root (T169) extends the still-open T136/T137 — do not build T169 before T136's worker body exists (see the Phase 4.5 ordering hazard).

### Difficulty (D-A / FR-001b)

- [x] T151-test Write the schema type-inference + column unit test for `recipes.difficulty`: NULLABLE, no default, CHECK constraint accepts exactly `easy`/`medium`/`hard` and rejects any other value; inferred Drizzle type is `RecipeDifficulty | null` in `packages/services/recipe-service/src/database/__tests__/recipes.difficulty.schema.test.ts`
- [x] T151 Add the `difficulty` column to the Drizzle `recipes` schema (`text('difficulty')`, no `.notNull()`, no `.default()`, `check(... in ('easy','medium','hard'))`) + a drizzle-kit migration in `packages/services/recipe-service/src/database/schema/recipes.ts` and `.../database/migrations/`. Deliberately diverges from the `servings`/times NOT-NULL precedent (0007/0008) per CR-001 D-A — do not add a default
- [x] T152-test Write unit tests for difficulty on recipe create/update service: create with a difficulty persists it; create without one persists NULL (no default); update is **three-state** — omitted leaves it unchanged, a value sets it, explicit `null` clears it back to unstated — in `packages/services/recipe-service/src/recipes/__tests__/recipes.difficulty.service.test.ts`
- [x] T152 Thread `difficulty` through `CreateRecipe`/`UpdateRecipe` DTOs (3-state `RecipeDifficulty | null` on update per the shipped `recipe.types.ts`), the recipe service create/update, and the detail projection in `packages/services/recipe-service/src/recipes/{recipes.service.ts,dto/*.ts}`
- [x] T152-int Add an integration test asserting `POST /v1/recipes` with and without difficulty, and `PATCH` clearing it via explicit `null`, round-trip correctly against real Postgres in `packages/services/recipe-service/__tests__/integration/recipes/difficulty.integration.spec.ts`
- [x] T153-test-web [P] [US1] Write component tests for the difficulty badge — web: renders the label + color pairing (NFR-004, label always present), and renders **no badge at all** when difficulty is absent (never a default/placeholder) — in `packages/apps/commise/features/recipes/src/__tests__/DifficultyBadge.test.tsx`
- [x] T153-test-mobile [P] [US1] Write the mobile component test for the difficulty badge (same assertions as T153-test-web) in `packages/apps/commise/features/recipes/src/__tests__/DifficultyBadge.native.test.tsx`
- [x] T153 [US1] Implement the difficulty badge (label + color, NFR-004; absent difficulty → no badge) on the recipe card and detail, and the difficulty control (three options + a clear/"not set") in the create/edit form — web + mobile (`DifficultyBadge.tsx` + `.native.tsx`) in `packages/apps/commise/features/recipes/src/`

### Ratings (D-B / FR-013 · FR-013a · FR-013b)

- [x] T154-test Write the schema/migration unit test for ratings: `recipe_ratings` (`stars` CHECK 1–5, `UNIQUE(recipe_id, user_id)`, FK→`recipes` ON DELETE CASCADE, `user_id` no-FK), `idx_recipe_ratings_user_id`, and the `recipes.average_rating`/`rating_count` columns with the coherence CHECK (`(rating_count = 0) = (average_rating IS NULL)`) in `packages/services/recipe-service/src/database/__tests__/recipe-ratings.schema.test.ts`
- [x] T154 Add the `recipe_ratings` Drizzle schema + the `average_rating`/`rating_count` columns on `recipes`, and the **hand-authored** `recipe_ratings_aggregate_refresh()` function + its **three** single-event statement-level triggers (INSERT/UPDATE/DELETE, transition table `changed_rows`, `FOR UPDATE` lock in `ORDER BY id`) as a raw-SQL drizzle-kit migration (Drizzle cannot express triggers) in `packages/services/recipe-service/src/database/schema/ratings.ts` and `.../migrations/`. No application code may write the two aggregate columns (CR-001 D-B)
- [x] T155-test Write unit tests for the ratings service (FR-013): idempotent upsert (re-rating replaces, same-value twice is a no-op on the aggregate); a user may rate any recipe they can **see**; an unreadable recipe returns `404 RECIPE_NOT_FOUND` **not `403`** (must be indistinguishable from non-existent); rating one's **own** recipe returns `403 CANNOT_RATE_OWN_RECIPE`; a tombstoned recipe returns `404`; delete is idempotent (removing a non-existent rating succeeds); the rater is taken from the token, never the body — in `packages/services/recipe-service/src/ratings/__tests__/ratings.service.test.ts`
- [x] T155 Implement the `RatingsModule` — `PUT`/`DELETE /v1/recipes/{id}/rating` controller + `RatingsService` (upsert `ON CONFLICT (recipe_id, user_id) DO UPDATE`; delete; visibility-derived authz returning 404-not-403 for unreadable, 403 only for own-recipe) + `SetRecipeRatingInput` DTO in `packages/services/recipe-service/src/ratings/{ratings.module.ts,ratings.controller.ts,ratings.service.ts,dto/set-rating.dto.ts}`. Returns the updated `RecipeDetail` with the trigger-refreshed aggregate
- [x] T156 Add an integration test for the aggregate trigger against real Postgres: two concurrent raters of the same recipe both count (the `FOR UPDATE` lost-update guard); removing a rating re-derives the average; the last rating removed yields `count=0` + `average=NULL` (never `0`); deleting a rated recipe cascades and the trigger is a silent no-op; a bulk `DELETE … WHERE user_id = :u` fires the trigger once (statement-level) — in `packages/services/recipe-service/__tests__/integration/ratings/aggregate-trigger.integration.spec.ts`
- [x] T157 Add service e2e + k6 for the rating endpoints: drive `PUT`/`DELETE /v1/recipes/{id}/rating` over HTTP against the booted Nest app (own-recipe 403, unreadable 404, idempotent replace, aggregate visible on the returned detail) in `packages/services/recipe-service/tests/e2e/ratings.e2e.ts`, and a k6 script exercising the read-heavy list + rating write mix under the SC-009 SLO in `packages/services/recipe-service/tests/load/ratings.load.ts`
- [x] T158-test Write unit tests for the client rating mutations (`useSetRecipeRating`, `useRemoveRecipeRating`): optimistic/settled cache invalidation of the recipe detail **and** any list/search rows carrying the recipe's aggregate, using MSW mocks, in `packages/clients/recipe-service/src/__tests__/hooks.rating.test.ts` — TDD red before T158
- [x] T158 Add `setRecipeRating(id, stars)` / `deleteRecipeRating(id)` to the typed client and the paired TanStack Query mutation hooks (invalidate recipe detail + list/search) in `packages/clients/recipe-service/src/{client.ts,hooks.ts}`
- [x] T159-test-web [P] [US2] Write component tests for the star-rating display + control — web: shows average + count when rated; shows "no ratings yet" (never a zero-star score) when `ratingCount=0`; the control is disabled/hidden on the viewer's own recipe; submitting calls the mutation — in `packages/apps/commise/features/recipes/src/__tests__/RecipeRating.test.tsx`
- [x] T159-test-mobile [P] [US2] Write the mobile component test for the star-rating display + control (same assertions as T159-test-web) in `packages/apps/commise/features/recipes/src/__tests__/RecipeRating.native.test.tsx`
- [x] T159 [US2] Implement the star-rating display (average + count, unrated empty state) and the rating control (1–5, hidden on own recipe) on recipe card + detail — web + mobile (`RecipeRating.tsx` + `.native.tsx`) in `packages/apps/commise/features/recipes/src/`
- [x] T159-e2e-web [US2] Playwright: user B rates user A's public recipe → average/count update; user rating their own recipe has no control; re-rating replaces (count unchanged) in `packages/apps/commise/web/tests/e2e/ratings.spec.ts`
- [x] T159-e2e-mobile [US2] Maestro flow mirroring T159-e2e-web in `packages/apps/commise/mobile/.maestro/recipes/ratings.yaml`

### Derived PRO badge (D-C / FR-003a)

- [x] T160-test Write the unit test for the single authoritative `usesPremiumCapability(recipe)` pure fn — the full truth table: `private`+`user_created`→true, `private`+`imported_public`→true, `private`+`imported_physical`→**false**, `private`+`imported_paid`→**false**, any `public`→false — in `packages/shared/recipe-core/src/__tests__/usesPremiumCapability.test.ts`
- [x] T160 Wire `usesPremiumCapability` (already defined in `@kitchensink/recipe-core`) into the recipe list **and** detail projections in `packages/services/recipe-service/src/recipes/`, so the field is server-derived from `visibility`+`sourceType` in exactly one place — no `is_pro` column, no client re-derivation, no feature-010 dependency (CR-001 D-C)
- [x] T161-test-web [P] [US1] Write the web component test for the PRO badge: shown when `usesPremiumCapability` is true, hidden otherwise; the component consumes the server field and does **not** re-derive from `visibility` — in `packages/apps/commise/features/recipes/src/__tests__/ProBadge.test.tsx`
- [x] T161-test-mobile [P] [US1] Write the mobile PRO-badge component test (same assertions) in `packages/apps/commise/features/recipes/src/__tests__/ProBadge.native.test.tsx`
- [x] T161 [US1] Implement the PRO badge bound to `usesPremiumCapability` on recipe card + detail — web + mobile (`ProBadge.tsx` + `.native.tsx`) in `packages/apps/commise/features/recipes/src/`

### List cover photo (FR-001c)

- [x] T162-test Write the integration test for cover-photo resolution: the list projection carries `coverPhotoUrl` = the photo with the lowest `sort_order` (deterministic tiebreak `created_at`, then `id`), the field is **absent** (not null, not a placeholder URL) for a photoless recipe, and a page of N recipes resolves in a single query (no N+1) in `packages/services/recipe-service/__tests__/integration/recipes/cover-photo.integration.spec.ts`
- [x] T162 Implement `coverPhotoUrl` on the recipe list projection via the `LEFT JOIN LATERAL … ORDER BY sort_order, created_at, id LIMIT 1` (data-model.md § Cover photo resolution) + add `idx_recipe_photos_recipe_cover` migration in `packages/services/recipe-service/src/recipes/{dal/recipes.dal.ts}` and `.../migrations/`
- [x] T163-test-web [P] [US1] Write the web component test for the recipe card image: renders `coverPhotoUrl` when present; renders the client no-image treatment (never a stock/placeholder image) when absent, in `packages/apps/commise/features/recipes/src/__tests__/RecipeCardCover.test.tsx`
- [x] T163-test-mobile [P] [US1] Write the mobile card-image component test (same assertions) in `packages/apps/commise/features/recipes/src/__tests__/RecipeCardCover.native.test.tsx`
- [x] T163 [US1] Render the recipe-card cover from `coverPhotoUrl` with the no-image treatment — web + mobile — in `packages/apps/commise/features/recipes/src/`. Do **not** solve rendition/thumbnail sizing here; that is FOLLOW-UP-CR-001-A (T168)

### Skeleton-placeholder Home widgets (D-D / amended FR-046 · R6)

> The `kind: 'live' | 'placeholder'` discriminated union + inverse-capability gating already shipped in `@commise/features-core` (`contract.ts`, `curateHomeWidgets`, `roadmapWidgets.ts`). These tasks wire the **host** to render the placeholder arm and amend the T104 tests/E2E that asserted "absent".

- [x] T164-test [P] [US0] Write/extend the unit test for `curateHomeWidgets` placeholder gating: a `placeholder` descriptor is eligible **only while its capability is NOT live**; a `live` descriptor **only while its capability IS live**; a placeholder + the real widget registered under the **same id** are mutually exclusive (never two tiles), and the placeholder self-supersedes when the capability goes live; **tier**-gated widgets are dropped (absent), not placeheld — in `packages/apps/commise/features/core/src/__tests__/curateHomeWidgets.test.ts` (extends the shipped test; supersedes T104-curate-test's absent-only assumption)
- [x] T164 [US0] Add the roadmap placeholder descriptors for 005–009 (meal-plan, nutrition, shopping, AI-suggestion, resume-cooking) in `packages/apps/commise/features/core/src/roadmapWidgets.ts` — each `kind: 'placeholder'` with the capability it waits on and a host-owned `load`, importing nothing from the unbuilt feature package
- [x] T165-test-web [US0] Extend the web Home component test: capability-absent widgets render a **skeleton placeholder** (the widget shape with skeleton blocks) — **not absent**, and asserting **no fabricated data** (no specimen macro total / item count / recipe name); a **tier**-gated widget is still **absent**; the live recipe widget's empty state is distinct — in `packages/apps/commise/web/src/app/__tests__/page.test.tsx` (amends the "gated widgets are absent" clause of T104-test-web)
- [x] T165-test-mobile [US0] Mirror T165-test-web on mobile in `packages/apps/commise/mobile/src/__tests__/HomeScreen.test.tsx` (amends T104-test-mobile)
- [x] T165 [US0] Wire the Home host (web `next/dynamic`, mobile `React.lazy`) to render the placeholder arm via a **host-owned** skeleton component from the roadmap descriptor's loader — web: `packages/apps/commise/web/src/components/home/skeletons/`, mobile: `packages/apps/commise/mobile/src/components/home/skeletons/` — registering the T164 roadmap descriptors so capability gating swaps a placeholder for the live widget with no client change (amends T104-web / T104-mobile)
- [x] T166-e2e-web [US0] Update the Home Playwright E2E: assert the capability-gated widgets render as **skeleton placeholders** (present, no data values) rather than absent, and that a tier-gated widget stays absent, in `packages/apps/commise/web/tests/e2e/home.spec.ts` (amends T104-e2e-web)
- [x] T166-e2e-mobile [US0] Update the Home Maestro flow to mirror T166-e2e-web in `packages/apps/commise/mobile/.maestro/home.yaml` (amends T104-e2e-mobile)

### Erasure × ratings (C-007 / FR-013b)

- [x] T169-test Write unit tests extending the erasure worker for the ratings root: erasing a user deletes **every** rating they authored (incl. those on other users' recipes); other users' recipes **survive**; the aggregate trigger re-derives their `average_rating`/`rating_count` to exclude the erased rating; the worker **does not** disable the trigger; ordering is rows-first (ratings deleted before the S3 prefix sweep) in `packages/services/recipe-workers/src/handlers/__tests__/account-erasure-worker.ratings.test.ts` (extends T135-test)
- [x] T169 Extend the erasure worker to `DELETE FROM recipe_ratings WHERE user_id = :ownerId` (the third owner-scoped root, using `idx_recipe_ratings_user_id`) as part of the rows-first phase, relying on the statement-level aggregate trigger to repair surviving recipes — in `packages/services/recipe-workers/src/handlers/account-erasure-worker.ts` (extends T136; do not start before T136's worker body exists)
- [x] T169-int Extend the end-to-end erasure integration test: seed the erasing user's ratings on **other** users' recipes → erase → assert the user's ratings are gone, the other recipes survive, and their aggregates are re-derived to exclude the erased ratings in `packages/services/recipe-service/__tests__/integration/account/erasure.integration.spec.ts` (extends T137)

### Contract sync & follow-up

- [x] T167 Verify the contract reconciliation is drift-free: regenerate/compare consumers against `contracts/api.openapi.yaml` (the `Recipe`/`RecipeDetail` split, `currentVersion`, `sourceType`/`hasSubstantiveEdit`/`hasPartialNutrition`, the rating routes, `difficulty`/`averageRating`/`ratingCount`/`usesPremiumCapability`/`coverPhotoUrl`) and confirm `@kitchensink/recipe-core` `Recipe`/`RecipeDetail` match — single source of truth, no local duplicate DTOs — via `npm run typecheck` across `packages/{services,clients,apps}/**`
- [x] T168 [FOLLOW-UP-CR-001-A — deferred] **Derived photo renditions / thumbnail variants.** `coverPhotoUrl` (FR-001c) today serves the **full-size original** (≤5 MB) into a ~300 px 4:3 card thumbnail because photos are stored unprocessed (ARCH-BE-3) — a 4-card Home widget can pull ~20 MB on first paint, a real SC-009 / mobile-data risk. Add a resize/rendition path (e.g. an on-upload variant generator + a rendition-aware cover URL) so the card downloads a thumbnail, not the original. **Out of scope for the CR-001 build**; must land before the Home widget is release-ready on mobile. Raise as its own change-request/task set.

**Checkpoint**: CR-001 mockup-parity — difficulty, ratings (+aggregate trigger), the derived PRO badge, the list cover photo, skeleton-placeholder Home widgets, and the erasure ratings root — are implemented and tested on both platforms, and the contract is drift-free.

---

## Dependencies & Execution Order

### Phase Dependency Graph

- Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1 Backend) → Phase 4 (US2 Backend) → Phase 4.5 (Spec Clarifications) → Phase 5 (Frontend) → Phase 6 (Polish)
- Phase 4.5 depends on US1 (recipes/versions/photos/collections) and US2 (clone primitives); Phase 5 frontend should consume Phase 4.5 schema additions (`deletedAt`, `sourceCollectionId`, `addedVia`) and surface the new endpoints.
- Phase 1 includes test infrastructure + CI pipeline setup — these MUST complete before any test tasks run.
- Phase 2 blocks all story work.
- Phase 5 (Frontend) can start after Phase 3 (US1 Backend) delivers stable API endpoints. Phase 4 (US2) and Phase 5 can run in parallel.
- Phase 6 starts only after all prior phases are complete.

### External / Cross-Feature Prerequisites (BLOCKING)

- **T019 and all ownership/authz tasks are BLOCKED** until **T000-prereq** (a 001 task) lands — the Clerk session token must emit the app-user ULID (`external_id` claim). The `@kitchensink/clerk-verify` package (`VerifiedClerkClaims` / `ClerkAuthService`) **already** surfaces that claim as `userId` on the verified Principal (**shipped in PR #60**), leaving `userId` undefined and delegating fail-closed to per-service policy when the claim is absent. What remains (T000-prereq) is the Clerk-side session-token customization so a token actually carries `external_id`, plus first-token sync-race handling. Until then the recipe service cannot derive the owner key: ownership compares `owner_id == principal.userId` (app ULID == app ULID) and MUST NOT fall back to the Clerk `sub` (`sub` is trace/audit only). The recipe AuthMiddleware (T019) is the fail-closed enforcement point (401 on absent `userId`).
- **T000-prereq** (add the ULID to the Clerk session-token customization on both instances + handle the first-token sync race; the verifier `userId`-from-`external_id` surfacing is already done in PR #60) MUST complete before **T019**. Every ownership/authz-dependent task — recipe CRUD (US1), clone/visibility (US2), and GDPR erasure (Phase 4.5) — transitively depends on it via T019.

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
- US1: DAL test tasks parallelize. DAL implementation tasks (T024, T027, T030, T034, T039, T042) are parallelizable.
- US2: T046 and policy/service prep can run in parallel before controller/test tasks.
- Frontend: Component test tasks (T105–T108) can run in parallel (the API-hooks test is T064-test, paired with its impl T064). Playwright E2E and Maestro E2E run independently.

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

**Authoritative count (recounted 2026-07-15): 187 tasks.** The `Actual` column is derived by counting
`- [ ] T…` / `- [x] T…` lines per phase; it is the number to trust. The category columns are the
**original 2026-05-10 planning estimate**, kept for provenance — they were never re-derived as tasks were
added, renumbered, and split, so they no longer sum to `Actual`.

| Phase                     | Implementation | Unit Tests | Integration Tests | E2E Tests | Infrastructure | Est.    | **Actual** |
| ------------------------- | -------------- | ---------- | ----------------- | --------- | -------------- | ------- | ---------- |
| Phase 1: Setup            | 14             | 0          | 0                 | 0         | 14             | 28      | **31**     |
| Phase 2: Foundational     | 12             | 6          | 0                 | 0         | 6              | 24      | **25**     |
| Phase 3: US1              | 22             | 15         | 7                 | 0         | 1              | 45      | **42**     |
| Phase 4: US2              | 6              | 4          | 2                 | 0         | 0              | 12      | **12**     |
| Phase 4.5: Clarifications | 10             | 6          | 4                 | 0         | 3              | 23      | **23**     |
| Phase 5: Frontend         | 23             | 9          | 0                 | 13        | 0              | 45      | **41**     |
| Phase 6: Polish           | 11             | 0          | 0                 | 0         | 2              | 13      | **13**     |
| **Total**                 | **98**         | **40**     | **13**            | **13**    | **26**         | **190** | **187**    |

> Phase 5 count includes 7 Home screen tasks (T104-shared, T104-web, T104-mobile, T104-test-web, T104-test-mobile, T104-e2e-web, T104-e2e-mobile) added 2026-05-10 for FR-046 (post-login Home screen) and FR-044a (parity enforcement). Previous total was 173.

> **Why the old 190 looked right (2026-07-15).** The estimate's 190 coincidentally equalled the raw
> checkbox count — but that count included the 3 Parity-Checklist rubric bullets (now numbered, not
> checkboxes) and the per-phase rows had drifted in both directions (Phase 1 +3, Phase 2 +1, Phase 3 −3,
> Phase 5 −4), which happened to net to the same figure. Two errors cancelling is why it went unnoticed.
> Raw checkbox count and real task count are now both **187**.
