/**
 * Drizzle mirror of `ingredients` — THE RECIPE LINE (migration 0051).
 *
 * This table replaces `recipe_ingredients`. The shared name catalog that used to be called `ingredients`
 * is gone; what a line binds to is now `food_lookups`, and the binding names exactly one of a food or an
 * unresolved food.
 *
 * ⚠️ `0051_ingredient_grain.sql` is AUTHORITATIVE. This declaration exists so drizzle knows the columns;
 * where the two disagree the SQL wins, and `schemaModelConformance.integration.test.ts` is what makes a
 * disagreement fail rather than drift.
 *
 * ⛔ `ingredient_name` AND `is_user_entered` ARE GONE, AND THEY ARE NOT COMING BACK AS COLUMNS. Both are
 * DERIVED by following {@link ingredients.foodLookupId}: the name from the catalog through the binding's
 * `food_id`, or from `unresolved_foods.name`; user-entered-ness from WHICH ARM the binding is on. A
 * denormalized copy is a second statement of a fact, and the whole point of the re-grain is that there is
 * only one.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { foodLookups } from './foodLookups.js';
import { recipes } from './recipes.js';

export const ingredients = pgTable(
    'ingredients',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        /**
         * ⛔ NOT NULL — the model's other half: a line cannot exist without a binding, so there is no such
         * thing as an ingredient that is neither a food nor an unresolved one.
         *
         * `RESTRICT` rather than `CASCADE` because a binding is SHARED: deleting one out from under the
         * lines that hold it would delete other cooks' ingredients, so the delete is refused and the caller
         * has to mean it.
         */
        foodLookupId: uuid('food_lookup_id')
            .notNull()
            .references(() => foodLookups.id, { onDelete: 'restrict' }),
        // U8/R41 — NULLABLE, and that is the point: `NULL` is the ONE representation of "the source stated
        // no amount" ("butter the size of an egg"). It is never `0`, which the positive check below still
        // refuses precisely so a zero cannot become a second spelling of absent.
        quantity: numeric('quantity', { precision: 10, scale: 3 }),
        /** The upper bound when the source stated a RANGE (`2 to 3 cups`); `NULL` for a single value (R36). */
        quantityHigh: numeric('quantity_high', { precision: 10, scale: 3 }),
        unit: text('unit').notNull(),
        /** A display OVERRIDE the author chose — not the raw line, and not our rendering of the food's name. */
        displayText: text('display_text'),
        /**
         * The WHOLE raw line the cook's SOURCE stated, verbatim (`2 cups all-purpose flour, sifted`).
         *
         * ⛔ DISTINCT FROM {@link ingredients.sourcePhrase}, AND MERGING THEM WOULD FAIL SILENTLY.
         * `verificationKey()` hashes the normalized LINE, so a merge changes every key — and because
         * ABSENCE OF A VERDICT PUBLISHES (migration 0023's header), nothing would error: verdicts would
         * simply stop matching and every line would publish unchecked.
         *
         * `NULL` means the line was AUTHORED rather than transcribed.
         */
        sourceLine: text('source_line'),
        /**
         * The ingredient PHRASE the parse lifted OUT of {@link ingredients.sourceLine} — `all-purpose
         * flour` from `2 cups all-purpose flour, sifted`. The memo tier's KEY GRAIN, because the cascade
         * queries with the phrase a picker types, never with a whole line.
         *
         * ⛔ Raw parsed text, and NEVER read as the line's display name — that comes from following
         * {@link ingredients.foodLookupId}.
         */
        sourcePhrase: text('source_phrase'),
        // U7/U11 — what the SOURCE printed, before the importer restated a historical measure into one the
        // USDA household-portion table carries. ⛔ Without these the verification gate is shown a number the
        // source never printed and correctly disagrees with a line we parsed RIGHT.
        statedQuantity: numeric('stated_quantity', { precision: 10, scale: 3 }),
        /** The stated UPPER bound when the source stated a range; `NULL` for a single stated value. */
        statedQuantityHigh: numeric('stated_quantity_high', { precision: 10, scale: 3 }),
        /** The unit the source printed (`gill`, `wineglass`, `saltspoon`). `NULL`, never `''`. */
        statedUnit: text('stated_unit'),
        // U26 — how THIS recipe prepares the food (`finely chopped`, `at room temperature`). Not a display
        // override, and not part of the name a binding resolves to. The vocabulary is `recipe-import-core`'s
        // `modifierLexicon.ts` (KTD-11b: past participle = preparation, adjective = identity, temperature =
        // preparation).
        preparation: text('preparation'),
        // U27 — the section this line belongs to (`For the marinade`, `Dry`). FREE TEXT by owner ruling
        // (2026-08-24), never an enum: a closed set could not express "For the crust". `NULL` means
        // ungrouped, which is most lines, and an all-NULL recipe renders as a plain flat list.
        groupLabel: text('group_label'),
        sortOrder: integer('sort_order').notNull().default(0),

        // User-entered nutrition override (FR-007a) — the USER's own, not a copy of anything food-service
        // holds. ⛔ NO CATALOG NUTRITION COLUMNS, and none may be added (KTD-3 / migration 0019): copies
        // taken at resolution time had no invalidation, so a food corrected upstream left every recipe
        // quoting the old number forever. Nutrition is read live through `FoodNutritionGateway`.
        userCalories: numeric('user_calories', { precision: 8, scale: 2 }),
        userProteinG: numeric('user_protein_g', { precision: 8, scale: 2 }),
        userCarbsG: numeric('user_carbs_g', { precision: 8, scale: 2 }),
        userFatG: numeric('user_fat_g', { precision: 8, scale: 2 }),
    },
    (table) => [
        // A Postgres CHECK is satisfied when it evaluates to NULL, so this already admits an absent quantity
        // while still refusing a zero — see `0020_quantity_range.sql`.
        check('ingredients_quantity_positive', sql`${table.quantity} > 0`),
        // The pair's illegal states, unrepresentable in the database as well as in `IngredientQuantity`: an
        // upper bound with no lower, and an upper bound at or below its lower (coincident bounds ARE an
        // exact quantity).
        check(
            'ingredients_quantity_coherent',
            sql`${table.quantityHigh} IS NULL OR (${table.quantity} IS NOT NULL AND ${table.quantityHigh} > ${table.quantity})`,
        ),
        // The stated pair's own illegal states: half a restatement, a blank unit (a second spelling of
        // "none" beside `NULL`), a non-positive amount, an inverted range, and a stated measure on a line
        // whose restated quantity is ABSENT — which `convertHistoricalUnit` refuses to produce, there being
        // no number to restate.
        //
        // ⚠️ It deliberately does NOT require the two pairs to share their range-ness: two stated bounds a
        // ten-thousandth apart round to one value at `numeric(10,3)`, and the right refusal for that is in
        // the tool, not a CHECK that turns a legitimate save into a 500.
        check(
            'ingredients_stated_measure_coherent',
            sql`(${table.statedQuantity} IS NULL AND ${table.statedQuantityHigh} IS NULL AND ${table.statedUnit} IS NULL) OR (${table.statedQuantity} IS NOT NULL AND ${table.statedQuantity} > 0 AND ${table.statedUnit} IS NOT NULL AND ${table.statedUnit} <> '' AND ${table.quantity} IS NOT NULL AND (${table.statedQuantityHigh} IS NULL OR ${table.statedQuantityHigh} > ${table.statedQuantity}))`,
        ),
        // U26/U27 — `NULL` is the ONE spelling of absent for each. A blank `preparation` reaches the wire as
        // `''`, which `recipeIngredientViewSchema` (`min(1)`) rejects — the exact write-but-cannot-read
        // break `notes` had. A blank or untrimmed `group_label` is worse than a second representation:
        // sections are FOLDED from the labels, so `'Dry '` renders a SECOND section under a heading visually
        // identical to `'Dry'`.
        check(
            'ingredients_preparation_present',
            sql`${table.preparation} IS NULL OR btrim(${table.preparation}) <> ''`,
        ),
        check('ingredients_group_label_present', sql`${table.groupLabel} IS NULL OR btrim(${table.groupLabel}) <> ''`),
        index('idx_ingredients_recipe_id').on(table.recipeId),
        index('idx_ingredients_food_lookup_id').on(table.foodLookupId),
    ],
);

/** An `ingredients` row as selected — one recipe LINE. */
export type IngredientRow = InferSelectModel<typeof ingredients>;
/** An `ingredients` row for insert. */
export type NewIngredientRow = InferInsertModel<typeof ingredients>;
