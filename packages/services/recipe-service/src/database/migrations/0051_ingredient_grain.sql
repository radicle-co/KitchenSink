-- 0051 — THE INGREDIENT GRAIN. One owner-ruled sentence, made true of the database:
--
--     "Recipe has one or more ingredients. An ingredient has either a food or an unresolved_food."
--
-- The owner's 2026-09-22 ruling (plan 002 R7) and the curated catalog plan (U20) refine "a food" into two
-- arms, because the food service now holds root foods and their variants:
--
--   recipes 1 ── 1..* ingredients ──NOT NULL──> food_lookups ──> a root food    (opaque food_id text)
--                                                           ──> a variant       (opaque food_variant_id text)
--                                                           ──> unresolved_foods
--                                                           exactly one of the three
--
-- Three tables replace two, and the names move one step each:
--
--   * `ingredients` IS THE RECIPE LINE. It replaces `recipe_ingredients`, carrying every one of its
--     columns except `ingredient_name` and `is_user_entered` — both of which are now DERIVED by following
--     `food_lookup_id`, so neither can disagree with the thing it described.
--   * `food_lookups` IS THE BINDING. It replaces the old shared `ingredients` catalog MINUS its `name`.
--   * `unresolved_foods` IS THE FAILURE RECORD — what the cascade concluded when it could not resolve a
--     phrase, which until now was computed and then discarded (`ingredients.service.ts`, at the
--     `outcome.kind !== 'resolved'` return).
--
-- ## ⛔ WHY THE ARM IS THREE NULLABLE COLUMNS AND A COUNT, AND NOT A `kind` DISCRIMINATOR
--
--     CONSTRAINT food_lookups_one_arm CHECK (num_nonnulls(food_id, food_variant_id, unresolved_food_id) = 1)
--
-- `num_nonnulls(...) = 1` states "exactly one" directly, and it never evaluates to NULL, so a CHECK over it
-- cannot be satisfied by accident. Two tempting spellings are wrong. `a IS NULL OR b IS NULL OR c IS NULL`
-- admits the all-null row. Chaining the two-arm form, `((a IS NULL) <> (b IS NULL)) <> (c IS NULL)`, is a
-- parity test, not a count: measured on Postgres 18, it admits the no-arm row and every two-arm row, and
-- refuses every single-arm row. `num_nonnulls` also takes a fourth arm without a rewrite.
--
-- A `kind` column would be a SECOND statement of the same fact, and a second statement can disagree with
-- the first. Three illegal states were representable before this migration for exactly that reason — most
-- visibly `food_id IS NULL` beside `food_resolution_status = 'RESOLVED'`. Here the arm is READ OFF the three
-- reference columns, so there is nothing for it to contradict. `food_resolution_status`, `is_user_entered` and every
-- ranking artefact tied to the departed `name` go with it.
--
-- ## ⛔ WHY THE CONSTRAINTS ARE `VALID` — A DELIBERATE DIVERGENCE FROM THE LOCAL CONVENTION
--
-- Migrations 0020, 0027 and 0030 declare their CHECKs `NOT VALID`, and they are right to: each was added
-- to a table ALREADY HOLDING ROWS, where `NOT VALID` skips the full-table verification scan and the
-- constraint still governs every subsequent write. None of that applies here. Every table below is
-- CREATED EMPTY in this same file, so there is no existing row to scan and `NOT VALID` buys nothing —
-- while telling every future reader of `pg_constraint` that some prefix of the data was never checked,
-- which would be false. The constraints are therefore `VALID`, and this paragraph is why.
--
-- ## ⛔ NO BACKFILL, NO EXPAND/CONTRACT, NO COMPATIBILITY SHIM — AND THE EXEMPTION IS DATED
--
-- ADR-0035's standing precondition is EXPAND-FIRST: a contracting migration ships a release LATER than the
-- code that stopped reading the column. This file contracts and expands in one statement, which that rule
-- forbids — and the exemption is that PRODUCTION HOLDS NO RECIPE DATA: the service has never been deployed
-- there. A compatibility path for data that does not exist is a defect rather than prudence: it would be dead
-- code nobody could ever exercise, carried forever by readers who could not tell that. Previews DO hold rows
-- (ADR-0006), which is why the one step that scans a filled table is written for them (see below).
--
-- ⛔ THE EXEMPTION EXPIRES ON THE FIRST PRODUCTION DEPLOY. The NEXT migration touching these three tables
-- after it is expand-first again, with no exemption and no appeal to this file. See
-- `docs/architecture/decisions/0045-ingredient-lookup-and-unresolved-foods.md`.
--
-- ## The drop order, and why nothing carries `CASCADE`
--
-- Two foreign keys referenced the old `ingredients` (verified against `pg_constraint` on a migrated
-- server, not inferred from the default naming): `recipe_ingredients_ingredient_id_fkey`, which dies with
-- its own table, and `ingredient_resolutions_ingredient_id_fkey`, which does not. That second one is
-- released EXPLICITLY below rather than swept away by a `DROP TABLE ... CASCADE`, so that any dependent
-- this file did not anticipate — a view, a later FK, a trigger — stops the migration loudly instead of
-- being deleted silently. `rank_tokens_of` is dropped only AFTER the generated column that calls it.

