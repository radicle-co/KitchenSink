# Local Development Quickstart: Commise Recipe API

**Branch**: `001-commise-recipe-app` | **Date**: 2026-07-17 (refreshed for shipped v1 — T052) | **Spec**: [spec.md](./spec.md)
**Related**: [plan.md](./plan.md) | [data-model.md](./data-model.md) | [research.md](./research.md)

This guide gets the Commise Recipe backend running locally in under 10 minutes. It covers infrastructure (PostgreSQL + LocalStack S3/SQS via Docker Compose), environment configuration, migrations (0001–0011), seed data, the **photo processor flow** (presigned upload → confirm → sharp cover-thumbnail), the **background workers** (version-archive + account-erasure in `@kitchensink/recipe-workers`), the CI pipeline, and every test tier's commands.

Two backend workspaces make up the feature: the NestJS API (`@kitchensink/recipe-service`) and the async Lambda workers (`@kitchensink/recipe-workers`). Cover-thumbnail generation is **not** a separate worker — it runs synchronously inside the API's `PhotosService` (sharp/libvips) on photo confirm; see [Photo processor flow](#photo-processor-flow).

---

## Prerequisites

Install these before continuing:

- **Node.js 24.x** — use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage versions (see `.nvmrc`)
- **npm 10+** — ships with Node 24
- **Docker + Docker Compose** v2 — `docker compose` (no hyphen) must work from your terminal
- **AWS CLI v2** — needed to provision LocalStack S3 buckets

Verify your setup:

```bash
node --version   # should print v24.x.x
docker --version
aws --version
```

---

## Docker Compose

Create `docker-compose.yml` at the monorepo root (or copy from below). This starts PostgreSQL 16 and LocalStack for S3 emulation. All services share a single Docker network.

```yaml
version: '3.9'

networks:
    commise:
        driver: bridge

services:
    postgres:
        image: postgres:16-alpine
        container_name: commise-postgres
        restart: unless-stopped
        networks:
            - commise
        ports:
            - '5432:5432'
        environment:
            POSTGRES_USER: commise
            POSTGRES_PASSWORD: commise
            POSTGRES_DB: commise
        volumes:
            - postgres_data:/var/lib/postgresql/data
            - ./infra/docker/postgres-init.sql:/docker-entrypoint-initdb.d/init.sql:ro
        healthcheck:
            test: ['CMD-SHELL', 'pg_isready -U commise -d commise']
            interval: 5s
            timeout: 5s
            retries: 10
            start_period: 10s

    localstack:
        image: localstack/localstack:3
        container_name: commise-localstack
        restart: unless-stopped
        networks:
            - commise
        ports:
            - '4566:4566'
        environment:
            SERVICES: s3
            DEFAULT_REGION: us-east-1
            EAGER_SERVICE_LOADING: 1
        volumes:
            - localstack_data:/var/lib/localstack

volumes:
    postgres_data:
    localstack_data:
```

The postgres init script at `infra/docker/postgres-init.sql` must enable the `pg_trgm` extension used by the full-text search indexes. Create that file with:

```sql
-- infra/docker/postgres-init.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

This file runs once when the container first initializes. It won't re-run on subsequent starts.

---

## Environment Variables

Copy `.env.example` to `.env` at the monorepo root (or in `packages/services/recipe-service/` if the workspace loads env from there). Never commit `.env`.

```dotenv
# .env.example

# Database
DATABASE_URL=postgresql://commise:commise@localhost:5432/commise

# S3 / LocalStack
S3_ENDPOINT=http://localhost:4566
S3_BUCKET_PHOTOS=commise-photos
S3_BUCKET_VERSIONS=commise-versions

# Clerk — replace with your dev instance values
# API (networkless session-token verification — both non-secret)
CLERK_JWT_KEY=-----BEGIN PUBLIC KEY-----...your-pem-public-key...-----END PUBLIC KEY-----
CLERK_AUTHORIZED_PARTIES=http://localhost:5173,http://localhost:3000
# Frontend publishable keys (web + mobile)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your-key-here
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your-key-here

