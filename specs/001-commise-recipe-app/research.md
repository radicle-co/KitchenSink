# Phase 0 Research: Commise Recipe Management Core

**Branch**: `001-commise-recipe-app` | **Date**: 2026-04-18
**Spec**: [spec.md](./spec.md) | **Status**: Complete

> **⚠️ SUPERSEDED (Phase-0 snapshot — routes/layout/package names frozen 2026-04-18).**
> This is a frozen research artifact; its illustrative identifiers were **not** updated when the design
> was finalized. Wherever this document shows the following, the **canonical** value (see spec.md, plan.md,
> data-model.md, and contracts/) governs — treat every such occurrence below as superseded history, not
> current guidance:
>
> - API route prefix `/api/v1/...` → **`/v1/...`** (e.g. `POST /api/v1/recipes/{id}/photos/...` → `POST /v1/recipes/{id}/photos/...`).
> - Service layout `apps/api/v1/*` (and generic `apps/api`) → **`packages/services/recipe-service`** (NestJS recipe service).
> - Shared-types package `@kitchensink/recipe-core` → **`@kitchensink/recipe-core`**.
>
> The technical findings (FTS, versioning, photo pipeline, framework/ORM choices) remain valid; only the
> naming/routing scaffolding above was renamed downstream.

## Research Questions

| #    | Question                                                                    | Status      |
| ---- | --------------------------------------------------------------------------- | ----------- |
| RQ-1 | PostgreSQL FTS performance at 100k–1M recipe scale (tsvector/tsquery + GIN) | ✅ Answered |
| RQ-2 | Database decision: RDS PostgreSQL over Aurora DSQL                          | ✅ Answered |
| RQ-3 | Recipe-specific search patterns (ingredient matching, faceted filtering)    | ✅ Answered |
| RQ-4 | Dedicated search engine comparison (Typesense / Meilisearch / OpenSearch)   | ✅ Answered |
| RQ-5 | Photo storage: S3 presigned upload, Lambda processing, CloudFront serving   | ✅ Answered |
| RQ-6 | Connection pool sizing for 10 k concurrent users                            | ✅ Answered |
| RQ-7 | Recipe versioning pattern (snapshot + 3-way merge + S3 archiving)           | ✅ Answered |
| RQ-8 | Backend framework decision (NestJS on Fargate, not Lambda)                  | ✅ Answered |
| RQ-9 | NestJS monorepo integration (Turborepo + shared packages)                   | ✅ Answered |

---

## RQ-1: PostgreSQL FTS Performance at Scale

### Benchmarks (2026 data)

| Dataset Size  | Query Type                   | Latency (p50) | Notes                            |
| ------------- | ---------------------------- | ------------- | -------------------------------- |
| 100 k rows    | tsvector GIN                 | 12 ms         | OneRuby.dev benchmark, GIN index |
| 500 k rows    | tsvector GIN                 | 28 ms         | OneRuby.dev benchmark            |
| 1 M rows      | tsvector GIN                 | 65 ms         | OneRuby.dev benchmark            |
| 138 M docs    | pg_textsearch BM25 (4-term)  | 40.6 ms p50   | Timescale 2026-03-31             |
| 4 M rows (HN) | ts_rank, common term ("ask") | 1 981 ms      | Without sampling optimization    |
| 4 M rows (HN) | ts_rank with 10 k sample CTE | 58 ms         | With sampling optimization       |

**Persistent tsvector improvement**: 283 ms → 2.4 ms (118× speedup via stored generated column + GIN index). Source: Daniela Baron, 2026-02-03.

**Concurrent throughput**: pg_textsearch at 198.7 TPS (81 ms avg) vs ParadeDB at 22.8 TPS (701 ms avg). Source: Timescale 2026-03-31.

### Ranking Trap

`ts_rank()` executes on every matching row — I/O bound on large result sets. Mitigation:

```sql
WITH ranked AS (
  SELECT id, ts_rank(search_vector, query) AS rank
  FROM recipes
  WHERE search_vector @@ query
  LIMIT 10000  -- sample, not full scan
)
SELECT * FROM ranked ORDER BY rank DESC LIMIT 20;
```