-- ── 1. Release the one dependent that outlives its referent ───────────────────────────────────────────

ALTER TABLE ingredient_resolutions DROP CONSTRAINT ingredient_resolutions_ingredient_id_fkey;

-- ── 2. The old grain, and every artefact of the name it no longer has ─────────────────────────────────
--
-- `DROP TABLE` takes the table's indexes and constraints with it, so 0001's `idx_ingredients_search_vector`
-- and `idx_ingredients_name_trgm`, 0006's `idx_ingredients_freeform_name` and `idx_ingredients_food_id`
-- (0001 created that one non-unique; 0006 dropped it and recreated it UNIQUE, so at drop time it is 0006's),
-- 0025's and 0034's stored generated ranking columns and 0040's `idx_ingredients_food_owner` all go here. They are
-- named in this comment rather than dropped one by one because an explicit `DROP INDEX` list is a copy of a
-- list, and a copy cannot detect that the list is incomplete — `tests/e2e/ingredientGrain.e2e.test.ts`
-- asserts their absence against `pg_indexes` instead.

DROP TABLE recipe_ingredients;
DROP TABLE ingredients;

-- The last ranking artefact: 0034's IMMUTABLE helper existed only to feed `ingredients.rank_head`, which
-- the table above took with it. Dropped WITHOUT `CASCADE` for the same reason as the tables — a surviving
-- caller must fail this migration rather than be quietly unhooked.
DROP FUNCTION rank_tokens_of(text);

-- ── 3. unresolved_foods — what the cascade CONCLUDED ──────────────────────────────────────────────────

CREATE TABLE unresolved_foods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ⛔ THE FOOD NAME THAT FAILED TO RESOLVE, and the unresolved arm's whole contribution to a line's
    -- display name. This is why `food_lookups` needs no `name` of its own: a line renders by following its
    -- binding, to the catalog through `food_id` or to this row.
    name text NOT NULL,

    -- The raw phrase `name` was lifted from. NULLABLE, and deliberately DUPLICATED with
    -- `ingredients.source_phrase` one table over — the two are a different GRAIN, not a copy: the line's is
    -- what THIS cook wrote, this one is what the SHARED record stands for. Collapsing them would make one
    -- cook's phrasing the phrasing of every line that converged on the same failure.
    source_phrase text,

    -- What lines converge on. See the partial unique index below for the asymmetry that makes convergence
    -- correct for a lookup failure and wrong for an author's declaration.
    normalized_key text NOT NULL,

    -- Why the cascade stopped. `author_declared` is the one member that is not a failure of ours: the cook
    -- named a substance and asked for it as written.
    reason_code text NOT NULL,

    -- ⛔ GENERATED FROM `reason_code`, so the two can never disagree and no writer computes it. Each reason
    -- names exactly one coarse status. The CASE is also the ONE statement of the closed reason set: an unknown
    -- reason generates NULL, and NOT NULL refuses the row. A separate `reason_code IN (...)` CHECK could never
    -- fire, because Postgres checks NOT NULL on the generated value first, so there is none. `RESOLVED` is in no branch: a resolved lookup points at a food and has
    -- no row in this table at all, so a `RESOLVED` row here would record a failure that succeeded — the
    -- state the old `ingredients.food_resolution_status` could hold beside a NULL `food_id`, and did.
    -- STORED, because the retry index below leads with it (and `generatedColumnStorage.test.ts` requires it).
    status text NOT NULL GENERATED ALWAYS AS (
        CASE reason_code
            WHEN 'awaiting_source' THEN 'PENDING'
            WHEN 'several_candidates' THEN 'UNRESOLVED'
            WHEN 'author_declared' THEN 'UNRESOLVED'
            WHEN 'no_source_has_it' THEN 'NOT_FOUND'
            WHEN 'cascade_exhausted' THEN 'NOT_FOUND'
            WHEN 'phrase_unusable' THEN 'NOT_FOUND'
            WHEN 'sources_errored' THEN 'FAILED'
            WHEN 'cascade_unavailable' THEN 'FAILED'
        END
    ) STORED,

    -- The food service's opaque id for the food it is still working on: a pending source fetch
    -- (`awaiting_source`) or a set of tied candidates (`several_candidates`). Present exactly for those two
    -- reasons (the CHECK below): the poll follows this handle, and only food-service's answer about it may
    -- free every line that converged here.
    food_handle_id text,

    -- ⛔ `NOT NULL` ON BOTH IS LOAD-BEARING ON THE CHECK BELOW, not a tidy default. `cardinality(NULL)` is
    -- NULL, a CHECK that evaluates to NULL is SATISFIED, and a nullable `tiers_unavailable` would therefore
    -- admit the exact `cascade_unavailable` row the constraint refuses — the same hole as `array_length`,
    -- displaced from the EMPTY array to the ABSENT one. It also leaves `'{}'` as the one spelling of "no
    -- tiers", which is this schema's standing discipline everywhere else.
    tiers_consulted text[] NOT NULL DEFAULT '{}',
    tiers_unavailable text[] NOT NULL DEFAULT '{}',

    -- ⛔ OPERATOR-ONLY and never on the wire (plan 002 R5): free text about one attempt, such as an error name
    -- and an HTTP status. It stays free text on purpose: `reason_code` IS the machine-readable code (R1, R6),
    -- and this column is for the long tail an operator needs. The service's repository never selects it, so
    -- no read path can carry it to a client. Bounded, so a runaway error body cannot land here.
    detail text,

    attempts integer NOT NULL DEFAULT 1,
    first_attempted_at timestamptz NOT NULL DEFAULT now(),
    last_attempted_at timestamptz NOT NULL DEFAULT now(),

    -- The binding a food-service answer SETTLED this failure to: the settle moved every line here to it
    -- (plan 002 R13). A settle mints no recipe version, so a save built from a read taken before it still names
    -- this failure; the line planner forwards such a line here, so the stale save neither undoes the settle nor
    -- reads as an ingredient edit. NULL while the failure stands. The foreign key is added after `food_lookups`
    -- exists (the two tables reference each other).
    settled_lookup_id uuid,

    -- ⛔ `cardinality`, NOT `array_length(tiers_unavailable, 1)`. `array_length` answers NULL for an EMPTY
    -- array, a CHECK is satisfied when it evaluates to NULL, and the obvious spelling would therefore admit
    -- the exact row this constraint exists to refuse — a `cascade_unavailable` naming no unavailable tier,
    -- which is an unfalsifiable claim that something was down. `cardinality('{}') = 0`, which fails.
    -- Migration 0023's header records the same trap.
    --
    -- ⚠️ `cardinality` has the SAME hole one step over — `cardinality(NULL)` is also NULL. The column's
    -- NOT NULL above is what closes it; relaxing that reopens this constraint, which is why the two are
    -- commented as one decision and asserted together in `tests/e2e/ingredientGrain.e2e.test.ts`.
    CONSTRAINT unresolved_foods_unavailable_names_a_tier
        CHECK (reason_code <> 'cascade_unavailable' OR cardinality(tiers_unavailable) >= 1),

    -- ⛔ TWO MORE STATES THAT CONTRADICT THE ROW'S OWN EXISTENCE, which is the test every CHECK in this
    -- table applies: a row that exists BECAUSE an attempt was made cannot have had zero attempts or have
    -- last been attempted before it was first attempted. That these values are server-written is no argument
    -- against constraining them — so is `reason_code` above.
    CONSTRAINT unresolved_foods_attempts_positive CHECK (attempts >= 1),
    CONSTRAINT unresolved_foods_attempt_window_coherent CHECK (last_attempted_at >= first_attempted_at),

    -- The handle exists exactly when food-service is still working on the food: a pending reason with no
    -- handle has nothing to poll, and a settled reason with one points at a food nobody will follow.
    CONSTRAINT unresolved_foods_handle_follows_reason
        CHECK ((food_handle_id IS NOT NULL) = (reason_code IN ('awaiting_source', 'several_candidates'))),

    -- The tiers named are links of THIS cascade (`llm` is a tier id elsewhere, never a link here), and a tier
    -- can only have been unavailable if it was consulted.
    CONSTRAINT unresolved_foods_tiers_known
        CHECK (
            tiers_consulted <@ ARRAY['curated', 'memo', 'lexical']::text[]
            AND tiers_unavailable <@ tiers_consulted
        ),

    CONSTRAINT unresolved_foods_detail_bounded CHECK (detail IS NULL OR char_length(detail) <= 500),

    -- A declaration is not a lookup that can later succeed, so nothing ever settles one.
    CONSTRAINT unresolved_foods_declaration_never_settles
        CHECK (settled_lookup_id IS NULL OR reason_code <> 'author_declared')
);

