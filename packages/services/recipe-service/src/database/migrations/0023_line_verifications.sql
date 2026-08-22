-- 0023_line_verifications.sql (plan U11 / R15–R18, R21) — what the verification gate CONCLUDED about a line.
--
-- ⛔ THE KEY IS THE CONTENT OF THE JUDGEMENT, NOT A ROW ID, and that is not a preference.
-- `RecipeIngredientsDal.replaceForRecipe` deletes every row of a recipe's ingredients and re-inserts them with
-- fresh `gen_random_uuid()` ids on EVERY recipe update. A verdict keyed on `recipe_ingredients.id` would
-- therefore be written against a row that no longer exists whenever a message is in flight across an edit,
-- and would discard every verdict for the whole recipe on any edit — re-verifying, and re-PAYING for, every
-- line because one word changed in a step. Keying on the judgement's content makes the write idempotent by
-- primary key, lets verdicts survive edits, and verifies a line shared by two of the corpus's 448 recipes
-- once. The derivation is `verificationKey()` in `@kitchensink/recipe-core/resolution/verification-key`, and
-- the `v1:` prefix it carries is what makes a future change to that derivation an additive, enumerable event
-- instead of a silent re-partition.
--
-- ⛔ THIS IS WHERE A VERDICT GOES — NOT `ingredients.food_resolution_status`. Three reasons, each independently
-- sufficient:
--   1. BLAST RADIUS. `ingredients` is a SHARED, ownerless catalog deduped one row per `food_id`
--      (`idx_ingredients_food_id`). Flipping its status on one line's quantity disagreement would withdraw
--      nutrition from every recipe in the system that references that ingredient.
--   2. IT IS A MIRROR, NOT A VERDICT. That column's own schema docstring defines it as mirroring
--      food-service's `FoodStatus` lifecycle. Writing our own value into it asserts a status food-service
--      never emitted.
--   3. `UNRESOLVED` ALREADY MEANS SOMETHING ELSE, AND IT IS A DEAD END. It means "several candidates, ask the
--      user to pick", and `GET /ingredients/{id}/candidates` serves that picker. A gate-written `UNRESOLVED`
--      yields a picker with zero options, and un-short-circuits `addByFoodId` for every future add of that
--      food.
--
-- ⚠️ ABSENCE OF A ROW MEANS PUBLISH. The gate runs off a queue, so a line publishes between save and
-- verification no matter what this table says; the only coherent read-side rule is "an explicit contradiction
-- withholds, everything else behaves as it did before the gate existed". That is also what makes a LOST
-- verdict benign, which is what lets the worker fail a verdict write without re-spending the call. It follows
-- that the plan's goal sentence — "nothing publishes nutrition we have not checked against the source" —
-- cannot hold literally for an asynchronous gate, and should read "nothing KEEPS publishing nutrition the gate
-- disagreed with". Flagged for the owner rather than quietly shipped under a sentence the code contradicts.
--
-- ⛔ NO MODEL-AUTHORED FREE TEXT IS PERSISTED HERE, and that is a deliberate omission. A `reason` string would
-- be text a model wrote ABOUT a cook's recipe line, and it can quote that line — so it is user-derived
-- personal data in a table that carries no owner and is reachable by no erasure sweep. The false-disagree rate
-- this unit measures is computable from `verdict`, `band` and `aspects` alone; the reason is a debugging aid
-- and its home is the (scrubbed, 14-day) log group. If U14's correction surface later needs it on screen, it
-- arrives WITH an owner column and an erasure sweep, as a deliberate decision.
--
-- ⚠️ WHAT IS STILL MISSING, so nobody reads this table as finished: nothing yet JOINS it to a recipe line.
-- That join needs `recipe_ingredients.source_line_hash`, which needs the raw source line to reach the service
-- at all — and today it does not: `recipe_ingredients.display_text` is a display OVERRIDE, and the only raw
-- line in the tree lives in the importer's memory (`recipe-import-core`'s `ParsedIngredientLine.raw`), which
-- writes through the public `POST /api/v1/recipes`. Admitting it is a WIRE change (`createRecipeRequestSchema`
-- via `.extend()`, never the base — ADR-0023's trap, since the update schema derives from the base and would
-- otherwise let any caller re-assert a source line on PATCH) and it moves `CONTRACT_HASH`. Until that lands,
-- this table is written by the worker and read by nothing: the gate ships in OBSERVE-ONLY mode, which the plan
-- itself names as the fallback posture and which is the correct FIRST posture for a gate whose false-disagree
-- rate has never been measured.
--
-- EXPAND-ONLY (ADR-0022). One new table; nothing existing is altered, dropped or rewritten.

