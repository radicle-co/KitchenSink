# Local Development Quickstart: Commise Recipe API

**Branch**: `001-commise-recipe-app` | **Date**: 2026-04-18 | **Spec**: [spec.md](./spec.md)
**Related**: [plan.md](./plan.md) | [data-model.md](./data-model.md) | [research.md](./research.md)

This guide gets the Commise Recipe Management API running locally in under 10 minutes. It covers infrastructure (PostgreSQL + LocalStack S3 via Docker Compose), environment configuration, migrations, seed data, and the most common dev commands.

The photo-processing Lambda workspace is out of scope here. This guide focuses entirely on the NestJS API.

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

Copy `.env.example` to `.env` at the monorepo root (or in `packages/api/recipe/` if the workspace loads env from there). Never commit `.env`.

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
PORT=3000
```

Clerk values won't affect most API behavior in dev mode, but the `AuthMiddleware` (networkless session-token verification via `CLERK_JWT_KEY` plus `azp` enforcement from `CLERK_AUTHORIZED_PARTIES`) will reject requests without a valid Clerk session token unless you configure the API to bypass auth in `NODE_ENV=development`. Check `packages/api/recipe/src/auth/auth.middleware.ts` for the local bypass flag.

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

Migrations live in `packages/shared/db` and are managed by drizzle-kit. Run them from that workspace:

```bash
npx drizzle-kit migrate --config=packages/shared/db/drizzle.config.ts
```

Or, if the workspace defines a `migrate` script:

```bash
npm run migrate --workspace=packages/shared/db
```

drizzle-kit reads `DATABASE_URL` from your `.env`. Confirm migrations applied:

```bash
npx drizzle-kit studio --config=packages/shared/db/drizzle.config.ts
# Opens a browser-based DB browser at http://localhost:4983
```

### 5. Provision LocalStack S3 buckets

See [LocalStack S3 Setup](#localstack-s3-setup) below.

### 6. Seed test data

```bash
npm run seed --workspace=packages/shared/db
```

See [Seed Data](#seed-data) for what this creates.

### 7. Start the API dev server

```bash
npm run dev --workspace=packages/apps/api
```

> **Note**: This path will be updated to `packages/api/recipe` once workspace scaffolding is complete per plan.md.

The server starts on `http://localhost:3000`. NestJS logs the registered routes on boot. Hit `http://localhost:3000/health` to confirm it's up.

---

## Seed Data

The seed script (`packages/shared/db/src/seed.ts`) populates a baseline dataset for manual testing and integration tests that don't manage their own fixtures.

After seeding, the database contains:

- **2 test users**: one with the `free` plan tier and one with `pro`. Both have stable IDs that match fixture tokens in `packages/apps/api/v1/test/fixtures/`.
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

| Command                                                                  | What it does                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| `npm run dev --workspace=packages/api/recipe`                            | Start recipe API dev server only                   |
| `npm run build`                                                          | Build all packages in dependency order             |
| `npm run test`                                                           | Run all tests across the monorepo                  |
| `npm run test --workspace=packages/api/recipe`                           | Run API tests only                                 |
| `npm run lint`                                                           | Lint all packages                                  |
| `npx drizzle-kit generate --config=packages/shared/db/drizzle.config.ts` | Generate a new migration file after schema changes |
| `npx drizzle-kit migrate --config=packages/shared/db/drizzle.config.ts`  | Apply pending migrations                           |
| `npx drizzle-kit studio --config=packages/shared/db/drizzle.config.ts`   | Open Drizzle Studio at `localhost:4983`            |

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
  npx drizzle-kit migrate --config=packages/shared/db/drizzle.config.ts

# Or source .env first
set -a && source .env && set +a
npx drizzle-kit migrate --config=packages/shared/db/drizzle.config.ts
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

### Port 3000 is already in use

Another process (possibly a previous API instance) is holding port 3000. Find and kill it:

```bash
lsof -ti :3000 | xargs kill -9
```

Or change the API port in `.env` (`PORT=3001`) and restart.

---

## Running Tests Locally

### Unit Tests

```bash
npm run test                                    # All workspaces
npm run test --workspace=packages/api/recipe    # API only
```

### Integration Tests (requires Docker Compose running)

```bash
npm run test:integration --workspace=packages/api/recipe
```

Integration tests run against real PostgreSQL and LocalStack S3. Make sure `docker compose up -d` is running first.

