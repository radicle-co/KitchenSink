-- 0040 — private-food visibility scoping across the shared tiers (plan U11, R20).
--
-- ── ingredients.food_owner_id: the captured privacy fact ──────────────────────────────────────────
--   The shared `ingredients` catalog holds ONE row per food id, and a private authored food's row would
--   otherwise surface its NAME in every user's local search/suggest. ADR-0006 forbids a cross-database
--   join, so the privacy fact is CAPTURED at admission exactly as `prior_fraction` (0038) is: when the
--   admitting caller's `FoodResponse` says `visibility: 'private'`, the caller IS the author (the
--   authorship policy 404s everyone else), so their ULID lands here; any other visibility (catalog,
--   promoted) captures NULL. `refreshStatus` re-captures, so U12's promotion clears it on next touch.
--
--   Every local retrieval surface filters `(food_owner_id IS NULL OR food_owner_id = :caller)` — the
--   recipe-side half of R20's boundary (the food-service search carries the other half in its own
--   predicate).
--
--   Erasure (R24): rows for a dead author's private foods are DELETED when nothing references them, and
--   RETAINED (pseudonymous ULID, the recipes/owner_id posture) when a kept public recipe still needs the
--   line's name — still hidden from every search by this very filter, since the dead author never
--   searches again.
--
-- ── ingredient_resolutions.author_augmented: the band-statistics exclusion ────────────────────────
--   A shortlist that contained the caller's own private food ranks DIFFERENTLY than any other user's
--   identical query — its margins are facts about one user's catalog, not the shared ranker. Band
--   authority (U3) is earned from SHARED evidence only, so a ranked resolution over an author-augmented
--   shortlist records the flag, records NO band epoch, and its verification is excluded from band
--   feedback and skip-eligibility on both sides of the queue.

ALTER TABLE "ingredients" ADD COLUMN "food_owner_id" varchar(255);
CREATE INDEX "idx_ingredients_food_owner" ON "ingredients" ("food_owner_id") WHERE "food_owner_id" IS NOT NULL;

ALTER TABLE "ingredient_resolutions" ADD COLUMN "author_augmented" boolean DEFAULT false NOT NULL;
