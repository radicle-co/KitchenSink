-- 0012 — the FNDDS/WWEIA consumption prior (plan U5, KTD-G).
--
-- ⛔ A SIBLING TABLE, never a `food` column: golden scalars are merge-engine-owned, and a popularity
-- column on `food` would be clobbered by the next merge or contended between two writers with different
-- authorities. This table has exactly ONE writer — the operator-run `seed:fndds-prior` command — and the
-- search statement LEFT JOINs it (an absent row IS a prior of zero; "no measured consumption" must never
-- rank below "measured zero").
--
-- `prior_fraction` is NORMALIZED AT SEED TIME into [0, 1] against a fixed reference ceiling (the seed
-- command owns the constant), so the ranking renderings compose it with one multiply and the ladder bound
-- (`PRIOR_BONUS_MAX`) needs no knowledge of the raw weights' scale. `consumption_weight` keeps the raw
-- figure for audit and re-normalization.

CREATE TABLE food_popularity (
    food_id text PRIMARY KEY REFERENCES food(id) ON DELETE CASCADE,
    -- Survey-weighted grams-independent consumption weight (NHANES day-1 WTDRD1 sums), raw.
    consumption_weight numeric NOT NULL CHECK (consumption_weight >= 0),
    -- The fused fraction, normalized at seed time.
    prior_fraction numeric NOT NULL CHECK (prior_fraction >= 0 AND prior_fraction <= 1),
    -- The vintage/cycle the seed derived from, for the audit trail (e.g. 'fndds-2021-2023+nhanes-2021-2023-day1').
    source text NOT NULL,
    seeded_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE food_popularity IS
    'U5: FNDDS/WWEIA consumption prior, operator-seeded; LEFT JOINed by search ranking (fusion-only).';