-- ⛔ THE ASYMMETRY, and it is the most easily-broken decision in this file. A real lookup FAILURE is a
-- shared fact ABOUT A PHRASE — every line that says "nutritional yeast" failed for the same reason, so they
-- converge on one row and ONE later resolution frees all of them. A cook's DECLARED name is the opposite: two
-- cooks writing "grandma's spice mix" do not mean the same substance, and deduping them would silently merge
-- one person's ingredient into another's. Hence the `WHERE` clause. Dropping it looks like a tightening and
-- is a data-corruption bug; `tests/e2e/ingredientGrain.e2e.test.ts` asserts BOTH directions.
CREATE UNIQUE INDEX unresolved_foods_shared_failure_key_idx
    ON unresolved_foods (normalized_key)
    WHERE reason_code <> 'author_declared';

-- The retry sweep's read: "what is still unresolved, oldest attempt first". ⛔ Declarations are excluded: a
-- cook's declared name is not a lookup that can later succeed, so it never belongs in a retry read. This
-- closes the question ADR-0045 left open without adding a status the ruled vocabulary does not have. A SETTLED
-- failure is excluded too: food answered it, and counting it would say something is still unresolved.
CREATE INDEX unresolved_foods_status_attempted_idx
    ON unresolved_foods (status, last_attempted_at)
    WHERE reason_code <> 'author_declared' AND settled_lookup_id IS NULL;

