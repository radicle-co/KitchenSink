-- 0003: add `food.origin` ('live' | 'bulk') — the marker that excludes bulk-seeded foods from the LIVE
-- change-refresh scan (ingredient-search plan §2 Stage 1, resolution F-C2 / round-3 F3).
--
-- Hand-authored, ordered DDL applied once by the in-VPC migration runner (see
-- src/lambdas/migrate/handler.ts). The runner wraps this file in a single BEGIN/COMMIT, so it must NOT
-- open its own transaction. The Drizzle definition in src/db/schema/food.ts documents the same
-- post-migration shape (`foodOriginEnum` + `food.origin`).
--
-- ── WHY THIS COLUMN EXISTS — CORRECTNESS, NOT JUST QUOTA (read before removing the gate) ────────────
--   Stage 1 seeds ~8k Foundation + SR Legacy foods as RESOLVED golden records straight from the USDA
--   BULK download. `ChangeRefreshConsumer` then scans every RESOLVED food's backing items and does a
--   LIVE `fetchByKey` per item to compare `food_sources.item_version`
--   (worker/change-refresh/change-refresh.consumer.ts, worker/food-consumer.service.ts refresh branch).
--   A bulk-seeded crosswalk row's `item_version` is derived from the bulk file's CONTENT, so it can
--   never equal an API `publicationDate`. Left unexcluded, that produces TWO failures:
--     (1) DATA CORRUPTION — every sweep sees "changed", re-enqueues the food forever, and the drain's
--         `mergeChangedSources` overwrites the lab-analyzed BULK nutrition with API values; and
--     (2) QUOTA DRAIN — ~8k live re-fetches per sweep against the SHARED 1,000/hr per-IP USDA window
--         (~8h/sweep), starving interactive demand. SR Legacy is a FROZEN dataset that never changes
--         upstream, so those calls are pure waste.
--   Bulk-origin foods are re-freshened from the NEXT bulk download, never from the live API.
--
-- ── WHY ON `food` AND NOT `food_sources.fetch_state` ───────────────────────────────────────────────
--   `fetch_state` is CHECK-constrained to ('fetched','error') AND is overwritten by EVERY `upsertSource`
--   call, so a marker there would be silently clobbered on the next write. `origin` is a stable property
--   of the golden record, and `listResolvedBackingItems` already joins `food_sources -> food`, so the
--   exclusion is a clean `AND f.origin <> 'bulk'` on a join that already exists.
--
-- ── BACKFILL ──────────────────────────────────────────────────────────────────────────────────────
--   `NOT NULL DEFAULT 'live'` backfills every pre-existing row to 'live' as part of the ADD COLUMN
--   (PostgreSQL 11+ stores the default in the catalog, so this is metadata-only — no table rewrite, no
--   long lock). 'live' is the correct default: every food that exists before this migration was admitted
--   through the live API path and MUST stay in the change-refresh scan.
--
-- ── NO INDEX, DELIBERATELY ────────────────────────────────────────────────────────────────────────
--   `listResolvedBackingItems` drives from `food_sources` and joins `food` on its PRIMARY KEY, so the
--   `origin` predicate is evaluated per already-fetched row — an index on `origin` cannot accelerate it.
--   Add a composite `(status, origin)` index only if the planner is later shown to prefer `food` as the
--   driving relation on a materially larger table.
--
-- @implements FR-031 FR-032

CREATE TYPE "food_origin" AS ENUM ('live', 'bulk');

ALTER TABLE "food" ADD COLUMN "origin" "food_origin" NOT NULL DEFAULT 'live';

COMMENT ON COLUMN "food"."origin" IS
    'Where this golden record''s data came from: ''live'' (source API, refreshed by the change-refresh scan) or ''bulk'' (USDA bulk download, EXCLUDED from the live scan and re-freshened from the next bulk file). See migration 0003.';