This converts 1 981 ms → 58 ms on 4 M row datasets.

### Decision

**PostgreSQL FTS is viable** for the recipe app at projected scale (< 5 M recipes initially). Persistent tsvector + GIN + rank sampling is the recommended starting architecture. **Load testing is required** to validate p95 latency targets under real concurrent load with auth filters, joins, and faceting — the cited benchmarks (OneRuby.dev, Daniela Baron, Timescale) validate the pattern and provide credible reference points, but none reproduces our exact workload.

---

## RQ-2: Database Decision — RDS PostgreSQL over Aurora DSQL

### Aurora DSQL Blockers (Why NOT Aurora DSQL)

| Feature                      | Aurora DSQL Status     | Impact on Spec 001                                                                      |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `CREATE EXTENSION` (pg_trgm) | ❌ NOT supported       | Cannot do fuzzy ingredient search / autocomplete                                        |
| GIN indexes on custom types  | ❌ NOT supported       | Full-text search requires sequential scans at 330k+ rows                                |
| JSONB type                   | ⚠️ Partial (JSON only) | JSON supported, but JSONB (binary) not available; trade-off acceptable for spec         |
| Triggers                     | ❌ NOT supported       | Cannot auto-maintain `search_vector` tsvector on row change                             |
| Materialized views           | ❌ NOT supported       | Ordinary views supported, but not materialized views for search optimization            |
| Transaction row limit        | ⚠️ 3,000–10,000 rows   | Bulk operations (version archival, ingredient import) require chunking with retry logic |

Source: [docs/architecture/usda/05-event-driven-queue-based.md](../../docs/architecture/usda/05-event-driven-queue-based.md) lines 956–975.

### RDS PostgreSQL Advantages

| Feature                  | RDS PostgreSQL Status  | Benefit                                                                                  |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| `pg_trgm` extension      | ✅ Full support        | Fuzzy search + trigram-based autocomplete on ingredients                                 |
| GIN indexes              | ✅ Full support        | Fast tsvector + array containment queries                                                |
| JSONB                    | ✅ Full support        | Flexible recipe version snapshots, user-entered nutrition data                           |
| Triggers                 | ✅ Full support        | Auto-maintain `search_vector` on recipe write — no application-layer tsvector management |
| Materialized views       | ✅ Full support        | Pre-computed search facets if needed                                                     |
| No transaction row limit | ✅                     | Bulk operations work natively                                                            |
| Read replicas            | ✅                     | Cross-region read replicas for multi-region expansion                                    |
| Cost                     | `db.t4g.small` ~$25/mo | Lean launch viable; vertical scale to `db.t4g.medium` ~$50/mo                            |

### Decision

**Use RDS PostgreSQL.** Aurora DSQL's limitations are blocking for spec 001's search and versioning requirements. RDS PostgreSQL provides full extension support, triggers, JSONB, and a clear path to Aurora PostgreSQL Global Database for future multi-region active-active if needed.

### Per-PR Schema Isolation (Constitution V)

Schema naming: `pr_<number>`. Tear down on PR close. CDK manages RDS instance; pipelines do not provision databases directly.

---

## RQ-3: Recipe-Specific Search Patterns

### Multi-Field Weighted tsvector

```sql
-- Weight: title (A) > description (B) > ingredients (C)
UPDATE recipes SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(ingredient_names_text, '')), 'C');
```

With `ts_rank_cd` for cover density ranking on weighted vectors.

### Faceted Filtering

Facets (cuisine, dietary, tags) MUST be separate columnar fields — NOT embedded in tsvector — to enable efficient indexed filtering:

```sql
WHERE search_vector @@ plainto_tsquery('english', $1)
  AND cuisine = $2
  AND $3 = ANY(dietary_flags)
  AND tags && $4::text[]
```

### Ingredient Matching

Ingredients are a separate normalized table. For "recipes containing chicken + garlic":

```sql
SELECT DISTINCT recipe_id FROM recipe_ingredients
WHERE ingredient_id IN (
  SELECT id FROM ingredients WHERE search_vector @@ plainto_tsquery('chicken')
)
GROUP BY recipe_id HAVING count(*) >= 2;
```

