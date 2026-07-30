# Implementation Plan: Commise Recipe App

**Branch**: `001-commise-recipe-app` | **Date**: 2026-04-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-commise-recipe-app/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Core recipe management application — CRUD operations, full-text search (PostgreSQL FTS with tsvector/tsquery + GIN indexes), recipe versioning (snapshot pattern with optimistic concurrency), sharing/cloning with visibility controls (private/public), collection cloning with opt-in source-pull, and photo management (S3 presigned uploads + magic-byte/size validation, served as-is via CloudFront CDN — no resizing or async processing). NestJS 11 on AWS Fargate (ECS) backend, RDS PostgreSQL 16, Drizzle ORM, Turborepo monorepo with npm workspaces.

Cross-cutting reliability behaviors driven by the 2026-04-30 spec clarifications:

- **Atomic recipe save with independent photo uploads (FR-001a)**: recipe metadata persists in a single DB transaction; photos use the existing presigned-URL flow per-file with client + server validation and per-file retry; failed photos are never persisted as broken references on the recipe.
- **Resilient version archive to S3 (FR-007b-i)**: user save succeeds independent of the S3 archive write. The version snapshot row in the DB is the source of truth; the S3 archive is enqueued asynchronously via SQS with retry + DLQ. A failed archive leaves a `recipe_version_pending_archives` row that **references the `recipe_versions` row whose `snapshot` is the replay payload** (via FK — no duplicated payload column), so retries replay that exact snapshot until S3 confirms; only then is the pending row deleted.
- **Soft-delete tombstone with GDPR hard purge (C-007)**: recipe deletion sets `deleted_at` and removes the recipe from listings, search, collections, and clone targets. DB rows + S3 version archives are retained indefinitely. An explicit user-initiated "Erase my data" action enqueues an irreversible hard purge (SQS `account-erasure` → a VPC-attached erasure-worker Lambda + a cron sweeper for stuck jobs) of the user's tombstoned recipes (DB rows + every S3 version object).
- **Collection cloning as snapshot with opt-in pull (FR-011)**: a clone records `source_collection_id`. A user-initiated "Pull updates from source" action reconciles the clone against the source's current public membership without overwriting recipes the cloner added directly.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24.x (per `.nvmrc` + `package.json` engines)
**Primary Dependencies**: NestJS 11, Drizzle ORM, `pg` (node-postgres), `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sqs` (version-archive, account-erasure queues), `class-validator` + `class-transformer` (DTO validation), `@nestjs/config` (Zod env), `@clerk/nextjs` (web), `@clerk/expo` (mobile), `@clerk/backend` (API session-token verification), `@kitchensink/food-service-client` (ingredient data via the source-agnostic food service 003 — async resolution), `ditox` + `@ditox/react` (frontend DI container / `appShell` for the Home widget surface)
**Storage**: the **shared** RDS PostgreSQL 16 instance — recipe tables in their own logical database `kitchensink_recipes` on that shared instance (mirrors `kitchensink_food`; no new RDS instance) — pg_trgm, JSONB, tsvector FTS; S3 (photo objects + version archives) + CloudFront (CDN); SQS (version-archive, account-erasure queues + DLQs)
**Testing**: Vitest (unit + integration), Playwright (web E2E), Maestro (mobile E2E); TDD red-green-refactor; LocalStack for AWS emulation (S3 + SQS); pyramid target ≥70% unit / ≤20% integration / ≤10% E2E
**Target Platform**: AWS Fargate (ECS) for NestJS API, Lambda for version-archive worker (SQS-triggered, VPC-attached), Lambda for GDPR erasure worker (SQS-triggered, VPC-attached), CloudFront CDN, RDS PostgreSQL
**Project Type**: web-service (NestJS REST API) + serverless functions (version-archive worker + erasure worker) + web app (Next.js) + mobile app (Expo/React Native)
**Performance Goals**: p95 ≤ 500 ms API response for 10k concurrent users; search latency < 2 s (PostgreSQL FTS at launch, Typesense fallback if p95 > 400 ms); recipe save p95 must remain ≤ 500 ms even when S3 version archive is queued (FR-007b-i)
**Constraints**: 5 MB max photo upload, 10 photos per recipe, < 200 ms cold start (Fargate eliminates Lambda cold start for API; the version-archive worker Lambda is async so cold start is non-blocking); recipe save MUST NOT block on S3 archive (FR-007b-i); photo uploads MUST NOT block recipe metadata save (FR-001a); soft-deleted recipes MUST be filtered from every read path
**Scale/Scope**: 10k concurrent users, < 5M recipes initially; connection pool 50–100 (the shared RDS); pending-archive backlog target ≤ 100 rows steady state with operator alert above threshold

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Verify compliance with each KitchenSink Constitution principle (v1.1.0) before proceeding:

| #   | Principle                                                                                                                          | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | **Correctness & Type Safety** — strict TS, no `any`, proper error types, ISO dates                                                 | ☑️ Pass | Strict TS via shared `typescript` base config (`strict: true`). Drizzle schema provides end-to-end type safety. ISO 8601 timestamps in all date columns (`created_at`, `updated_at`, `deleted_at`). New error codes (`RECIPE_DELETED`, `ARCHIVE_PENDING`) extend `Error`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| II  | **Readability & JSDoc** — JSDoc on all exports, braces, blank-line rules, named exports                                            | ☑️ Pass | All new exported functions/types (pending-archive worker, erasure service, collection-pull service) carry JSDoc. Named exports only. ESLint rules enforced via shared config.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| III | **Code Organization & Imports** — aliased imports, `.js` extensions, `utils/`/`lib/`/`dal/` layout, no `helpers/`                  | ☑️ Pass | Monorepo workspace imports via workspace aliases following the platform/product split: 001's recipe **backend** packages are KitchenSink-platform `@kitchensink/*` (role-suffix style — `@kitchensink/recipe-service`, `@kitchensink/recipe-workers`, `@kitchensink/recipe-service-client`, `@kitchensink/recipe-core`), matching the existing shipped services; only the Commise-**product** widget/feature packages are `@commise/features-*` (`@commise/features-recipes`, `@commise/features-core`) under `packages/apps/commise/`. NestJS modules follow `dal/`/`lib/`/`utils/` convention. New `versions/archive/` and `users/erasure/` modules follow same structure. No `helpers/`. `.js` extensions in ESM imports. |
| IV  | **Testing Discipline** — pyramid ratios, `getByRole`/`getByLabel` only, no `waitForTimeout`, test-plan comments                    | ☑️ Pass | Vitest for unit + integration; Playwright for E2E. New flows (per-photo retry, pending-archive replay, erase-my-data, pull-from-source) get unit + integration coverage. `getByRole`/`getByLabel` selectors only. Pyramid: ≥70% unit / ≤20% integration / ≤10% E2E.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| V   | **Monorepo & Workspace Governance** — workspace registered, shared tooling extended, Turbo tasks declared, per-PR schema isolation | ☑️ Pass | All workspaces registered in root `package.json`. Shared `tsconfig`, ESLint, Prettier configs extended from `packages/tools/`. Turbo tasks declared in `turbo.json`. Per-PR schema isolation via Drizzle migrations + Docker Compose local PostgreSQL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| VI  | **Formatting & Tooling** — Prettier/ESLint shared configs, git hooks active, CI gates passing, `generate:types` runs first         | ☑️ Pass | Prettier + ESLint shared. Git hooks (lint-staged) active. CI gates enforce lint + typecheck + test. Drizzle `generate:types` in Turbo dependency graph before build. New SQS/LocalStack service container in CI for archive-worker integration tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| VII | **Accessibility & UX Consistency** — accessible names, design tokens, design-token–driven components, platform parity              | ☑️ Pass | FR-044 platform parity (web + mobile). FR-044a parity enforcement rule: every user-facing task must cover both platforms or carry a documented exception. New UX surfaces — per-photo error/retry control, "Erase my data" confirmation, "Pull updates from source" action, Home screen — carry accessible names and pair color status with icon/text. Design tokens from `packages/apps/commise/ui/` (`@commise/ui`).                                                                                                                                                                                                                                                                                                       |

Any justified deviation MUST be documented in the **Complexity Tracking** table below.

## Project Structure

### Documentation (this feature)

```text
specs/001-commise-recipe-app/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — complete (487 lines)
├── data-model.md        # Phase 1 output — complete (full DDL + tombstone + pending-archive)
├── quickstart.md        # Phase 1 output — complete (local dev guide)
├── contracts/           # Phase 1 output — API contract stubs (OpenAPI + TS types)
└── tasks.md             # Phase 2 output — pending update for FR-001a / FR-007b-i / C-007 / FR-011 pull
```

### Source Code (repository root)