# CloudFront — LocalStack stand-in for local dev
CLOUDFRONT_URL=http://localhost:4566/commise-photos

# App
NODE_ENV=development
PORT=4000
```

Clerk values won't affect most API behavior in dev mode, but the `AuthMiddleware` (networkless session-token verification via `CLERK_JWT_KEY` plus `azp` enforcement from `CLERK_AUTHORIZED_PARTIES`) will reject requests without a valid Clerk session token unless you configure the API to bypass auth in `NODE_ENV=development`. Check `packages/services/recipe-service/src/auth/auth.middleware.ts` for the local bypass flag.

---

## Setup Commands

Run these in order from the monorepo root.

### 1. Start infrastructure

```bash
docker compose up -d
```

Wait for PostgreSQL to pass its health check before running migrations:

```bash
docker compose ps
# postgres: healthy
```

If it stays in "starting" for more than 30 seconds, see [Troubleshooting](#troubleshooting).

### 2. Install dependencies

```bash
npm install
```

### 3. Build shared packages

Shared packages must build before the NestJS dev server starts. This is a CommonJS interop requirement wired into `turbo.json` as a `^build` dependency.

```bash
npm run build
```

This compiles all packages in dependency order. Only the shared packages need a full build — the API dev server uses `ts-node` / `@swc/core` with hot reload after this.

### 4. Run database migrations

Migrations live in the recipe service's own database module (`packages/services/recipe-service/src/database/migrations` — the recipe tables live in their own logical database `kitchensink_recipes` on the shared RDS instance, not a shared db package) and are managed by drizzle-kit. Run them from that workspace:

```bash
npx drizzle-kit migrate --config=packages/services/recipe-service/drizzle.config.ts
```

Or, if the workspace defines a `migrate` script:

```bash
npm run migrate --workspace=packages/services/recipe-service
```

drizzle-kit reads `DATABASE_URL` from your `.env`. Confirm migrations applied:

```bash
npx drizzle-kit studio --config=packages/services/recipe-service/drizzle.config.ts
# Opens a browser-based DB browser at http://localhost:4983
```

### 5. Provision LocalStack S3 buckets

See [LocalStack S3 Setup](#localstack-s3-setup) below.

### 6. Seed test data

```bash
npm run seed --workspace=packages/services/recipe-service
```

See [Seed Data](#seed-data) for what this creates.

### 7. Start the API dev server

```bash
npm run dev --workspace=packages/services/recipe-service
```

The server starts on `http://localhost:4000`. NestJS logs the registered routes on boot. Hit `http://localhost:4000/health` to confirm it's up.

---

## Seed Data

The seed script (`packages/services/recipe-service/src/database/seed.ts`) populates a baseline dataset for manual testing and integration tests that don't manage their own fixtures.

After seeding, the database contains:

- **2 test users**: one with the `free` plan tier and one with `pro`. Both have stable IDs that match fixture tokens in `packages/services/recipe-service/src/__fixtures__/`.
- **5 test recipes**: a mix of visibility levels (`private`, `public`, `shared`). Each recipe has a full ingredient list, preparation steps, and at least one version snapshot. Two recipes belong to the `pro` user and three to the `free` user.
- **1 collection**: owned by the `pro` user, containing 3 of the 5 recipes. Used to test collection membership queries and ordering.

The seed script is idempotent — running it twice doesn't create duplicates. It uses `ON CONFLICT DO NOTHING` on the stable fixture IDs.

---

## LocalStack S3 Setup

