# Technical Plan: Feature 003 — Source-Agnostic Food Data Integration

**Feature**: `003-usda-food-data`
**Architecture**: Event-Driven Queue-Based (Postgres `fetch_queue` + LISTEN/NOTIFY + Fargate fan-out/merge worker + per-source rolling 60-min window limiter)
**Reference**: `docs/architecture/usda/05-event-driven-queue-based.md`; re-baseline `docs/brainstorms/2026-06-21-source-agnostic-food-data-model-requirements.md`
**Status**: Draft

> **Re-baseline note (2026-06-21).** This plan was re-baselined to the **source-agnostic food
> data model**, superseding the USDA-coupled Phase 1–2 design. A food is now keyed by an internal
> surrogate `id` (ULID-valued, named `id`), USDA is **one pluggable source adapter** among many,
> foods are assembled into a **cross-source golden record** with per-field provenance, and users add
> foods **by name** through a `PENDING → (UNRESOLVED) → RESOLVED` lifecycle (terminal `NOT_FOUND` /
> `FAILED`). All `fdcId` / `fetch_status` / denormalized-nutrient-column design is removed from the
> canonical model and confined to the USDA adapter boundary (`fdcId → external_key` inbound).
> The **infrastructure, auth (§2A), and queue/rate-limiter mechanics are preserved in intent** — only
> the keying changes from `fdcId` to the food `id` and the limiter generalizes from USDA-only to
> per-source. This is a clean replacement (no data to migrate), per spec A-014.

---

## 1. Architecture Overview

### System Context

```
External food sources (each rate-limited; USDA = 1,000 req/hr)
        ↑  (async, per-source rolling-60-min-window rate-limited)
        │   ── pluggable source adapters (USDA wired today; +N additive) ──
        │
Fargate consumer worker  ← LISTEN/NOTIFY ─┐
   fan-out by name across adapters →       │
   normalize → merge into golden record    │
   (per-source rolling 60-min window:       │
    ≤ each source's cap in any trailing     │
    60 min; USDA pause @ 90% = 900)         │
        ↓                                 │
PostgreSQL  (kitchensink_food on the shared kitchensink-data-{stage} instance)
  • food / food_sources / nutrient / food_nutrients /
    food_portions / food_field_provenance / food_category   (canonical store)
  • fetch_queue (Postgres-as-queue, keyed on food id) ──────┘ pg_notify('fetch_queued')
  • fetch_requesters / source_call_log
        ↑
ALB → ECS/Fargate NestJS service (FoodService)
   FoodAuthGuard (in-process Clerk verifyToken + azp)
        ↑
   Commise App (user token) / downstream services (M2M token) / Search UX

EventBridge (scheduled only): change-driven refresh schedule → enqueue;  FoodFetchCompleted completion
```

> Every entry point (incl. WebSocket `$connect`) is fronted by **`FoodAuthGuard`** (§2A) —
> networkless Clerk verification — before any DB/queue/source work. Fairness is enforced by
> **demotion** at queue drain time (no per-`sub` enqueue quota; §2A.4). Async producers
> (EventBridge/cron) are gated by least-privilege IAM (FR-048). **No source-specific term leaks
> past the adapter boundary** — `fdcId` exists only inside `@kitchensink/usda-client`.

### Data Flow

1. **Read path** (synchronous): ALB → ECS/Fargate NestJS service → PostgreSQL → response. `200` only
   when the food is `RESOLVED`; `202` when `PENDING`/`UNRESOLVED`; `404` when `NOT_FOUND`/`FAILED`/no
   row (status still retrievable). No source call (optional in-process LRU per §6).
2. **Add-by-name path** (async): `POST /v1/foods` → create canonical `food` row + `id` (dedup on
   normalized name under an advisory lock so concurrent adds collapse to one row) →
   `INSERT INTO fetch_queue (food_id) … ON CONFLICT` + `pg_notify('fetch_queued', id)` → `202` + `id`.
   The Fargate worker wakes (LISTEN/NOTIFY), drains by demand-weighted priority (demoting `sub`s with
    > 50 pending items to the back), **fans out across every wired adapter by name**, fetches from each
    > source that has the item (each call per-source rolling-window-limited), normalizes, and **merges
    > into the golden record** → sets `food.status` to `RESOLVED` / `UNRESOLVED` / `NOT_FOUND` / `FAILED`.