COMMENT ON TABLE unresolved_foods IS
    'The cascade''s failure record (0051). RESOLVED is absent by construction — a resolved lookup has no row here.';
COMMENT ON COLUMN unresolved_foods.name IS
    'The food name that failed to resolve — the unresolved arm''s contribution to a line''s display name.';
COMMENT ON COLUMN unresolved_foods.source_phrase IS
    'The raw phrase this SHARED record stands for. A different grain from ingredients.source_phrase, which is what one cook wrote.';
COMMENT ON COLUMN unresolved_foods.detail IS
    'Operator-only free text about an attempt, at most 500 characters. NEVER on the wire, and never selected by the service repository.';
COMMENT ON COLUMN unresolved_foods.status IS
    'Generated from reason_code. Never written.';

-- ── 4. food_lookups — THE BINDING, and the only place the arm is stated ───────────────────────────────

CREATE TABLE food_lookups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The food service's internal ULID (003), OPAQUE. Never a USDA `fdcId`, and NOT a cross-DB foreign key:
    -- ADR-0006 gives every stage its own logical database, so this reference MAY dangle and the reader
    -- degrades rather than joins.
    food_id text,

    -- The food service's opaque id for a VARIANT of a root (the curated catalog's `food_variant`). Opaque and
    -- not a cross-DB foreign key, for the same reason as `food_id`. A line bound here chose a variant, and a
    -- reseed never moves it; a line bound to `food_id` chose none and follows its root.
    food_variant_id text,

    unresolved_food_id uuid REFERENCES unresolved_foods(id) ON DELETE RESTRICT,

    -- R20 (from 0040): the AUTHOR's ULID when the referenced food is their PRIVATE authored one, captured at
    -- admission because ADR-0006 forbids the cross-database join. NULL for catalog and promoted foods. Every
    -- local retrieval surface filters `(food_owner_id IS NULL OR food_owner_id = :caller)`.
    food_owner_id varchar(255),

    created_at timestamptz NOT NULL DEFAULT now(),

    -- ⛔ AN OWNER DESCRIBES A ROOT FOOD, so it may not be asserted on another arm. This is the same
    -- contradiction the header rejects a discriminator column for — one arm's state stated on the other —
    -- and it is not cosmetic: the account-erasure sweep KEYS on this column, and a private authored food is
    -- always a root (only the seed writes variants, and it writes no private ones).
    CONSTRAINT food_lookups_owner_needs_a_root
        CHECK (food_owner_id IS NULL OR food_id IS NOT NULL),

    -- ⛔ THE INVARIANT. See the header for why it is a count over the three reference columns and why there
    -- is no discriminator column beside it.
    CONSTRAINT food_lookups_one_arm
        CHECK (num_nonnulls(food_id, food_variant_id, unresolved_food_id) = 1)
);

