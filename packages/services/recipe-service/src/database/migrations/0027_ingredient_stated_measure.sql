-- 0027_ingredient_stated_measure.sql (plan U7/U11) — the amount and unit the SOURCE printed, beside the
-- restatement the food catalog can actually weigh.
--
-- ⛔ THIS IS THE COLUMN THAT STOPS THE VERIFICATION GATE MANUFACTURING A FALSE DISAGREE. The importer
-- restates a historical measure at parse time: `convertHistoricalUnit` reads `one gill of milk` and returns
-- BOTH halves — `stated: 1 gill` and `restated: 0.5 cup` — because the USDA household-portion table carries
-- `cup` and has never heard of a gill. Only the restated half reached this service: `restateHistoricalUnit`
-- overwrites the candidate line's `quantity`/`unit`, and `toImportedIngredientLine` builds the create body
-- from those. The stated half survived as PROSE only, in `notes` and `source_line`.
--
-- U11's gate then builds its question from `recipe_ingredients.quantity`/`unit` (via `verifiedLineIdentity`),
-- so the model was shown a source line reading `one gill of milk` beside a parse claiming `0.5 cup` and asked
-- whether they agree. They do not, and the model is right to say so — about a line we parsed CORRECTLY. U11
-- names the false-disagree rate as "the number that triggers a rethink" for exactly this reason: a wrong
-- AGREE passes data that would have shipped anyway, while a wrong DISAGREE withholds nutrition from a correct
-- line, which is worse than having no gate at all.
--
-- ⚠️ IT OVERTURNS A PREMISE U7 RECORDED, and the two docstrings carrying that premise are corrected in the
-- same change. `RangeDerivedBound` (`recipe-core/src/nutrition.ts`) and `RecipeNutrition.rangeDerivedBound`
-- (`recipe.types.ts`) both argue that a historical unit "is restated at IMPORT time, upstream of the wire and
-- by a tool, so there is no read-time step to disclose and no column to disclose it in" — and instruct the
-- reader not to "restore the symmetry". The gate IS a read-time consumer of the stated pair, and "a fact with
-- one producer and no reader" is no longer true. What remains true, and is why this is not the symmetry those
-- notes refused: the marker is still NOT on the RESPONSE wire and still not shown to a cook through a
-- structured field. It is write-side provenance, exactly as `source_line` is.
--
-- ⛔ NOT `display_text` AND NOT `notes`. Migration 0024 already made this argument for `source_line` and it
-- holds identically here: `display_text` is a label the AUTHOR chose, free-form and overwritable, while this
-- is a machine-checkable pair the gate reads. A prose sentence in the recipe description ("historical measures
-- were converted…") is a disclosure to a HUMAN and cannot be compared against a number.
--
-- ⛔ NOT ONE COLUMN HOLDING `1 gill`. The gate compares an amount, a bound and a unit separately, and the
-- restated half is already three columns for that reason. A single text column would have to be re-parsed by
-- the very parser under test, which is the circularity 0024's header refuses in its own case.
--
-- ── THE COHERENCE CHECK, AND THE ONE INVARIANT IT DELIBERATELY OMITS ──
--
-- `recipe_ingredients_stated_measure_coherent` makes the pair's own illegal states unrepresentable:
--
--   * a stated quantity with no stated unit → REJECTED. A restated amount that cannot name what it was
--     restated FROM is indistinguishable from a directly-stated one, which is precisely the disclosure R35
--     exists to force.
--   * a stated unit with no stated quantity → REJECTED, same fact from the other side.
--   * a BLANK stated unit → REJECTED. `unit` spells "unitless" as `''`, and a restatement is never FROM
--     nothing; admitting the blank would give "no stated measure" a second spelling beside `NULL`.
--   * a non-positive stated quantity → REJECTED, matching `recipe_ingredients_quantity_positive`.
--   * an upper bound at or below its lower, or with no lower → REJECTED, matching
--     `recipe_ingredients_quantity_coherent`. Coincident bounds ARE an exact quantity.
--   * a stated measure beside a NULL `quantity` → REJECTED. `NULL` means the source stated no amount, and
--     `convertHistoricalUnit` refuses an absent quantity outright (there is no number to restate and
--     inventing one is R40's forbidden fabrication), so such a row is one nothing can produce.
--
-- ⚠️ It does NOT require the stated and restated pairs to have the same RANGE-NESS, and that omission is
-- deliberate rather than an oversight. Two stated bounds a ten-thousandth apart both round to one value at
-- `numeric(10,3)`, so a stated range can legitimately restate to an exact quantity. The right response is to
-- REFUSE the conversion where it is produced — `convertHistoricalUnit` returns `null` and the line keeps its
-- own words — not a CHECK that turns a legitimate save into a Postgres error the API reports as a 500. The
-- database polices the pair's internal coherence; the tool polices the pair against its restatement.
--
-- ── TWO CONSEQUENCES THAT ARE NOT BUGS, RECORDED SO NOBODY READS THEM AS ONE ──
--
-- ⚠️ 1. THE MEMO RATE WILL JUMP. `verifyLine` writes an `ingredient_resolution_memos` row only when the band
-- is `verified` AND the identity aspect was asked. Until now a false quantity-DISAGREE — the defect this
-- migration exists to remove — collapsed the band and SUPPRESSED a correct identity memo along with it. Those
-- memos are now written. It is safe: a stated measure cannot influence the identity aspect, so an `agree`
-- still requires the model to accept the food. Do not read the jump as a regression.
--
-- ⚠️ 2. THE GATE NO LONGER COVERS THE PUBLISHED NUMBERS DIRECTLY. It verifies the pair the source PRINTED,
-- while nutrition is computed from the RESTATED pair — so the model's verdict protects the published figure
-- only insofar as the conversion between them is right. That is deliberate, because the conversion is
-- deterministic arithmetic WE performed: it needs an assertion, not a language model, and asking a model to
-- compare a source line against a number the source never printed is the false disagree above. The assertion
-- lives where the conversion is made — `convertHistoricalUnit` (`@kitchensink/cookbook-import`) REFUSES a
-- restatement whose kind changes or whose bounds do not round-trip back to the stated amount within 1%, so an
-- unreconciled pair never reaches this table.
--
-- ⚠️ 3. A CALLER MAY DECLARE A STATED MEASURE WITHOUT ANY GRANT, and that was weighed rather than missed. See
-- the addendum in `docs/architecture/decisions/0023-curator-declared-provenance.md`.
--
-- PERSONAL DATA: none beyond what the row already holds. These are numbers and a unit word derived from a
-- published cookbook, on a table that `ON DELETE CASCADE`s from `recipes` — so the erasure worker's scoped
-- recipe delete already reaches them, exactly as it reaches `source_line`.
--
-- EXPAND-ONLY (ADR-0022). Three nullable `ADD COLUMN`s with no default — a catalog-only change in PostgreSQL
-- 11+, so no table rewrite and no long lock — plus one `NOT VALID` CHECK, which skips the full-table
-- verification scan while still policing every INSERT and UPDATE from this moment on. Every pre-existing row
-- trivially satisfies it (all three columns are NULL), so a later `VALIDATE CONSTRAINT` is a no-op cleanup
-- that can run at any time in its own migration. Safe to apply BEFORE the code that writes it, which is the
-- order the in-stack migration Trigger enforces.
--
-- ── ROLLBACK ──
-- Rolling the IMAGE back is safe: the previous release neither writes nor reads these columns, and the check
-- is satisfied by the all-NULL rows it would leave. Rolling the SCHEMA back is not offered (there are no
-- down-migrations in any runner); recovery is `DROP COLUMN`, and the data is re-derivable only by re-import,
-- which is what plan U15 does.
--
-- ⛔ NO INDEX, deliberately. Nothing looks a line UP by its stated measure: the gate producer and U14's
-- reader both already hold the row. An index here would cost a write on every recipe save to serve a query
-- no code issues.

ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS stated_quantity numeric(10, 3);

ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS stated_quantity_high numeric(10, 3);

ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS stated_unit text;

ALTER TABLE recipe_ingredients
    DROP CONSTRAINT IF EXISTS recipe_ingredients_stated_measure_coherent;

ALTER TABLE recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_stated_measure_coherent
        CHECK (
            (stated_quantity IS NULL AND stated_quantity_high IS NULL AND stated_unit IS NULL)
            OR (
                stated_quantity IS NOT NULL
                AND stated_quantity > 0
                AND stated_unit IS NOT NULL
                AND stated_unit <> ''
                AND quantity IS NOT NULL
                AND (stated_quantity_high IS NULL OR stated_quantity_high > stated_quantity)
            )
        )
        NOT VALID;
