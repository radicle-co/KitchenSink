-- 0021_resolution_mappings.sql (plan U10) — the ingredient-resolution knowledge base.
--
-- Two tables, not one, because a curated mapping and a machine-derived one CHANGE FOR DIFFERENT REASONS:
--   * ingredient_resolution_mappings — HUMAN-authored (R19/R20). Its reach is an authorization decision
--     (`ingredients/domain/mappingScopePolicy.ts`), it is supersedable, and its HISTORY IS THE AUDIT TRAIL
--     behind every global ruling.
--   * ingredient_resolution_memos    — MACHINE-derived. Nobody asserted it, so it has no scope and no author;
--     what it carries instead is the identifier of the model that AGREED with it (R21).
--     ⚠️ UPDATED BY 0026, then REVERSED BY 0033. 0026 gave it an `owner_id` — the predicate account
--     erasure needed to reach `source_phrase`. The 2026-08-25 owner ruling (ADR-0027) repealed that: an
--     ingredient phrase is not personal data, so 0033 DROPPED the column and the sweep. This tier is once
--     again what the sentence above says it is — no scope, no author, nobody. The residual recorded below
--     is not "closed", it is REPEALED.
-- Folding them together would produce rows where "who decided this, and on whose authority" is unanswerable,
-- which is the exact question an audit of a global mapping exists to answer.
--
-- ⛔ THE PLAN'S "EMBEDDINGS" TABLE IS DELIBERATELY NOT BUILT. The plan specifies a stored vector column with
-- brute-force cosine search and a firing condition for an ANN decision. It is a MEMO table with a pg_trgm
-- k-NN index instead, for four reasons, none of which is a preference:
--   1. NOTHING IN THIS RELEASE CAN PRODUCE AN EMBEDDING, and producing one would breach ADR-0024. There is no
--      embedding model anywhere in the plan; the only provider client is U11's, and calling Bedrock from
--      recipe-service (Fargate) would add a SECOND `bedrock:InvokeModel` grantee — which ADR-0024 layer 4b's
--      set-equality guard test fails on by construction — and would put that spend OUTSIDE the $100
--      reserve-then-settle ceiling, which counts verification `Converse` calls only.
--   2. R14's requirement is a NEAREST-NEIGHBOUR lookup, not a VECTOR one, and this database already ships
--      one. `pg_trgm` (created in 0001) provides the `<->` distance operator over a GiST index, so the
--      near-twin lookup is an INDEXED k-NN query inside Postgres rather than a full-table fetch plus a cosine
--      loop in Node.
--   3. That cosine loop is an operational hazard the plan does not price: it would load N x d float8 into the
--      Node heap on a request path, in a horizontally-scaled Fargate service with no shared cache. The
--      binding constraint is memory in the API process, not recall — so the metric the plan proposed would
--      have measured the wrong thing.
--   4. A nullable vector column no writer fills is speculative capability. Adding it later is a metadata-only
--      `ADD COLUMN`, so the "cheap seam / expensive reversal" exception does not apply.
-- ⚠️ For the record, one premise a reader might supply is FALSE: pgvector IS available on RDS PostgreSQL 16
-- (from 16.1). Its absence is not the reason; the absence of a PRODUCER is.
-- When U11 ships an embedding model it ADDS a vector column and a second lookup path beside this one.
--
-- EXPAND-ONLY (ADR-0022). Two new tables and their indexes; nothing existing is altered, dropped or
-- rewritten, so this is safe to apply BEFORE the code that reads it — the order the in-stack migration
-- Trigger enforces. There is no down-migration in any runner in this repository; recovery is `DROP TABLE`,
-- and both tables hold DERIVED knowledge rebuildable from user corrections and re-resolution.
--
-- ⛔⛔ EVERYTHING IN THE PARAGRAPH BELOW WAS REVERSED — owner ruling 2026-08-25, ADR-0027, migration 0033.
-- An ingredient phrase is NOT personal data: there is no erasure sweep over this table, `author_id` is now
-- `user_id` and is a DISTINCT-USER COUNTER plus an authorization predicate, and the partial index this
-- header calls "the erasure sweep's index" was dropped. The paragraph is left standing as the record of what
-- was believed, not as a description of the system. Read
-- `docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md` first.
--
-- ⛔ RIGHT-TO-ERASURE IS NOT WIRED, AND MUST BE BEFORE THE WRITE PATH BECOMES REACHABLE (handed off).
-- `author_id` is an app-user ULID and `source_phrase` is text a user typed, so these rows are personal data.
-- `recipe-workers`' account-erasure sweep deletes `recipes`, `collections`, `recipe_ratings` and
-- `author_handles` and knows nothing about this table. That is tolerable ONLY because U10 ships no route —
-- the correction surface is U14's, so no production row exists yet. The schema below is shaped so the
-- prescribed sweep is a single statement and needs no further migration:
--   UPDATE ingredient_resolution_mappings
--      SET superseded_at = now(), author_id = NULL, source_phrase = NULL
--    WHERE author_id = $owner AND superseded_at IS NULL;
-- which is why `author_id` is NULLABLE, why `superseded_by` may be NULL while `superseded_at` is set, and why
-- there is a partial index on `author_id`. ⛔ A HARD DELETE IS THE WRONG ANSWER: a corroboration row cites
-- the two author rows that produced it, so deleting them would either break those references or silently
-- un-resolve an ingredient for every OTHER user.