-- One binding per food-service golden record — the DB-side dedup key that makes binding races safe, and the
-- `food_id` lookup index. Partial, because the unresolved arm leaves the column NULL and NULLs do not
-- conflict under a plain unique index anyway; stating the predicate makes the intent readable.
CREATE UNIQUE INDEX idx_food_lookups_food_id
    ON food_lookups (food_id)
    WHERE food_id IS NOT NULL;

-- One binding per variant, for the same reason as one per root. A separate index per arm, never one index over
-- a coalesce of the arms: a root and a variant are different things even if their opaque ids ever collide.
CREATE UNIQUE INDEX idx_food_lookups_food_variant_id
    ON food_lookups (food_variant_id)
    WHERE food_variant_id IS NOT NULL;

-- One binding per failure record, so the two tables are 1:1 across the unresolved arm and a second lookup
-- cannot quietly attach itself to a failure another line already owns.
CREATE UNIQUE INDEX idx_food_lookups_unresolved_food_id
    ON food_lookups (unresolved_food_id)
    WHERE unresolved_food_id IS NOT NULL;

CREATE INDEX idx_food_lookups_food_owner
    ON food_lookups (food_owner_id)
    WHERE food_owner_id IS NOT NULL;

-- The settle pointer's foreign key, added now that both tables exist. RESTRICT: a binding lines were settled to
-- is never deleted from under a failure that forwards to it.
ALTER TABLE unresolved_foods
    ADD CONSTRAINT unresolved_foods_settled_lookup_id_fkey
    FOREIGN KEY (settled_lookup_id) REFERENCES food_lookups (id) ON DELETE RESTRICT;

COMMENT ON TABLE food_lookups IS
    'The binding (0051): exactly one of food_id / food_variant_id / unresolved_food_id, enforced by food_lookups_one_arm. Carries no name and no status.';
COMMENT ON COLUMN food_lookups.food_variant_id IS
    'Opaque food-service variant id (curated catalog). Not a cross-DB FK — it MAY dangle, and readers degrade.';
COMMENT ON COLUMN food_lookups.food_id IS
    'Opaque food-service ULID (003). Not a cross-DB FK — it MAY dangle, and readers degrade.';

-- ── 5. ingredients — THE RECIPE LINE ──────────────────────────────────────────────────────────────────