### Autocomplete

Use `ts_stat()` on the ingredients tsvector column to build a lexeme frequency table for autocomplete suggestions.

---

## RQ-4: Dedicated Search Engine Comparison

| Engine         | Expected Latency | Typo Tolerance   | Faceting         | Notes                                             |
| -------------- | ---------------- | ---------------- | ---------------- | ------------------------------------------------- |
| PostgreSQL FTS | ~28–65 ms (p50)  | Manual (pg_trgm) | Via SQL          | No extension support on Aurora DSQL               |
| **Typesense**  | ~3–12 ms (p50)   | Built-in         | Built-in         | Self-host; REST API; recommended migration target |
| Meilisearch    | ~5–40 ms (p50)   | Built-in         | Built-in         | Schemaless; strong DX                             |
| OpenSearch     | ~8–80 ms (p50)   | Via analyzer     | Via aggregations | Best for complex aggregations                     |

### Decision

**Start with PostgreSQL FTS.** Recipe search is secondary to CRUD at launch. Latency figures are reference benchmarks (Typesense ~3 ms p50 on 2.2M docs from public recipe test; PostgreSQL ~28–65 ms p50 on 100k–1M rows per OneRuby.dev benchmarks) — treat as directional, not guaranteed SLA. Add Typesense if:

- Typo tolerance becomes a P1 UX requirement
- p95 exceeds 400 ms under real load testing
- Search query complexity grows (e.g., semantic/vector search for 005-ai-integration)

Typesense is the recommended migration target if needed — lowest operational overhead, 3 ms p50.

---

## RQ-5: Photo Storage Architecture

### Upload Flow (presigned URL pattern)

```
Client → POST /api/v1/recipes/{id}/photos/upload-url
       ← { url: "https://s3.../key?X-Amz-Signature=...", key: "..." }
Client → PUT {url} (direct S3, never touches API server)
Client → POST /api/v1/recipes/{id}/photos/confirm { key }
```

Presigned URL expiry: **15 minutes** (upload window). Generated by Lambda with `@aws-sdk/client-s3` `PutObjectCommand` + `getSignedUrl`.

### Processing Pipeline

```
S3 PUT event → EventBridge → Lambda (Sharp)
                              ├── 150×150  (thumbnail)
                              ├── 400×400  (card)
                              └── 1200×1200 (full)
                              → store output keys in DB
                              → delete original (optional, after processing)
```

Lambda configuration:

- Runtime: Node.js 22.x
- Memory: **1 536 MB** (image processing is CPU-bound; Sharp benefits from memory)
- Timeout: 30 s
- Sharp layer or bundled (esbuild `--bundle --platform=node`)

### Serving (CloudFront)

```
CloudFront distribution
├── Origin: S3 (private bucket, OAC)
├── Cache: max-age=31 536 000 (1 year, content-addressed keys)
├── Compress: gzip + Brotli enabled
└── Signed URLs for private recipes (premium users)
```

Image keys are **content-addressed** (`sha256(original):size.webp`) for cache immutability.

### Constraints (from spec FR-001)

- Max 10 photos per recipe
- Max 5 MB per image (enforced by presigned URL `Content-Length-Range` condition)

---

## RQ-6: Connection Pool Sizing

### Formula

```
pool_size = (vCPU_count × 2) + effective_spindle_count
```

For Aurora DSQL (serverless distributed):

- Writer: start with **pool_size = 20**, observe `pg_stat_activity`
- Maintain < 70 % utilization at peak: plan for 28+ connections headroom
- PgBouncer mode: **transaction pooling** (compatible with Aurora DSQL, stateless queries)

### 10 k Concurrent Users

10 k concurrent users ≠ 10 k concurrent DB connections. Typical web/API ratio:

- 1 request = 1 DB connection for ~5–50 ms
- At 500 ms p95 budget: max inflight DB queries = 10 000 × (50 ms / 500 ms) = ~1 000 at extreme concurrency
- Realistically with query < 10 ms: pool of **50–100 connections** handles 10 k users