-- ── The curated tier: human-authored, scope-gated, supersedable ───────────────────────────────────

CREATE TABLE "ingredient_resolution_mappings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The match grain: `normalizedIngredientKey` (@kitchensink/recipe-core). NOT a display name.
    "normalized_key" text NOT NULL,
    -- The raw phrase the key was derived FROM. Its presence is what makes the key derivation a two-way door:
    -- a change to that function re-partitions this table, and with the phrase stored the repair is a backfill
    -- rather than data loss. NULLABLE because erasure removes it (see the header).
    "source_phrase" text,
    -- Opaque food-service ULID, exactly as `ingredients.food_id`: never a USDA fdcId, never a cross-DB FK.
    -- ⚠️ It MAY dangle. U12's reseed mints fresh ULIDs and nothing here can prevent that, so every reader
    -- must treat an unresolvable mapping as a MISS and fall through — never as an error.
    "food_id" text NOT NULL,
    "scope" text NOT NULL,
    -- On whose authority this mapping holds. `author` = its writer alone; `curator` = a grant holder;
    -- `corroboration` = two independent authors agreeing. Separate from `scope` because `curator` and
    -- `corroboration` are the SAME reach reached by DIFFERENT authority, and the supersession rule below
    -- turns on which one it was.
    "origin" text NOT NULL,
    -- The app-user ULID that wrote it (R20 "who"). NULL for a corroboration binding (nobody wrote it — two
    -- people's agreement produced it) and for an erased author. VARCHAR(255), no FK: no local users table (D2).
    "author_id" varchar(255),
    -- R20 "from which surfacing". Free text rather than a CHECK enum: the set of surfaces grows with the
    -- product, and a surface added tomorrow must never fail a user's correction with a constraint violation.
    "surfacing" text NOT NULL,
    -- The two author-scoped mappings whose agreement produced a corroboration binding. THIS IS THE AUDIT
    -- RECORD the plan asks for: a promotion is enumerable by `SELECT`, durably, rather than existing only in
    -- a log line inside a retention window.
    "corroborated_a" uuid REFERENCES "ingredient_resolution_mappings" ("id"),
    "corroborated_b" uuid REFERENCES "ingredient_resolution_mappings" ("id"),
    "superseded_at" timestamptz,
    "superseded_by" uuid REFERENCES "ingredient_resolution_mappings" ("id"),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "ingredient_resolution_mappings_scope_check" CHECK ("scope" IN ('author', 'global')),
    CONSTRAINT "ingredient_resolution_mappings_origin_check"
        CHECK ("origin" IN ('author', 'curator', 'corroboration')),
    -- Scope and origin are two views of one fact and cannot disagree: an author-scoped mapping is exactly one
    -- somebody wrote for themselves, and everything else binds globally.
    CONSTRAINT "ingredient_resolution_mappings_scope_origin_agree"
        CHECK (("scope" = 'author') = ("origin" = 'author')),
    -- ⛔ A GLOBAL MAPPING WITH NO JUSTIFICATION IS UNREPRESENTABLE. A corroboration binding cites both of the
    -- mappings that produced it, and only a corroboration binding cites anything.
    CONSTRAINT "ingredient_resolution_mappings_corroboration_cites_both"
        CHECK (("origin" = 'corroboration') = ("corroborated_a" IS NOT NULL AND "corroborated_b" IS NOT NULL)),
    -- …and it cites TWO DIFFERENT mappings. One row cited twice is one author corroborating themselves.
    -- ⚠️ The `IS NULL` disjunct is REQUIRED, not defensive: `NULL IS DISTINCT FROM NULL` evaluates to FALSE,
    -- so without it this constraint rejects every ordinary (non-corroboration) row — which is precisely what
    -- the schema integration test caught on the first run of this migration.
    CONSTRAINT "ingredient_resolution_mappings_corroboration_distinct"
        CHECK ("corroborated_a" IS NULL OR "corroborated_a" IS DISTINCT FROM "corroborated_b"),
    -- A successor implies a retirement, but NOT the reverse: erasure retires a mapping with no replacement.
    CONSTRAINT "ingredient_resolution_mappings_supersession_coherent"
        CHECK ("superseded_by" IS NULL OR "superseded_at" IS NOT NULL),
    -- A row cannot retire itself: the successor is what a reader follows to find the ruling in force, so a
    -- self-reference is a loop with no answer at the end of it.
    CONSTRAINT "ingredient_resolution_mappings_supersession_forward"
        CHECK ("superseded_by" IS DISTINCT FROM "id")
);

