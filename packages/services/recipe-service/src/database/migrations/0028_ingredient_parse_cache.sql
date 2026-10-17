-- 0028_ingredient_parse_cache.sql (plan U20 / KTD-13, KTD-14) — what an ENGINE made of one ingredient line.
--
-- ⛔ THE KEY CARRIES THE ENGINE, WHERE ITS NEAREST PRECEDENT PUTS THE MODEL IN A COLUMN, AND THAT IS THE WHOLE
-- DESIGN.
--
-- `recipe_ingredient_verifications` (0023) keys a JUDGEMENT on the content of the judgement and stores
-- `model_id` as an ATTRIBUTE, versioning only the derivation — so swapping models does not invalidate cached
-- verdicts. That is correct there: a verdict is a verdict, and the model that reached it is provenance.
--
-- This table backs a COMPARISON pipeline, and the comparison IS the product. U19's comparator needs BOTH
-- engines' answers for one line to exist AT THE SAME TIME. Keyed the 0023 way — engine as an attribute — the
-- second engine's write would overwrite the first, and the comparator would adjudicate one answer against
-- itself while every test stayed green. So the identity is the TRIPLE `(line_digest, engine, engine_version)`,
-- the merged result is DERIVED rather than stored as the only row, and a CRF version bump re-partitions only
-- the CRF half while every LLM row survives to be re-compared against the new pairing.
--
-- ## ALTERNATIVES REJECTED, recorded so they are not re-proposed as simplifications
--
--   1. **One row per line, engine in a column** — the 0023 shape. Rejected above: it cannot hold two engines'
--      answers, which is the one thing this table exists to do.
--   2. **One row per line with two nullable columns (`crf_parse`, `llm_parse`)** — makes "the same line under
--      two engines" a single row and looks tidier. Rejected: a third engine is then a MIGRATION rather than a
--      value, the two halves must be written by two concurrent processes into one row (a lost update, or a
--      read-modify-write and a lock), and `engine_version` would have to be duplicated per column with nothing
--      keeping the pair coherent.
--   3. **Keyed on `recipe_ingredients.id`** — rejected for 0023's reason, which binds here identically:
--      `replaceForRecipe` deletes and re-inserts every ingredient row with fresh ids on EVERY recipe edit, so
--      a parse keyed on one would be discarded wholesale because a word changed in a step, and re-paid for.
--   4. **No cache at all** — rejected on cost, and on determinism: without one, re-running the comparison
--      harness over the corpus re-invokes both engines for all ~2,584 lines, and the LLM leg does not return
--      the same answer twice, so a measurement could never be repeated against fixed inputs.
--
-- ## ⛔ KTD-14 — THIS TABLE HOLDS A DIGEST AND A PARSE, AND NO OWNER LINK. THAT IS LOAD-BEARING.
--
-- It is deliberately absent from `recipe-workers`' account-erasure sweep, exactly as
-- `recipe_ingredient_verifications` is, and the ONLY thing that makes that defensible is the absence of a
-- person-to-row link. `parse.foods[].name` is a fragment of user-typed text; the mitigation is that the row is
-- shared installation-wide and addressed by a one-way digest of the line, so there is nothing for a sweep to
-- key on and nothing an operator could use to attribute a row to a cook.
--
-- ⚠️ ADDING ANY COLUMN NAMING A PERSON — `owner_id`, `author_id`, `user_id`, even `recipe_id` — CHANGES THAT,
-- and it must not happen by accident. `ingredient_resolution_mappings` and `ingredient_resolution_memos` BOTH
-- shipped owner-bearing without sweep coverage and were retrofitted (0026). The guard against a third instance
-- is `parseCacheSchema.integration.test.ts`, which asserts this table's column set by EQUALITY: any new column
-- reds it, so whoever adds one owes an erasure decision at that moment. A cook's own correction of a parse is
-- a DIFFERENT table with the memo treatment (U21 / 0029) — never a column here.
--
-- ## The `{version}:` prefix on both key columns
--
-- `parse_key` and `line_digest` are `{version}:{sha256hex}`, derived by `@kitchensink/recipe-core/parsing/
-- parse-key`. TEXT, not `uuid`: the version prefix is part of the VALUE and is what a query filters on to find
-- a superseded generation (`WHERE parse_key LIKE 'v1:%'`). Without it, changing the derivation makes every
-- stored row unreachable while every new row collides with nothing — no error, no failing test, the cache
-- simply stops hitting, both engines are re-invoked for every line, and the only symptom is a bill. The two
-- `_versioned` CHECKs below make an unprefixed key impossible, because a row belonging to no generation can
-- never be enumerated OUT of one. They sit on a derived, machine-written value, so a malformed one is a code
-- defect that must be loud rather than absorbed — the reasoning `verification_spend_period_format` (0022)
-- already establishes.
--
-- ⚠️ Reclaiming a superseded generation is an OPERATIONAL act (`DELETE … WHERE parse_key LIKE 'v1:%'`), not an
-- automatic one. Rows are small and the corpus is bounded; a TTL would delete measurements the comparison
-- harness is still citing.
--
-- ## A cache row is WRITE-ONCE within its generation
--
-- The pipeline writes `ON CONFLICT (parse_key) DO NOTHING`, so the FIRST parse of a generation stands. That is
-- deliberate, and `DO UPDATE` would be wrong: the LLM leg is not deterministic, so an overwriting cache lets a
-- row change under a comparison that already cited it, and a re-run of the harness would silently measure
-- different inputs. A corrected parse arrives as a NEW `engine_version` (or a `PARSE_KEY_VERSION` bump) — never
-- as a silent rewrite of a row somebody's measurement depends on. It also makes a redelivered pipeline message
-- and two concurrent misses both benign.
--
-- ## Notes on the constraints
--
-- ⚠️ Every CHECK below sits on a `NOT NULL` column, deliberately. A CHECK treats NULL as PASSING, which is how
-- 0023's `array_length("aspects", 1) >= 1` would have admitted exactly the empty array it forbade (that one
-- needs `cardinality`). There is no array or nullable column here, so the trap has no purchase — but the rule
-- is why it is worth saying out loud rather than rediscovering.
--
-- `jsonb`, not `json` or `text`: normalized on write, equality-comparable, and `jsonb_typeof` gives the one
-- structural floor worth having — the column holds an OBJECT, so a raw line or a bare string cannot be stored
-- in the place a structured parse belongs. Its INTERIOR shape is U16's `ParsedLine` contract and is checked in
-- TypeScript by the producer, not here: a database that validated the parse's shape would have to be migrated
-- every time the contract moved, in lockstep with an expand-first deploy that cannot guarantee the order.
--
-- EXPAND-ONLY (ADR-0022). One new table and one new index; nothing existing is altered, dropped or rewritten,
-- so the image that predates this migration keeps working against the migrated schema. `IF NOT EXISTS` on both
-- statements so a re-run is a no-op independently of the runner's `schema_migrations` ledger.