3. **Disambiguation path**: a fan-out with multiple non-collapsible candidates → `UNRESOLVED`;
   `GET /v1/foods/{id}/candidates` lists them; `PATCH /v1/foods/{id}` resolves from the user's pick
   (validated to that food's candidate set) → merge → `RESOLVED`.
4. **Bulk path**: multiple unknown names (recipe import) → one `food` row + `id` and one `fetch_queue`
   row per name (deduped via `ON CONFLICT`). The USDA adapter MAY internally batch its own source
   fetches (≤20 source keys / 1 windowed call) once it has resolved which USDA items to pull — an
   adapter-internal optimization invisible to the canonical API.
5. **Scheduled path**: an EventBridge schedule launches the change-driven refresh **Fargate scheduled
   task** (low-priority idle-drain that yields to live demand; cadence is budget-bounded, not a fixed
   promise). It re-enqueues affected foods via the ordinary `enqueue(food_id, 'svc_change_refresh')`
   path and re-pulls only fields whose originating external item changed upstream (FR-031/FR-032).

### Key Architecture Decision

Use Architecture 5 (Event-Driven Queue-Based) per user selection, **re-shaped to fan-out + golden-record
merge over a source-agnostic canonical model**. This treats each source's rate limit as a first-class
constraint, decouples data fetching from data serving, and makes adding a source additive (a new adapter,
no canonical-schema change). The single expensive-to-undo decision — a food's identity is our internal
`id`, never a source's native key — is made now (R1/FR-IDN-1); the golden-record/provenance machinery is
built now even though USDA is the only wired source, because the id/crosswalk foundation is the costly
part to change later (R-"golden record now").

### Package & Infrastructure Layout (locked 2026-06-19; re-baselined 2026-06-21)

| Package                            | Path                             | Role                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kitchensink/food-service`        | `packages/services/food-service` | Deployable NestJS service on **ECS/Fargate fronted by the single shared per-stage ALB** (owned by the global infra) via a **host-based listener rule** (priority 200) — not its own ALB — `/v1/foods/*` API + in-process `FoodAuthGuard`, the canonical Drizzle schema/DAOs, the source-adapter interface + fan-out/merge worker, and its **own CDK** (`infra/lib/`). |
| `@kitchensink/usda-client`         | `packages/clients/usda`          | The **USDA source adapter** — a typed wrapper over USDA FoodData Central implementing the common adapter interface. This is the **only** place `fdcId` and USDA terminology appear; it maps `fdcId → external_key` inbound (no DB/server).                                                                                                                            |
| `@kitchensink/food-service-client` | `packages/clients/food-service`  | Typed client for our `/v1/foods/*` API used by web/mobile + downstream (001/006/007/009 M2M callers). Exposes only canonical `id`-keyed shapes.                                                                                                                                                                                                                       |
| `@kitchensink/clerk-verify`        | `packages/shared/clerk-verify`   | Shared networkless Clerk verification, extracted from the identity service.                                                                                                                                                                                                                                                                                           |

**Database — reuse, no new RDS, no cluster.** The food tables live in a **separate logical
database `kitchensink_food`** on the **existing shared instance `kitchensink-data-{stage}`** (a
single `rds.DatabaseInstance`, db.t4g.small, owned by the global DataStack in
`packages/infra/global`). The `kitchensink_food` database + its least-privilege role/secret are
provisioned in that **global DataStack** (platform infra); `food-service` `Fn.importValue`s the
shared DB exports and runs its migrations against `kitchensink_food`. The instance's `pg_trgm`
extension is already bootstrapped (FR-008 fuzzy search). Reusing the instance inherits its current
`multiAz: false` posture (acceptable for lean launch; SC-009 99.9% is a future shared-DB concern,
A-013/T-061).

**Migration runner (FU-MIGRATE — preserved).** RDS is `PRIVATE_ISOLATED`, so migrations are **not**
run from CI or the Fargate task directly. They run via an **in-VPC migration-runner Lambda** mirroring
the identity-webhooks `migrate.ts` pattern (the lambda is VPC-attached, reaches the private RDS over the
NAT-less path, and applies the Drizzle SQL against `kitchensink_food`). Until that runner is wired, all
phases build and test against **Docker Postgres** (the LocalStack e2e harness already used by identity).
Tracked as **FU-MIGRATE**; see §7.

---

## 2. Data Model

> **Source-agnostic canonical schema (FR-028).** Replaces the prior `foods`-with-denormalized-nutrient-
> columns + `fdcId`-PK design. A food is keyed by an internal `id`; sources are crosswalked; nutrients
> and portions are normalized; provenance is stored at the value's grain (a `source_id` reference on
> multi-valued rows, a thin `food_field_provenance` side-table for scalar fields). **No verbatim source
> payload is retained, and there is no golden-record recompute pipeline.** No EAV. Column types follow
> the repo's Drizzle style (identity service `users`/`accounts`): `text` ULID PKs, `timestamp({ withTimezone })`,
> `pgEnum` for controlled enums, partial/unique/GIN indexes.
>
> **Enum vs `text`+`CHECK` convention (DB-7).** Domain-model controlled sets use `pgEnum` (`food_status`,
> `food_kind`, `food_source`, `food_field`, `nutrient_basis`). The two **operational** state columns —
> `fetch_queue.status` (`pending|in_flight|tombstone`) and `food_sources.fetch_state` (`fetched|error`) —
> are deliberately `text` + a `CHECK` constraint rather than `pgEnum`, because their value sets are
> operational mechanics (not part of the public data model) and may need cheap in-place evolution; the
> `CHECK` still guarantees the set is constrained, so no column is left free-text.

### Canonical tables (Drizzle-flavored DDL)

```sql
-- ── Controlled enums ───────────────────────────────────────────────────────────
CREATE TYPE food_status   AS ENUM ('PENDING','UNRESOLVED','RESOLVED','NOT_FOUND','FAILED'); -- FR-028 lifecycle (R11/R13)
CREATE TYPE food_kind     AS ENUM ('generic','branded');                                    -- FR-IDN-3 (replaces USDA data-type enum)
CREATE TYPE food_source   AS ENUM ('usda');  -- source enum; additive — new sources append values (R3/FR-IDN-3)
CREATE TYPE food_field    AS ENUM ('name','description','kind','brand_owner','brand_name','barcode'); -- scalar provenance field enum (R5)
CREATE TYPE nutrient_basis AS ENUM ('per_100g','per_serving');                              -- FR-028 (basis lives on the value row)

-- ── food: the golden record (internal id PK) ───────────────────────────────────
CREATE TABLE food (
  id              text PRIMARY KEY,                 -- internal ULID, named `id` (R1/FR-IDN-1); NEVER a source key
  name            text,                             -- golden scalar (merge: higher-priority source — FR-MRG-2)
  normalized_name text NOT NULL,                    -- lowercased+trimmed dedup key (FR-005 idempotency)
  description     text,                             -- golden scalar (merge: longer-wins — FR-MRG-2)
  kind            food_kind NOT NULL DEFAULT 'generic',
  brand_owner     text,
  brand_name      text,
  barcode         text,                             -- GTIN/UPC when present (lookup via food_sources too)
  status          food_status NOT NULL DEFAULT 'PENDING',
  tombstoned_at   timestamptz,                      -- set on NOT_FOUND/FAILED; drives the NOT_FOUND TTL (FR-025)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX food_normalized_name_unique ON food (normalized_name); -- FR-005/FR-013 dedup
CREATE INDEX food_status_idx ON food (status);                            -- lifecycle filter / refresh eligibility (FR-029)
CREATE INDEX food_barcode_idx ON food (barcode) WHERE barcode IS NOT NULL; -- barcode lookup (FR-008)
-- Search (FR-008/FR-010): trigram on name+description for fuzzy/substring/partial match.
CREATE INDEX food_name_trgm_idx ON food USING gin (name gin_trgm_ops);
CREATE INDEX food_description_trgm_idx ON food USING gin (description gin_trgm_ops);
-- (A generated tsvector + GIN FTS index is an optional add for ranked full-text; pg_trgm covers fuzzy.)

-- ── food_sources: the crosswalk (NO raw payload) ───────────────────────────────
CREATE TABLE food_sources (
  id            text PRIMARY KEY,                   -- internal ULID; referenced as `source_id` for provenance
  food_id       text NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  source        food_source NOT NULL,
  external_key  text NOT NULL,                      -- that source's PK for the item (USDA: mapped from fdcId)
  fetch_state   text NOT NULL DEFAULT 'fetched',    -- per-source fetch state (fetched|error); NOT the food lifecycle
  item_version  text,                               -- per-item version/etag/hash for change-driven refresh (FR-032)
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT food_sources_source_key_unique UNIQUE (source, external_key),  -- R4/FR-028
  CONSTRAINT food_sources_food_id_id_unique  UNIQUE (food_id, id),          -- D-PROVENANCE-FK: target for the composite same-food FKs below
  CONSTRAINT food_sources_fetch_state_check  CHECK (fetch_state IN ('fetched','error')) -- DB-7: constrain the controlled set
);
CREATE INDEX food_sources_food_id_idx ON food_sources (food_id);
-- (source, external_key) unique index doubles as the barcode/external-key lookup path (FR-008).

-- ── nutrient: the dictionary (units live here, once) ───────────────────────────
-- Dedup key (DB-5): a source nutrient resolves to nutrient_id by external_code when present, else by
-- (name, unit). external_code is the preferred stable anchor but is nullable, so it cannot be the sole
-- dedup key (multiple NULLs are distinct in Postgres → would split 'Protein' into duplicate rows and
-- defeat food_nutrients UNIQUE(food_id, nutrient_id)). The (name, unit) fallback unique guarantees one
-- dictionary row per nutrient even when no INFOODS tagname exists.
CREATE TABLE nutrient (
  id            text PRIMARY KEY,                   -- internal ULID
  name          text NOT NULL,                      -- e.g. 'Protein'
  unit          text NOT NULL,                      -- e.g. 'g','mg','kcal' — never on the value row (R8)
  external_code text,                               -- stable anchor (e.g. an INFOODS tagname) where available
  CONSTRAINT nutrient_code_unique      UNIQUE (external_code), -- enforced only when present (NULLs distinct)
  CONSTRAINT nutrient_name_unit_unique UNIQUE (name, unit)     -- DB-5 fallback dedup when external_code IS NULL
);

-- ── food_nutrients: normalized values with per-value provenance ────────────────
CREATE TABLE food_nutrients (
  id          text PRIMARY KEY,                     -- internal ULID
  food_id     text NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  nutrient_id text NOT NULL REFERENCES nutrient(id),
  amount      numeric NOT NULL,                            -- arbitrary-precision (no scale): full source fidelity (SC-008); precision is intentionally omitted
  basis       nutrient_basis NOT NULL DEFAULT 'per_100g', -- normalized to per_100g before any blend (FR-MRG-3)
  source_id   text NOT NULL,                              -- per-value provenance (R5/FR-028)
  CONSTRAINT food_nutrients_food_nutrient_unique UNIQUE (food_id, nutrient_id), -- one golden value per nutrient (merge winner)
  CONSTRAINT food_nutrients_amount_nonneg CHECK (amount >= 0), -- DB-6: reject a sign/parse error before it corrupts the golden record (SC-008)
  -- D-PROVENANCE-FK: provenance must reference a food_sources row of the SAME food. NO ACTION (not
  -- RESTRICT) so a DIRECT food_sources-row delete that would orphan a golden value is still blocked,
  -- but the check defers to end-of-statement — a food-level ON DELETE CASCADE succeeds because these
  -- value rows are themselves cascade-deleted within the same statement (FR-028).
  CONSTRAINT food_nutrients_provenance_same_food_fk
    FOREIGN KEY (food_id, source_id) REFERENCES food_sources (food_id, id) ON DELETE NO ACTION
);
CREATE INDEX food_nutrients_food_id_idx ON food_nutrients (food_id);  -- FR-029
CREATE INDEX food_nutrients_source_id_idx ON food_nutrients (source_id); -- "which fields came from source X" (FR-029/R7)

-- ── food_portions: household measures / serving sizes ──────────────────────────
CREATE TABLE food_portions (
  id          text PRIMARY KEY,                     -- internal ULID
  food_id     text NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  label       text NOT NULL,                        -- e.g. '1 cup, chopped'
  gram_weight numeric NOT NULL,                       -- arbitrary-precision (no scale); precision intentionally omitted
  source_id   text NOT NULL,                         -- per-value provenance (R9)
  CONSTRAINT food_portions_gram_weight_pos CHECK (gram_weight > 0), -- DB-6: a portion weight must be strictly positive
  -- D-PROVENANCE-FK: same-food composite FK, ON DELETE NO ACTION (blocks a direct source-row delete that
  -- would orphan a value, but defers so a food-level cascade delete still succeeds).
  CONSTRAINT food_portions_provenance_same_food_fk
    FOREIGN KEY (food_id, source_id) REFERENCES food_sources (food_id, id) ON DELETE NO ACTION
);
CREATE INDEX food_portions_food_id_idx ON food_portions (food_id);

-- ── food_field_provenance: scalar-field provenance side-table ──────────────────
CREATE TABLE food_field_provenance (
  food_id   text NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  field     food_field NOT NULL,                    -- controlled enum (R5) — no EAV value column
  source_id text NOT NULL,
  PRIMARY KEY (food_id, field),                      -- one provenance row per scalar field
  -- D-PROVENANCE-FK: same-food composite FK, ON DELETE NO ACTION.
  CONSTRAINT food_field_provenance_same_food_fk
    FOREIGN KEY (food_id, source_id) REFERENCES food_sources (food_id, id) ON DELETE NO ACTION
);

-- ── food_category + assignment (many-to-many classification) ───────────────────
CREATE TABLE food_category (
  id   text PRIMARY KEY,                             -- internal ULID
  name text NOT NULL,
  CONSTRAINT food_category_name_unique UNIQUE (name)
);
CREATE TABLE food_category_assignment (
  food_id     text NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES food_category(id) ON DELETE CASCADE,
  source_id   text,                                  -- which source asserted the classification (nullable)
  PRIMARY KEY (food_id, category_id),
  -- D-PROVENANCE-FK: same-food composite FK (nullable source_id → MATCH SIMPLE skips enforcement when NULL), ON DELETE NO ACTION.
  CONSTRAINT food_category_assignment_same_food_fk
    FOREIGN KEY (food_id, source_id) REFERENCES food_sources (food_id, id) ON DELETE NO ACTION
);

-- ── food_candidates: per-source candidate set backing UNRESOLVED / disambiguation (D-CANDIDATES) ──
-- The worker persists the surviving candidates on an UNRESOLVED outcome; GET /candidates reads them;
-- PATCH-resolve validates the pick against this set (CandidateMismatchError otherwise), RE-FETCHES the
-- picked candidate's full payload from its source by external_key (a budgeted source call — the fan-out
-- CanonicalCandidate is not persisted here), then merges and clears the set.
-- NOTE: this table stores ONLY disambiguation metadata (source, external_key, name, summary). It carries
-- NO nutrient amounts, portions, or scalar fields by design (no-raw-payload; the UNIQUE(food_id, nutrient_id)
-- golden-value invariant forbids per-candidate nutrient rows). Resolve therefore re-fetches (see §5 step 5).
CREATE TABLE food_candidates (
  id           text PRIMARY KEY,                     -- internal ULID
  food_id      text NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  source       food_source NOT NULL,
  external_key text NOT NULL,                        -- that source's PK for the candidate item (re-fetch handle)
  name         text NOT NULL,
  summary      text,                                 -- short human-readable disambiguation hint
  created_at   timestamptz NOT NULL DEFAULT now(),   -- candidate-set TTL anchor (FR-025a: expires 30d after this)
  CONSTRAINT food_candidates_food_source_key_unique UNIQUE (food_id, source, external_key)
);
CREATE INDEX food_candidates_food_id_idx ON food_candidates (food_id);
```

> **Provenance query (FR-029 / R7).** "Which fields came from source X for this food" is one query:
> `UNION` of `food_field_provenance`, `food_nutrients`, and `food_portions` filtered by
> `source_id IN (SELECT id FROM food_sources WHERE food_id = $1 AND source = $2)`. No payload is read,
> because none is stored.

### Operational tables (queue + fairness + per-source limiter — keyed on food `id`)

```sql
-- ── fetch_queue: demand-weighted Postgres-as-queue, keyed on food id (FR-014/FR-015) ──
CREATE TABLE fetch_queue (
  food_id         text PRIMARY KEY REFERENCES food(id) ON DELETE CASCADE, -- ON CONFLICT dedup target (FR-014)
  request_count   int  NOT NULL DEFAULT 1,                                 -- distinct-requester demand (FR-044)
  first_requested timestamptz NOT NULL DEFAULT now(),                      -- FIFO tie-break (FR-015)
  last_requested  timestamptz NOT NULL DEFAULT now(),                      -- backoff gate (FR-016)
  status          text NOT NULL DEFAULT 'pending',                         -- pending|in_flight|tombstone
  attempts        int  NOT NULL DEFAULT 0,                                  -- retry/backoff (FR-016)
  last_error      text,
  fetched_at      timestamptz,
  leased_at       timestamptz,                                              -- worker lease stamp; reaper reverts in_flight rows with leased_at < now()-30s (FR-018/D-LEASE)
  CONSTRAINT fetch_queue_status_check CHECK (status IN ('pending','in_flight','tombstone'))
);
CREATE INDEX idx_fetch_queue_priority
  ON fetch_queue (request_count DESC, first_requested ASC)
  WHERE status = 'pending';   -- FR-015 demand-weighted partial index
-- Reaper access path (DB-8): the FR-018 reaper (WHERE status='in_flight' AND leased_at < now()-30s) and
-- leaseNext's in_flight reclaim branch are NOT covered by the pending-only priority index above; this
-- partial index keeps them off a seq scan.
CREATE INDEX idx_fetch_queue_inflight_lease
  ON fetch_queue (leased_at)
  WHERE status = 'in_flight';

-- ── fetch_requesters: distinct-requester demand + per-sub pending count (demotion) + WS targeting ──
-- Retention (DSN-10): a requester row matters only while the food is awaiting a fetch. The food row is
-- kept after resolution, so cascade-on-food does NOT bound this table; instead the worker PRUNES a food's
-- fetch_requesters rows when it leaves the queue — on resolve() (RESOLVED) and on tombstone()
-- (NOT_FOUND/FAILED) — so the set cannot grow one row per (requester, food) forever. (Same retention
-- discipline as source_call_log below.)
CREATE TABLE fetch_requesters (
  food_id      text NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  sub          text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (food_id, sub)
);
CREATE INDEX idx_fetch_requesters_sub ON fetch_requesters (sub); -- live per-sub pending count at drain time (FR-043)

-- ── source_call_log: PER-SOURCE rolling-60-min window (FR-019/FR-020) ──
-- One timestamped row per outbound source call; trailing-60-min count =
-- COUNT(*) WHERE source = $1 AND called_at > now() - interval '60 minutes'.
-- Generalizes the old USDA-only usda_call_log to per-source. No rate_limiter_state token bucket.
-- Retention (FR-020): rows older than the trailing 60-min window are pruned on a periodic sweep
-- (the window is the only consumer of this ledger), keeping the table bounded.
CREATE TABLE source_call_log (
  id        bigserial PRIMARY KEY,
  source    food_source NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_source_call_log_source_called_at ON source_call_log (source, called_at); -- windowed count + prune

-- ── source_sync_metadata: source-neutral sync tracking (FR-IDN-3) ──
-- Replaces usda_sync_metadata; one row per source (no USDA-named columns in the canonical schema).
CREATE TABLE source_sync_metadata (
  source              food_source PRIMARY KEY,
  last_full_sync_at   timestamptz,
  last_incremental_at timestamptz,
  source_version      text
);
```

> **Drizzle notes.** ULID PKs use `text('id')` (as identity's `users.id`) generated by a `newFoodId()`
> helper reusing `ulidx` (mirrors `newUserId`). Enums use `pgEnum`. Timestamps use
> `timestamp(col, { withTimezone: true })`. Trigram indexes use `.using('gin', …, sql\`… gin_trgm_ops\`)`;
the `pg_trgm`extension is already bootstrapped on the shared instance.`numeric`(Drizzle`numeric`)
for nutrient amounts/gram weights to avoid float drift (SC-008 fidelity). The old `tsvector`/`raw_json`columns are gone — search is`pg_trgm`, and no payload is retained.

### Final table list

The canonical store plus operational tables total **13 tables**: `food`, `food_sources`, `nutrient`,
`food_nutrients`, `food_portions`, `food_field_provenance`, `food_category`, `food_category_assignment`,
`food_candidates`, `fetch_queue`, `fetch_requesters`, `source_call_log`, `source_sync_metadata`.
**Removed** from the prior design: `foods` (denormalized), `usda_sync_metadata`, `usda_call_log`,
`rate_limiter_state`, `user_fetch_quota`, `global_fetch_quota`, and all denormalized-nutrient /
`raw_json` / `fetch_status` columns.

### Integration with 001

The `ingredients` table is **owned by feature 001** (`packages/shared/db/src/schema/ingredients.ts`,
not built yet) and lives in a **different logical database** than `kitchensink_food`. The integration
column is a **soft `food_id text` (no cross-database foreign key)** that **001 adds** to its
`ingredients` table — Postgres cannot FK across databases, and 003 cannot `ALTER` 001's table. The link
between an ingredient and a `food(id)` row is validated at the **application layer** (via the
food-service client), not by a DB constraint. _(Re-baseline 2026-06-21: the soft link is the food `id`,
not `usda_fdc_id`.)_ Tracked as `FU-INGREDIENTS` (revisit when 001 builds `ingredients`); see §7.

---

## 2A. Authentication & Authorization (FR-035–FR-053)

> **Preserved verbatim-in-intent from the 2026-06-19 re-plan** (closes sync-verify DRIFT-101 and the
> red-team findings RT-003-usda-food-data-2026-06-19). Only load-bearing identifiers are re-keyed:
> WebSocket/notification targeting and the requester set now key on the food **`id`**, not `fdcId`; the
> rate budget is described **per source** (USDA being the wired one). Deployment is **LOCKED to in-process
> verification** — no API Gateway / Lambda authorizer except the deferred WebSocket `$connect`.

### 2A.1 `FoodAuthGuard` — the named auth component (FR-053)

A single auth component fronts **every** food data entry point — all HTTP routes (`POST /v1/foods`,
`GET /v1/foods/{id}`, `/status`, `/candidates`, `PATCH /v1/foods/{id}`, `/search`, batch) **and** the
WebSocket `$connect`. It is a first-class architecture module (not spec prose), and every auth FR
(FR-035–FR-052) traces to it.

- **Verification is networkless** (FR-036/FR-037): `verifyToken` from `@clerk/backend` using the public
  `CLERK_JWT_KEY`, enforcing `azp` ∈ `CLERK_AUTHORIZED_PARTIES`. No IdP round trip, no Clerk secret key,
  no Auth0/Cognito authorizer. Mirrors the identity service's `ClerkAuthService`/`AuthMiddleware`
  (`packages/services/identity/src/auth/`).
- **Identity from the verified token only** (FR-038): `sub` (+ `azp`, `public_metadata`) come from the
  validated JWT; no client-suppliable identity header is ever trusted. The forgeable **`x-debug-sub`**
  path (and any trusted-header identity) is **removed** — the service sits behind a public, internet-facing
  ALB, so such a header would be forgeable; it is ignored entirely.

**Deployment decision (locked 2026-06-19): in-process NestJS middleware on ECS/Fargate.**
FoodService is a NestJS service on **ECS/Fargate fronted by the single shared per-stage ALB** (owned by
the global infra; the service adds a host-based listener rule at priority 200 rather than creating its
own ALB — same topology as the identity service, which uses priority 100). The service is still fronted
by a **public, internet-facing ALB**, so the auth rationale is unchanged. Therefore `FoodAuthGuard` is
implemented as **NestJS `AuthMiddleware` running in-process**, not as a Lambda authorizer:

- An **API Gateway Lambda authorizer cannot front an ALB** — Lambda authorizers are an API Gateway /
  AppSync feature; ALB has no equivalent (its only native auth is redirect-based
  `authenticate-oidc`/`authenticate-cognito`, the wrong shape for verifying a Clerk bearer token). Using
  a Lambda authorizer would require inserting `API Gateway → VPC Link → ALB → ECS` purely to host it — an
  extra edge layer for no gain, since the token verifies networklessly in ~1ms in-process.
- The middleware **reuses the identity service's Clerk verification**: extract the `ClerkAuthService`
  verify logic (`verifyToken` + `azp`) into a shared **`@kitchensink/clerk-verify`** package
  (`packages/shared/clerk-verify`) consumed by both the identity service and `food-service` — one
  implementation, no drift.
- No cold start → SC-011 (≤10ms p95) is met without provisioned concurrency; fairness-by-demotion
  (FR-043) lives in the same service, computed at queue drain time (not a pre-enqueue quota check).
- **FR-050 reframed for middleware:** the middleware runs on **every** route (there is no authorizer
  result cache to fall open); the cache-TTL/route-binding form of FR-050 applies only to the WebSocket
  `$connect` authorizer below.
- _If_ API Gateway is later added in front of FoodService for other reasons (WAF, usage plans, unified
  edge), a Clerk REQUEST Lambda authorizer becomes the right tool and FR-050's cache rules re-apply —
  but that is out of scope for this plan.

### 2A.2 Token classes (FR-047, A-012)

| Class                   | Caller                                                                                              | `azp`                           | Verified by               |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------- |
| **User session token**  | web/mobile end users                                                                                | web/mobile origins              | networkless `verifyToken` |
| **Machine (M2M) token** | downstream services (001/006/007/009) + internal jobs (recipe import FR-012, change-refresh FR-032) | service client ids in allowlist | networkless `verifyToken` |

Every endpoint is classified user-token / service-token / both (see §3 table). Server-initiated paths
that lack a user token MUST use an M2M token — they are **not** exempt from auth.

### 2A.3 Authorization (FR-039, FR-051)

- Food data is shared reference data → **any authenticated principal may read** (no per-record ownership).
- Operational/admin endpoints (manual re-fetch, refresh trigger) require an **elevated scope** read from
  the token's signed `public_metadata`; missing scope → **`403 Forbidden`** (distinct from `401`).
- **Response precedence (FR-051):** `401` (authn) → `403` (authz scope) → `400` (input validation) →
  `404`/`202`/`200` (business logic). Applies to FR-002/003/004/005/006 and `PATCH` (FR-RES-2).

### 2A.4 Queue fairness by demotion (FR-043, FR-044, FR-045, FR-046 — denial-of-wallet)

Auth ≠ rate limiting. Fairness is enforced **without rejecting any authenticated request for a personal
quota** — the food service only calls a source on a **local-store miss** (no `RESOLVED` row to serve), and
the per-source rolling-60-min-window limiter (§4, FR-019) already guarantees the system never exceeds each
source's budget (USDA: 1,000 req/hr). Within that budget, fairness is by **demotion at drain time**, not by
a per-`sub` enqueue quota:

- **Fairness by demotion** (FR-043): a `sub` with **more than 50 items currently pending** in the
  `fetch_queue` has their queued items ranked to the **back** of the priority order (below the FR-015
  demand ordering), so a heavy user cannot starve other users. This is **dynamic** — priority is computed
  **at drain time** from the requester's _current_ per-`sub` pending count (derived from `fetch_queue` +
  `fetch_requesters`, DEMOTE_THRESHOLD = 50), so items auto re-promote the moment the `sub` drops below 50.
  A **shared** food with multiple requesters is demoted **only when all** of its current requesters
  individually exceed the threshold (**FR-043a**) — a single under-threshold requester keeps it at normal
  priority. The scheme is **work-conserving**: a demoted user still drains on spare capacity, and **no
  enqueue is ever rejected with `429`** for a personal quota.
- **Near-ceiling flood-shedding** (FR-043b): when the **global** rolling-window budget is near its ceiling,
  **NEW** enqueues from the `sub` with the highest pending count are shed first with **`503`** (Retry-After)
  to preserve headroom; reads and `PATCH`-resolves are **never** shed and **never** return `429`.
- **Distinct-requester demand** (FR-044): `request_count` (FR-015 priority) counts **distinct `sub`s**
  via `fetch_requesters(food_id, sub, requested_at)` — a `sub` cannot inflate priority by repeating
  (each `sub` contributes at most once — the per-`sub` cap is structural, enforced by the
  `(food_id, sub)` primary key). The drain order is the canonical **absolute demand-weighting**
  `request_count DESC, first_requested ASC` (DSN-7): there is **no** separate time-decay/aging term — the
  `first_requested ASC` tie-break is FIFO **within** a demand tier, so an older single-requester item still
  drains ahead of an equally-demanded newer one. This table also drives WebSocket targeting (§2A.5) **and**
  supplies the per-`sub` pending count used by demotion.
- **Max batch size** (FR-045): recipe-import name sets and `POST /v1/foods/batch` ≤ 100 names/`id`s; over
  → `400`. A mixed hit+miss batch returns a **per-item partial response** — local-store hits (`RESOLVED`
  foods, with `id`s) inline and a `PENDING` entry per miss (each row created + enqueued) in one response, so
  the caller gets available data immediately and polls only the pending `id`s. (USDA's 20-key/call cap,
  FR-023, stays an
  adapter-internal detail.)
- **Queue backpressure + circuit breaker** (FR-046): enforced max `fetch_queue` depth (10,000); when
  exceeded, or when a source's circuit breaker is **open**, new enqueues fail closed with **`503`**
  (jittered recovery, no thundering herd). The breaker is a normative requirement, not a §6 footnote.

### 2A.5 WebSocket auth (FR-041, FR-049)

The WebSocket notifier (US-9, deferred P3) runs on an **API Gateway WebSocket API** — separate from the
ECS HTTP service. This is the one surface where a **`$connect` Lambda authorizer** is the right tool (it
reuses the same shared Clerk-verification package), and FR-050's cache-TTL/route-binding rules apply here.

- Token presented at `$connect` via query param or `Sec-WebSocket-Protocol` (browsers can't set
  `Authorization` on WS); `$connect` rejection pinned to **`403`**.
- Mid-connection expiry (`exp` passes): connection closed (re-auth on reconnect after the 10-min idle close).
- `FoodFetchCompleted` pushes resolve recipients from `fetch_requesters` (the requester `sub`→food `id`
  set) — **no broadcast** to non-requesting connections. _(Targeting re-keyed from `fdcId` to the food `id`.)_

### 2A.6 Async-producer authorization (FR-048)

Only named, least-privilege IAM roles may drive fetch work, across **both** producer surfaces (§4): the
demand path — `INSERT` into `fetch_queue` (the in-process `FoodRequested`/`FoodBatchRequested` enqueues) —
and the scheduled path — `events:PutEvents` for `IngestionScheduled`. The consumer validates event/row
provenance on both. The `requestedBy` field carries the authenticated `sub` or the named service
principal — never an unauthenticated `'system'` shortcut that bypasses the edge.

### 2A.7 Auth-layer DoS protection (FR-052, SC-011)

Bound auth-verification concurrency + per-source `401`-rate cap (load-shed) so a flood of well-formed-
but-invalid tokens (each forcing a CPU-bound signature verify before the fail-closed `401`) cannot
saturate the verifier and breach SC-009. SC-011's ≤10ms p95 is validated **under an invalid-token flood**.

### 2A.8 Config (FR-042)

`CLERK_JWT_KEY` (public PEM) + `CLERK_AUTHORIZED_PARTIES` (azp allowlist) — both non-secret. Each external
source's API key (e.g. the USDA key) remains a secret (Secrets Manager) and lives behind that source's
adapter. New operational data: `fetch_requesters` (distinct-requester demand + per-`sub` pending count for
demotion) and `source_call_log` (per-source rolling-60-min window). No quota tables.

---

## 3. API Contracts

### Endpoints

Auth column: **U** = user session token, **M** = M2M/service token, **scope** = additionally requires a
`public_metadata` scope. All endpoints reject with `401` (no/invalid token) before any other handling.
There is **no** per-`sub` `429` — fairness is by demotion at drain time (FR-043), not request rejection.
**All path params are the internal food `id` (ULID), never a source key.**

| Method | Path                        | Auth      | Description                                                                                                          |
| ------ | --------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/foods`                 | U or M    | Add food **by name** → create row + `id`, dedup on normalized name, enqueue, `202` + `id` (FR-005)                   |
| GET    | `/v1/foods/{id}`            | U or M    | Read by internal `id`: `200` only `RESOLVED`; `202` `PENDING`/`UNRESOLVED`; `404` `NOT_FOUND`/`FAILED`/no row        |
| GET    | `/v1/foods/{id}/status`     | U or M    | Poll lifecycle status (FR-007)                                                                                       |
| GET    | `/v1/foods/{id}/candidates` | U or M    | List cross-source candidates for an `UNRESOLVED` food (FR-RES-1)                                                     |
| PATCH  | `/v1/foods/{id}`            | U or M    | Resolve from the user's candidate pick (validated to this food's set) → merge → `RESOLVED` (FR-RES-2)                |
| GET    | `/v1/foods/search?query=`   | U or M    | Search local store (name/substring/partial + `pg_trgm` fuzzy) → `id`s; barcode/`external_key` lookup (FR-008)        |
| POST   | `/v1/foods/batch`           | U or M    | Batch add-by-name; ≤100 names (`400` over); per-item partial (local-store hits inline + `PENDING` per miss) (FR-045) |
| POST   | `/v1/foods/{id}/refetch`    | U + scope | Operational manual re-fetch (`403` w/o scope)                                                                        |
| WS     | `$connect`                  | U         | WebSocket subscribe (`403` reject; FR-049; deferred P3)                                                              |

> The prior `fdcId`-keyed `GET /v1/foods/{fdcId}` read/`/nutrients`/`/autocomplete` design is **removed**.
> The single read returns the full golden record (incl. nutrients + per-field provenance); `barcode`/
> `external_key` lookup is folded into `/search`.

### Response Shapes

```typescript
// POST /v1/foods — add by name (FR-005)
202 Accepted
{ "id": "01J9...ULID", "status": "PENDING", "estimatedWaitSeconds": 30 }

// GET /v1/foods/{id} — RESOLVED (golden record) (FR-002)
200 OK
{
  "id": "01J9...ULID",
  "name": "Broccoli, raw",
  "description": "Broccoli, raw",
  "kind": "generic",
  "status": "RESOLVED",
  "nutrients": [
    { "nutrient": "Energy",  "amount": 34,  "unit": "kcal", "basis": "per_100g", "source": "usda" },
    { "nutrient": "Protein", "amount": 2.8, "unit": "g",    "basis": "per_100g", "source": "usda" },
    { "nutrient": "Total fat","amount": 0.4,"unit": "g",    "basis": "per_100g", "source": "usda" }
  ],
  "portions": [ { "label": "1 cup chopped", "gramWeight": 91, "source": "usda" } ],
  "provenance": { "name": "usda", "description": "usda" }   // scalar-field provenance (FR-029)
}

// GET /v1/foods/{id} — PENDING or UNRESOLVED (FR-003)
202 Accepted
{ "id": "01J9...ULID", "status": "PENDING", "estimatedWaitSeconds": 20 }
{ "id": "01J9...ULID", "status": "UNRESOLVED" }   // client follows up via /candidates

// GET /v1/foods/{id}/candidates — UNRESOLVED disambiguation (FR-RES-1)
200 OK
{
  "id": "01J9...ULID",
  "candidates": [
    { "candidateId": "c1", "source": "usda", "externalKey": "171688", "name": "Broccoli, raw", "summary": "34 kcal/100g" },
    { "candidateId": "c2", "source": "usda", "externalKey": "170379", "name": "Broccoli, cooked, boiled", "summary": "35 kcal/100g" }
  ]
}

// PATCH /v1/foods/{id} — resolve from pick (FR-RES-2)
// body: { "candidateIds": ["c1"] }  → validated to this food's candidate set
200 OK   { "id": "01J9...ULID", "status": "RESOLVED" }
409 Conflict   { "error": "Candidate not in food's candidate set" }   // or 400; status unchanged

// GET /v1/foods/{id} — NOT_FOUND or FAILED (status still retrievable) (FR-004)
404 Not Found
{ "id": "01J9...ULID", "status": "NOT_FOUND", "message": "No source has this food; tombstoned until TTL (default 30 days)" }
{ "id": "01J9...ULID", "status": "FAILED",    "message": "All sources errored after retries; try again later" }

// GET /v1/foods/search?query=avacado  (FR-008; pg_trgm fuzzy → ids)
200 OK
{ "results": [ { "id": "01J9...ULID", "name": "Avocado, raw", "score": 0.42 } ] }

// POST /v1/foods/batch — per-item partial (FR-045)
200 OK
{
  "items": [
    { "id": "01J9...A", "status": "RESOLVED", "name": "Chicken breast, raw" },
    { "id": "01J9...B", "status": "PENDING",  "estimatedWaitSeconds": 30 }
  ]
}

// Any endpoint — unauthenticated / invalid / expired / wrong-azp (FR-035, FR-040)
401 Unauthorized   { "error": "Unauthorized", "message": "Valid Clerk session or M2M token required" }

// Operational endpoint — authenticated but missing scope (FR-039, FR-051)
403 Forbidden   { "error": "Forbidden", "message": "Operation requires elevated scope" }

// Input validation / backpressure
400 Bad Request   { "error": "Batch too large", "maxNames": 100 }       // FR-045
400 Bad Request   { "error": "Invalid id" }                              // malformed ULID (FR-006)
400 Bad Request   { "error": "Empty name" }                              // POST /v1/foods (FR-006)
503 Service Unavailable   { "error": "Fetch temporarily unavailable", "retryAfterSeconds": 30 } // FR-046
```

> **Status precedence (FR-051):** `401` → `403` → `400` → `404`/`202`/`200`. A malformed `id` with a bad
> token returns `401` (not `400`); a valid token on a `NOT_FOUND`/`FAILED` food returns `404` with the
> status still retrievable. There is **no** stale-by-age `200` — a populated food is `RESOLVED` and served;
> change-driven refresh (§7-adjacent, FR-031) replaces stale-while-revalidate.

---

## 4. Event Contracts

> **Event taxonomy (reconciled 2026-06-20; re-keyed to food `id` 2026-06-21).** Two distinct mechanisms —
> do not conflate them. The **demand path** (`FoodRequested`/`FoodBatchRequested`) is an **in-process
> Postgres `fetch_queue` enqueue**, NOT an EventBridge event (matches spec.md's event taxonomy +
> v-model `REQ-IF-005`/`ARCH-002`). EventBridge carries **only** the scheduled producers and the
> completion signal. The CDK (`FoodServiceStack`) reflects this — its only EventBridge rules are the
> change-driven-refresh schedule + the `FoodFetchCompleted` completion rule (`detailType:
['FoodFetchCompleted']`); there is no demand-event rule. All payloads now carry the food **`id`**,
> not `fdcId`.

#### Demand-path enqueue (in-process — NOT EventBridge)

`FoodRequested` / `FoodBatchRequested` are the names of the in-process enqueue operations
(`EnqueueEmitter.publishFoodRequested` / `publishFoodBatchRequested`, ARCH-002). Each performs a direct
`INSERT … ON CONFLICT` into the Postgres `fetch_queue` paired with `pg_notify('fetch_queued', food_id)`
(FR-011/FR-014/FR-017) — no `events:PutEvents`, no EventBridge topic, no SQS.

```typescript
// Local-store miss — single food, no RESOLVED row (→ fetch_queue INSERT … ON CONFLICT + pg_notify)
FoodRequested {
  id: string,               // internal food id (ULID) — created up front by the read API
  name: string,             // the add-by-name query the worker fans out on
  requestedAt: ISO8601,
  requestedBy: string,      // authenticated Clerk sub or named service principal (FR-048; never a 'system' shortcut)
  // No priority field — fetch_queue is ordered purely by demand (request_count DESC, first_requested ASC);
  // request_count is the capped distinct-requester count (FR-044), with demotion applied at drain time (FR-043).
}

// Batch import — multiple foods (→ per-id fetch_queue rows, deduped via ON CONFLICT)
FoodBatchRequested {
  foods: { id: string, name: string }[],  // ≤100 (FR-045); each becomes one fetch_queue row
  requestedAt: ISO8601,
  requestedBy: string,
  source: 'import' | 'recipe',
  correlationId: string
}
```

#### EventBridge Events (scheduled producers + completion only)

```typescript
// Scheduled producer — change-driven refresh (Fargate scheduled task) enqueues low-demand fetch_queue rows via the ordinary enqueue path (FR-031/FR-032)
IngestionScheduled {
  eventId: string,
  timestamp: ISO8601,
  source: 'change-refresh',
  requestedBy: string,      // named, least-privilege producer principal (FR-048)
}

// Fetch completed — Fargate worker → search-indexer + WebSocket notification (FR-034)
FoodFetchCompleted {
  eventId: string,
  timestamp: ISO8601,
  id: string,               // internal food id
  status: 'RESOLVED' | 'UNRESOLVED' | 'NOT_FOUND' | 'FAILED'
}

// Terminal failure — emitted to CloudWatch/SNS on a FAILED tombstone ONLY (DSN-9: NOT_FOUND is a normal
// outcome and does NOT emit FetchFailed / is not alarmed). Not a bus consumer fan-out.
FetchFailed {
  eventId: string,
  timestamp: ISO8601,
  id: string,
  attempts: number,
  lastError: string,
}
```

### Fetch Queue (Postgres)

**Table**: `fetch_queue` — single durable demand-weighted queue keyed on the food `id` (ordered by
`request_count DESC, first_requested ASC`; no high/low priority tier; demotion applied at drain time).

```sql
-- See §2 for the full DDL. Enqueue is two statements: idempotent dedup (FR-014) + distinct-requester
-- demand (FR-044). request_count is the CAPPED DISTINCT-`sub` count (each sub contributes at most 1 —
-- PRIORITY_CAP = 1), NEVER a raw `+1` (a single sub must not be able to inflate priority by repeating).

-- 1) Record the distinct requester (idempotent on (food_id, sub)):
INSERT INTO fetch_requesters (food_id, sub) VALUES ($1, $2)
ON CONFLICT (food_id, sub) DO NOTHING;

-- 2) Upsert the queue row (idempotent dedup, FR-014) and set request_count to the distinct-`sub` count:
INSERT INTO fetch_queue (food_id) VALUES ($1)
ON CONFLICT (food_id) DO UPDATE
  SET request_count = (SELECT count(*) FROM fetch_requesters WHERE food_id = $1),
      last_requested = now()
  WHERE fetch_queue.status = 'pending';
```

> So `request_count = 50` means **50 distinct `sub`s** have asked for this food — not 50 repeats from one
> `sub`. Demotion (FR-043/FR-043a) is then applied at drain time, not by inflating or capping the queue row.

> **Reactivation reset (DSN-1) — the enqueue above is intentionally a no-op on a non-`pending` row, so a
> terminal food needs an explicit reset.** The step-2 `ON CONFLICT … DO UPDATE … WHERE status = 'pending'`
> guard skips rows already `in_flight` or `tombstone`; without that guard a concurrent re-add could disturb
> an in-flight drain. The consequence is that when `createByName` **reactivates** a terminal-state food
> (`NOT_FOUND`/`FAILED`, past TTL → `food.status='PENDING'`, FR-028a), the food's `fetch_queue` row is still
> `tombstone`, so the guarded upsert never re-queues it and the worker would never claim it. Reactivation
> therefore **resets the queue row in the same transaction** (and re-notifies):
>
> ```sql
> UPDATE fetch_queue
>    SET status = 'pending', attempts = 0, leased_at = NULL, last_error = NULL,
>        last_requested = now(),
>        request_count = (SELECT count(*) FROM fetch_requesters WHERE food_id = $1)
>  WHERE food_id = $1;            -- then pg_notify('fetch_queued', $1)
> ```
>
> Conversely, an add-by-name for a food that is **already `RESOLVED`/`UNRESOLVED`/in-flight is NOT enqueued
> at all** — `createByName` branches on the `created`/`reactivated`/existing outcome and returns the `id` +
> current status without touching `fetch_queue`, so a re-add of a `RESOLVED` food never re-drains or burns
> the scarce per-source budget (a new fetch happens only via the change-refresh path, §5). Only a genuine
> `created` or `reactivated` outcome enqueues.

**Wakeup channel**: Postgres `LISTEN/NOTIFY` on channel `fetch_queued`. Enqueue statement is paired with
`pg_notify('fetch_queued', food_id)`. No SQS, no Redis on the critical path.

**Single-consumer guarantee** (FR-022): exactly one Fargate consumer drains at a time, enforced via a
Postgres advisory lock (one task holds the lock; others stand by).

**Rate limiter (per source)**: a **per-source rolling 60-minute window** — ≤ each source's cap in any
trailing 60 min (USDA: ≤1,000; FR-019). Before each source call the consumer does an atomic
check-and-record against `source_call_log` for that source (count rows where `source=$1` in the trailing
60 min, insert the new call in one transaction); at 90% of that source's cap (USDA: 900) it pauses
draining **work that needs that source** and resumes as older calls age out. This replaces the old
token bucket (a refilling bucket could emit ~2× the cap across a rolling hour). Deferred Redis variant:
a per-source sorted set (`ZADD` ts / `ZCOUNT` last 60 min).

Because the FR-022 advisory lock guarantees a **single drainer**, this read-committed count-then-insert is
effectively **serial** — no concurrent call can read a stale (undercounted) window between another call's
count and insert. That serialization is what makes "**never exceed the cap in any rolling 60-min window**"
hold (it is why the window check needs no extra locking beyond the single-drainer invariant).

**Lease timeout / reaper**: each claimed row stamps `leased_at` (§2). A reaper reverts rows with
`status='in_flight' AND leased_at < now() - interval '30 seconds'` back to `pending` (at consumer start +
every minute), recovering from consumer crashes — without it a crash mid-lease would orphan the
`in_flight` row forever, since the priority partial index is `WHERE status='pending'` (FR-018/D-LEASE).
The reaper scan (and `leaseNext`'s `in_flight` reclaim branch) is served by the partial index
`idx_fetch_queue_inflight_lease ON fetch_queue (leased_at) WHERE status='in_flight'` (§2/§7, DB-8) — the
pending-only priority index does not cover it.

**No DLQ infrastructure**: Tombstone rows (`status='tombstone'`) are the audit trail — queryable via SQL,
reprocessable by setting `status='pending'`. Only **`FAILED`** tombstones are alarmed (DSN-9): `FAILED` is
reached after the FR-016 retry budget (real source errors) and is re-fetchable. **`NOT_FOUND`** tombstones
carry a TTL (default 30 days, `food.tombstoned_at`) and are queryable but **not** alarmed — "no source has
this item" is a normal outcome, so it never emits `FetchFailed` or pages (see §8).

---

## 5. Workers & Source Adapters

### food-fetch-consumer (Fargate worker — fan-out + merge)

- **Runtime**: Node.js 22.x in a Fargate task (single instance via the FR-022 advisory lock; scale-to-zero
  via ECS desired-count toggle if cost-critical)
- **Memory**: 512 MB
- **Trigger**: Postgres `LISTEN fetch_queued` (one connection held open for the worker lifetime)
- **Drain loop**: On notify wakeup → select the next eligible row:
  `SELECT food_id FROM fetch_queue WHERE status='pending' AND last_requested <= now() ORDER BY request_count DESC, first_requested ASC FOR UPDATE SKIP LOCKED LIMIT 1`,
  with demotion (FR-043) folded into the ordering at drain time from the live per-`sub` pending count →
  process → `UPDATE` → loop until empty → block on next NOTIFY.
- **Fan-out + merge (per row)** — the core re-baselined logic (this is the **first-time resolution** path,
  taken for a `PENDING` row; a change-refresh re-enqueue takes the refresh branch below instead):
    1. Read the food's fan-out query name. The first fan-out keys off the **creation-time** name — the
       original add-by-name query, captured as `normalized_name` (the dedup key, never merge-overwritten)
       rather than the golden `food.name` scalar (which a RESOLVED merge may rewrite, DB-11). A later
       re-request carries its own `name` (`FoodRequested.name`); so `normalized_name` is the stable
       fan-out source of record and a golden-name rewrite cannot drift the re-fan-out query.
    2. For **each wired source adapter**, call `searchByName(name)` (per-source rolling-window-limited).
       The USDA adapter is the only wired one today; the loop is over a registry so adding a source is
       additive (FR-MRG-4/FR-ADP-1).
    3. For each source that returns hits, `fetchByKey(...)` the candidate item(s) and `mapToCanonical(...)`
       — adapter validates/sanitizes (type/range/length/text) before any value enters the store (FR-ADP-2);
       fetches are HTTPS with cert validation, and a response failing validation is rejected, not stored
       (FR-ADP-3).
    4. **Pre-merge dedup** across sources as far as is confident (name normalization + attribute
       similarity); residual ambiguity is left for the user (FR-RES-3).
    5. **Merge** the surviving candidate(s) into the golden record (rules below), writing `food_sources`
       crosswalk rows (`UNIQUE(source, external_key)`), `food_nutrients`/`food_portions` with their
       `source_id`, and scalar-field provenance into `food_field_provenance`.
    6. Set `food.status` by the **survivor-count rule** (FR-MRG-5, D-AUTORESOLVE): after pre-merge dedup,
       count the candidates surviving **normalized-name exact match** — exactly **1 → `RESOLVED`** (merge
       it); **>1 → `UNRESOLVED`** (persist the surviving set to `food_candidates`, surface via
       `/candidates`); **0 → `NOT_FOUND`** (tombstone + 30-day TTL). A source fetch that errors after
       bounded retries → `FAILED`. There is **no nutrient-tolerance test** — the worker **biases toward
       `UNRESOLVED`** over a wrong auto-pick (the human is the final arbiter, FR-RES-3). Emit
       `FoodFetchCompleted`.
- **Refresh branch (FR-031/FR-032, DSN-4) — the one executable home for change-refresh.** When the
  dequeued row is a **change-refresh re-enqueue** — detected from the existing signal, **not** a new column:
  the food is already `RESOLVED` and its only/originating requester is the `svc_change_refresh` service
  principal (§4 / D-REFRESH) — the worker **does NOT fan out by name** (steps 1–6 above). Instead it:
  (a) for each backing `food_sources` row, `fetchByKey(external_key)` and recompute `item_version`
  (re-fetch + hash compare — USDA exposes no per-item etag, §9.4); (b) **selectively re-pulls only the
  items whose `item_version` changed** upstream, mapping + validating as in step 3; (c) merges those
  changed values **in place** by the same merge rules, updating their `source_id` provenance; and
  (d) **preserves every user-resolved / manual-pick field — a refresh never overwrites one** (DB-9 /
  AT-LC-D). Unchanged items cost no write. This avoids the old failure where a refresh re-ran the
  full name fan-out + disambiguation and could revert a user's `UNRESOLVED → RESOLVED` pick. The branch
  emits `FoodFetchCompleted` like the first-time path. (The change-refresh **Fargate scheduled task**,
  below, is the low-priority drainer that processes these `svc_change_refresh` rows; it enqueues them via
  the ordinary path, so they share the single-drainer lock, the per-source limiter, and demotion.)
- **Merge rules (FR-MRG-2/FR-MRG-3 — stated normatively):**
    - **Presence beats absence** — a source that has a value supplies it where another lacks it.
    - **Identity/short fields** (`name`, `brand_owner`, `brand_name`) → the **higher-priority source** wins
      (NOT the longest value). USDA is the **default highest priority** until an explicit ranking is
      configured.
    - **Free-text fields** (`description`, `ingredients`) → the **longer** value wins.
    - **Nutrients** → normalized to a common basis (**per-100g**) before any blend; on a conflict for the
      same nutrient, the **higher-priority source** wins, and `food_nutrients.source_id` records the winner.
- **Legal lifecycle transitions (FR-028a, D-LIFECYCLE):** the worker (and the resolve/refresh paths) move a
  food only along the legal set — `PENDING → {RESOLVED, UNRESOLVED, NOT_FOUND, FAILED}`;
  `UNRESOLVED → RESOLVED` (human pick via `PATCH`-resolve); `FAILED → PENDING` (bounded-backoff retry, **no**
  30-day gate); `NOT_FOUND → PENDING` (re-add after the 30-day TTL). A **refresh never overwrites a user's
  manual pick.** `PATCH`-resolve is **`UNRESOLVED`-only, idempotent, and candidate-in-set validated** — a
  pick outside the food's `food_candidates` set raises `CandidateMismatchError` and leaves the status
  unchanged. `createByName` for an existing terminal-state (`NOT_FOUND`/`FAILED`, past TTL) normalized-name
  row **reactivates** it (→`PENDING`, re-enqueue) rather than raising a `23505` unique-violation.
- **Manual-pick preservation grain (DB-9).** At single-source launch a "manual pick" is preserved at the
  **crosswalk / item grain**: a `PATCH`-resolve pins which `food_sources` item(s) back the food, and the
  refresh branch never re-runs name disambiguation against that food, so it cannot revert the pick. There
  is deliberately **no field-level `manual`/`locked`/`resolved_by` marker** on value/provenance rows yet —
  it is unnecessary while USDA is the only source (refresh re-pulls the same picked item in place). A
  field-level lock column is a **prerequisite to be added before a second source is wired** (once two
  sources merge, a higher-priority source could otherwise overwrite a user-picked field); recorded here so
  that addition is not forgotten.
- **Rate limiting**: per-source rolling 60-min window (FR-019); atomic check-and-record against
  `source_call_log`; pause that source's draining at 90%; on a source `429` treat its window as full and
  back off (FR-026).
- **Error handling**: 5 **failures** with exponential backoff (`last_requested = now() + interval '2^attempts seconds'`)
  → food `FAILED`, row `status='tombstone'`, `last_error` populated (FR-016/FR-027). No source has it →
  `NOT_FOUND` tombstone immediately, no retry (FR-025).
    - **`attempts` counts real source failures, not leases (DSN-5).** Increment `attempts` **only** in the
      genuine-failure branch (a source 5xx/timeout, or a `429` after the source's own retries are exhausted).
      Do **not** increment it (a) at lease/claim time, (b) on a rate-limit / window-full / 90%-pause deferral
      (the row is simply re-queued with backoff, no source call was made), or (c) on a reaper reclaim of an
      orphaned `in_flight` row. Otherwise normal back-pressure (the 90% pause is steady state) plus a crash
      recovery would trip the `attempts >= 5` `FAILED` gate after one or zero real failures, false-tombstoning
      healthy foods and firing the §8 tombstone alarm. The lease/claim counter (if any) is separate from this
      FR-016 retry budget.
- **Lease recovery**: the reaper reverts `in_flight` rows whose `leased_at` is older than 30s back to
  `pending` (consumer start + every minute) (FR-018/D-LEASE).

### Source adapter interface (per source; USDA is the first)

```typescript
/** A pluggable food source. No source-specific structure leaks past this boundary (R21/R22). */
interface FoodSourceAdapter {
    readonly source: FoodSourceId; // e.g. 'usda'
    searchByName(name: string): Promise<SourceCandidate[]>; // candidates (source + that source's key)
    fetchByKey(externalKey: string): Promise<CanonicalCandidate>; // fetch + map + validate/sanitize
    // mapToCanonical is internal to fetchByKey; it does the fdcId→external_key mapping for USDA.
}
```

- **`@kitchensink/usda-client`** is the only wired adapter. It is the **only** place `fdcId` and USDA terms
  appear; it maps `fdcId → external_key` inbound (FR-IDN-2/FR-023). It MAY use USDA's `POST /v1/foods`
  batch endpoint (≤20 keys/call, counting as 1 windowed call) once it has resolved which USDA items to
  fetch — an adapter-internal optimization invisible to the canonical API (FR-023/SC-005).
- All persistence goes through a **DAO/repository layer** (the existing `FoodsRepository` seam extends to
  per-aggregate DAOs — `FoodDao`, `FoodSourcesDao`, `NutrientDao`, `FoodNutrientsDao`, etc.). No
  source-specific structure leaks into services, DAOs, or the API (FR-ADP-1).

### candidate-resolution path (`PATCH`-resolve — re-fetch on pick)

`PATCH /v1/foods/{id}` (FR-RES-2, in the NestJS API, not the worker) resolves an `UNRESOLVED` food from the
user's candidate pick. Because `food_candidates` holds **only** disambiguation metadata
(`source`, `external_key`, `name`, `summary`) and carries **no** nutrient/portion/scalar payload — the
fan-out's `CanonicalCandidate` is intentionally **not** persisted (no-raw-payload; the
`UNIQUE(food_id, nutrient_id)` golden invariant forbids per-candidate nutrient rows) — the resolve path
cannot merge from the stored rows. It therefore:

1. Loads the food; if already `RESOLVED`, returns an idempotent `200` no-op; if not `UNRESOLVED`, `409`
   (`PATCH`-resolve is `UNRESOLVED`-only, FR-028a).
2. **Validates** each picked `candidateId` is in this food's own `food_candidates` set — out-of-set →
   `CandidateMismatchError` (`409`/`400`), status unchanged (FR-RES-2/FR-049).
3. **Re-fetches** each picked candidate by its `external_key` via the source adapter
   (`adapter.fetchByKey` → `mapToCanonical` → validate, FR-ADP-2/FR-ADP-3) to obtain the full
   `CanonicalCandidate` (nutrients/portions/scalars). **This is a budgeted per-source call**: it goes
   through the **same atomic `checkAndRecordCall`** the worker uses, so every resolve call is **recorded**
   against the rolling 60-minute window (FR-019) — resolve **never** makes an unrecorded source call.
4. **Merges** the re-fetched payload(s) into the golden record (same merge rules as the worker), stores the
   pick as **ordinary provenance**, and sets `RESOLVED`, then clears the candidate set.

**Cap semantics for `PATCH`-resolve (DSN-6 — option (a), wait-for-headroom).** Resolve is **exempt from
flood-shed and from the 90% drain pause** and **never returns `429`** for a personal quota (D-FAIRNESS):
NEW enqueues are shed first (`503`) precisely to reserve the ~10% window headroom for reads and
resolves, so a resolve draws from that headroom and is not deferred at the 90% mark. But resolve is **still
bounded by the hard rolling-window cap** — "never exceed the cap in any rolling-60-min window" (SC-002) is
absolute. Because the limiter records **nothing** when the window is at the cap, resolve must **not** call
through a full window; instead, if `checkAndRecordCall` reports the **full** cap (not merely the 90% pause)
is momentarily exhausted, resolve **waits for headroom to free up** as older calls age out of the trailing
60 minutes, then records-and-calls — it never emits an unrecorded call that would let the next window
breach the cap. The client still never sees `429`: the `PATCH` simply takes slightly longer, or returns
**`503` Retry-After** if the wait would exceed the request's time budget (a retryable signal, not a quota
rejection). If the re-fetch itself fails, the resolve aborts with `SourceApiError`, the candidate set is
**not** cleared, and the food stays `UNRESOLVED` for a retry.

### change-refresh consumer (Fargate scheduled task)

- Runs as a **Fargate scheduled task** (an EventBridge schedule emits `IngestionScheduled` to launch it),
  **not** a VPC Lambda — Fargate in a public subnet egresses to each source via the Internet Gateway, off
  the NAT path (see ADR-0004 for the egress/compute-placement rationale; ADR-0004 is the NAT-egress ADR,
  not a refresh ADR). It is **low-priority idle-drain** background work that yields to live demand, and its
  cadence is **budget-bounded, not a fixed promise**.
- **Execution model (DSN-4) — enqueue here, re-pull in the worker's refresh branch.** This task is the
  **producer + idle-drainer** of refresh work; it does **not** carry its own separate re-pull logic that
  could diverge from the worker. It selects refresh-eligible `RESOLVED` foods and **re-enqueues each through
  the ordinary** `enqueue(food_id, 'svc_change_refresh')` path (a low-demand `fetch_queue` row deduped via
  `ON CONFLICT`) — there is **no** separate low-priority tier or `enqueueLowPriority` method. Those rows are
  then drained by the **single refresh branch** documented in the fan-out logic above (the food is already
  `RESOLVED` + the `svc_change_refresh` requester signals "refresh"): for each backing `food_sources` item,
  re-fetch by `external_key` and compare `item_version`; re-pull **only** the items that changed upstream
  (FR-031/FR-032); merge those in place updating `source_id` provenance; leave unchanged items — **and
  every user-resolved / manual-pick field, which a refresh never overwrites** — intact. Because refresh
  rows enter via the ordinary queue, they share the single-drainer advisory lock (FR-022), the per-source
  rolling-window limiter, and demotion, so refresh can never breach a source budget or starve live demand.
  There is exactly **one** place the selective re-pull + manual-pick preservation lives (the worker's
  refresh branch), so the scheduled task and the worker cannot diverge.

### food-search-indexer (optional)

- With `pg_trgm` GIN indexes on `food.name`/`food.description`, no separate indexer is strictly required
  for fuzzy search. If ranked full-text is later added (generated `tsvector` + GIN), a `FoodFetchCompleted`-
  triggered indexer maintains it. Deferred.

---

## 6. Resilience & External Services

### External sources (per adapter)

- **Rate limit**: per-source rolling 60-min window via `source_call_log` (USDA: ≤1,000 in any trailing 60
  min; worker pauses at 90% = 900). Each additional source gets its own window sized to its limit.
- **Timeout**: 10s per request; HTTPS with certificate validation (FR-ADP-3).
- **Degraded mode**: if a source is unavailable, that source contributes nothing to the fan-out; a food
  resolves from the remaining sources, or lands `FAILED`/`NOT_FOUND` per the rules.
- **Circuit breaker** (FR-046): after 5 consecutive failures for a source, open its circuit for 60s; new
  enqueues fail closed with `503` while open. Normative, not a footnote.

### Application-layer cache (optional, in-process)

- The Postgres canonical store is the source of truth and is fast (B-tree PK on `food.id`, hot rows served
  from shared_buffers at this scale).
- An optional in-process LRU in the NestJS API process MAY accelerate repeated reads within a handler
  lifetime; no shared cache infrastructure is required at MVP scale.
- **No ElastiCache Redis** is provisioned. The Redis read-through cache and the Redis sorted-set limiter
  are **deferred post-launch variants** (FR-030/A-002). Reintroduce Redis only when single-Postgres
  `ORDER BY` of `fetch_queue` or read latency exceeds the A-002 thresholds.

---

## 7. Migration / Schema Changes

> **Clean replacement, no data to migrate (A-014).** This migration drops the Phase 1–2 `foods` /
> `usda_*` design and creates the source-agnostic canonical + operational tables. Migrations run via the
> **in-VPC migration-runner Lambda** (FU-MIGRATE) because RDS is `PRIVATE_ISOLATED`; phases build against
> Docker Postgres until that runner is wired (mirrors identity-webhooks `migrate.ts`).

```sql
-- Migration for 003 source-agnostic food data (kitchensink_food database)

-- Extensions (pg_trgm already bootstrapped on the shared instance for FR-008 fuzzy search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enums
CREATE TYPE food_status    AS ENUM ('PENDING','UNRESOLVED','RESOLVED','NOT_FOUND','FAILED');
CREATE TYPE food_kind      AS ENUM ('generic','branded');
CREATE TYPE food_source    AS ENUM ('usda');
CREATE TYPE food_field     AS ENUM ('name','description','kind','brand_owner','brand_name','barcode');
CREATE TYPE nutrient_basis AS ENUM ('per_100g','per_serving');

-- Canonical tables (see §2 for full column lists)
CREATE TABLE food ( ... );                       -- internal id PK, normalized_name dedup, status, golden scalars
CREATE TABLE food_sources ( ... );               -- crosswalk; UNIQUE(source, external_key); NO payload
CREATE TABLE nutrient ( ... );                    -- dictionary: name+unit+external_code
CREATE TABLE food_nutrients ( ... );             -- (food_id, nutrient_id, amount, basis, source_id)
CREATE TABLE food_portions ( ... );              -- (food_id, label, gram_weight, source_id)
CREATE TABLE food_field_provenance ( ... );      -- (food_id, field, source_id) for scalar fields
CREATE TABLE food_category ( ... );
CREATE TABLE food_category_assignment ( ... );
CREATE TABLE food_candidates ( ... );            -- per-source candidate set backing UNRESOLVED (D-CANDIDATES)

-- Same-food provenance integrity (§2, D-PROVENANCE-FK): food_sources gets UNIQUE(food_id, id); the
-- source_id references on food_nutrients / food_portions / food_field_provenance / food_category_assignment
-- are composite (food_id, source_id) FKs to food_sources(food_id, id) ON DELETE NO ACTION (NO ACTION, not
-- RESTRICT: NO ACTION still blocks a direct food_sources-row delete that would orphan a golden value, but
-- defers its check to end-of-statement so a food-level ON DELETE CASCADE — which cascade-deletes both the
-- food_sources rows and the referencing value rows in one statement — still succeeds). fetch_queue
-- carries the leased_at lease column (§2, D-LEASE). Full column/constraint lists are in §2.

-- ── Migration reviewer checklist (DB-3) — the generated 0000 SQL MUST mirror §2 exactly on each of: ──
--   [ ] food_sources              : UNIQUE(food_id, id)  AND  UNIQUE(source, external_key)  AND
--                                    CHECK(fetch_state IN ('fetched','error'))                         (DB-2/DB-7)
--   [ ] composite same-food FKs   : food_nutrients / food_portions / food_field_provenance /
--                                    food_category_assignment each FK (food_id, source_id) →
--                                    food_sources(food_id, id) ON DELETE NO ACTION  (4× — NO ACTION, not RESTRICT) (DB-2)
--   [ ] nutrient                  : UNIQUE(external_code)  AND  UNIQUE(name, unit)                      (DB-5)
--   [ ] food_nutrients.amount     : CHECK(amount >= 0)   ;  food_portions.gram_weight: CHECK(gram_weight > 0)  (DB-6)
--   [ ] fetch_queue               : leased_at timestamptz  AND  CHECK(status IN ('pending','in_flight','tombstone')) (DB-1/DB-7)
--   [ ] indexes                   : idx_fetch_queue_priority (partial, status='pending')  AND
--                                    idx_fetch_queue_inflight_lease (partial, status='in_flight' — reaper path) (DB-8)
--   [ ] table count               : exactly 13 tables (no removed-design table re-appears)

-- Operational tables (keyed on food id)
CREATE TABLE fetch_queue ( ... );                -- demand-weighted Postgres-as-queue (food_id PK; leased_at lease)
CREATE TABLE fetch_requesters ( ... );           -- distinct-requester demand + per-sub pending count
CREATE TABLE source_call_log ( ... );            -- PER-SOURCE rolling 60-min window
CREATE TABLE source_sync_metadata ( ... );       -- source-neutral sync tracking

-- Indexes (see §2)
CREATE UNIQUE INDEX food_normalized_name_unique ON food (normalized_name);
CREATE INDEX food_status_idx ON food (status);
CREATE INDEX food_barcode_idx ON food (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX food_name_trgm_idx ON food USING gin (name gin_trgm_ops);
CREATE INDEX food_description_trgm_idx ON food USING gin (description gin_trgm_ops);
CREATE UNIQUE INDEX food_sources_source_key_unique ON food_sources (source, external_key);
CREATE INDEX food_sources_food_id_idx ON food_sources (food_id);
CREATE INDEX food_nutrients_food_id_idx ON food_nutrients (food_id);
CREATE INDEX food_nutrients_source_id_idx ON food_nutrients (source_id);
CREATE INDEX food_candidates_food_id_idx ON food_candidates (food_id);
CREATE INDEX idx_fetch_queue_priority ON fetch_queue (request_count DESC, first_requested ASC) WHERE status='pending';
CREATE INDEX idx_fetch_queue_inflight_lease ON fetch_queue (leased_at) WHERE status='in_flight'; -- DB-8 reaper path
CREATE INDEX idx_fetch_requesters_sub ON fetch_requesters (sub);
CREATE INDEX idx_source_call_log_source_called_at ON source_call_log (source, called_at);

-- NOTE — `ingredients` extensions are NOT part of 003. The `ingredients` table is owned by feature 001
-- and lives in a DIFFERENT logical database than kitchensink_food, so a cross-database FK to `food(id)`
-- is IMPOSSIBLE (Postgres has no cross-database foreign keys) and 003 cannot ALTER a table it does not
-- own. When 001 builds `ingredients`, IT adds a SOFT column (no cross-DB FK) — linkage validated at the
-- application layer (food-service client). Deferred as FU-INGREDIENTS.
--
--   -- (added by feature 001, not 003)
--   ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS food_id TEXT;  -- soft link to food(id), NO cross-DB FK
```

---

## 8. Monitoring & Observability

### CloudWatch Metrics

- `food-fetch-queue-depth` — Postgres `fetch_queue` pending-row depth
- `food-resolution-latency-seconds` — p50/p95/p99 from `202` to `RESOLVED` (SC-003)
- `source-rolling-window-count` — per-source calls in the trailing 60 min (USDA alarm approaching 900/1,000)
- `source-api-request-count` / `source-api-success-rate` — per-source success/failure
- `food-unresolved-backlog` — `UNRESOLVED` foods awaiting a human pick
- `food-failed-count` — **`FAILED`** tombstone rows only (all sources errored after the retry budget) — the alarmed signal
- `food-not-found-count` — **`NOT_FOUND`** tombstone rows (no source has the item) — queryable, **not** alarmed (a normal, common outcome: typos, branded/non-USDA items)
- `food-local-store-serve-rate` — share of reads served from the local store as a `RESOLVED` golden record with no source call (in-process LRU; Postgres fallback)
- `auth-401-rate` — auth-layer load-shed signal (FR-052; also surfaces a misconfigured `CLERK_JWT_KEY`)

### Alarms

- **`FAILED`** tombstone-row count > 0 → SNS alert. **`NOT_FOUND` tombstones are explicitly NOT alarmed**
  (DSN-9): "no source has this item" is a normal, frequent outcome (typos, branded/non-USDA foods), so
  alarming on it would page on routine operation. `NOT_FOUND` stays a queryable tombstone (with its 30-day
  TTL) and is **excluded** from the `FetchFailed`/SNS path; only `FAILED` (all sources errored after the
  FR-016 retry budget) raises an alert.
- API error rate > 5% → SNS alert
- queue depth > 10,000 (backpressure ceiling, FR-046) → SNS alert + fail-closed `503`
- `first_requested` of a pending row older than 5 min → queue-age alarm

---

## 9. Planning Decisions (settled)

These decisions were deferred at spec/brainstorm time; stabilization settles them. Items 1, 2, and 4 are
now **settled** by the applied `D-*` decisions; items 3 and 5 were already settled by the locked
architecture. None remains an open product call.

1. **Auto-`RESOLVED` boundary (settled — FR-MRG-5, D-AUTORESOLVE).** After pre-merge dedup the worker
   counts the candidates surviving **normalized-name exact match**: exactly **1 → `RESOLVED`** (merge it);
   **>1 → `UNRESOLVED`** (persist the surviving set to `food_candidates`, surface via `/candidates`);
   **0 → `NOT_FOUND`**. There is **no nutrient-tolerance test** (the `±10%` /
   `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE` knob is dropped) — the matcher need not be perfect, so it **biases
   toward `UNRESOLVED`** over a wrong auto-pick, with the human as the final arbiter (FR-RES-3). No open
   product call remains.

2. **`UNRESOLVED` candidate-set TTL (settled — FR-025a, D-UNRESOLVED-TTL).** An `UNRESOLVED` food is
   **kept until a human picks** — it is **never** swept to `NOT_FOUND`. Instead its **`food_candidates` set
   expires 30 days after `created_at`**; the next add-by-name request for that food **re-fans-out** against
   the normal per-source budget (mirroring the `NOT_FOUND` 30-day TTL). A human pick made before expiry
   still wins (→`RESOLVED`, no re-fan-out).

3. **Sync vs async candidate search (settled — locked architecture).** **Async.** `POST /v1/foods` returns
   `202` + `id` immediately and the worker fans out off the queue — the only option consistent with the
   per-source rolling-window limiter and the rate budget (a synchronous search could not be throttled
   without blocking the request and exposing a denial-of-wallet surface). No change needed; recorded to
   close the question.

4. **Change-detection mechanism on refresh (settled — D-REFRESH, FR-032).** USDA exposes no per-item etag,
   so change detection is **re-fetch + hash compare**: persist a per-item `food_sources.item_version`
   (source version or content hash of the mapped candidate) and compare on re-fetch — cheap, payload-free,
   already in the §2 DDL. The refresh runs as a **Fargate scheduled task** (low-priority idle-drain that
   yields to live demand; budget-bounded cadence) and re-enqueues via the ordinary
   `enqueue(food_id, 'svc_change_refresh')` path; it **never** overwrites a user's manual pick (§5).

5. **Source priority ranking (settled — FR-MRG-2).** USDA is the hard-coded default highest priority. Keep a
   static config-ordered list now (`['usda']`); promote to a DB-backed ranking only when a second source is
   wired. No schema change required at launch.

---

## 10. Implementation Order

1. **Packages + workspace wiring** — `@kitchensink/{food-service,usda-client,food-service-client,clerk-verify}`,
   register `packages/clients/*` (NFR-006).
2. **Global DataStack: `kitchensink_food` database** on the shared instance + food-service CDK + the
   in-VPC migration-runner Lambda (FU-MIGRATE).
3. **Canonical + operational schema** — `food`, `food_sources`, `nutrient`, `food_nutrients`,
   `food_portions`, `food_field_provenance`, `food_category(+assignment)`, `fetch_queue`,
   `fetch_requesters`, `source_call_log`, `source_sync_metadata`, indexes (build/test on Docker Postgres).
4. **Auth slice (US-0)** — `FoodAuthGuard` middleware + M2M + scopes/403 + fairness-by-demotion +
   backpressure + DoS (test-first).
5. **DAO/repository layer + source-adapter interface** — per-aggregate DAOs behind the `FoodsRepository`
   seam; the `FoodSourceAdapter` interface; the USDA adapter (`fdcId → external_key`).
6. **REST API endpoints** — `POST /v1/foods`, `GET /v1/foods/{id}` (+`/status`), `/candidates`,
   `PATCH /v1/foods/{id}`, `/search`, `/batch` (auth-gated; lifecycle status codes).
7. **Postgres fetch_queue + Fargate fan-out/merge worker** — LISTEN/NOTIFY, per-source rolling-window
   limiter, demotion at drain time, fan-out + golden-record merge, candidate handling, tombstones.
8. **Change-driven refresh (EventBridge scheduled)** + **monitoring/alarms**, then **WebSocket
   notifications** (P3, deferred).