-- ⛔ THIS INDEX IS THE CORROBORATION COUNTER. "A second INDEPENDENT user corroborates" is implemented as a
-- count of live author-scoped rows for a phrase, and that equals a count of DISTINCT AUTHORS only because
-- this index makes a second live row from one author impossible. Without it, corroboration would need a
-- read-modify-write counter — the shape the plan explicitly rejects, because two concurrent corrections then
-- interleave into a promotion nobody earned. Partial on `superseded_at IS NULL` so history is RETAINED: R20
-- requires a later correction to supersede rather than be refused, which needs the old row to stay readable.
-- `author_id IS NOT NULL` excludes corroboration bindings and erased rows, which have no author to be unique
-- per.
CREATE UNIQUE INDEX "idx_resolution_mappings_live_author"
    ON "ingredient_resolution_mappings" ("normalized_key", "author_id")
    WHERE "scope" = 'author' AND "superseded_at" IS NULL AND "author_id" IS NOT NULL;

-- ⛔ AT MOST ONE GLOBAL MAPPING IS IN FORCE PER PHRASE. Tier 1 must be deterministic: two live global rows
-- naming different foods would make "which mapping wins?" a question with no answer, resolved differently per
-- query plan. Enforcing it HERE rather than in code is what makes the supersession path the only way a global
-- mapping can be replaced — and therefore what makes the scope policy's supersession gate unbypassable.
CREATE UNIQUE INDEX "idx_resolution_mappings_live_global"
    ON "ingredient_resolution_mappings" ("normalized_key")
    WHERE "scope" = 'global' AND "superseded_at" IS NULL;

-- One corroboration binding per pair of corroborating mappings. This is what makes the concurrent-promotion
-- race safe with an ordinary `INSERT … ON CONFLICT DO NOTHING`: the loser gets zero rows, which reads as
-- "somebody else already promoted this", not as an error.
CREATE UNIQUE INDEX "idx_resolution_mappings_corroboration_pair"
    ON "ingredient_resolution_mappings" ("corroborated_a", "corroborated_b")
    WHERE "origin" = 'corroboration';

-- Serves both hot reads: tier 1's "what is in force for this phrase, for this caller", and the write path's
-- "who else already mapped this phrase to this same food".
CREATE INDEX "idx_resolution_mappings_live_lookup"
    ON "ingredient_resolution_mappings" ("normalized_key", "food_id")
    WHERE "superseded_at" IS NULL;

-- The erasure sweep's index. Erasure is a per-user operation on a path with a deadline, so it gets one;
-- the post-reseed dangling-`food_id` sweep deliberately does NOT, because it is a one-off maintenance scan
-- and an unused index would cost write amplification on every correction forever.
CREATE INDEX "idx_resolution_mappings_author"
    ON "ingredient_resolution_mappings" ("author_id")
    WHERE "author_id" IS NOT NULL;

-- ── The memo tier: machine-derived, model-attributed ──────────────────────────────────────────────

CREATE TABLE "ingredient_resolution_memos" (
    -- The key IS the identity: one remembered resolution per phrase. A re-verification under a newer model
    -- REPLACES the memo rather than accumulating beside it — a memo is a food id, not a vector, so an older
    -- judge's answer is superseded by a newer one rather than being incomparable to it.
    "normalized_key" text PRIMARY KEY,
    "food_id" text NOT NULL,
    "source_phrase" text NOT NULL,
    -- R21 — the identifier of the model that AGREED with this resolution. ⛔ A memo exists ONLY for a
    -- resolution the verification gate agreed with; this column is that agreement's record, and a writer with
    -- no model identifier to record is a writer with no agreement to record.
    "verified_by" text NOT NULL,
    "verified_at" timestamptz NOT NULL DEFAULT now()
);

-- ⛔ THIS INDEX IS THE NEAREST-NEIGHBOUR SEARCH (R14 forbids equality-only matching). `pg_trgm`'s GiST
-- operator class supports the `<->` distance operator, so `ORDER BY normalized_key <-> $1 LIMIT k` is an
-- INDEXED k-NN query rather than a sort over the whole table. GiST, not GIN: GIN supports `%` containment and
-- `similarity()` but NOT the distance ordering a k-NN scan orders by.
CREATE INDEX "idx_resolution_memos_key_trgm"
    ON "ingredient_resolution_memos" USING gist ("normalized_key" gist_trgm_ops);
