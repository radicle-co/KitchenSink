-- 0035 — `ingredient_resolutions`: the cascade's provenance EVENTS (plan U2, KTD-C).
--
-- ⛔ WHY THIS TABLE EXISTS. `resolveThroughCascade` kept only the foodId — no column anywhere recorded
-- which tier answered — so every verification message shipped `unattributedEvidence()` and a curated hit
-- paid for an identity check its tier had already established. Worse, the band log (plan U3) cannot be
-- built from outcomes nobody recorded. This table is that record.
--
-- ⚠️ EVENTS, not line columns, deliberately: an `ingredients` row is SHARED (one row per food_id, warm
-- re-references skip the cascade entirely), so a resolution is a fact about one admission at one moment —
-- an event keyed by ingredient, read latest-first — never a property of the shared row.
--
-- ⚠️ NO `user_id`, deliberately, for now: R20's per-user dimension (author-augmented shortlists excluded
-- from shared band statistics) arrives with plan U11 TOGETHER WITH its erasure ruling — a user-keyed
-- column without a ruling lands RED in the erasure-coverage gate with no ADR to cite. Until then every
-- shortlist this table can hold is public-catalog data. Additive, expand-first when U11 lands.
--
-- Columns the band log (U3) will read: `rung`, `margin`, `shortlist`, `band_epoch` — all nullable because
-- today's tiers (curated, memo) rank nothing; the lexical tier (U4) is what populates them.

CREATE TABLE ingredient_resolutions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    -- A RESOLUTION_TIER_IDS member. CHECKed so a typo'd tier is refused at the write, not discovered when
    -- the producer maps it onto evidence.
    tier text NOT NULL CHECK (tier IN ('curated', 'lexical', 'memo', 'llm')),
    -- The winner's rank rung (RankTier member), null for tiers that rank nothing.
    rung text,
    -- top - runnerUp, null when there was no runner-up. Raw value; band BUCKETING is calibration (U3).
    margin numeric,
    -- The FULL structured shortlist snapshot (ScoredCandidate[]: foodId, score, per-100g nutrients) —
    -- KTD-C: a digest cannot rebuild what the gate's re-run reads. Null for non-ranking tiers.
    shortlist jsonb,
    -- The band authority epoch the resolution was made under (plan U3). Null until bands exist.
    band_epoch text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The producer's read is "latest event per ingredient", batched over a save's ingredient ids.
CREATE INDEX ingredient_resolutions_latest_idx
    ON ingredient_resolutions (ingredient_id, created_at DESC);

COMMENT ON TABLE ingredient_resolutions IS
    'U2: cascade resolution provenance events — which tier answered, with what ranked evidence. '
    'The band log''s substrate and the verification producer''s evidence source.';
