# Tech Stack Rationale

**Branch**: `001-commise-recipe-app` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [research.md](../research.md)

---

## Overview

The tech stack for Commise is derived from RQ-1 through RQ-9 in [research.md](../research.md) and the implementation decisions documented in [plan.md](../plan.md). Each section below captures: the chosen technology, the rationale from research, documented trade-offs, and how it maps to the monorepo structure.

---

## Backend: NestJS 11 on AWS Fargate (ECS)

### Choice

**NestJS 11 on AWS Fargate (ECS)** — NOT Lambda for the main API.

### Rationale

- [research.md](../research.md) RQ-8: "NestJS on Fargate, not Lambda" — the API handles connection-oriented workloads (RDS PostgreSQL), benefits from persistent memory (warm container reuse), and avoids Lambda cold start latency on recipe save operations.
- Recipe save must not block on S3 archive (FR-007b-i per [plan.md](../plan.md)). With Fargate, the NestJS process stays warm between requests, keeping connection pools hot and avoiding cold-start overhead on every save.
- Fargate scales horizontally without the stateless constraint of Lambda, which suits the long-lived WebSocket connections for collaborative editing if added later.

### Trade-offs

| Trade-off                                             | Mitigated By                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Cold start on first request after idle (Fargate ~30s) | Fargate warm container reuse — only cold after deployment or scale-to-zero event. Not user-facing for recipe apps (low traffic spikes). |
| No auto-scale to zero                                 | Cost trade-off: Fargate minimum 1 task = $0.0408/vCPU-hr (us-east-1). Lambda would scale to zero but carry cold-start penalty.          |
| Connection pool management                            | NestJS with `pg` driver + careful pool sizing (50–100 connections per [plan.md](../plan.md))                                            |

### Workspace Location

`packages/apps/commise/api`

---

## Database: RDS PostgreSQL 16

### Choice

**RDS PostgreSQL 16** with extensions `pg_trgm`, `pgcrypto`, `uuid-ossp`.

### Rationale

- [research.md](../research.md) RQ-2: "Database decision: RDS PostgreSQL over Aurora DSQL" — RDS was chosen for: proven tsvector GIN FTS performance (12ms at 100k rows, 65ms at 1M rows per benchmarks), JSONB for version snapshots, simpler operational model for a small team.
- Per [plan.md](../plan.md): `db.t4g.small` (~**$25/mo launch**) — cost-constrained design.
- tsvector stored generated column maintained by PostgreSQL trigger (not application layer) — [research.md](../research.md) RQ-1 benchmarks show 118x speedup (283ms → 2.4ms) with GIN index.

### Search Architecture

- Primary: PostgreSQL tsvector GIN with `ts_rank` + headline (per [research.md](../research.md) RQ-1)
- Fallback trigger: If p95 search > 400ms, swap to Typesense (per [plan.md](../plan.md) Section: Performance Goals)
- Ingredient matching: `pg_trgm` GIN index for fuzzy string matching (e.g., "pasta" matches "pasta rigate")

### Trade-offs

| Trade-off                                                     | Mitigated By                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full-text search vs. dedicated engine (Typesense/Meilisearch) | pg_trgm + tsvector is sufficient at launch scale (< 5M recipes). Dedicated engine adds operational complexity. Fallback documented in [plan.md](../plan.md). |
| Connection pool (50–100 max on `db.t4g.small`)                | Fargate tasks are long-lived (pool reuse); SQS async workers offload non-critical DB writes                                                                  |

### Schema Notes

Per [data-model.md](../data-model.md):

- `public` schema for production; `pr_<number>` per-PR isolation
- JSONB for recipe version snapshots
- GIN indexes on `tsvector`, `text[]`, `JSONB`

---

## Storage: S3 + CloudFront + Lambda Sharp

### Choice

**S3** for photo objects and version archives; **CloudFront** CDN for serving; **Lambda + Sharp** for photo processing.

### Rationale

