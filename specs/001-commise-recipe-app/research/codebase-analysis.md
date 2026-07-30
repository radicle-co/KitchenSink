# Codebase Analysis: Commise Recipe App

**Branch**: `001-commise-recipe-app` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [data-model.md](../data-model.md), root `package.json`, `turbo.json`

---

## Monorepo Layout

KitchenSink is a **Turborepo + npm workspaces** monorepo. Root `package.json` defines four workspace globs:

```json
"workspaces": [
    "packages/tools/*",
    "packages/apps/commise/web",
    "packages/apps/commise/mobile",
    "packages/ui"
]
```

**Turbo tasks** (from `turbo.json`):

- `build` — depends on `^build` (upstream must build first), outputs `dist/**`
- `test` — no outputs
- `lint` — no outputs
- `typecheck` — depends on `^build`
- `format` / `format:check` — no outputs

**Node version**: `>=24.0.0` (per `package.json` engines). TypeScript 5.x.

---

## Existing Workspaces

### `packages/tools/*`

Glob for tooling packages under `packages/tools/`. Expected to contain shared build scripts, code generators, or deployment utilities. No constraints on what lands here — conventions: TypeScript strict, no `as any`.

### `packages/apps/commise/web`

The Next.js 15 web application workspace. This is the primary frontend. [plan.md](../plan.md) specifies:

- Next.js 15 App Router
- `@clerk/nextjs` for authentication
- Server-side rendering for SEO-sensitive recipe pages

### `packages/apps/commise/mobile`

The Expo 53 / React Native mobile application. [plan.md](../plan.md) specifies:

- Expo 53+
- `@clerk/expo` for authentication
- `expo-secure-store` for token storage

### `packages/ui`

Shared UI component library. Consumed by both web and mobile workspaces. Should contain design system primitives, recipe-specific components used across platforms. Built separately so both apps can depend on the same UI package.

---

## New Workspaces Required

Based on [plan.md](../plan.md) Section "Where this fits":

| New Workspace                         | Purpose                        | Location                              |
| ------------------------------------- | ------------------------------ | ------------------------------------- |
| `packages/apps/commise/api`           | NestJS backend on Fargate      | `packages/apps/commise/api`           |
| `packages/apps/commise/lambda-photos` | Lambda photo processor (Sharp) | `packages/apps/commise/lambda-photos` |

**Existing workspaces that will depend on new ones**:

- `web` → `api` (REST client calls)
- `mobile` → `api` (REST client calls)
- `api` → S3, SQS, RDS (AWS SDK calls)

---

## Conventions

### TypeScript

- Strict mode enabled (implied by AGENTS.md conventions)
- No `as any` — use proper typing or `unknown` with guard
- ESLint with `eslint-plugin-import-x`

### Code Style

- ESLint + Prettier (format on save / pre-commit hook via lint-staged)
- `husky` pre-commit hooks (commitlint)

### Testing Strategy

TBD — no test framework declared in root. [plan.md](../plan.md) does not document test strategy. Implementation will need to adopt Vitest (React/Node) or Jest. This is a gap to fill before Phase 6 implementation.

**Expected pattern**: Each workspace defines its own `test` script; Turbo runs them in parallel via `turbo run test`.

### Environment Management

- `@nestjs/config` with Zod for env validation
- Auth: Clerk for both web and mobile (separate SDKs per platform)
- AWS: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sqs`

---

## Data Model Summary

[data-model.md](../data-model.md) establishes:

- **RDS PostgreSQL 16** with `db.t4g.small` (~$25/mo)
- Extensions: `pg_trgm` (fuzzy search), `pgcrypto` (UUID generation)
- `tsvector` generated column with GIN index for FTS
- `JSONB` for recipe version snapshots and flexible metadata
- Own logical database `kitchensink_recipes` on the shared RDS instance for production; per-PR isolation is a per-PR **logical database** (`kitchensink_recipes` cloned per PR, [ADR-0006](../../../docs/architecture/decisions/0006-per-pr-feature-deploys-base-stage-and-logical-db.md)), **not** a per-PR Postgres schema
- Tables: `recipes`, `ingredients`, `recipe_ingredients`, `recipe_steps`, `recipe_photos`, `recipe_versions`, `collections`, `recipe_collections`, `recipe_version_pending_archives`, `account_erasure_jobs` (no local `users` table — the recipe schema does not own users; D2)

**Key versioning pattern** (from [plan.md](../plan.md) FR-007b-i):

- Recipe save succeeds independently of S3 archive write
- Version snapshot DB row is source of truth
- S3 archive enqueued async via SQS with retry + DLQ
- `recipe_version_pending_archives` table tracks retry state

---

## Auth Architecture

- **Web**: `@clerk/nextjs` (Next.js App Router integration)
- **Mobile**: `@clerk/expo` + `expo-secure-store`
- Both use Clerk as the identity provider
- API verifies the Clerk session token networklessly via `@clerk/backend` `verifyToken` using the public `CLERK_JWT_KEY`, with `azp` enforced from `CLERK_AUTHORIZED_PARTIES`

---

## Infrastructure

Per [plan.md](../plan.md):

- **Compute**: NestJS on AWS Fargate (ECS), NOT Lambda
- **Database**: RDS PostgreSQL 16
- **Storage**: S3 + CloudFront CDN for photo objects and version archives
- **Queue**: SQS for version-archive queue + DLQ
- **IaC**: CDK v2 (`aws-cdk-lib`)
- **Photo processing**: Lambda + Sharp (resize, WebP convert, multi-size generation)

---

## Workspace Dependency Graph

```
packages/ui (shared components)
    ↑
    ├── packages/apps/commise/web (Next.js 15)
    │       └── packages/apps/commise/api (NestJS REST)
    │              ├── packages/apps/commise/lambda-photos
    │              └── AWS (S3, SQS, RDS)
    │
    └── packages/apps/commise/mobile (Expo 53)
            └── packages/apps/commise/api (NestJS REST)
```

---

## Gaps and Pending Decisions

| Gap                             | Status                                            |
| ------------------------------- | ------------------------------------------------- |
| Test framework (Vitest vs Jest) | TBD — no existing test config in root             |
| E2E testing approach            | TBD — Playwright not yet referenced               |
| Mobile API client library       | TBD — likely `fetch` or `axios`                   |
| CI/CD pipeline specifics        | TBD — GitHub Actions config not yet created       |
| CDK stack structure             | TBD — `cdk.json` or `cdk.out/` not yet referenced |

---

## Source File References

- [plan.md](../plan.md) — full tech stack, new workspaces, architectural decisions
- [data-model.md](../data-model.md) — schema, indexes, versioning patterns
- [research.md](../research.md) — RQ-1 through RQ-9 research synthesis
- Root `package.json` — workspaces, Node version, scripts
- Root `turbo.json` — task pipeline