PgBouncer pool recommendation:

```ini
pool_size = 50          ; connections to Aurora DSQL
max_client_conn = 500   ; API server connections to PgBouncer
pool_mode = transaction
```

---

## RQ-7: Recipe Versioning Pattern

### Pattern: Snapshot Versioning (not Event Sourcing)

Event sourcing rejected — recipes are edited holistically (replace full content), not via incremental commands. Snapshot versioning is simpler, sufficient, and proven at recipe scale.

### Schema Design

```sql
-- recipe_versions table: stores full recipe content per version
CREATE TABLE recipe_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content JSONB NOT NULL,            -- full recipe snapshot (title, description, ingredients, instructions)
  base_version INTEGER,              -- enables 3-way merge conflict detection
  author_id UUID NOT NULL,           -- who made this edit
  change_summary TEXT,               -- optional: what changed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, version_number)
);
```

### Optimistic Concurrency Control

Prevent concurrent edit conflicts at DB layer:

```sql
UPDATE recipes
SET version_count = version_count + 1, updated_at = now()
WHERE id = $1 AND version_count = $expected_version
RETURNING version_count;
-- If 0 rows returned → conflict detected → fetch latest and present 3-way merge UI
```

### 3-Way Merge Conflict Resolution

When two users edit the same recipe version concurrently:

1. Detect: `WHERE version_count = expected` returns 0 rows
2. Fetch: base version (what both started from), local changes, remote changes (current HEAD)
3. Auto-merge: fields edited by only one party merge automatically
4. Manual: fields edited by both parties → present UI chooser (field-level, not line-level)

### S3 Archival Strategy

- **DB**: Last 10 versions stored in `recipe_versions` table (queryable, restorable via API)
- **S3**: All versions archived indefinitely at `recipes/{recipe_id}/v{padded_number}.json`
- **Lifecycle**: STANDARD → STANDARD_IA (30 days) → GLACIER_IR (90 days)
- **Retrieval**: Versions < 90 days old: instant. Older versions: GLACIER_IR retrieval (minutes, not hours — not DEEP_ARCHIVE)

### Decision

Snapshot versioning with optimistic concurrency + 3-way merge at field granularity. Simple, proven, no event stream complexity. JSONB storage for version content (enabled by RDS PostgreSQL — would not work on Aurora DSQL).

---

## RQ-8: Backend Framework Decision

### Decision: NestJS on Fargate (not Lambda)

User directive: "backend services should use nestjs unless it doesn't make architectural sense" and "nestjs should be hosted on fargate, not lambda."

### Why NestJS is Architecturally Appropriate for Spec 001

- **CRUD-heavy**: 7 resource modules (recipes, ingredients, versions, photos, collections, search, auth) — NestJS module/controller/service pattern is purpose-built for this
- **DI container**: Clean dependency injection for service → DAL → DB layering
- **Validation**: `class-validator` decorators on DTOs provide declarative input validation
- **Middleware**: Clerk session-token verification via a NestJS `AuthMiddleware` (Bearer token, networkless via `@clerk/backend` `verifyToken` + `CLERK_JWT_KEY`) — cleaner than raw Lambda authorizer wrappers
- **Monorepo fit**: NestJS modules import shared `@kitchensink/recipe-core` types cleanly via workspace deps

### Why Fargate over Lambda

| Dimension                 | Lambda (NestJS)                           | Fargate (NestJS)                        |
| ------------------------- | ----------------------------------------- | --------------------------------------- |
| Cold start                | 500–1,500 ms (DI container init)          | Zero (long-lived container)             |
| Warm latency              | 20–80 ms                                  | 20–80 ms (equivalent)                   |
| INIT billing (Aug 2025)   | ⚠️ Charged for DI startup                 | N/A                                     |
| Scale to zero             | ✅ Yes                                    | ❌ No (min 1 task ~$16/mo)              |
| DB connections            | Needs RDS Proxy (pool exhaustion risk)    | Direct pooling via Drizzle `pg.Pool`    |
| WebSockets (future)       | ❌ Not natively                           | ✅ Yes                                  |
| Local dev parity          | Requires SAM/serverless-offline           | `docker-compose up` = production parity |
| Cost at projected traffic | ~$50–65/mo (with provisioned concurrency) | ~$25–40/mo (Fargate Spot available)     |