- [research.md](../research.md) RQ-5: "Photo storage: S3 presigned upload, Lambda processing, CloudFront serving"
- Presigned S3 URL pattern: browser uploads directly to S3 (no server relay), Lambda triggered on S3 object creation, processed images served via CloudFront.
- Sharp processes photos into 4 sizes: thumbnail (200x200), card (400x300), full (1200x900), OG image (1200x630) + WebP conversion.
- Version archives (JSONB snapshots) also go to S3 (per [research.md](../research.md) RQ-7), with SQS-driven async write.

### Photo Pipeline

1. Browser requests presigned URL from `POST /recipes/:id/photos/presign`
2. Browser uploads directly to S3 `photos/{recipe_id}/{photo_id}.{ext}`
3. S3 event triggers Lambda `sharp-processor`
4. Lambda generates 4 sizes + WebP; writes to `photos/{recipe_id}/processed/`
5. CloudFront serves processed images with `Cache-Control: public, max-age=31536000`

### Trade-offs

| Trade-off                                                   | Mitigated By                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Direct browser-to-S3 upload requires presigned URL per file | Per [plan.md](../plan.md) FR-001a: each file gets its own presigned URL; server validates presence after upload |
| Lambda cold start for photo processing                      | Cold start is non-blocking — user sees "Processing..." state; Lambda is async, not on the critical save path    |
| S3 cost for 5M photos at ~500KB each                        | ~2.5 TB; S3 Standard is ~$0.023/GB = ~$57/mo. Manageable at launch. Transition to S3 IA after 90 days.          |

### Workspace Location

`packages/apps/commise/lambda-photos` (Lambda function code).

---

## Queue: SQS (version-archive queue + DLQ)

### Choice

**Amazon SQS** for the version-archive queue and its dead-letter queue.

### Rationale

- [research.md](../research.md) RQ-7: "Recipe versioning pattern (snapshot + 3-way merge + S3 archiving)" — SQS decouples recipe save from S3 archive write.
- Per [plan.md](../plan.md) FR-007b-i: recipe save succeeds independently of S3 archive. SQS enqueues the archive task. `recipe_version_pending_archives` table tracks retry state.
- SQS is fully managed — no operational overhead for a small team.

### Architecture

- **Queue**: `commise-version-archive` (standard queue)
- **DLQ**: `commise-version-archive-dlq` (receives failed messages after 3 retries)
- **Consumer**: Lambda or Fargate-scheduled task polls queue; writes archive JSONB to S3
- **Pending archive table**: `recipe_version_pending_archives` — rows deleted only after S3 confirms write

### Trade-offs

| Trade-off                                          | Mitigated By                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| SQS is eventually consistent (not guaranteed FIFO) | Version archive is idempotent; ordering doesn't matter for archival                       |
| SQS polling cost                                   | Lambda triggered by SQS is cost-free for queue polling; only Lambda execution time billed |

---

## Auth: Clerk

### Choice

**Clerk** as the identity provider for both web and mobile.

### Rationale

- Per [plan.md](../plan.md): `@clerk/nextjs` (web), `@clerk/expo` (mobile)
- Clerk handles sign-in/sign-up, session-token issuance, and user management via its hosted UI
- Web: Next.js App Router integration via `@clerk/nextjs` (`<ClerkProvider>`, `middleware.ts`)
- Mobile: Expo 53 + React Native with `@clerk/expo` + `expo-secure-store`
- API verifies the Clerk session token networklessly via `@clerk/backend` `verifyToken` using the public `CLERK_JWT_KEY`, enforcing authorized parties (`azp`) from `CLERK_AUTHORIZED_PARTIES` — no client secret, no audience check, no JWKS round trip

### Trade-offs

| Trade-off                                       | Mitigated By                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Clerk is a third-party SaaS (availability risk) | Clerk SLA is 99.99%; fallback to hosted UI with retry               |
| Clerk pricing at scale                          | Free up to 10,000 MAU; usage-based beyond (reasonable until growth) |

---

## Frontend Web: Next.js 15 App Router

### Choice

**Next.js 15** with App Router.

### Rationale