CREATE TABLE ingredients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,

    -- ⛔ NOT NULL, and that is the model's other half: a line cannot exist without a binding, so there is no
    -- such thing as an ingredient that is neither a food nor an unresolved one. `RESTRICT` rather than
    -- `CASCADE` because a binding is SHARED — deleting one out from under the lines that hold it would
    -- delete other cooks' ingredients, so the delete is refused and the caller has to mean it.
    food_lookup_id uuid NOT NULL REFERENCES food_lookups(id) ON DELETE RESTRICT,

    -- U8/R41 — NULLABLE, and that is the point: NULL is the ONE representation of "the source stated no
    -- amount" ("butter the size of an egg"). It is never 0, which the positive check below still refuses
    -- precisely so a zero cannot become a second spelling of absent.
    quantity numeric(10, 3),
    -- The upper bound when the source stated a RANGE (`2 to 3 cups`); NULL for a single value (R36).
    quantity_high numeric(10, 3),
    unit text NOT NULL,

    -- A display OVERRIDE the author chose. NOT the raw line, and NOT our rendering of the food's name.
    display_text text,

    -- ⛔ TWO COLUMNS, AND THEY MUST STAY TWO. `source_line` is the WHOLE raw line the cook's source stated
    -- ("2 cups all-purpose flour, sifted"); `source_phrase` is the ingredient phrase the parse lifted OUT of
    -- it ("all-purpose flour"). `verificationKey()` hashes the normalized LINE, so merging them would change
    -- every key — and because absence of a verdict PUBLISHES (0023's header), that break would be SILENT:
    -- nothing would error, verdicts would simply stop matching and every line would publish unchecked.
    -- `source_phrase` is raw parsed text and is NEVER read as the line's display name; the name comes from
    -- following `food_lookup_id`.
    source_line text,
    source_phrase text,

    -- U7/U11 — what the SOURCE printed, before the importer restated a historical measure into one the USDA
    -- household-portion table carries. Without these the verification gate is shown a number the source never
    -- printed and correctly disagrees with a line we parsed RIGHT.
    stated_quantity numeric(10, 3),
    stated_quantity_high numeric(10, 3),
    stated_unit text,

    -- U26 — how THIS recipe prepares the food (`finely chopped`). Not a display override, and not part of
    -- the name a `food_id` resolves to.
    preparation text,
    -- U27 — the section this line belongs to (`For the marinade`). FREE TEXT by owner ruling (2026-08-24):
    -- a closed set could not express "For the crust".
    group_label text,

    sort_order integer NOT NULL DEFAULT 0,

    -- The USER's own nutrition override (FR-007a) — theirs, not a copy of anything the food service holds.
    user_calories numeric(8, 2),
    user_protein_g numeric(8, 2),
    user_carbs_g numeric(8, 2),
    user_fat_g numeric(8, 2),

    -- A Postgres CHECK is satisfied when it evaluates to NULL, so this admits an absent quantity while still
    -- refusing a zero — see `0020_quantity_range.sql`.
    CONSTRAINT ingredients_quantity_positive CHECK (quantity > 0),

    -- The pair's illegal states: an upper bound with no lower, and an upper bound at or below its lower
    -- (coincident bounds ARE an exact quantity).
    CONSTRAINT ingredients_quantity_coherent
        CHECK (quantity_high IS NULL OR (quantity IS NOT NULL AND quantity_high > quantity)),

    -- The stated pair's own illegal states: half a restatement, a blank unit (a second spelling of "none"
    -- beside NULL), a non-positive amount, an inverted range, and a stated measure on a line whose restated
    -- quantity is ABSENT — which `convertHistoricalUnit` refuses to produce, there being no number to
    -- restate. It deliberately does NOT require the two pairs to share their range-ness: two stated bounds a
    -- ten-thousandth apart round to one value at numeric(10,3), and the right refusal for that is in the
    -- tool, not a CHECK that turns a legitimate save into a 500.
    CONSTRAINT ingredients_stated_measure_coherent
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
        ),

    -- NULL is the ONE spelling of absent for each. A blank `preparation` reaches the wire as `''`, which
    -- `recipeIngredientViewSchema` (`min(1)`) rejects — write-but-cannot-read. A blank or untrimmed
    -- `group_label` is worse: sections are FOLDED from the labels, so `'Dry '` renders a SECOND section
    -- under a heading visually identical to `'Dry'`.
    CONSTRAINT ingredients_preparation_present
        CHECK (preparation IS NULL OR btrim(preparation) <> ''),
    CONSTRAINT ingredients_group_label_present
        CHECK (group_label IS NULL OR btrim(group_label) <> '')
);

CREATE INDEX idx_ingredients_recipe_id ON ingredients (recipe_id);
CREATE INDEX idx_ingredients_food_lookup_id ON ingredients (food_lookup_id);

