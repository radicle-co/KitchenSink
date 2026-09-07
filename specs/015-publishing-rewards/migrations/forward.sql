-- 0026_publishing_rewards.sql (feature 015) — the publishing-reward ledger.
--
-- EXPAND-ONLY. Four new tables, no existing object modified, so old and new code run concurrently against
-- this schema (ADR-0022 expand-first precondition).
--
-- ⛔ TABLE NAME: `recipe_public_listings`, NOT `recipe_publications`. `recipes.status` is already
-- NOT NULL DEFAULT 'published' and is a SECURITY boundary meaning "not a draft" — which is NOT what 015
-- means by publishing (making a recipe public). Two adjacent concepts named "published", one of them a
-- security boundary, is how an authz bug gets written.
--
-- ⛔ NO RATING COLUMNS HERE. `recipes.average_rating` / `recipes.rating_count` already exist (0010), are
-- maintained ONLY by the recipe_ratings_aggregate_refresh() trigger, and are guarded by
-- recipes_rating_aggregate_coherent. Duplicating them would create a second source of truth with nothing
-- keeping it honest. Ratings are READ FROM `recipes`.
--
-- ⛔ NUMBER IS 0026. It was 0024, then 0025, and both were taken by concurrent work (5cd53969). The runner sorts by filename and journals on the FULL filename, so a prefix is a sort
-- key and not an identity — but RE-CHECK the directory before writing this file; the number is not stable
-- while multiple sessions share one worktree.