### Web E2E Tests (Playwright)

```bash
# Install Playwright browsers (first time only)
npx playwright install --with-deps

# Run E2E tests (starts API server automatically via globalSetup)
npm run test:e2e --workspace=packages/apps/commise/web
```

### Mobile E2E Tests (Maestro)

```bash
# Install Maestro CLI (first time only)
curl -Ls "https://get.maestro.mobile.dev" | bash

# Run flows against a running Expo dev build
maestro test packages/apps/commise/mobile/tests/e2e/
```

Maestro flows require a running iOS Simulator or Android Emulator with the Expo dev build installed.

---

## CI/CD Pipeline

The GitHub Actions workflow at `.github/workflows/ci.yml` runs automatically on every PR and push to `main`. The existing workflow already includes quality gates; tasks T090–T092 extend it with integration and E2E jobs:

| Job                | What it runs                         | Service containers          | Status         |
| ------------------ | ------------------------------------ | --------------------------- | -------------- |
| `install`          | `npm ci` + cache                     | None                        | **Exists**     |
| `lint`             | `turbo run lint`                     | None                        | **Exists**     |
| `format`           | `format:check`                       | None                        | **Exists**     |
| `typecheck`        | `turbo run typecheck`                | None                        | **Exists**     |
| `test`             | `turbo run test` (Vitest unit tests) | None                        | **Exists**     |
| `test-integration` | `turbo run test:integration`         | PostgreSQL 16, LocalStack 3 | **New (T090)** |
| `test-e2e-web`     | Playwright E2E tests                 | PostgreSQL 16, LocalStack 3 | **New (T090)** |
| `test-e2e-mobile`  | Maestro E2E flows                    | Emulator/Maestro Cloud      | **New (T090)** |

All jobs must pass before a PR can merge. See `plan.md` § CI Pipeline for the full workflow structure.

### Frontend API Configuration

Frontend apps default to `http://localhost:3000` for API calls. Override via environment variables:

- **Next.js (web)**: Set `NEXT_PUBLIC_API_URL` in `.env.local` or CI environment
- **Expo (mobile)**: Set `EXPO_PUBLIC_API_URL` in `.env` or EAS build environment

For E2E tests, the API URL is set automatically by the test `globalSetup` to point at the local test server.

---

## Domain Behavior Notes

A few behaviors are easy to trip over when poking at the local DB or hitting the API by hand:

### Soft-deleted recipes (tombstones)

`DELETE /api/v1/recipes/{id}` is a **soft delete**. The row stays in `recipes` with `deleted_at` set to the deletion timestamp. List, search, get-by-id, and collection responses all filter out tombstoned rows, but they remain visible in Drizzle Studio and via direct SQL.

If you need to inspect or reset state during development:

```sql
-- See tombstoned recipes
SELECT id, title, deleted_at FROM recipes WHERE deleted_at IS NOT NULL;

-- Un-tombstone for local debugging only (NEVER do this in prod)
UPDATE recipes SET deleted_at = NULL WHERE id = '<uuid>';
```

Hard deletion of recipe rows, version snapshots, photos, and S3-archived version blobs only happens via the GDPR erasure flow (`POST /api/v1/account/erasure`), which runs asynchronously.

### Cloned collections and pull-from-source

`POST /api/v1/collections/{id}/clone` creates a new collection whose `source_collection_id` points back to the original. Each membership row carries an `added_via` value:

- `manual` — direct add via `POST /api/v1/collections/{id}/recipes`
- `clone` — copied during the initial clone
- `pull` — added later via `POST /api/v1/collections/{id}/pull-from-source`

Pulls are additive only: recipes removed from the source after the clone are **not** removed from the clone. Removing a recipe from the source collection has no effect on existing clones.

### Pending version archives

Version snapshots are written synchronously to PostgreSQL but archived to S3 asynchronously. Rows in `recipe_version_pending_archives` remain the source of truth until the archive worker confirms the upload. When debugging "missing" S3 objects locally, check that table first — the LocalStack worker may simply not have run yet.

### Account erasure (local)

`POST /api/v1/account/erasure` queues an async job that hard-deletes everything owned by the calling user, including tombstoned recipes and all S3 objects. Locally this runs against LocalStack and the dev Postgres — re-seed afterward with `npm run seed --workspace=packages/shared/db` if you want the test fixtures back.
