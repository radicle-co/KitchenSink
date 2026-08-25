-- 0029_ingredient_parse_corrections.sql (plan U21; KTD-14, KTD-15) — a cook's correction of a PARSE.
--
-- The parse pipeline's TOP tier. A line is resolved by: this table, then the parse cache, then the two
-- engines. ⛔ The order is the point and it is not a preference — a correction that lost to a cached machine
-- parse would be a correction that does nothing, so the cook's answer is consulted BEFORE anything a machine
-- produced, including a cache row the machine wrote a moment ago.
--
-- ## What a correction is, and why its reach is an authorization question
--
-- The same shape `ingredient_resolution_mappings` (0021) has, and deliberately so: the SUBJECT differs but
-- the scope rule is identical knowledge (KTD-15). A mapping asserts "the phrase `plain flour` means food X";
-- a correction asserts "the line `2 cups plain flour, sifted` parses to THESE facts". Both, at `global`
-- scope, assert that sentence for EVERY user of the installation on every future occurrence, with no further
-- review — which makes reach a privilege rather than a preference, and the thing authorized a FIELD VALUE
-- (`scope`) rather than a route. The rule therefore lives in ONE pure policy
-- (`ingredients/domain/correctionScopePolicy.ts`, which 0021's `mappingScopePolicy` now also delegates to)
-- and NOT in a route Guard (ADR-0023).
--
-- ## ⛔ Why the key is `normalizedIngredientKey`, and NOT the parse cache's case-preserving digest
--
-- KTD-13 requires the CACHE key to preserve case: a cache is an equality on the exact input, and folding
-- case there would serve one engine's reading of `Turkey` for a line that said `turkey`. This table is the
-- opposite kind of thing. Corroboration is its escalation path — "a second INDEPENDENT user corroborates"
-- (KTD-15) — and corroboration requires two users' lines to COLLIDE on the key. Over a case-preserving
-- digest they essentially never would, so promotion would be unreachable in practice and the policy's whole
-- corroboration branch would be decorative. `normalizedIngredientKey` (`@kitchensink/recipe-core`) is the
-- derivation whose docstring states that property outright: *"two users spelling the same thing differently
-- must COLLIDE on it — that collision is the entire mechanism by which one cook's correction resolves
-- another cook's line."* The two tiers partition the same line differently ON PURPOSE.
--
-- ⚠️ Consequence, recorded so it is not read as a defect: this table cannot distinguish two lines that
-- differ only in case or whitespace. That is the definition of the equivalence class, not a collision.
--
-- ## ⛔ THE MEMO TREATMENT (KTD-14), and the one place it goes further than 0026
--
-- This table holds user-typed text AND who typed it, so it takes 0026's treatment: a NULLABLE `owner_id`, a
-- partial index `WHERE owner_id IS NOT NULL`, the text column nullable in the SAME migration as the sweep,
-- and a DE-IDENTIFYING `UPDATE` rather than a `DELETE`.
--
--   * **`source_line` is NULLABLE FROM BIRTH.** 0026 had to reach that state with an `ALTER`, and its header
--     records why the relaxation may not wait for a later release: *"the sweep sets it to NULL, and a sweep
--     that runs against the old constraint fails the erasure job rather than the statement."* Creating the
--     column nullable is the same rule with nothing to relax.
--   * **A DE-IDENTIFYING `UPDATE`, never a `DELETE`.** The row is consulted by EVERY user's parse pipeline,
--     so removing it would silently un-correct that line installation-wide — one user's erasure causing
--     every other user's regression. `corrected_facts` therefore SURVIVES: it is the assertion, and clearing
--     it would be a delete wearing an update's clothes.
--   * ⛔ **`owner_id` AND `source_line` MOVE AS A PAIR, and here that is a CONSTRAINT rather than a
--     convention** — the one place this goes further than 0026. Updating the text while leaving a previous
--     owner's id beside it would aim a LATER erasure at the wrong person: it would sweep a line that owner
--     never typed and leave the one they did. `ingredient_parse_corrections_owner_line_pair` makes that row
--     unrepresentable, so a future edit that splits the sweep into two statements is refused by the database
--     instead of being caught in review. It is also what makes the sweep idempotent by construction: a
--     re-swept row is already in the target state on both columns.
--
-- ## ⛔ `corrected_facts` HOLDS THE FACTS, NEVER THE RAW LINE
--
-- The persisted payload is `ParsedFacts` (`@kitchensink/recipe-import-core`) — `statedMeasure`, `quantity`,
-- `unit`, `foods[]` — and deliberately NOT the full `ParsedLine`, whose `raw` member is the input
-- byte-identical. Storing `raw` here would put a SECOND copy of the erasable text in a column no sweep
-- touches, which is the "moved the data, rather than removing it" failure the mappings suite already tests
-- against. The residue that does remain — a food name, a stated measure — is a FRAGMENT of a line whose
-- normalized form already survives as `normalized_key` (the same property 0021 accepted for its own key),
-- and removing it is indistinguishable from deleting the row.
--
-- ⚠️ `corrected_facts` is `jsonb` and is COMPARED BY POSTGRES, never re-serialized in TypeScript. That is
-- why there is no `answer_digest` column: `jsonb` already sorts keys and normalizes numerics, so it is a
-- canonical form this repository does not have to derive — and a second derivation of a PERSISTED equality
-- key is precisely the drift `normalizedIngredientKey`'s docstring warns is silent when it happens.
--
-- ## EXPAND-ONLY (ADR-0022)
--
-- One new table and its indexes; nothing existing is altered, dropped or rewritten, so this is safe to apply
-- BEFORE the code that reads it — the order the in-stack migration Trigger enforces. There is no
-- down-migration in any runner in this repository; recovery is `DROP TABLE`, and the table holds corrections
-- re-derivable only from the cooks who made them, which is why it is swept rather than dropped.

CREATE TABLE "ingredient_parse_corrections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The match grain: `normalizedIngredientKey` over the WHOLE ingredient line. See the header for why this
    -- and not the parse cache's case-preserving digest.
    "normalized_key" text NOT NULL,
    -- The raw line the key was derived FROM. Keeps the key derivation a two-way door (a change to that
    -- function is repaired by a backfill rather than data loss), and is the erasable half of the pair below.
    -- NULLABLE from birth: the sweep sets it to NULL.
    "source_line" text,
    -- The corrected parse: `ParsedFacts`, WITHOUT `raw`. Survives erasure — it is the correction itself.
    "corrected_facts" jsonb NOT NULL,
    -- How far this correction reaches. `author` binds only the cook who made it; `global` binds everyone.
    "scope" text NOT NULL,
    -- On whose authority it holds: its writer alone, a grant holder, or two independent cooks agreeing.
    -- Separate from `scope` for 0021's reason: `curator` and `corroboration` are the SAME reach arrived at by
    -- DIFFERENT authority, and the supersession rule turns on which one it was.
    "origin" text NOT NULL,
    -- The app-user ULID that typed the line. NULL for a corroboration binding (nobody wrote it — two cooks'
    -- agreement produced it) and for an erased owner. VARCHAR(255), no FK: no local users table (D2).
    "owner_id" varchar(255),
    -- Which affordance produced the correction. Free text rather than a CHECK enum, for 0021's reason: the
    -- set of surfaces grows with the product, and a surface added tomorrow must never fail a cook's
    -- correction with a constraint violation.
    "surfacing" text NOT NULL,
    -- The two author-scoped corrections whose agreement produced a corroboration binding. THE AUDIT RECORD:
    -- a promotion is enumerable by `SELECT`, durably, rather than existing only inside a log retention window.
    "corroborated_a" uuid REFERENCES "ingredient_parse_corrections" ("id"),
    "corroborated_b" uuid REFERENCES "ingredient_parse_corrections" ("id"),
    "superseded_at" timestamptz,
    "superseded_by" uuid REFERENCES "ingredient_parse_corrections" ("id"),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "ingredient_parse_corrections_scope_check" CHECK ("scope" IN ('author', 'global')),
    CONSTRAINT "ingredient_parse_corrections_origin_check"
        CHECK ("origin" IN ('author', 'curator', 'corroboration')),
    -- Scope and origin are two views of one fact and cannot disagree.
    CONSTRAINT "ingredient_parse_corrections_scope_origin_agree"
        CHECK (("scope" = 'author') = ("origin" = 'author')),
    -- ⛔ A GLOBAL CORRECTION WITH NO JUSTIFICATION IS UNREPRESENTABLE. A corroboration binding cites both of
    -- the corrections that produced it, and only a corroboration binding cites anything.
    CONSTRAINT "ingredient_parse_corrections_corroboration_cites_both"
        CHECK (("origin" = 'corroboration') = ("corroborated_a" IS NOT NULL AND "corroborated_b" IS NOT NULL)),
    -- …and it cites TWO DIFFERENT rows. One row cited twice is one cook corroborating themselves.
    -- ⚠️ The `IS NULL` disjunct is REQUIRED, not defensive: `NULL IS DISTINCT FROM NULL` is FALSE, so without
    -- it this constraint rejects every ordinary (non-corroboration) row — the failure 0021 hit on its first
    -- run against a real database.
    CONSTRAINT "ingredient_parse_corrections_corroboration_distinct"
        CHECK ("corroborated_a" IS NULL OR "corroborated_a" IS DISTINCT FROM "corroborated_b"),
    -- A successor implies a retirement, but NOT the reverse: a correction may be retired with no replacement.
    CONSTRAINT "ingredient_parse_corrections_supersession_coherent"
        CHECK ("superseded_by" IS NULL OR "superseded_at" IS NOT NULL),
    -- A row cannot retire itself: the successor is what a reader follows to find the correction in force, so
    -- a self-reference is a loop with no answer at the end of it.
    CONSTRAINT "ingredient_parse_corrections_supersession_forward"
        CHECK ("superseded_by" IS DISTINCT FROM "id"),
    -- ⛔ THE PAIR INVARIANT (KTD-14). The owner link and the text it identifies exist together or not at all.
    -- Enforcing it HERE rather than trusting the sweep is what makes a half-erased row — a previous owner's
    -- id sitting beside somebody else's line — a state PostgreSQL refuses to store. A corroboration binding
    -- satisfies it by carrying NEITHER: it copies no cook's line, which is also why erasing either
    -- contributing cook leaves nothing on the binding to strip.
    CONSTRAINT "ingredient_parse_corrections_owner_line_pair"
        CHECK (("owner_id" IS NULL) = ("source_line" IS NULL))
);

