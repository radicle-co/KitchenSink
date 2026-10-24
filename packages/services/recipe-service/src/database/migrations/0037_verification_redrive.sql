-- 0037 — the pending-verification RE-DRIVE substrate (plan U4c, KTD-A).
--
-- Under withhold semantics a DLQ'd (or never-sent) verification is USER-VISIBLE harm: the line sits
-- `pending-verification` with its macros unaccounted until a verdict lands. So the producer stores every
-- withholding line's READY message here, keyed on the verdict store's own content key, and the scheduled
-- drain re-sends any row that is past the age bound and still has no verdict — the same
-- producer-builds/drain-sends DRY line as `resolution_band_skips` (0036).
--
-- ⛔ Keyed on verification_key, NOT on line id: two recipes quoting the same source line share one
-- judgement and need one re-drive; and the drain's no-verdict check is then a same-key LEFT JOIN with no
-- derivation anywhere — the one thing that CANNOT drift from what the worker writes.
--
-- Rows are never deleted by the drain (`last_driven_at` marks each attempt); a verdict landing simply makes
-- the row invisible to the join. Erasure ruling: the row carries a source line and a recipe id — the same
-- content class as the verification queue message and the verdict store, governed by the same rulings.

CREATE TABLE recipe_ingredient_verification_redrive (
    verification_key text PRIMARY KEY,
    -- The ready `VerifyIngredientLineMessage`, verbatim.
    message jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_driven_at timestamptz
);

-- The drain reads "aged rows, oldest first"; the verdict join uses the verdict store's own PK.
CREATE INDEX verification_redrive_age_idx ON recipe_ingredient_verification_redrive (created_at);

COMMENT ON TABLE recipe_ingredient_verification_redrive IS
    'U4c: withholding lines'' ready verification messages, re-sent by the drain while no verdict exists.';