CREATE TABLE "recipe_ingredient_verifications" (
    -- `{version}:{sha256hex}` over the canonical judgement — see the header. Text, not uuid: the version
    -- prefix is part of the value and is what a query filters on to find a superseded generation.
    "verification_key" text PRIMARY KEY,

    -- The model's judgement. `abstain` is a first-class member rather than a low certainty, so a model that
    -- cannot judge a line can say so without asserting a verdict it does not hold.
    "verdict" text NOT NULL,

    -- The ordinal rung the model reported. Named rungs, never a number: R16 holds that an ordinal score is not
    -- a confidence value until a document says how it becomes one, and no such document exists yet.
    "certainty" text NOT NULL,

    -- The collapsed band, stored rather than derived on read. It is derived by `bandFor()` in recipe-core and
    -- IS re-derivable — it is written here so that a change to that mapping does not silently rewrite the
    -- meaning of every historical row, which is what a calibration would otherwise do to the very measurements
    -- it is being calibrated against.
    "band" text NOT NULL,

    -- Which aspects were actually asked about. ⛔ Load-bearing, not decoration: identity may be skipped when a
    -- human curated the mapping or a wide margin established it, so an `agree` says nothing about identity
    -- unless 'identity' appears here. Reading a verdict without this column over-claims what was checked.
    "aspects" text[] NOT NULL,

    -- R21 / KTD-4: the model that produced this verdict. The bake-off replaces the model, and a verdict whose
    -- author is unknown cannot be re-baselined against its successor.
    "model_id" text NOT NULL,

    -- The opaque food-service id the verdict was about. Redundant with the key's preimage (which is a digest
    -- and therefore unreadable), and kept so an operator can answer "what did the gate contradict about food
    -- X" without a table scan against a hash.
    "food_id" text NOT NULL,

    "verified_at" timestamptz NOT NULL DEFAULT now(),

    -- The three enums are CHECKed rather than left to the application, because this table's whole job is to be
    -- read by a DIFFERENT process than the one that writes it. An unrecognised band read by the recipe service
    -- is a value with no defined publish behaviour, and the safe default it would fall back to is the one the
    -- gate exists to avoid.
    CONSTRAINT "recipe_ingredient_verifications_verdict_check"
        CHECK ("verdict" IN ('agree', 'disagree', 'abstain')),
    CONSTRAINT "recipe_ingredient_verifications_certainty_check"
        CHECK ("certainty" IN ('low', 'medium', 'high')),
    CONSTRAINT "recipe_ingredient_verifications_band_check"
        CHECK ("band" IN ('verified', 'contradicted', 'inconclusive')),
    -- A verdict that checked nothing is not a verdict. The policy makes this unrepresentable in TypeScript
    -- (a non-empty tuple); the database is the other writer's floor.
    CONSTRAINT "recipe_ingredient_verifications_aspects_nonempty"
        CHECK (array_length("aspects", 1) >= 1)
);

-- The operational read: "what has the gate contradicted?". Partial, because `contradicted` is the rare band —
-- a full index would cost a write on every verified line to serve a query about the few that were not.
CREATE INDEX "idx_line_verifications_contradicted"
    ON "recipe_ingredient_verifications" ("food_id", "verified_at")
    WHERE "band" = 'contradicted';

-- The bake-off's read: "how did each model do, and when". Supports re-baselining a model against its
-- successor over a date window, which is the measurement KTD-4's owner ruling ("ship the winner and improve
-- from there") depends on being able to repeat.
CREATE INDEX "idx_line_verifications_model"
    ON "recipe_ingredient_verifications" ("model_id", "verified_at");
