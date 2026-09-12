-- 0042_per_aspect_verdicts.sql (owner ruling 2026-08-31, U15 report "Owner rulings" §4) — the model's
-- per-aspect answers on a verification verdict.
--
-- ⛔ THE JOINT VERDICT CONFLATES IDENTITY WITH QUANTITY. The gate asks about both aspects in one call and
-- records ONE verdict, so "a small piece of butter" bound to "Butter, salted" lands `disagree` on an
-- unparseable amount while the identity is right — U15's 39% contradicted rate is therefore an UPPER BOUND
-- on identity error, unreadable further. The prompt now also asks for a per-aspect verdicts object, and
-- these two columns store it. The consumer is U13's ambiguity-review surface, whose rule is: surface a
-- line for human re-pick only when the JOINT verdict is `disagree` AND `identity_verdict` here is
-- `disagree` at high certainty — never on a quantity-only dispute.
--
-- ⚠️ NULLABLE, and NULL is a statement: the answer carried no aspects object (a verdict written before this
-- migration, or a model that omitted it). ⛔ Never backfill NULL from the joint verdict — copying a joint
-- `disagree` into `identity_verdict` would re-create the conflation for the whole pre-0042 population and
-- surface every quantity dispute in front of a human.
--
-- The CHECKs mirror the wire enum (`VERIFICATION_VERDICTS`) so a typo'd value fails the INSERT rather than
-- becoming a silent third series no reader queries.

ALTER TABLE recipe_ingredient_verifications
    ADD COLUMN identity_verdict text,
    ADD COLUMN quantity_verdict text;

ALTER TABLE recipe_ingredient_verifications
    ADD CONSTRAINT recipe_ingredient_verifications_identity_verdict_valid
        CHECK (identity_verdict IS NULL OR identity_verdict IN ('agree', 'disagree', 'abstain')) NOT VALID,
    ADD CONSTRAINT recipe_ingredient_verifications_quantity_verdict_valid
        CHECK (quantity_verdict IS NULL OR quantity_verdict IN ('agree', 'disagree', 'abstain')) NOT VALID;

COMMENT ON COLUMN recipe_ingredient_verifications.identity_verdict IS
    'The model''s verdict on identity alone (0042). NULL: the answer carried no aspects object.';
COMMENT ON COLUMN recipe_ingredient_verifications.quantity_verdict IS
    'The model''s verdict on quantity alone (0042). NULL: the answer carried no aspects object.';