After `docker compose up -d`, create the two S3 buckets against LocalStack. The AWS CLI needs a dummy credential set for LocalStack (it doesn't validate them):

```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

aws --endpoint-url=http://localhost:4566 s3 mb s3://commise-photos
aws --endpoint-url=http://localhost:4566 s3 mb s3://commise-versions
```

Verify the buckets exist:

```bash
aws --endpoint-url=http://localhost:4566 s3 ls
```

You should see both `commise-photos` and `commise-versions`. These match the `S3_BUCKET_PHOTOS` and `S3_BUCKET_VERSIONS` values in `.env.example`.

LocalStack doesn't persist bucket contents across container restarts unless you mount a volume (already configured in the Compose file above). Buckets themselves need to be re-created after a full `docker compose down -v`.

---

## Common Commands

| Command                                                                                | What it does                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `npm run dev --workspace=packages/services/recipe-service`                             | Start recipe API dev server only                   |
| `npm run build`                                                                        | Build all packages in dependency order             |
| `npm run test`                                                                         | Run all tests across the monorepo                  |
| `npm run test --workspace=packages/services/recipe-service`                            | Run API tests only                                 |
| `npm run lint`                                                                         | Lint all packages                                  |
| `npx drizzle-kit generate --config=packages/services/recipe-service/drizzle.config.ts` | Generate a new migration file after schema changes |
| `npx drizzle-kit migrate --config=packages/services/recipe-service/drizzle.config.ts`  | Apply pending migrations                           |
| `npx drizzle-kit studio --config=packages/services/recipe-service/drizzle.config.ts`   | Open Drizzle Studio at `localhost:4983`            |

When running drizzle-kit commands outside the workspace directory, always pass `--config` explicitly. drizzle-kit will look for `drizzle.config.ts` in the current working directory otherwise.

---

## Troubleshooting

### PostgreSQL container won't reach "healthy"

The most common cause is a port conflict. Check if something is already using port 5432:

```bash
lsof -i :5432
```

If another Postgres instance is running, either stop it or change the host port in `docker-compose.yml` (e.g., `"5433:5432"`) and update `DATABASE_URL` in `.env` to match.

If the container keeps restarting, check its logs:

```bash
docker compose logs postgres
```

A `could not open file "/docker-entrypoint-initdb.d/init.sql"` error means the init script path is wrong. Confirm `infra/docker/postgres-init.sql` exists from the repo root.

### drizzle-kit can't connect to the database

drizzle-kit resolves `DATABASE_URL` from environment variables. If you're running from a subdirectory or a shell that hasn't sourced `.env`, the variable may be missing. Options:

```bash
# Explicitly pass it
DATABASE_URL=postgresql://commise:commise@localhost:5432/commise \
  npx drizzle-kit migrate --config=packages/services/recipe-service/drizzle.config.ts

# Or source .env first
set -a && source .env && set +a
npx drizzle-kit migrate --config=packages/services/recipe-service/drizzle.config.ts
```

Also confirm the PostgreSQL container is healthy before running migrations (`docker compose ps`).

### NestJS dev server fails to start with module resolution errors

This almost always means the shared packages haven't been built yet. Run:

```bash
npm run build
```

Then restart the dev server. The NestJS workspace imports from compiled output in `packages/shared/*/dist/`, not from TypeScript source. The `^build` constraint in `turbo.json` enforces this in CI, but local dev servers launched directly via `npm run dev --workspace=...` bypass Turbo's dependency graph.

### LocalStack S3 requests fail with "connection refused"

Check that LocalStack is running and healthy:

```bash
docker compose ps localstack
docker compose logs localstack
```

LocalStack can take 10–15 seconds after the container starts before the S3 service accepts connections. The `EAGER_SERVICE_LOADING=1` env var speeds this up but doesn't make it instant.

If `aws s3 ls --endpoint-url=http://localhost:4566` returns an error, wait a few seconds and retry. If the buckets are missing, re-run the bucket creation commands from [LocalStack S3 Setup](#localstack-s3-setup).

### Port 4000 is already in use

Another process (possibly a previous API instance) is holding port 4000. Find and kill it:

```bash
lsof -ti :4000 | xargs kill -9
```

Or change the API port in `.env` (`PORT=4001`) and restart.

---

## Running Tests Locally

### Unit Tests

```bash
npm run test                                    # All workspaces
npm run test --workspace=packages/services/recipe-service    # API only
```

Unit + component tests (Vitest / React Testing Library) need no Docker. The web app runs two configs (`.tsx` DOM + `.native.tsx` react-native-web); features-recipes likewise.

### Integration Tests (requires Docker Compose running)

```bash
# API — recipes/ingredients/collections/photos/versions/ratings against real PG + LocalStack S3
npm run test:integration --workspace=packages/services/recipe-service

# Workers — version-archive + account-erasure against real PG + LocalStack SQS/S3
npm run test:integration --workspace=packages/services/recipe-workers
```

Integration tests run against real PostgreSQL and LocalStack (S3 + SQS). Make sure `docker compose up -d` is running first.

### Service E2E Tests (booted NestJS app)

```bash
# Boots the assembled app against Docker Postgres + LocalStack (health, ingredients, ratings, throttle)
npm run test:e2e --workspace=packages/services/recipe-service
```

These `describe.skipIf(!hasDatabaseUrl)` suites skip when no `DATABASE_URL` is set, and run in CI where it is.

### Web E2E Tests (Playwright)

```bash
# Install Playwright browsers (first time only)
npx playwright install --with-deps

# Run E2E tests (starts the web server automatically via globalSetup)
npm run test:e2e --workspace=packages/apps/commise/web
```

The authed specs (sign-in/up, recipe CRUD/rating/clone) drive a real Clerk session, so they need the sandbox Clerk dev-instance secrets (`CLERK_SECRET_KEY` + publishable key). Selectors are `getByRole`/`getByLabel` only.

### Mobile E2E Tests (Maestro)

```bash
# Install Maestro CLI (first time only)
curl -Ls "https://get.maestro.mobile.dev" | bash

# Run the flows against a booted Android emulator / iOS simulator with the app installed
maestro test packages/apps/commise/mobile/.maestro
```

Flows live in `packages/apps/commise/mobile/.maestro/` (auth + recipes: create/edit/delete/rating/visibility/collections/conflict/discover-clone/list-detail/search/accessibility). They require the Expo debug build installed on a running emulator and a reachable recipe API (`EXPO_PUBLIC_API_URL`).

### Load Tests (k6 — SC-009)

```bash
# 1. Install k6 (https://k6.io/docs/get-started/installation/), then prepare a dedicated load DB:
DATABASE_URL=postgres://postgres:postgres@localhost:5432/recipe_load \
  node packages/services/recipe-service/tests/load/prepare-db.mjs   # applies migrations + seeds catalog

# 2. Boot the COMPILED service against that DB (dev-bypass auth so k6 needs no live Clerk token):
npm run build --workspace=@kitchensink/recipe-service
DATABASE_URL=postgres://postgres:postgres@localhost:5432/recipe_load PORT=3000 \
  RECIPE_DEV_AUTH_USER_ID=01J000000000000000000LOAD0 \
  npm run start --workspace=@kitchensink/recipe-service &

# 3. Run the SC-009 read/write scenario (p95 ≤ 500ms threshold; a breach exits non-zero):
RECIPE_API_BASE_URL=http://localhost:3000 \
  k6 run packages/services/recipe-service/tests/load/sc009-read-write.load.js
```

`prepare-db.mjs` is mandatory: since T043b every recipe create validates each line's `ingredientId` against the catalog, so the seed ingredients must exist or every write 400s and trips the failure-rate threshold. The `search-latency` and `save-under-archive` scenarios live alongside it.

---

## CI/CD Pipeline

CI is a **reusable** workflow, `.github/workflows/_ci.yml`, invoked by two thin wrappers: `ci-pr.yml` (on `pull_request` → `stage: sandbox`) and `ci-main.yml` (on push to `main` → `stage: prod`). Both call `_ci.yml` with `secrets: inherit`.

| Job                              | What it runs                                                                  | Service containers      | Gate                            |
| -------------------------------- | ----------------------------------------------------------------------------- | ----------------------- | ------------------------------- |
| `install`                        | `npm ci` + dependency cache                                                   | —                       | every run                       |
| `lint` / `format` / `typecheck`  | `turbo run lint` / `format:check` / `typecheck`                               | —                       | every run                       |
| `test`                           | `turbo run test` (Vitest unit + component; builds `@commise/ui` via `^build`) | —                       | every run                       |
| `Integration (recipe …)`         | recipe-service `test:integration`                                             | Postgres 16, LocalStack | every run                       |
| `Integration (recipe-workers …)` | recipe-workers `test:integration`                                             | Postgres 16, LocalStack | every run                       |
| `E2E (backend services)`         | recipe-service booted-app e2e                                                 | Postgres 16, LocalStack | every run                       |
| `E2E (web — Playwright)`         | authed web flows (Clerk sandbox)                                              | —                       | every run                       |
| `E2E (mobile — Vitest)`          | react-native-web mobile e2e                                                   | —                       | every run                       |
| `E2E (mobile — Maestro)`         | real-device flows (emulator + Gradle APK)                                     | Android emulator        | **opt-in** `run_mobile_maestro` |
| `Load test (recipe — k6)`        | SC-009 p95 ≤ 500ms threshold gate                                             | Postgres 16             | **opt-in** `run_load_test`      |

The two heavyweight jobs are gated **off by default** purely for cost/duration (an Android emulator + Gradle build; a multi-VU load run). A caller opts in by passing `run_mobile_maestro: true` / `run_load_test: true` to `_ci.yml`. The **`ci-full.yml`** workflow (manual `workflow_dispatch`) runs the complete pipeline with both flags enabled — use it to exercise every job end-to-end (T116). All non-opt-in jobs must pass before a PR merges.

### Frontend API Configuration

Frontend apps default to `http://localhost:4000` for API calls. Override via environment variables:

- **Next.js (web)**: Set `NEXT_PUBLIC_API_URL` in `.env.local` or CI environment
- **Expo (mobile)**: Set `EXPO_PUBLIC_API_URL` in `.env` or EAS build environment

For E2E tests, the API URL is set automatically by the test `globalSetup` to point at the local test server.

---

## Photo processor flow

Recipe photos never pass through the API body — the client uploads directly to S3 and the API records + post-processes the object. All routes are under `POST|GET|PATCH|DELETE /v1/recipes/:recipeId/photos` (owner-gated; see `photos.controller.ts`):

1. **Request an upload URL** — `POST …/photos/upload-url` `{ fileName, fileSize, contentType }` → `{ uploadUrl, key, expiresIn, maxBytes }`. The service pre-checks the 5 MB / 10-photo caps and returns a presigned S3 PUT.
2. **PUT the bytes to S3** — the client `PUT`s the image straight to the `uploadUrl` (LocalStack `commise-photos` bucket locally). _LocalStack quirk:_ the S3 client is configured `requestChecksumCalculation: 'WHEN_REQUIRED'`, otherwise the presigned PUT fails an `x-amz-checksum-crc32` check under the aws-sdk v3 defaults.
3. **Confirm** — `POST …/photos/confirm` `{ key, contentType }`. The service validates the object's **magic bytes** (jpeg/png/webp — the `file-type` library, not a hand-rolled sniff), records the `recipe_photos` row, and generates a **cover thumbnail**.
4. **Cover thumbnail (synchronous, in-API)** — `photo-thumbnail.ts` resizes the first photo with **sharp/libvips** to `THUMBNAIL_MAX_PX` longest edge (default 400) at `THUMBNAIL_QUALITY` JPEG (default 80) and stores it under `thumbnail_key` (migration `0011`). If generation fails (e.g. an S3 5xx, or a `sharp` arch mismatch on a deployed task), it logs and **serves the original as the cover** — the cover projection resolves `COALESCE(thumbnail_key, s3_key)`, so the card degrades gracefully rather than 500-ing. The gallery always serves full-size originals; only the **cover** is a thumbnail.
5. **Serve** — URLs are resolved against `CLOUDFRONT_URL` (a LocalStack stand-in locally).

`sharp` is a native binary: it installs with a plain `npm i` for the local/Fargate `linux-x64` platform. On a deployed task the image build arch **must** match the task arch (`X86_64`) or every thumbnail falls back to the original (see release-readiness).

---

## Background workers (recipe-workers)

The async side of the feature lives in `@kitchensink/recipe-workers` (raw AWS Lambda handlers, no NestJS) and runs against LocalStack SQS + S3 locally:

- **version-archive** — drains the `recipe_version_pending_archives` outbox to S3 (`commise-versions`) and prunes to the last 10 in-DB versions. A sweeper re-drives stuck rows; a DLQ + CloudWatch alarms (backlog > 100 / oldest > 1h / any DLQ message) cover FR-007b-i.
- **account-erasure** — SQS-triggered GDPR hard-delete of everything a user owns (rows + S3 objects), with a sweeper for stuck jobs and an **orphan-sweeper** backstop that deletes any archive object materialized under an already-erased owner (the archive-resurrection race).

```bash
# Unit + integration (integration needs Docker Postgres + LocalStack SQS/S3):
npm run test --workspace=@kitchensink/recipe-workers
npm run test:integration --workspace=@kitchensink/recipe-workers

# Synthesize the CDK stack (queues, DLQs, 6 alarms, SNS topic) without deploying:
npm run infra:synth --workspace=@kitchensink/recipe-workers
```

> The workers `test` script runs `npm run build` first, because the infra-synth test asserts against the esbuild bundle in `dist/`.

---

## Domain Behavior Notes

A few behaviors are easy to trip over when poking at the local DB or hitting the API by hand:

### Soft-deleted recipes (tombstones)

`DELETE /v1/recipes/{id}` is a **soft delete**. The row stays in `recipes` with `deleted_at` set to the deletion timestamp. List, search, get-by-id, and collection responses all filter out tombstoned rows, but they remain visible in Drizzle Studio and via direct SQL.

If you need to inspect or reset state during development:

```sql
-- See tombstoned recipes
SELECT id, title, deleted_at FROM recipes WHERE deleted_at IS NOT NULL;

-- Un-tombstone for local debugging only (NEVER do this in prod)
UPDATE recipes SET deleted_at = NULL WHERE id = '<uuid>';
```

Hard deletion of recipe rows, version snapshots, photos, and S3-archived version blobs only happens via the GDPR erasure flow (`POST /v1/account/erasure`), which runs asynchronously.

### Cloned collections and pull-from-source

`POST /v1/collections/{id}/clone` creates a new collection whose `source_collection_id` points back to the original. Each membership row carries an `added_via` value:

- `manual` — direct add via `POST /v1/collections/{id}/recipes`
- `clone` — copied during the initial clone
- `pull` — added later via `POST /v1/collections/{id}/pull-from-source`

Pulls are additive only: recipes removed from the source after the clone are **not** removed from the clone. Removing a recipe from the source collection has no effect on existing clones.

### Pending version archives

Version snapshots are written synchronously to PostgreSQL but archived to S3 asynchronously. Rows in `recipe_version_pending_archives` remain the source of truth until the archive worker confirms the upload. When debugging "missing" S3 objects locally, check that table first — the LocalStack worker may simply not have run yet.

### Account erasure (local)

`POST /v1/account/erasure` queues an async job that hard-deletes everything owned by the calling user, including tombstoned recipes and all S3 objects. Locally this runs against LocalStack and the dev Postgres — re-seed afterward with `npm run seed --workspace=packages/services/recipe-service` if you want the test fixtures back.