-- ⛔ THE CORROBORATION COUNTER, exactly as `idx_resolution_mappings_live_author` is for 0021. "A second
-- INDEPENDENT cook corroborates" is implemented as a count of live author-scoped rows for a line, and that
-- equals a count of DISTINCT COOKS only because this index makes a second live row from one cook impossible.
-- Without it, corroboration would need a read-modify-write counter, and two concurrent corrections would
-- interleave into a promotion nobody earned. Partial on `superseded_at IS NULL` so history is RETAINED — a
-- later correction supersedes rather than being refused, which needs the old row to stay readable —  and on
-- `owner_id IS NOT NULL` so corroboration bindings and erased rows, which have no owner to be unique per,
-- are excluded. That exclusion is also what releases an erased cook's slot: without it, exercising the right
-- to erasure would permanently cost a returning user the ability to correct that line again.
CREATE UNIQUE INDEX "idx_parse_corrections_live_owner"
    ON "ingredient_parse_corrections" ("normalized_key", "owner_id")
    WHERE "scope" = 'author' AND "superseded_at" IS NULL AND "owner_id" IS NOT NULL;

-- ⛔ AT MOST ONE GLOBAL CORRECTION IS IN FORCE PER LINE. The top tier must be deterministic: two live global
-- rows carrying different parses would make "which correction wins?" a question with no answer, resolved
-- differently per query plan. Enforcing it here is what makes supersession the ONLY way a global correction
-- can be replaced — and therefore what makes the scope policy's supersession gate unbypassable.
CREATE UNIQUE INDEX "idx_parse_corrections_live_global"
    ON "ingredient_parse_corrections" ("normalized_key")
    WHERE "scope" = 'global' AND "superseded_at" IS NULL;