**Cost crossover**: Lambda cheaper below ~50k req/day (scale-to-zero). Above ~50k req/day, Fargate wins. At spec 001's projected "lean launch" traffic, both are equivalent cost — but Fargate eliminates cold start variance entirely.

### Cold Start Evidence (Node.js 22, 2026 benchmarks)

| Bundle Size                   | Memory  | P50 Init   | P99 Init     |
| ----------------------------- | ------- | ---------- | ------------ |
| 0.5 MB (minimal)              | 512 MB  | 180 ms     | 280 ms       |
| 4–8 MB (NestJS esbuild)       | 1024 MB | 500–800 ms | 950–1,500 ms |
| Any (provisioned concurrency) | Any     | <10 ms     | <20 ms       |

Source: viprasol.com cold start benchmarks (2026-04-06), dcdhameliya.com cross-architecture measurements (2025-11-11).

### ORM Choice: Drizzle (not Prisma, not TypeORM)

| ORM         | Cold Start Overhead | Lambda Impact                    | Fargate Impact        |
| ----------- | ------------------- | -------------------------------- | --------------------- |
| **Drizzle** | **<10 ms**          | Minimal                          | Negligible            |
| TypeORM     | ~50–100 ms          | Moderate                         | Negligible            |
| Prisma      | 300–800 ms          | **Severe** (Rust engine sidecar) | Minor (one-time init) |

Drizzle selected for: lightweight, TypeScript-first, no code generation step, compatible with both Lambda (photo processor) and Fargate (API).

### Deployment Portability

AWS Lambda Web Adapter (v1.0.0, March 2026) enables the **same Docker image** to deploy to both Lambda and Fargate with zero code changes. `main.ts` runs a standard HTTP server; the adapter handles Lambda event translation. This preserves optionality to move hot paths to Lambda or vice versa.

---

## RQ-9: NestJS Monorepo Integration

### Turborepo + npm Workspaces Pattern

Evidence from `vndevteam/nestjs-turbo` (production monorepo) and `robertlinde/next-nest-turbo-boilerplate`.

### Two-Tier Type Sharing (No Decorator Pollution)

**Tier 1 — `@kitchensink/recipe-core` (pure TS, NO NestJS deps)**:

- Plain TypeScript interfaces + Zod schemas
- Consumed by Web (Next.js), Mobile (Expo), and API (NestJS)
- Must compile to CommonJS (`main: ./dist/index.js`) for NestJS `tsc` compatibility
- Zero NestJS dependencies — no `class-validator`, no `reflect-metadata`

**Tier 2 — NestJS DTOs (inside `apps/api` or `packages/nest-common`)**:

- `class-validator` decorated DTOs that `implements` the pure interfaces from Tier 1
- Consumed only by the NestJS API — never imported by Web or Mobile
- Example: `CreateRecipeDto implements CreateRecipeInput` with `@IsString()`, `@MaxLength(255)` decorators

### Critical: CommonJS Requirement

NestJS uses `tsc` which cannot consume raw TypeScript from `node_modules`. All shared packages must:

1. Have a `build` script that compiles to JS
2. Set `main: ./dist/index.js` in `package.json`
3. Use `turbo.json` `^build` dependency to ensure packages compile before NestJS dev server starts

```json
// turbo.json
{
    "tasks": {
        "build": { "dependsOn": ["^build"] },
        "dev": { "dependsOn": ["^build"], "cache": false, "persistent": true }
    }
}
```

### NestJS Module Structure

Single NestJS app with 7 resource modules (flat imports in `AppModule`):

```typescript
@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DbModule, // @Global() Drizzle provider (DB_TOKEN)
        AuthModule, // Clerk session-token AuthMiddleware
        RecipesModule, // CRUD
        IngredientsModule, // DB-backed + freeform
        VersionsModule, // Snapshot versioning + 3-way merge
        PhotosModule, // Presigned URL generation + metadata
        CollectionsModule, // User recipe collections
        SearchModule, // FTS + faceted filtering
    ],
})
export class AppModule {}
```