```text
packages/
├── apps/
│   └── commise/
│       ├── web/                        # Next.js 15 App Router (Clerk web SDK, @clerk/nextjs)
│       │   ├── src/
│   │   │   ├── app/                # Next.js app directory (routes)
│   │   │   │   └── page.tsx        # Post-login Home widget surface — the root `/` route (FR-046, US-000)
│   │   │   ├── components/         # Domain-grouped UI components
│   │   │   │   ├── home/           # Home widget-surface host (composition root; live widgets come from @commise/features-*/widget/web)
│   │   │   │   ├── recipe-form/    # Recipe create/edit + per-photo retry UI (FR-001a)
│       │   │   │   ├── account/        # "Erase my data" confirmation flow (C-007)
│       │   │   │   └── collections/    # Pull-from-source action (FR-011)
│       │   │   └── lib/                # Client-side utilities
│       │   └── tests/
│       │       ├── unit/
│       │       └── e2e/                # Playwright E2E tests
│       ├── mobile/                     # Expo 53 + React Native (Clerk native SDK, @clerk/expo)
│       │   ├── src/
│       │   │   ├── screens/            # Screen components
│       │   │   │   └── HomeScreen.tsx  # Post-login Home widget surface (FR-046, US-000)
│       │   │   ├── components/         # Domain-grouped UI components (home, recipe-form, account, collections)
│       │   │   └── lib/                # Mobile utilities
│       │   └── tests/
│       │       ├── unit/
│       │       └── e2e/                # Maestro E2E flow files (*.yaml)
│       ├── features/                   # @commise/features-* — Commise product feature packages (widget/feature UI)
│       │   ├── recipes/                # @commise/features-recipes — exports `.`, `./widget/web`, `./widget/mobile` (NO page exports)
│       │   │   └── src/
│       │   │       └── widget/         # Recent-recipes Home widget (widget.web.tsx + widget.native.tsx; .native suffix, never .mobile)
│       │   └── core/                   # @commise/features-core — Home-widget contract + appShell ditox tokens (Discovery/Composition/Render seam)
│       │       └── src/
│       └── ui/                         # @commise/ui — design system (tokens only, no components)
│           └── src/
│               └── tokens/             # Design tokens (colors, spacing, typography)
├── services/
│   ├── recipe-service/                 # @kitchensink/recipe-service — NestJS 11 REST API (Fargate); own logical DB `kitchensink_recipes` on the shared RDS instance (mirrors food; no new instance)
│   │   ├── src/
│   │   │   ├── recipes/                 # Recipe module (controller, service, dal)
│   │   │   │   ├── recipes.controller.ts
│   │   │   │   ├── recipes.service.ts   # Atomic save (FR-001a), tombstone delete (C-007)
│   │   │   │   └── dal/                 # Drizzle queries (filters out deleted_at IS NOT NULL on every read path)
│   │   │   ├── ingredients/             # Ingredient module (food-service-client integration + freeform; async resolution — FR-007). Owns ingredients + recipe_ingredients tables
│   │   │   ├── versions/                # Version module (snapshots, retention)
│   │   │   │   ├── versions.service.ts  # DB write + SQS enqueue (FR-007b-i)
│   │   │   │   └── archive/             # Pending-archive read/replay/delete logic
│   │   │   ├── photos/                  # Photo module (presigned URLs, per-file confirm with magic-byte + size validation, list/delete/reorder); object served as-is via CloudFront (no resizing, no async processing)
│   │   │   ├── collections/             # Collection module (CRUD, membership, clone, pull-from-source)
│   │   │   ├── search/                  # Search module (PostgreSQL FTS, deleted_at filter)
│   │   │   ├── users/                   # User module
│   │   │   │   └── erasure/             # GDPR "Erase my data" service (C-007)
│   │   │   ├── auth/                    # Auth module (Clerk session-token AuthMiddleware — networkless; reads the app-user ULID from the verified token claim, no local users table / no read-through user creation, no x-authorizer-context)
│   │   │   ├── health/                  # Health check endpoint
│   │   │   ├── config/                  # Zod-based env config loader (@nestjs/config)
│   │   │   ├── database/                # Drizzle schema + migrations + seed (own logical DB kitchensink_recipes on the shared instance, NOT a shared db pkg)
│   │   │   │   ├── schema/              # Table definitions (TypeScript)
│   │   │   │   ├── migrations/          # SQL migration files (incl. deleted_at, pending_archive, source_collection_id)
│   │   │   │   └── seed/                # Seed data for local dev + E2E
│   │   │   └── common/                  # Shared utilities (filters, pagination, errors)
│   │   └── tests/
│   │       ├── unit/
│   │       └── integration/             # Vitest + Docker PostgreSQL + LocalStack S3/SQS
│   └── recipe-workers/                 # @kitchensink/recipe-workers — worker Lambdas (pattern of identity-webhooks)
│       ├── src/
│       │   ├── version-archive-worker/ # Lambda (SQS-triggered, FR-007b-i) — reads shared RDS (`kitchensink_recipes`) → VPC-attached (t4g.nano NAT consumer)
│       │   │   └── handler.ts           # Reads the version row's snapshot (via the pending row's recipe_version_id FK), PUTs to S3, deletes pending row on success
│       │   └── erasure-worker/         # Lambda (SQS account-erasure-triggered, C-007 GDPR hard purge) — reads RDS + deletes S3 → VPC-attached; a cron sweeper re-drives stuck jobs
│       │       └── handler.ts
│       └── tests/
│           └── unit/
├── clients/
│   └── recipe-service/                 # @kitchensink/recipe-service-client — typed recipe API client (mirrors @kitchensink/food-service-client)
│       └── src/
├── shared/
│   └── recipe-core/                    # @kitchensink/recipe-core — pure TS types + zod only (no UI, no runtime deps)
│       └── src/
│           ├── types/                  # Recipe (with deletedAt), Ingredient (foodId + foodResolutionStatus + isUserEntered), Step, Collection (with sourceCollectionId), PendingArchive interfaces
│           └── utils/                  # Validation helpers, slug generation
└── tools/                              # Shared tooling configs (existing)
    ├── typescript/
    ├── eslint/
    └── prettier/
```

