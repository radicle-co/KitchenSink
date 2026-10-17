-- 0030_ingredient_preparation_and_group.sql (plan U26/U27) — how a recipe PREPARES a food, and which
-- SECTION of the list the line belongs to.
--
-- ⛔ `preparation` IS NOT `display_text`, AND U26 SETTLED THAT RATHER THAN RENAMING ONE INTO THE OTHER.
-- The plan asked the question outright: `notes` (the wire name for `display_text`) already reaches the wire
-- and no EDITOR writes it, so is it really the preparation field under a wrong name? It is not, and the
-- evidence is its one producer. `@kitchensink/cookbook-import`'s `toImportedIngredientLine` writes
-- `notes: parsed.raw` — the whole normalized clause the book printed ("2 cups all-purpose flour, sifted",
-- "1 gill of milk") — kept verbatim beside the structured values "for a reader", in that function's own
-- words. Renaming that column to `preparation` would relabel every imported line's FULL CLAUSE as a
-- preparation phrase, on a surface that renders it inline beside the ingredient
-- (`RecipeDetailBody.tsx`). That is a visible corruption of data at rest, not a docstring fix.
--
-- So: `display_text` keeps its column, its wire name and its rendering, and nothing is backfilled. What
-- changes is that its docstrings now say what it actually is — a display OVERRIDE with an importer producer
-- and no editor writer — and `preparation` is a genuinely new field that the editor writes and only the
-- editor writes.
--
-- ⚠️ The VOCABULARY `preparation` holds is the KTD-11b ruling of 2026-08-23, already implemented as
-- `@kitchensink/recipe-import-core`'s `modifierLexicon.ts`: a past participle is preparation (`chopped`,
-- `grated`, `melted`, `sifted`), an ADJECTIVE is identity and belongs in the food's name (`sweet`, `brown`,
-- `Italian`, `large`), and a temperature is preparation even though it is an adjective (`hot`, `cold`).
-- ⛔ Nothing re-derives that split, and no part-of-speech tagger can: NLTK's was run over the ruling's own
-- 25 words and contradicts it on 7 of them, in both directions. It is a definition, not a claim about
-- English. This column is the wire's half of it.
--
-- ⛔ AND `preparation` IS NEVER PART OF THE FOOD'S NAME. `ingredient_name` is what a `food_id` resolves to
-- in the catalog; this is what one recipe does to it. Concatenating them is how a name stops matching any
-- catalog row — the failure `splitMeasurement`'s header records for measurements landing in the name.
--
-- ── group_label, and why it is FREE TEXT rather than an enum ────────────────────────────────────────────
--
-- ⛔ DRY/WET AS A PER-LINE ATTRIBUTION WAS DROPPED (owner ruling 2026-08-24), and this column is what
-- replaces it. The USDA derives nothing usable for a moisture state: `foodCategory` is a taxonomy, and the
-- Water nutrient (which we do not ingest) gets the COOKING sense backwards — flour at 12% water is dry,
-- honey at 17% is wet. More decisively, dry/wet is a property of the FOOD rather than of a recipe's use of
-- it: flour is dry every time, so a per-line toggle asks a cook to restate a fact about flour on every
-- recipe they will ever write. Where the distinction genuinely matters to a cook it means MIXING ORDER,
-- which is the same axis as "For the sauce". One field serves both. "Dry" and "Wet" survive here as two
-- LABELS among many — which is exactly why a closed set will not do, since it could not express
-- "For the crust".
--
-- ⚠️ This gives `parseIngredientLine`'s `group_header` somewhere to land. That parser already detects a
-- section heading ("For the sauce:") and, having nowhere to put it, raises it as a review reason and
-- discards the text. See the RESIDUAL note at the foot of this header for what still stands between the
-- signal and this column.
--
-- ⛔ PER LINE, and NOT a `(group, lines[])` structure on the wire. A structure can represent a GROUP WITH NO
-- LINES, which this column cannot — so such a group would survive in an editor, vanish on save, and reappear
-- to the cook as a section that silently deleted itself. A label on a line makes that state unrepresentable.
-- It also makes "move a line to another section" a single-field update rather than a splice across two
-- positions, which is where the line's other fields get dropped.
--
-- ⛔ SECTIONS ARE FOLDED FROM CONSECUTIVE RUNS of equal labels in `sort_order`, never grouped by label
-- identity. `[Dry][Wet][Dry]` renders as THREE sections in that order; folding by identity would pull the
-- third line up beside the first and REORDER the recipe, which is the one thing a stored order must never
-- do. An ungrouped recipe (every `group_label` NULL) renders as a plain flat list with no section chrome at
-- all — most recipes will never group, and those must not look unfinished.
--
-- ⛔ SCOPED TO ITS RECIPE, structurally rather than by a rule: there is no label id, no registry, no
-- cross-recipe entity. Two recipes writing "For the sauce" share a word and nothing else.
--
-- ── THE TWO CHECKS, AND WHY A BLANK IS WORSE THAN NULL ─────────────────────────────────────────────────
--
-- `NULL` is the ONE spelling of absent for both columns, and the checks are what hold that:
--
--   * a BLANK or whitespace-only `preparation` → REJECTED. The read projection omits the key for `NULL`
--     only, so a blank would reach the wire as `preparation: ''`, which `recipeIngredientViewSchema`
--     (`min(1)`) rejects — a body this server can write and no client can read. That is the exact break
--     `notes` had before `recipeIngredientNotesSchema` gained its `min(1)`.
--   * a BLANK or whitespace-only `group_label` → REJECTED, and here it is sharper than a second
--     representation. Sections are folded from the labels themselves, so 'Dry ' renders a SECOND section
--     under a heading visually identical to 'Dry' — one a reader cannot tell apart and a cook cannot merge.
--     The wire trims (`recipeIngredientGroupLabelSchema` pipes through `.trim()`); this refuses what a
--     caller bypassing the wire could still write.
--
-- ⚠️ The two are deliberately INDEPENDENT — no check couples them. A preparation with no group and a group
-- with no preparation are both ordinary lines, and pairing them would refuse the commonest shape of each.
--
-- ⚠️ And NOTHING couples `preparation` to `display_text`. They are different facts with different producers
-- (see the top of this header); a coupling would refuse the ordinary imported line, which legitimately
-- carries a clause in `display_text` and no preparation at all.
--
-- PERSONAL DATA: user-authored free text, on a table that `ON DELETE CASCADE`s from `recipes` — so the
-- erasure worker's scoped recipe delete already reaches both columns, exactly as it reaches `display_text`
-- and `source_line`. `recipe_ingredients` carries no owner column of its own, so
-- `erasureSweepCoverage.test.ts` neither requires nor exempts it; the cascade is the coverage.
--
-- EXPAND-ONLY (ADR-0022). Two nullable `ADD COLUMN`s with no default — a catalog-only change in PostgreSQL
-- 11+, so no table rewrite and no long lock — plus two `NOT VALID` CHECKs, which skip the full-table
-- verification scan while still policing every INSERT and UPDATE from this moment on. Every pre-existing row
-- satisfies both trivially (both columns are NULL), so a later `VALIDATE CONSTRAINT` is a no-op cleanup that
-- can run at any time in its own migration. Safe to apply BEFORE the code that writes it, which is the order
-- the in-stack migration Trigger enforces.
--
-- ── ROLLBACK ──
-- Rolling the IMAGE back is safe: the previous release neither writes nor reads these columns, and the
-- checks are satisfied by the all-NULL rows it would leave. Rolling the SCHEMA back is not offered (there
-- are no down-migrations in any runner); recovery is `DROP COLUMN`, and the data is authored by a cook, so
-- it is not re-derivable — which is the argument for not rolling the schema back at all.
--
-- ⛔ NO INDEX, deliberately. Nothing looks a line UP by its preparation or its section: the fold runs over a
-- recipe's own lines, which are already loaded by `recipe_id` in `sort_order`. An index here would cost a
-- write on every recipe save to serve a query no code issues.
--
-- ── THREE RESIDUALS, RECORDED RATHER THAN IMPLIED ──
--
-- ⚠️ 1. `preparation` HAS NO PRODUCER BUT THE EDITOR. `ParsedLine.prep` already exists and is already
-- populated — `parseComparator.ts`'s header calls KTD-11b "the definition `prep` carries system-wide,
-- INCLUDING the write-path field in U26", a forward reference to this column — and `ingredient_parse_cache`
-- stores it. Nothing on a recipe CREATE path reads it, so an imported line arrives with its preparation
-- still inside the food name. Wiring it is a parse-pipeline change (the same one residual 3 needs), not a
-- wire change; the column and the contract are ready for it.
--
-- ⚠️ 2. THE DETAIL SURFACE RENDERS NO SECTIONS. `preparation` is rendered on both detail leaves — a field
-- an author can set and a reader cannot see is a defect, not a deferral — but a grouped recipe still reads
-- as ONE undifferentiated list on the surface a cook cooks from. Sections render in the EDITOR only. The
-- detail's ingredient list is a single `<ul>` of checkbox `<li>`s whose state is keyed per line, so
-- splitting it has cook-mode and list-semantics consequences that want their own change; plan U27 scopes
-- section rendering to "both form leaves" and this migration does not widen that. It is a KNOWN GAP in the
-- feature's usefulness, not an oversight.
--
-- ⚠️ 3. `group_header` does NOT yet reach this column from any shipped
-- import path, and the reason is structural rather than a missed wiring. The only consumer of
-- `parseIngredientLine` on a create path is `cookbook-import`'s prose scanner, whose `ingredientInClause`
-- accepts a clause ONLY when it parses to both a quantity and a unit — and a section heading has neither, so
-- it is never emitted as a clause at all. `ParsedClause` also carries no `reviewReasons`, so the signal is
-- gone one step earlier. Landing it needs a STRUCTURED-list importer (feature 004, unbuilt) or a
-- cross-clause state change in the prose scanner; the wire and the column are ready for either.

ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS preparation text;

ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS group_label text;

ALTER TABLE recipe_ingredients
    DROP CONSTRAINT IF EXISTS recipe_ingredients_preparation_present;

ALTER TABLE recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_preparation_present
        CHECK (preparation IS NULL OR btrim(preparation) <> '')
        NOT VALID;

ALTER TABLE recipe_ingredients
    DROP CONSTRAINT IF EXISTS recipe_ingredients_group_label_present;

ALTER TABLE recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_group_label_present
        CHECK (group_label IS NULL OR btrim(group_label) <> '')
        NOT VALID;
