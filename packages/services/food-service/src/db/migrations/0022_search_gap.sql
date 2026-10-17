-- 0022 — the search-gap record: wording a cook used for a food our catalog holds under other words (ADR-0055 point 4,
-- plan 002 R66).
--
-- Hand-authored, ordered DDL applied once by the migration runner, which wraps this file in one transaction.
-- The Drizzle model in src/db/schema/searchGap.ts documents the same shape (`searchGap`).
--
-- ── What a row is ────────────────────────────────────────────────────────────────────────────────
--   The progressive search hides a remote hit for a food the catalog holds. When the root that holds it is not in
--   that answer's catalog results, the cook's words did not find a food we have, and `remoteHitTriage.ts` names the
--   hit a gap. One row per (query, source, item): the holding root and variant, the source's name for the item, and
--   how often and when it was seen. A curator reads the frequent recent rows and adds the wording to the root's
--   synonyms in the committed seed.
--
-- ── No user ──────────────────────────────────────────────────────────────────────────────────────
--   No requester, session or address. An ingredient phrase is not personal data (ADR-0027), and a count is all a
--   curator reads, so the account-erasure sweep has nothing here.
--
-- ── Counted under the row lock ───────────────────────────────────────────────────────────────────
--   `SearchGapDao.record` is one upsert that adds one to `occurrences`; the conflict takes the row's lock, so
--   concurrent searches of one gap each count once.
--
-- ── Bounded ──────────────────────────────────────────────────────────────────────────────────────
--   Each change-refresh run deletes the rows not seen within the retention period, beside the call ledger's prune.
--   A root the seed deletes takes its rows with it.
--
-- Additive only (ADR-0035): nothing reads this table until the release that writes it.

CREATE TABLE IF NOT EXISTS "search_gap" (
    "query" text NOT NULL,
    "source" "food_source" NOT NULL,
    "external_key" text NOT NULL,
    "food_id" text NOT NULL REFERENCES "food" ("id") ON DELETE CASCADE,
    "food_variant_id" text REFERENCES "food_variant" ("id") ON DELETE CASCADE,
    "remote_name" text NOT NULL,
    "occurrences" integer NOT NULL DEFAULT 1,
    "first_seen_at" timestamptz NOT NULL DEFAULT now(),
    "last_seen_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "search_gap_pkey" PRIMARY KEY ("query", "source", "external_key"),
    CONSTRAINT "search_gap_query_length" CHECK (char_length("query") BETWEEN 1 AND 200),
    CONSTRAINT "search_gap_counted" CHECK ("occurrences" >= 1),
    CONSTRAINT "search_gap_seen_in_order" CHECK ("last_seen_at" >= "first_seen_at")
);

-- The prune's predicate.
CREATE INDEX IF NOT EXISTS "search_gap_last_seen_idx" ON "search_gap" ("last_seen_at");

-- The two foreign keys, so a root's or a variant's delete finds its rows without a scan.
CREATE INDEX IF NOT EXISTS "search_gap_food_id_idx" ON "search_gap" ("food_id");
CREATE INDEX IF NOT EXISTS "search_gap_food_variant_id_idx" ON "search_gap" ("food_variant_id")
    WHERE "food_variant_id" IS NOT NULL;

COMMENT ON TABLE "search_gap" IS
    'Remote hits the progressive search hid because the catalog holds their item under a root absent from that answer: the cook''s wording for a food we have. One row per query, source and item, counted. No user.';
