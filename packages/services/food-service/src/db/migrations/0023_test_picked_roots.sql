-- 0023 — the test principal's picked roots: which catalog roots a TEST PRINCIPAL's remote pick created, so the test
-- purge can take them back (ADR-0040 food half; owner ruling 2026-10-16, "Clean up test-picked foods").
--
-- Hand-authored, ordered DDL applied once by the migration runner, which wraps this file in one transaction.
-- The Drizzle model in src/db/schema/testPickedRoot.ts documents the same shape (`testPickedRoot`).
--
-- ── Why a table of its own ───────────────────────────────────────────────────────────────────────
--   A remote pick turns a source's hit into a new CATALOG root (ADR-0055 point 4), and a catalog root has no author:
--   `food.user_id IS NULL` is what defines one (0013's CHECK, the live-root queries, the name dedup). Setting
--   `user_id` would turn the root into an authored food, so the attribution cannot live on `food`.
--
-- ── What a row is ────────────────────────────────────────────────────────────────────────────────
--   One row per root, written in the pick's own transaction, and ONLY when the pick's caller is a signed test
--   principal. A real cook's pick writes nothing, so the table can never name a root a real cook made.
--   `held_by_real_user` is set when a real cook later answers the root (a pick of the same item, or of a hit the
--   root now hides): the purge keeps a held root, because a normal cook's flow may depend on it.
--
-- ── Personal data ────────────────────────────────────────────────────────────────────────────────
--   `created_by` is the app-user ULID of a pool user, never of a person: a row exists only for a signed test
--   principal. It goes with its root (ON DELETE CASCADE), and the account-erasure sweep deletes the rows by
--   `created_by`.
--
-- Additive only (ADR-0035): nothing reads this table until the release that writes it.

CREATE TABLE IF NOT EXISTS "test_picked_root" (
    "food_id" text PRIMARY KEY REFERENCES "food" ("id") ON DELETE CASCADE,
    "created_by" text NOT NULL,
    "held_by_real_user" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "test_picked_root_created_by_present" CHECK (char_length("created_by") > 0)
);

-- The purge's predicate, and the erasure sweep's.
CREATE INDEX IF NOT EXISTS "test_picked_root_created_by_idx" ON "test_picked_root" ("created_by");

COMMENT ON TABLE "test_picked_root" IS
    'Catalog roots a signed test principal''s remote pick created, so the test purge can remove them. Never written for a real cook; held_by_real_user keeps a root a real cook has since answered.';