**Structure Decision**: Monorepo split along a platform/product boundary (CODING_STANDARDS §5.1, Option B): KitchenSink **platform** packages (backend services, workers, clients, shared libs, tools, infra) are `@kitchensink/*` at `packages/{services,clients,shared,tools,infra}/<name>` and keep the existing role-suffix style (`-service`, `-workers`, `-service-client`); the Commise **product** (apps + feature/UI packages) is `@commise/*` under `packages/apps/commise/{web,mobile,features/*,ui}`. The recipe backend (`@kitchensink/recipe-service`) is a NestJS service that uses the **shared RDS instance with its own logical database `kitchensink_recipes`** (provisioned by a `RecipeDbBootstrap` custom resource mirroring `FoodDbBootstrap` (passwordless IAM-auth `recipe_app` role + `kitchensink_recipes` DB); the service authenticates via RDS IAM tokens (no password secret) and `Fn.importValue`s the shared instance endpoint like food — no new RDS instance; there is no shared `db` package). Worker Lambdas (`@kitchensink/recipe-workers`) follow the `identity-webhooks` pattern; the **version-archive worker** and the **erasure worker** are **VPC-attached** (they read the shared RDS (`kitchensink_recipes`) via the shared t4g.nano NAT instance). Photos are stored and served as-is (no resizing/async processing), so there is no photo-processor Lambda. The typed recipe API client is `@kitchensink/recipe-service-client` (mirrors the existing `@kitchensink/food-service-client`); pure recipe types live in `@kitchensink/recipe-core`; frontend widget/feature UI in `@commise/features-recipes`. Frontend apps in `packages/apps/commise/{web,mobile}/`. The service attaches to the **shared ALB** (`SharedAlbStack`, global infra) via a host-based listener rule at **priority 300** (identity=100, food=200, recipe=300) and does **not** create its own ALB; Fargate runs in **public subnets with `assignPublicIp`** (egress via IGW, not NAT). Per-PR feature deploys tag `Environment=pr-{N}` and name resources `kitchensink-recipe-*-pr-{N}` (ADR-0005) with a per-PR logical DB (ADR-0006). The version-archive worker is intentionally separated from the synchronous API path so DB-side commits and user responses are never blocked on S3 latency or failure.

## Reliability Architecture (FR-001a, FR-007b-i, C-007, FR-011)

### Atomic Recipe Save with Independent Photo Uploads (FR-001a)

```
Client                       NestJS RecipesService                   PostgreSQL
  │  POST /v1/recipes              │                                      │
  │ ───────────────────────────►│                                      │
  │                             │  BEGIN TX                            │
  │                             │  INSERT recipes + recipe_steps +     │
  │                             │         recipe_ingredients           │
  │                             │  INSERT recipe_versions v1           │
  │                             │  Enqueue archive job (best-effort,   │
  │                             │   inside TX commit hook — see below) │
  │                             │  COMMIT                              │
  │ ◄─── 201 { recipe }         │                                      │
  │                             │                                      │
  │  (per photo, in parallel:)                                         │
  │  POST /photos/upload-url    │  ContentLengthRange [1, 5MB]         │
  │ ◄─── { uploadUrl, key }     │                                      │
  │  PUT (direct to S3) ────────────────────────────────────► S3       │
  │  POST /photos/confirm       │  validate magic-bytes + S3 HEAD size │
  │ ───────────────────────────►│  INSERT recipe_photos { s3_key, ... } │
  │ ◄─── 201 { photo }          │  (object served as-is via CloudFront) │
```

- Recipe metadata commit is one DB transaction. Photos are never part of that transaction.
- Per-photo client-side validation (size ≤ 5 MB, MIME in `image/jpeg | image/png | image/webp`) before requesting the presigned URL.
- Per-photo server-side re-validation on `/photos/confirm`: the presigned URL `ContentLengthRange` + allowlisted `ContentType` are the upload-time caps; confirm re-checks by **magic bytes** (JPEG/PNG/WebP signature, NOT the client Content-Type) + an S3 HEAD size ≤ 5 MB, then INSERTs the `recipe_photos` row.
- Failed photo uploads return a per-file error to the client with a `retryable: true` flag. The client may re-request a presigned URL and retry without re-saving the recipe.
- A photo that fails confirm validation is never inserted, so it is never linked as a broken reference on the recipe (the `recipes` row never holds a direct image foreign key beyond `recipe_photos`).
- The stored object is served **unmodified** via CloudFront — there are no derived variants, no resizing, no processing state machine, and no photo-processor Lambda / `photo-processed` SQS queue.

### Resilient Version Archive to S3 (FR-007b-i)

```
RecipesService.save()
  │
  ├── DB TX:
  │     INSERT recipe_versions  (snapshot JSONB, s3_key NULL initially)
  │     INSERT recipe_version_pending_archives (recipe_version_id FK, attempts=0)  // no snapshot copy — FK to the version row
  │     COMMIT
  │
  └── after-commit hook:
        sqs.sendMessage(VERSION_ARCHIVE_QUEUE, { recipe_version_id })   // best-effort

VERSION_ARCHIVE_QUEUE  ──► version-archive-worker (Lambda, SQS-triggered)
                              │
                              ├── SELECT pending row by recipe_version_id (JOIN recipe_versions for snapshot)
                              ├── PUT s3://versions-bucket/{recipe_id}/v{n}.json  (body = recipe_versions.snapshot)
                              ├── On success:
                              │     UPDATE recipe_versions SET s3_key = ...
                              │     DELETE recipe_version_pending_archives WHERE id = ...
                              ├── On failure:
                              │     UPDATE recipe_version_pending_archives SET attempts = attempts + 1, last_error
                              │     SQS retry policy → DLQ after N attempts
                              │
                              └── DLQ landing → CloudWatch alarm → operator alert
```

