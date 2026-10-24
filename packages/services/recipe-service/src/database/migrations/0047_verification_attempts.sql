-- 0047 — verification ATTEMPT bookkeeping (plan U7, R6/R9/R18/R19).
--
-- ⛔ WHY. The verification gate reserves spend, calls Bedrock, and only then computes the verification key
-- and records what it concluded. Every input to that key comes from the MESSAGE — the source line, the food
-- id, the quantity pair, the unit, the restated measure — so it could have been computed first, and a
-- duplicate delivery could have been answered for free. It was not, so a redelivery pays the model again to
-- reach a judgement already stored under the same key.
--
-- ⛔ WHY A SEPARATE TABLE RATHER THAN COLUMNS ON THE VERDICT. Because the thing being counted happens when
-- there is no verdict yet. `recipe_ingredient_verifications` is keyed on the judgement, and a row in it is
-- read by the publish path as "this line was judged"; writing a placeholder row to hold a counter would be
-- read as a verdict — and an absent verdict is the ONLY thing that publishes, so a placeholder would either
-- suppress publication of a line nobody judged or manufacture a verdict nobody reached. Neither is
-- acceptable, and both are invisible downstream.
--
-- ⛔ KEYED ON (verification_key, model_id), not on the key alone. The verdict store's supersede rule already
-- says a re-verification under a NEWER model replaces an older judgement rather than being dropped; the
-- counter has to agree with that, or a line that exhausted its attempts under last quarter's model could
-- never be verified under this one.
--
-- The row is CLAIM and COUNTER together: `last_received_at` is the lease that refuses a concurrent duplicate,
-- exactly as `recipe_parse_job_lines.last_received_at` does for the parse leg (0046), and `attempts` is the
-- count the allowance is compared against. The settle deletes the row in the same statement that writes the
-- verdict, so a judged line carries no bookkeeping.

CREATE TABLE recipe_verification_attempts (
    verification_key text NOT NULL,
    model_id text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    last_received_at timestamptz NOT NULL DEFAULT now(),
    failure_code text,
    PRIMARY KEY (verification_key, model_id)
);

COMMENT ON TABLE recipe_verification_attempts IS
    'U7: the verification gate''s claim + delivery counter for a line with no verdict yet. Deleted when the verdict lands.';
COMMENT ON COLUMN recipe_verification_attempts.last_received_at IS
    'U7: the claim lease — a duplicate delivered while the first attempt is still running is refused.';
COMMENT ON COLUMN recipe_verification_attempts.failure_code IS
    'U7: why the gate stopped trying. The line then publishes UNVERIFIED, which is what an absent verdict has always meant.';