Each module is fully self-contained: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.

### Drizzle Integration Pattern

`@Global()` module with lazy connection proxy:

```typescript
// apps/api/v1/src/db/db.module.ts
export const DB_TOKEN = Symbol('DRIZZLE_DB');

@Global()
@Module({
    providers: [
        {
            provide: DB_TOKEN,
            useFactory: () => {
                const pool = new Pool({ connectionString: process.env.DATABASE_URL });
                return drizzle(pool, { schema });
            },
        },
    ],
    exports: [DB_TOKEN],
})
export class DbModule {}
```

Services inject via `@Inject(DB_TOKEN) private db: DrizzleDB`.

### CDK Deployment (Fargate)

Multi-stage Dockerfile at `apps/api/v1/Dockerfile`:

1. Builder stage: `npm ci --workspace=apps/api` from monorepo root context
2. Runtime stage: copy `dist/` + `node_modules`, expose port 3000
3. CDK `ecs.ContainerImage.fromAsset()` builds from monorepo root with `file: apps/api/v1/Dockerfile`

**esbuild gotcha** (CDK issue #37545): `esbuild` must be declared in **root** `package.json` devDependencies for `NodejsFunction` to find it in npm workspaces.

---

## Sources

| Source                                  | Date       | Key Finding                                                |
| --------------------------------------- | ---------- | ---------------------------------------------------------- |
| Timescale pg_textsearch benchmarks      | 2026-03-31 | BM25 concurrent throughput: 198.7 TPS at 81 ms             |
| OneRuby.dev PostgreSQL FTS scaling      | 2026-01-14 | 100 k=12 ms, 500 k=28 ms, 1 M=65 ms with GIN               |
| Daniela Baron persistent tsvector       | 2026-02-03 | 283 ms → 2.4 ms (118×) with stored generated column        |
| Péter Csoór ranking optimization        | 2025-05-14 | Sampling CTE: 1 981 ms → 58 ms on 4 M rows                 |
| Instacart Elasticsearch → PostgreSQL    | 2025-05-29 | Production migration case study                            |
| AWS Lambda image processing guide       | 2026-02-12 | Sharp, S3 events, CloudFront OAC                           |
| USDA architecture doc (Option #5)       | 2026-04    | Aurora DSQL blockers: no pg_trgm, no GIN, 3k row limit     |
| viprasol.com cold start benchmarks      | 2026-04-06 | Node 22 Lambda: 180 ms (0.5 MB) to 950 ms (5 MB)           |
| dcdhameliya.com cross-arch measurements | 2025-11-11 | Bundle size → cold start: ~50–60 ms per MB                 |
| CGIAR NestJS Lambda deployment          | 2026       | esbuild: 80 MB → 4–8 MB; production cold start data        |
| vndevteam/nestjs-turbo                  | 2026       | NestJS monorepo: nest-common package, CommonJS requirement |
| robertlinde/next-nest-turbo-boilerplate | 2026       | Turborepo + NestJS + Next.js workspace pattern             |
| aolus-software/clean-nest-drizzle-pg    | 2026       | Drizzle + NestJS: Global DB module, DB_TOKEN injection     |

---

## Conclusion and Recommendation

**Use PostgreSQL FTS (tsvector/tsquery + GIN) at launch.** Aurora DSQL constraints eliminate extension-based enhancements but standard built-ins are sufficient for recipe search at projected scale (< 1 M recipes). The p95 ≤ 500 ms target is achievable with:

1. Persistent `search_vector` stored generated column
2. GIN index on `search_vector`
3. Rank sampling CTE (LIMIT 10 000 before `ts_rank`)
4. Columnar facet fields (cuisine, dietary_flags, tags[])
5. PgBouncer transaction pooling (pool_size = 50, max_client_conn = 500)

Add Typesense if typo tolerance becomes P1 or p95 exceeds 400 ms in load testing.