Key invariants:

- The user-facing recipe save **never** awaits S3. The DB commit alone determines save success.
- The pending row is created in the same TX as the version row and holds no snapshot copy — it references the version row by `recipe_version_id`, so every unarchived version has its replay payload on disk in the DB as `recipe_versions.snapshot` (one source of truth, no duplication).
- The SQS enqueue is best-effort after commit: if SQS enqueue itself fails, a periodic sweeper Lambda (cron, every 5 min) selects pending rows older than 5 min and re-enqueues them. This makes the system tolerant of SQS outages.
- Operator-initiated replay is supported via an admin endpoint that re-enqueues an arbitrary `recipe_version_id` from the pending table.
- Pending rows are **only** deleted after S3 confirms the PUT. No TTL.

### Soft-Delete Tombstone & GDPR Hard Purge (C-007)

```
Recipe deletion (FR-002):
  DELETE /v1/recipes/{id}
    UPDATE recipes SET deleted_at = now() WHERE id = $1 AND owner_id = $userId
  Side effects:
    DELETE FROM recipe_collections WHERE recipe_id = $1     -- remove from collections
    (search/list/clone APIs filter `deleted_at IS NULL` on every read path)
  No DB rows or S3 archives removed.

GDPR hard purge ("Erase my data") — enqueue + async worker:
  POST /v1/account/erasure   (idempotent per C-007 — canonical erasure route)
    INSERT account_erasure_jobs (owner_id = $userId, status='queued')   -- enqueue only
    after-commit: sqs.sendMessage(ACCOUNT_ERASURE_QUEUE, { job_id })   -- best-effort
    → 202 Accepted { jobId }   (returns immediately; purge runs async)

ACCOUNT_ERASURE_QUEUE ──► erasure-worker (Lambda, SQS-triggered, VPC-attached — reads RDS + deletes S3)
    For each recipe owned by $userId where deleted_at IS NOT NULL:
      LIST s3://versions-bucket/{recipe_id}/   → DELETE all objects
      DELETE FROM recipe_versions WHERE recipe_id = $r
      DELETE FROM recipe_version_pending_archives WHERE recipe_version_id IN (...)
      DELETE FROM recipe_photos WHERE recipe_id = $r
      DELETE FROM recipes WHERE id = $r
    UPDATE account_erasure_jobs SET status='completed'
    Audit-log the erasure event (separate immutable audit table).
  Irreversible. Confirmation step in UI (typed confirmation + Clerk step-up).

Cron sweeper (scheduled) re-enqueues account_erasure_jobs stuck in 'queued'/'running'
(mirrors the version-archive sweeper), so a missed SQS enqueue still drains.
```

- Every recipe read path (`GET /recipes`, `GET /recipes/:id`, `GET /search/recipes`, `POST /recipes/:id/clone`, collection membership reads) MUST add `WHERE deleted_at IS NULL` (enforced at DAL layer, not in callers).
- Tombstoned recipes remain available to the owner via a future `GET /v1/account/erasure-preview` endpoint (read-only listing of what hard-purge would remove). This endpoint is the only read path permitted to return rows where `deleted_at IS NOT NULL`.
- The hard-purge worker transaction must be idempotent (safe to retry on SQS redelivery or partial failure, and safe for the cron sweeper to re-drive). S3 deletes are issued per object; failures are logged and re-tried; the DB rows are deleted only after S3 reports success on every object.

### Collection Snapshot Clone with Opt-In Pull (FR-011)

```
POST /v1/collections/{id}/clone
  INSERT collections (..., source_collection_id = $id)
  Copy current accessible recipe memberships at clone time

POST /v1/collections/{id}/pull-from-source     ← user-initiated, opt-in
  IF collections.source_collection_id IS NULL  → 409 NOT_CLONED
  Compute diff:
    add    = source.public_membership − clone.membership − clone.user_added_recipe_ids
    remove = clone.membership − source.public_membership − clone.user_added_recipe_ids
  Apply add/remove. Return summary.

# `clone.user_added_recipe_ids` is the set of recipe_ids added to the clone
# AFTER the original snapshot — tracked via `recipe_collections.added_via`
# ('clone' | 'manual' | 'pull').
```

- A clone never auto-pulls. Pull is per invocation.
- Pull MUST NOT remove any recipe whose `added_via = 'manual'` membership row.
- Pull MUST skip any source recipes the cloner cannot access (private, soft-deleted).

## Ingredient Data Integration (FR-007)

Recipe ingredients are backed by the **source-agnostic food service (003)** via its typed client `@kitchensink/food-service-client` (`FoodServiceClient`) — foods are referenced by the food service's **internal id**, not by any upstream data-provider identifier. 001 owns the `ingredients` and `recipe_ingredients` tables; each ingredient references a food by the food service's internal **ULID** (`foodId`), stored as an **opaque reference**. The upstream provider's raw record id is never stored or used as the ingredient key, and there is **no** cross-DB FK to the food DB — the food↔ingredient link lives entirely in 001.