-- ── §1. The publication record ────────────────────────────────────────────────
-- One row per act of making a recipe public. The authorship attestation (FR-002) lives HERE and not on
-- `recipes`, because FR-022 ties its retention to the publication it supports, not to the recipe.
CREATE TABLE IF NOT EXISTS recipe_public_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id UUID NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    -- App-user ULID from the token claim. No local users table (D2) — never a FK.
    owner_id VARCHAR(255) NOT NULL,
    listed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- FR-002: explicit, per-recipe, recorded at the moment of publication. A blanket ToS acceptance
    -- MUST NOT substitute, which is why this is a timestamp on the act and not a flag on the account.
    attestation_accepted_at TIMESTAMPTZ,
    -- FR-003/FR-004: the decision made at CONFIRM, and why. Stored so the eligibility a user was shown,
    -- the one applied, and the one reported can be proven identical after the fact.
    eligibility_decision TEXT NOT NULL,
    eligibility_reason TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'listed',
    CONSTRAINT recipe_public_listings_decision_check CHECK (eligibility_decision IN ('eligible', 'ineligible')),
    CONSTRAINT recipe_public_listings_state_check CHECK (state IN ('listed', 'unlisted_by_owner', 'removed_on_notice')),
    -- FR-002: an eligible listing without an attestation is a defect, not a data-quality issue (SC-002).
    CONSTRAINT recipe_public_listings_attestation_required CHECK (
        eligibility_decision = 'ineligible' OR attestation_accepted_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_public_listings_owner ON recipe_public_listings (owner_id);
CREATE INDEX IF NOT EXISTS idx_public_listings_recipe ON recipe_public_listings (recipe_id);

-- ── §2. The append-only grant ledger ──────────────────────────────────────────
-- FR-009 (append-only, inspectable) + FR-007b (permanent). The ONLY permitted mutation is setting
-- reversed_at via the FR-016 takedown path. No UPDATE of amount, no DELETE, ever.
CREATE TABLE IF NOT EXISTS reward_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES recipe_public_listings (id) ON DELETE CASCADE,
    owner_id VARCHAR(255) NOT NULL,
    kind TEXT NOT NULL,
    amount INTEGER NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reversed_at TIMESTAMPTZ,
    reversal_reason TEXT,
    -- Natural key: a recipe earns AT MOST ONCE in its lifetime (FR-005), so one grant per listing per kind.
    CONSTRAINT reward_grants_once_per_listing UNIQUE (listing_id, kind),
    CONSTRAINT reward_grants_kind_check CHECK (kind IN ('slot', 'milestone')),
    CONSTRAINT reward_grants_amount_positive CHECK (amount > 0),
    CONSTRAINT reward_grants_reversal_coherent CHECK (
        (reversed_at IS NULL AND reversal_reason IS NULL) OR (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_reward_grants_owner_active ON reward_grants (owner_id) WHERE reversed_at IS NULL;

-- ── §3. Impact signals + standing ─────────────────────────────────────────────
-- ⛔ AGGREGATE-ONLY (012-FR-024). No viewer id, no visitor id, no IP, no session — not now, not later.
-- A column identifying WHO cooked a recipe MUST NOT be added here; that is a different feature with a
-- different privacy analysis.
CREATE TABLE IF NOT EXISTS recipe_impact_signals (
    recipe_id UUID PRIMARY KEY REFERENCES recipes (id) ON DELETE CASCADE,
    cook_count INTEGER NOT NULL DEFAULT 0,
    save_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT impact_signals_nonneg CHECK (cook_count >= 0 AND save_count >= 0)
);

-- FR-007i, the ratchet: standing is monotonic — tier may NEVER decrease.
--
-- ⛔ A ROW-LEVEL CHECK CANNOT EXPRESS THIS, AND AN EARLIER DRAFT OF THIS FILE GOT IT WRONG.
-- That draft carried `highest_tier_reached` plus `CHECK (tier >= highest_tier_reached)`. It was tested
-- adversarially against a live Postgres and it FAILED: lowering BOTH columns in one statement
-- (`SET tier = 1, highest_tier_reached = 1`) satisfies the CHECK, and standing fell 3 → 1. A CHECK only
-- ever sees the candidate row; "never decreases" compares OLD to NEW and is therefore a TRANSITION
-- constraint, which in Postgres means a trigger. The second column was also redundant once monotonicity
-- actually holds — if tier can never fall, tier IS the highest ever reached.
CREATE TABLE IF NOT EXISTS contributor_standing (
    owner_id VARCHAR(255) PRIMARY KEY,
    tier SMALLINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT contributor_standing_tier_nonneg CHECK (tier >= 0)
);

CREATE OR REPLACE FUNCTION contributor_standing_ratchet() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tier < OLD.tier THEN
        RAISE EXCEPTION 'contributor standing is monotonic (FR-007i): tier cannot fall from % to %',
            OLD.tier, NEW.tier
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contributor_standing_ratchet ON contributor_standing;
CREATE TRIGGER trg_contributor_standing_ratchet
    BEFORE UPDATE ON contributor_standing
    FOR EACH ROW EXECUTE FUNCTION contributor_standing_ratchet();

-- ── §4. ⛔ RESTITUTION BACKFILL — DO NOT UNCOMMENT WITHOUT THE §3 DECISION ─────
-- See migration-plan.md §3. The DEFAULT position is now Option C, DO NOTHING: the programme is
-- forward-looking, everyone gets identical terms from launch, and free users already have a
-- private-in-effect state (status='draft' is owner-only and is NOT premium-gated). What remains is an
-- EQUITY question, not a lockout: pre-existing public recipes are "spent" under FR-005 (one grant per
-- recipe lifetime), so a user who already gave 30 recipes earns nothing for them while a newcomer is
-- granted 2 slots for doing it once.
--
-- ⛔ AN EARLIER DRAFT OF THIS BLOCK WAS INCOHERENT. It marked listings 'ineligible' purely to satisfy
-- recipe_public_listings_attestation_required, then granted a slot against them. Ineligible means EARNS
-- NOTHING. The three structural changes below are what restitution actually requires.
--
-- ⛔ REQUIRES: an owner decision (§3), AND an explicit SC-002 carve-out in spec.md — SC-002 currently says
-- 100% of rewarded publications carry an attestation, and these do not. Restitution does NOT reopen the
-- FR-001 inducement hazard, because inducement is prospective: a grant for a publication that already
-- happened cannot have motivated it.
--
-- validation.sql Q5 detects whether this ran.
--
-- -- (1) a third, honest decision value: a real historical publication with no attestation
-- ALTER TABLE recipe_public_listings DROP CONSTRAINT recipe_public_listings_decision_check;
-- ALTER TABLE recipe_public_listings ADD CONSTRAINT recipe_public_listings_decision_check
--     CHECK (eligibility_decision IN ('eligible', 'ineligible', 'grandfathered'));
-- ALTER TABLE recipe_public_listings DROP CONSTRAINT recipe_public_listings_attestation_required;
-- ALTER TABLE recipe_public_listings ADD CONSTRAINT recipe_public_listings_attestation_required
--     CHECK (eligibility_decision <> 'eligible' OR attestation_accepted_at IS NOT NULL);
--
-- -- (2) restitution is its own kind, so it is never misread as a scheduled grant
-- ALTER TABLE reward_grants DROP CONSTRAINT reward_grants_kind_check;
-- ALTER TABLE reward_grants ADD CONSTRAINT reward_grants_kind_check
--     CHECK (kind IN ('slot', 'milestone', 'restitution'));
--
-- -- (3) the backfill itself. Idempotent: ON CONFLICT DO NOTHING on the (listing_id, kind) natural key.
-- --     NOTE: this implements Option A (flat 1 per recipe). Option B (retroactive FR-007a schedule) needs
-- --     a window function over each owner's corpus ordered by created_at — see migration-plan.md §3.
-- INSERT INTO recipe_public_listings (recipe_id, owner_id, listed_at, attestation_accepted_at,
--                                     eligibility_decision, eligibility_reason, state)
-- SELECT r.id, r.owner_id, r.created_at, NULL, 'grandfathered',
--        'pre-dates publishing rewards; published under 001-FR-003', 'listed'
--   FROM recipes r
--  WHERE r.visibility = 'public'
--    AND r.source_type = 'user_created'
--    AND r.deleted_at IS NULL
--    AND r.status = 'published'
-- ON CONFLICT DO NOTHING;
--
-- INSERT INTO reward_grants (listing_id, owner_id, kind, amount, granted_at)
-- SELECT l.id, l.owner_id, 'restitution', 1, now()
--   FROM recipe_public_listings l
--  WHERE l.eligibility_decision = 'grandfathered'
-- ON CONFLICT (listing_id, kind) DO NOTHING;