COMMENT ON TABLE ingredients IS
    'THE RECIPE LINE (0051), replacing recipe_ingredients. Its name and user-entered-ness are DERIVED by following food_lookup_id.';
COMMENT ON COLUMN ingredients.source_line IS
    'The WHOLE raw line the source stated. verificationKey() hashes this — never merge it with source_phrase.';
COMMENT ON COLUMN ingredients.source_phrase IS
    'The ingredient phrase the parse lifted out of source_line. Raw parsed text, NEVER the line''s display name.';

-- ── 6. Re-point ingredient_resolutions at the grain it was always about ───────────────────────────────
--
-- 0035's header already calls a resolution an EVENT about one admission "never a property of the shared
-- row", and the row it was keyed on is now `food_lookups`: a resolution records WHICH TIER produced a
-- binding, which is precisely what a lookup row is. The column is renamed rather than dropped and re-added
-- so its index (`ingredient_resolutions_latest_idx`) and every existing value follow it.
--
-- ⛔ The foreign key is RE-ADDED, not left off. Releasing it in step 1 was a prerequisite of the drop, not a
-- decision to stop constraining the column; a bare `RENAME COLUMN` would have left `food_lookup_id`
-- referencing nothing at all. `ON DELETE CASCADE` preserves 0035's semantics exactly — the provenance of a
-- binding is meaningless once the binding is gone — and it does not weaken the `RESTRICT` one table over,
-- which is what actually stops a referenced binding being deleted in the first place. The reachable set is
-- therefore UNCHANGED from today's: a referenced binding cannot be deleted at all, so the cascade only ever
-- fires for an unreferenced one.
--
-- ⚠️ A resolution event may now point at a binding on the UNRESOLVED arm — the cascade ran, produced
-- evidence, and produced no food. That is a coherent new inhabitant, not corruption.

-- ⛔ THE SURVIVING EVENTS MUST GO FIRST, AND THIS IS NOT HOUSEKEEPING. Every row here holds an
-- `ingredients.id` that step 2 deleted; the constraint below is added `VALID`, which SCANS the table, so
-- one surviving row raises `23503` and — because the runner wraps each migration in its own transaction —
-- ROLLS THE WHOLE MIGRATION BACK. `0051` then never records in `schema_migrations`, every later deploy
-- re-attempts it, and the stage wedges behind its schema stack (ADR-0035).
--
-- ⚠️ MEASURED, because no test tier could have found it: a freshly migrated database has zero rows here, so
-- the scan is instant and green. Against a clone of a real migrated database holding ONE resolution event,
-- the un-deleted form failed with `Key (food_lookup_id)=(…) is not present in table "food_lookups"`. The
-- file's greenfield argument is about PRODUCTION; ADR-0006 gives every `pr-{N}` its own database and those
-- DO hold these rows.
--
-- ⚠️ The predicate matches EVERY row here — `food_lookups` is created empty four steps above — so this is a
-- total delete, and saying otherwise would be the sort of claim this file exists to avoid. It is written as a
-- predicate because the predicate IS the invariant (an event is provenance FOR A BINDING, and every binding
-- it described is gone), which is what a reader needs, and because it is honest to
-- `migrationDestructiveDml.test.ts` — which exists because `0041` once carried an unqualified `DELETE` that
-- was safe only by accident — instead of being recorded as an exception to it.
DELETE FROM ingredient_resolutions r
      WHERE NOT EXISTS (SELECT 1 FROM food_lookups fl WHERE fl.id = r.ingredient_id);

ALTER TABLE ingredient_resolutions RENAME COLUMN ingredient_id TO food_lookup_id;

-- 0035's index survives the rename with a name that no longer describes its leading column. Renamed rather
-- than dropped and recreated, so the index itself is never absent.
ALTER INDEX ingredient_resolutions_latest_idx RENAME TO ingredient_resolutions_lookup_latest_idx;

ALTER TABLE ingredient_resolutions
    ADD CONSTRAINT ingredient_resolutions_food_lookup_id_fkey
        FOREIGN KEY (food_lookup_id) REFERENCES food_lookups(id) ON DELETE CASCADE;