**Food-client call surface:**

- **Typeahead** over known foods → `foodClient.search(query)` (sync, local `/v1/foods/search`).
- **Unknown name** → `foodClient.addByName(name)` → `202 { id, status: PENDING | UNRESOLVED }` (nutrition may not be ready yet).
- **Poll** → `foodClient.getById(id)` / `foodClient.getStatus(id)` (`RESOLVED` → golden record with nutrition).
- **Disambiguation** → `foodClient.getCandidates(id)` + `foodClient.resolve(id, candidateIds)` (PATCH) when `UNRESOLVED`.

**Asynchronous resolution is a first-class UX concern.** The ingredient-picker MUST handle **PENDING/UNRESOLVED**: a just-added food may show "nutrition pending" and resolve asynchronously, so a recipe may temporarily show partial nutrition. The `ingredients`/`recipe_ingredients` schema therefore carries `foodId` plus a **`foodResolutionStatus`** field — UPPER_SNAKE, values `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED` (mirrors the shipped food client's `FoodStatus`, including the terminal `NOT_FOUND`/`FAILED`). Freeform ingredients (FR-007a) are a **separate `isUserEntered` boolean** (NOT a resolution-status value): user-entered nutrition, flagged "user-entered"; on `NOT_FOUND`/`FAILED` the picker surfaces an error and offers the freeform fallback. The thin `GET /v1/ingredients/search` proxy fronts `foodClient.search` for the apps.

## Testing Strategy

### TDD Workflow (NFR-005)

All implementation follows **red-green-refactor**:

1. **Red**: Write a failing test that captures the requirement (unit for business logic, integration for DAL/API/queue boundaries).
2. **Green**: Write the minimum implementation to pass the test.
3. **Refactor**: Clean up while keeping tests green.

Every implementation task in `tasks.md` is paired with a corresponding test task (suffixed `-test`). Test tasks execute first. No implementation task is marked complete without passing tests. New required test groups for the 2026-04-30 clarifications:

- Atomic recipe save: integration tests covering "DB commits, photo upload fails → recipe persists, no broken photo refs."
- Pending archive: integration tests covering "S3 PUT fails → pending row remains, DLQ triggered, replay succeeds → pending row deleted, `s3_key` populated."
- Tombstone filtering: DAL-layer unit tests asserting every read query includes `deleted_at IS NULL`.
- GDPR purge: integration test covering "tombstoned recipe → erase-my-data → DB rows + S3 objects gone, audit row written."
- Pull from source: integration tests for add/remove diffing including the user-added-recipe protection.

### Test Infrastructure

| Layer       | Tool       | File Pattern            | Location                                       |
| ----------- | ---------- | ----------------------- | ---------------------------------------------- |
| Unit        | Vitest     | `*.test.ts`             | `__tests__/` co-located with source            |
| Integration | Vitest     | `*.integration.test.ts` | `__tests__/integration/`                       |
| Web E2E     | Playwright | `*.spec.ts`             | `packages/apps/commise/web/tests/e2e/`         |
| Mobile E2E  | Maestro    | `*.yaml`                | `packages/apps/commise/mobile/tests/e2e/`      |
| Load        | k6         | `*.load.ts`             | `packages/services/recipe-service/tests/load/` |

### LocalStack in Tests (NFR-007)

- **Local dev**: Docker Compose (`docker-compose.yml`) runs PostgreSQL 16 + LocalStack (S3 + SQS).
- **CI**: GitHub Actions service containers mirror the same setup. LocalStack provisions S3 buckets **and** the version-archive and account-erasure SQS queues + DLQs in a `globalSetup.ts` before integration/E2E test suites run.
- **Test isolation**: Each integration test suite gets a fresh database schema (Drizzle migrations applied in `globalSetup`). S3 buckets and SQS queues are purged between test suites.

### Maestro Mobile E2E (NFR-006)

Maestro flows test native mobile interactions on iOS Simulator and Android Emulator:

- Flow files in `packages/apps/commise/mobile/tests/e2e/*.yaml`
- CI runs via `maestro test` with Maestro Cloud or self-hosted runners
- Covers: recipe CRUD (incl. soft delete behavior visible to owner), collection management, clone + pull-from-source, navigation, accessibility, "Erase my data" confirmation flow.

### Fixture Factories (NFR-011)

All unit and component tests use `make*` factories (constitution Principle IV):

- **Backend**: `packages/services/recipe-service/src/__fixtures__/index.ts` — `makeRecipe()`, `makeIngredient()`, `makeCollection()`, `makeUser()`, `makePendingArchive()`, etc.
- **Frontend**: `packages/apps/commise/web/src/__fixtures__/index.ts` and `mobile/src/__fixtures__/index.ts`
- Factories return typed objects with sensible defaults; all fields overridable via partial argument.

### E2E Database Seeding (NFR-010)

- Seed script: `packages/services/recipe-service/src/database/seed.ts` — idempotent, deterministic IDs.
- Playwright `globalSetup.ts` runs migrations + seed before E2E suite.
- Maestro flows expect seeded data (stable user IDs, recipe IDs for assertions).

### Frontend API Configuration (NFR-009)

Frontend apps connect to local or remote API servers via environment variables.

**Local port assignments** (avoid collisions):

| Service                | Port   | Notes                                                        |
| ---------------------- | ------ | ------------------------------------------------------------ |
| Recipe API (NestJS)    | `4000` | `PORT=4000` in `packages/services/recipe-service/.env.local` |
| Next.js web app        | `3000` | Next.js default                                              |
| Expo mobile dev server | `8081` | Metro default                                                |
| PostgreSQL (docker)    | `5432` | `docker-compose.yml`                                         |
| LocalStack (S3, SQS)   | `4566` | `docker-compose.yml`                                         |

Frontend env defaults:

- **Next.js (web)**: `NEXT_PUBLIC_API_URL` — defaults to `http://localhost:4000` in `.env.local`
- **Expo (mobile)**: `EXPO_PUBLIC_API_URL` — defaults to `http://localhost:4000` in `.env` (use `http://10.0.2.2:4000` for Android emulator, `http://<host-lan-ip>:4000` for physical devices)
- The typed recipe API client (`packages/clients/recipe-service`, `@kitchensink/recipe-service-client`) reads the base URL from the environment at initialization.
- E2E tests configure this to point at the local test server.

### Async Archive Worker — Deployment Ordering Note

The version-archive worker (T131/T132) and its CloudWatch alarms (T138) depend on the `recipe_version_pending_archives` table (T121, now in Phase 2). Deploy order: schema migration → API change to enqueue (T130) → worker Lambda + SQS (T131/T132) → alarms (T138). Reversing this order causes pending rows to accumulate without a drainer.

## CI Pipeline (NFR-008)

### GitHub Actions Workflow (`.github/workflows/ci.yml`)

> **Existing CI**: The repo already has a CI workflow with install (npm cache), lint, format, typecheck, and test jobs. Tasks T090–T092 **extend** this existing workflow — they do NOT recreate it. Preserve existing job structure, cache strategy, and concurrency settings.

```yaml
# Conceptual structure — existing jobs (preserve) + new jobs (add)
triggers: [pull_request, push to main] # existing
services: [postgres:16-alpine, localstack/localstack:3] # NEW — for integration + E2E jobs only
existing_jobs: # DO NOT MODIFY (except cache path glob fix)
    - install (npm ci + cache/save)
    - lint (turbo run lint)
    - format (format:check)
    - typecheck (turbo run typecheck)
    - test (turbo run test — unit only)
new_jobs: # ADD these
    test-integration:
        needs: [install]
        services: [postgres, localstack] # localstack runs s3 + sqs
        steps:
            - run migrations + seed
            - provision SQS queues (commise-version-archive, commise-account-erasure) + DLQs
            - turbo run test:integration
    test-e2e-web:
        needs: [test]
        services: [postgres, localstack]
        steps:
            - build apps
            - start API server
            - npx playwright test
    test-e2e-mobile:
        needs: [test]
        steps:
            - maestro test (Maestro Cloud or self-hosted)
```

### CI Service Containers

- **PostgreSQL 16**: `postgres:16-alpine` with `pg_trgm` extension, health check.
- **LocalStack 3**: `localstack/localstack:3` with `SERVICES=s3,sqs`, provisions buckets and the `commise-version-archive` and `commise-account-erasure` queues + DLQs in job setup step.
- **Playwright**: Browser binaries cached by `playwright-version + runner-os` key. Traces/reports uploaded on failure only.
- **Maestro**: Installed via `maestro-cli` action; flows run against Expo dev build on emulator/simulator.

## Post-Login Home Screen — Widget Surface (FR-046, US-000)

**Design authority: [`research/home-widget-architecture.md`](./research/home-widget-architecture.md) — the `## DECISION (2026-07-06)` section.**

The Home screen is the first screen rendered after the Clerk post-login redirect. It is a **widget surface** built in three layers — Discovery, Composition, Render — NOT a hardcoded fan-out of parallel calls to a fixed set of endpoints.

### Three layers

- **Discovery** = explicit startup registration at a composition root (`.use(addFeature)`); each feature contributes its widget descriptor. NOT build-time codegen or `require.context` — pure, bundler-portable code.
- **Composition** = `curateHomeWidgets(widgets, ctx)`, a pure function that gates each widget by **capability** (feature flag: is the backing service live) + **subscription tier**, then orders by **personalization**.
- **Render** = lazy loader (`reg.load`) + `Suspense` + `ErrorBoundary`; unknown widget ids are skipped (safe server/client version skew + auto-appear). The lazy primitive is platform-specific: **web (RSC) uses `next/dynamic`** (T104-web) while **mobile uses `React.lazy`** — the "lazy + Suspense" contract is identical, only the loader differs.

### Dependency injection (`appShell`)

- **Frontend → ditox** (`ditox` + `@ditox/react`) — token-based, decorator-free, esbuild/Hermes-safe. Provider = `CustomDependencyContainer`; hooks = `useDependency(token)`; RSC/server components use the core `ditox` container directly. The container is the `appShell`, available everywhere.
- **Backend → NestJS decorator DI** (unchanged). This front/back DI asymmetry is intentional.

### Feature packages & loader seam

- Widgets ship from feature packages (e.g. `@commise/features-recipes`) exporting `./widget/web` + `./widget/mobile`; platform files use the **`.native.ts(x)`** suffix (never `.mobile.*`).
- Widget registration carries a **loader**, not a component: `load: () => import('@commise/features-recipes/widget/web')` (and `/widget/mobile` on mobile) — forward-compatible with turning a widget into a Module Federation remote one line at a time.

### Capability gating rescopes US-000

Home v1 ships with **only the recipe widget live** (recent-recipes) and **only the recipe widget registered**. The meal-plan, nutrition-snapshot, shopping-list, AI-suggestion, and resume-cooking widgets are **not registered in v1** — their `@commise/features-*` packages (backed by services **005–009**) don't exist yet, and registering literal `import('@commise/features-*/widget/...')` loaders for unbuilt packages would fail the build. The capability/subscription curate pipeline is already in place and is exercised by the recipe widget's own capability check. Each gated widget is **added with its loader when its feature package ships**, at which point capability gating makes it **auto-appear** with no client redeploy (e.g. the AI-suggestion widget lights up when service 005 deploys).

- **US-000 acceptance**: v1 asserts the **recipe widget renders** and the **gated widgets are absent** (not present-with-empty-state). The per-section empty-state (e.g. the recipe widget's "Create your first recipe" CTA) applies **only to live widgets**.

### Personalization (owned by identity service, 002)

Per-user home layout (`order`, `hidden`) persists as JSON under the user's profile preferences (`profiles.preferences.homeLayout`) via the existing `PATCH /v1/profiles/me`, **owned by the identity service (002)** (it owns the per-user profile DB) and **consumed** by 001. Any known widget not in the user's saved layout renders at its default weight, so newly-lit widgets appear for existing users with no migration.

### Subscription Nudge

When a free-tier user taps a premium-gated entry point on Home (private recipe visibility, advanced nutrition), a bottom sheet / modal appears with an upgrade prompt. The nudge is suppressed for the remainder of the session after the first appearance, tracked in component state (not persisted). No backend call is needed for nudge suppression.

### Platform Layout

| Platform      | Layout                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Web (Next.js) | Responsive CSS grid: 2-column on ≥768px, 1-column below. Only **live** widgets render, in curated order. |
| Mobile (Expo) | Vertical ScrollView. Only **live** widgets render, in curated order.                                     |

Widget implementations live in the feature packages (`@commise/features-recipes/widget/{web,mobile}`, `widget.web.tsx` + `widget.native.tsx`); the apps compose the surface and host the composition root. Each widget owns its own data fetch (TanStack Query on mobile; web either converges on TanStack Query or uses the existing fetch wrapper).

### Route

- **Web**: `packages/apps/commise/web/src/app/page.tsx` — the `/` route after login redirect.
- **Mobile**: `packages/apps/commise/mobile/src/screens/HomeScreen.tsx` — the initial tab/stack screen after auth.

---

## Web/Mobile Parity Enforcement

FR-044 requires feature parity across web and mobile. FR-044a (added 2026-05-10) makes this enforceable at task level.

### Rule

Every frontend implementation task MUST satisfy one of:

1. **Covers both platforms explicitly** — the task description names both web and mobile file paths or says "web + mobile".
2. **Has a paired task** — a separate task exists for the other platform, and both tasks reference each other.
3. **Carries a documented exception** — the task body includes a `[PARITY-EXCEPTION]` note explaining why parity is deferred and which future spec closes the gap.

A task that covers only one platform without a documented exception is a **blocking defect** and must not be marked complete.

### Pre-Approved Exceptions (no task-level note required)

| Exception                                     | Reason                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| Clerk SDK integration (web vs. mobile)        | Covered by spec 002; different SDKs are expected     |
| Expo device APIs (camera, haptics, push)      | No web equivalent; noted per feature                 |
| Playwright (web E2E) vs. Maestro (mobile E2E) | Different tools for the same flow; both are required |

### Audit

T060 (Phase 6 parity audit) remains in place as a final gate. It now checks that every frontend task in Phase 5 satisfies one of the three conditions above, not just that the API contracts mention parity.

---

## Complexity Tracking

> No constitution violations identified. All 7 principles pass without deviation. The worker Lambdas add one new workspace — justified below.

| Violation                                                                                   | Why Needed                                                                                                                                                                                                    | Simpler Alternative Rejected Because                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New workspace `packages/services/recipe-workers/` (version-archive-worker + erasure-worker) | FR-007b-i (archive) and C-007 (GDPR erasure) require async work that must not block the user request. SQS-triggered Lambdas are the standard AWS pattern for at-least-once async processing with DLQ + retry. | Inlining the archive/erasure writes in the Fargate API process would violate "save/erase MUST succeed independently of S3" and would couple recipe-save p95 to S3 latency/availability. |
