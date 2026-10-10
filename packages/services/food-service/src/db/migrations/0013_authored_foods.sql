-- 0013: the authored-foods substrate (plan U10, origin D8/D9a/KTD-H; owner rulings 2026-08-30 Q3a-c).
--
-- Hand-authored, ordered DDL applied once by the in-VPC migration runner. The runner wraps this file in
-- a single BEGIN/COMMIT, so it must NOT open its own transaction. The Drizzle definition in
-- src/db/schema/food.ts documents the same post-migration shape.
--
-- ── WHAT AN AUTHORED FOOD IS (D8, narrowly) ────────────────────────────────────────────────────────
--   A SUBSTANCE a user authored — T150's "a recipe is a method, not a substance" is preserved, and this
--   amends the single-writer ruling deliberately: the USDA pipeline stays the single writer of CATALOG
--   rows (user_id IS NULL); an authored row (user_id IS NOT NULL) has exactly one writer too — its
--   author. Provenance is STRUCTURAL, never a wire field (D9a): an authored food has NO food_sources
--   crosswalk row, which keeps it out of both refresh scans by construction (they drive from
--   food_sources), and the authored CREATE route is the only door that writes user_id.
--
-- ── VISIBILITY (Q3c): author-PRIVATE until promoted ────────────────────────────────────────────────
--   The CHECK makes the illegal states unrepresentable rather than policed in code: a catalog row is
--   'public' and nothing else; an authored row is 'private' or 'promoted', never 'public' — promotion
--   (U12, cross-author agreement) is the ONLY route out of private, and an orphaning erasure can never
--   accidentally flip a private food public because clearing user_id under 'private' violates the CHECK.
--
-- ── THE DEDUP SPLIT (KTD-H) — the delicate piece, expand-first ─────────────────────────────────────
--   The full-table `food_normalized_name_unique` becomes TWO partial uniques:
--     catalog-unique WHERE user_id IS NULL   (exactly the old constraint over exactly the old rows —
--                                             every pre-0013 row has user_id NULL, so creating it before
--                                             the drop can never fail on live pr-{N} clones), then
--     per-(normalized_name, user_id) WHERE user_id IS NOT NULL
--   so two authors may own the same name, one author may not own it twice, and an authored name may
--   SHADOW a catalog name (resolution ranking, not uniqueness, decides what a search shows). The old
--   index is DROPPED, not renamed: its semantics change (full → partial), and ADR-0027's
--   rename-don't-recreate discipline is for an index whose meaning survives — pretending continuity
--   here would misdescribe the constraint. The expand-first ordering (create replacement, then drop)
--   is the same discipline's real content: at no statement boundary is the catalog unprotected.
--
-- ── NULLABLE PROVENANCE ON VALUES (KTD-H's consequence) ────────────────────────────────────────────
--   food_nutrients.source_id / food_portions.source_id become NULLABLE. The composite same-food FK is
--   MATCH SIMPLE (the default), so enforcement is skipped when source_id IS NULL and enforced when
--   present — exactly the documented D-PROVENANCE-FK posture food_category_assignment has had since
--   0000. A NULL source on a value row means "the food's author wrote this" (the food's user_id names
--   who); the merge engine never touches an authored food (no crosswalk row), so the writer discipline
--   cannot collide.
--
-- ── ERASURE (R24) ──────────────────────────────────────────────────────────────────────────────────
--   food is now a user-bearing table; `eraseFoodRows` sweeps it in the same change (the U17 gate goes
--   red otherwise). At U10 every authored food is private and bindable only by its author, so the
--   interim sweep is DELETE (Q3b's unreferenced arm); U18 refines to delete-or-orphan with the
--   tombstone-first reference check once promotion (U12) makes cross-author references possible.
--
-- ── `origin` IS DELIBERATELY UNTOUCHED ─────────────────────────────────────────────────────────────
--   0003's enum ('live'|'bulk') is a refresh-scan marker, and both scans drive from food_sources — an
--   authored food is invisible to them structurally. A third enum value would be redundant machinery
--   beside the real provenance marker (user_id), and enum members are one-way doors.

ALTER TABLE "food" ADD COLUMN "user_id" varchar(255);
ALTER TABLE "food" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;

ALTER TABLE "food" ADD CONSTRAINT "food_visibility_coherent" CHECK (
    ("user_id" IS NULL AND "visibility" = 'public')
    OR ("user_id" IS NOT NULL AND "visibility" IN ('private', 'promoted'))
);

-- Expand first: the catalog partial recreates the old constraint over exactly the old rows…
CREATE UNIQUE INDEX "food_normalized_name_catalog_unique" ON "food" USING btree ("normalized_name")
    WHERE "user_id" IS NULL;
-- …then the full-table original goes, then the per-author half arrives.
DROP INDEX "food_normalized_name_unique";
CREATE UNIQUE INDEX "food_normalized_name_per_author_unique" ON "food" USING btree ("normalized_name", "user_id")
    WHERE "user_id" IS NOT NULL;

-- The erasure sweep's predicate and the author's own listing. Partial: catalog rows never match either.
CREATE INDEX "idx_food_user_id" ON "food" USING btree ("user_id") WHERE "user_id" IS NOT NULL;

ALTER TABLE "food_nutrients" ALTER COLUMN "source_id" DROP NOT NULL;
ALTER TABLE "food_portions"  ALTER COLUMN "source_id" DROP NOT NULL;