-- One corroboration binding per pair. This is what makes the concurrent-promotion race safe with an ordinary
-- `INSERT … ON CONFLICT DO NOTHING`: the loser gets zero rows, which reads as "somebody else already
-- promoted this", not as an error.
CREATE UNIQUE INDEX "idx_parse_corrections_corroboration_pair"
    ON "ingredient_parse_corrections" ("corroborated_a", "corroborated_b")
    WHERE "origin" = 'corroboration';

-- Serves both hot reads: the tier's "what is in force for this line, for this caller", and the write path's
-- "who else already corrected this line to this same parse". ⚠️ `corrected_facts` is deliberately NOT a
-- column of this index: a `jsonb` payload is unbounded and a btree index entry is not, so indexing it would
-- turn a large correction into an INSERT failure. The key alone narrows to a handful of rows, and the facts
-- equality is evaluated as a filter over them.
CREATE INDEX "idx_parse_corrections_live_lookup"
    ON "ingredient_parse_corrections" ("normalized_key")
    WHERE "superseded_at" IS NULL;

-- The erasure sweep's index. Partial for 0026's reason: the sweep's predicate is `owner_id = $1`, and a
-- de-identified row is NULL forever after, so indexing the NULLs would index the table's eventual majority
-- for a query that can never match them.
CREATE INDEX "idx_parse_corrections_owner"
    ON "ingredient_parse_corrections" ("owner_id")
    WHERE "owner_id" IS NOT NULL;