CREATE TABLE IF NOT EXISTS "ingredient_parse_cache" (
    -- `{version}:{sha256hex}` over `[version, line_digest, engine, engine_version]` — the content key, and the
    -- primary key. Being a digest of exactly the triple the UNIQUE index below constrains is what keeps the two
    -- describing the same thing.
    "parse_key" text PRIMARY KEY,

    -- `{version}:{sha256hex}` over the NFC-normalized, whitespace-collapsed, case-PRESERVING source line.
    -- ⛔ Case is not folded, deliberately opposite to `normalized_key`: that one is an equivalence class for
    -- MATCHING two cooks' phrases, this identifies the exact text handed to a parser, and both engines read a
    -- capitalised proper noun differently. This column is the ONLY representation of the line that is stored.
    "line_digest" text NOT NULL,

    -- Which engine produced the parse. A member of the identity, not provenance beside it (see the header).
    "engine" text NOT NULL,

    -- The engine's own version: the CRF package + model pin, or the LLM's model id + prompt version. Opaque
    -- here on purpose — what counts as "a different version" is the engine's business, and a schema that
    -- parsed it would change every time an engine's versioning scheme did.
    "engine_version" text NOT NULL,

    -- The engine's structured output, verbatim. U16's `ParsedLine`; this service stores and returns it and
    -- interprets nothing.
    "parse" jsonb NOT NULL,

    "parsed_at" timestamptz NOT NULL DEFAULT now(),

    -- The engine vocabulary is CHECKed rather than left to the application because this table's whole job is to
    -- be read by a DIFFERENT process than the one that wrote it. An unrecognised engine is a cached parse no
    -- reader has an interpretation for, and the comparator's safe-looking fallback would be to treat it as the
    -- other engine's answer. Mirrors `PARSE_ENGINES` in `@kitchensink/recipe-core/parsing/parse-key`, which the
    -- Drizzle definition ties itself to with `satisfies` — so a third engine is a compile error AND a migration.
    CONSTRAINT "ingredient_parse_cache_engine_check"
        CHECK ("engine" IN ('crf', 'llm')),

    -- See the header. An unprefixed key belongs to no generation and can never be enumerated out of one.
    CONSTRAINT "ingredient_parse_cache_parse_key_versioned"
        CHECK ("parse_key" ~ '^v[0-9]+:.+$'),
    CONSTRAINT "ingredient_parse_cache_line_digest_versioned"
        CHECK ("line_digest" ~ '^v[0-9]+:.+$'),

    -- An unversioned parse is served forever: a version bump re-partitions by CHANGING this value, and it
    -- cannot change something that was never set.
    CONSTRAINT "ingredient_parse_cache_engine_version_nonempty"
        CHECK (length("engine_version") >= 1),

    -- The column holds STRUCTURED output. Without this it would accept `"2 cups flour"` — the raw line, in the
    -- one table whose erasure argument is that it stores no raw line.
    CONSTRAINT "ingredient_parse_cache_parse_object"
        CHECK (jsonb_typeof("parse") = 'object')
);

-- ⛔ ONE INDEX, TWO JOBS, and neither is redundant with the primary key.
--
-- ENFORCEMENT: "one cache row per (line_digest, engine, engine_version)" is the unit's stated goal, and
-- `parse_key` alone cannot enforce it — the key is a DIGEST of this triple, so the invariant holds only while
-- the derivation is correct and is the sole way rows are written. A derivation bug, a hand-written statement,
-- or a second writer keyed differently would otherwise produce two rows for one identity, and the comparator
-- would adjudicate a duplicate as though it were a second engine's answer.
--
-- READ: `line_digest` is the LEFTMOST column, so the same index serves the pipeline's hottest query — "every
-- engine's parse for this line" — at no additional write cost.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_parse_cache_identity"
    ON "ingredient_parse_cache" ("line_digest", "engine", "engine_version");