- Per [plan.md](../plan.md): Next.js 15 for the web application
- SSR for SEO-sensitive recipe pages (metadata, structured data)
- React Server Components reduce client-side JS bundle
- `app/` directory pattern for route-based code splitting

### Trade-offs

| Trade-off                               | Mitigated By                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Next.js complexity vs. Vite/React       | App Router is the current standard; team has prior Next.js experience (implied by spec)               |
| Server components vs. client components | Clear split: recipe pages are server; interactive forms (edit, search) are client with `'use client'` |

### Workspace Location

`packages/apps/commise/web`

---

## Frontend Mobile: Expo 53 / React Native

### Choice

**Expo 53** with React Native.

### Rationale

- Per [plan.md](../plan.md): Expo 53+ for mobile
- Expo avoids native module complexity for S3 upload, camera, notifications
- `expo-secure-store` for token storage
- `@clerk/expo` for authentication

### Trade-offs

| Trade-off                                                  | Mitigated By                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Expo SDK lag (may lag React Native latest by 1–2 releases) | Expo 53 confirmed compatible with `@clerk/expo` (per [plan.md](../plan.md))                                 |
| Limited native code access                                 | Most features (S3, camera, notifications) are available via Expo modules; custom native code only if needed |

### Workspace Location

`packages/apps/commise/mobile`

---

## ORM: Drizzle ORM

### Choice

**Drizzle ORM** with `pg` driver (node-postgres).

### Rationale

- Per [plan.md](../plan.md): Drizzle ORM
- Drizzle is lightweight, TypeScript-first, and has a schema-as-code approach (`.drizzle.ts` files)
- Compatible with PostgreSQL 16 and all PostgreSQL-specific features (tsvector, JSONB, GIN indexes)
- Migrations via Drizzle Kit

### Trade-offs

| Trade-off                                     | Mitigated By                                                 |
| --------------------------------------------- | ------------------------------------------------------------ |
| Drizzle is newer than Prisma (less community) | Active maintenance, type-safe SQL, no runtime overhead       |
| No built-in migration GUI                     | Drizzle Kit CLI for migrations; CI runs migrations on deploy |

---

## IaC: CDK v2

### Choice

**AWS CDK v2** (`aws-cdk-lib`).

### Rationale

- Per [plan.md](../plan.md): CDK v2
- Infrastructure as code for Fargate, Lambda, S3, SQS, CloudFront, RDS
- TypeScript (matches the rest of the stack)
- Existing pattern in the repo (referenced in AGENTS.md for 002-user-auth)

### Trade-offs

| Trade-off                                 | Mitigated By                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| CDK diff shows full stack on every deploy | Use stack separation (VPC stack, ECS stack, Lambda stack) to reduce diff noise |
| Requires AWS credentials                  | GitHub Actions OIDC role for CI/CD                                             |

---

## Research Question Mapping

| RQ   | Topic                           | Technology                                      | Source                        |
| ---- | ------------------------------- | ----------------------------------------------- | ----------------------------- |
| RQ-1 | PostgreSQL FTS performance      | tsvector GIN + pg_trgm                          | [research.md](../research.md) |
| RQ-2 | Database decision               | RDS PostgreSQL 16 over Aurora DSQL              | [research.md](../research.md) |
| RQ-3 | Recipe-specific search patterns | Ingredient matching via pg_trgm                 | [research.md](../research.md) |
| RQ-4 | Dedicated search engine         | Deferred — PostgreSQL first; Typesense fallback | [plan.md](../plan.md)         |
| RQ-5 | Photo storage pipeline          | S3 presigned URL + Lambda Sharp + CloudFront    | [research.md](../research.md) |
| RQ-6 | Connection pool sizing          | 50–100 connections (db.t4g.small)               | [plan.md](../plan.md)         |
| RQ-7 | Recipe versioning               | Snapshot + SQS async archive + S3               | [research.md](../research.md) |
| RQ-8 | Backend framework               | NestJS on Fargate (not Lambda)                  | [research.md](../research.md) |
| RQ-9 | NestJS monorepo                 | Turborepo + npm workspaces                      | [research.md](../research.md) |
