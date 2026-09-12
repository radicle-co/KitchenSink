/**
 * Unit coverage for the deterministic seed data (T096): the ingredient/recipe/collection ids must be
 * valid, unique UUIDs (they target `uuid` columns), the collection's members must reference real seed
 * recipes, and — since the seed gained real composition — every seeded recipe must carry ingredient lines
 * and steps that the database's own CHECK/UNIQUE constraints will accept.
 *
 * These are the constraints of `0001_initial.sql` restated at the unit tier, where they fail in
 * milliseconds with a readable diff instead of as an opaque `23514`/`23505` from a Postgres the developer
 * may not have running. The integration tier (`__tests__/integration/recipes/seededWorld.integration.test.ts`)
 * proves the rows actually land and read back; this tier proves the DATA could never be illegal.
 */
import { describe, expect, it } from 'vitest';

import {
    SEED_COLLECTION,
    SEED_INGREDIENTS,
    SEED_OWNER_FREE,
    SEED_OWNER_PRO,
    SEED_RECIPE_INGREDIENT_LINES,
    SEED_RECIPE_STEPS,
    SEED_RECIPES,
    seedIngredientNamesText,
} from '../seed.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The three catalog rows that are pinned by position, and are deliberately attached to NO seed recipe. */
const UNATTACHED_CATALOG_NAMES = ['Flour', 'Sugar', 'Butter'];

describe('recipe seed data', () => {
    it('seeds exactly 5 recipes with valid, unique UUID ids', () => {
        expect(SEED_RECIPES).toHaveLength(5);

        for (const r of SEED_RECIPES) {
            expect(r.id).toMatch(UUID);
        }

        expect(new Set(SEED_RECIPES.map((r) => r.id)).size).toBe(5);
    });

    it('honors the recipe CHECK constraints (positive servings, non-negative + consistent times)', () => {
        for (const r of SEED_RECIPES) {
            expect(r.servings).toBeGreaterThan(0);
            expect(r.prepTimeMinutes).toBeGreaterThanOrEqual(0);
            expect(r.cookTimeMinutes).toBeGreaterThanOrEqual(0);
            expect(r.totalTimeMinutes).toBe(r.prepTimeMinutes + r.cookTimeMinutes);
            expect(['public', 'private']).toContain(r.visibility);
        }
    });

    it('assigns recipes across the two stable owners', () => {
        const owners = new Set(SEED_RECIPES.map((r) => r.ownerId));
        expect(owners).toEqual(new Set([SEED_OWNER_FREE, SEED_OWNER_PRO]));
    });

    /**
     * ⚠️ REWRITTEN (was: `expect(names).toEqual(['Flour', 'Sugar', 'Butter'])`, an EXACT whole-catalog
     * assertion). The catalog now also carries the ingredients the five seed recipes are actually made of,
     * so an exact list would have to be restated here on every fixture edit — a test that only ever
     * repeats the source it guards. What is genuinely load-bearing is narrower and is what this asserts:
     *
     *   1. Flour, Sugar and Butter remain the FIRST THREE, in that order, because
     *      `__tests__/integration/recipes/ingredientsComposition.integration.test.ts` destructures
     *      `const [FLOUR, SUGAR] = SEED_INGREDIENTS` and asserts those names on read-back. That is a
     *      POSITIONAL contract, and prepending a row to the catalog silently retargets it.
     *   2. The catalog is bigger than that trio, i.e. the recipe ingredients really are catalog rows —
     *      recipe create/update validates every line's `ingredientId` against this table (T043b), and
     *      `ingredients/search.integration.test.ts` restores the seeded world from it after wiping.
     */
    it('pins [Flour, Sugar, Butter] as the first three catalog rows, ahead of the recipe ingredients', () => {
        expect(SEED_INGREDIENTS.slice(0, 3).map((i) => i.name)).toEqual(UNATTACHED_CATALOG_NAMES);
        expect(SEED_INGREDIENTS.length).toBeGreaterThan(3);
    });

    it('gives every catalog row a valid UUID id and a case-insensitively unique name', () => {
        for (const ingredient of SEED_INGREDIENTS) {
            expect(ingredient.id).toMatch(UUID);
            expect(ingredient.name.trim()).toBe(ingredient.name);
            expect(ingredient.name.length).toBeGreaterThan(0);
        }

        expect(new Set(SEED_INGREDIENTS.map((i) => i.id)).size).toBe(SEED_INGREDIENTS.length);
        // Every seeded row is inserted `is_user_entered = true`, which is exactly the partial predicate of
        // `idx_ingredients_freeform_name` (0006) — a UNIQUE index on `lower(name)`. Two rows differing only
        // in case would abort the seed with a 23505 the moment a fresh database is migrated.
        expect(new Set(SEED_INGREDIENTS.map((i) => i.name.toLowerCase())).size).toBe(SEED_INGREDIENTS.length);
    });

    /**
     * The suite-safe invariant `packages/apps/commise/mobile/.maestro/recipes/search-navigation.yaml`
     * rests on: it filters discovery by the catalog ingredient "Flour" and asserts the feed collapses to
     * "No matching recipes". Attaching Flour (or its two neighbours, for the same reason) to a seed recipe
     * turns that flow red on an emulator this change cannot run — so the trio stays a pure CATALOG fixture
     * and every recipe line comes from the rows appended after it.
     */
    it('attaches none of Flour, Sugar or Butter to a seed recipe (the Maestro ingredient-filter anchor)', () => {
        const attached = new Set(SEED_RECIPE_INGREDIENT_LINES.map((line) => line.ingredient.name));

        for (const name of UNATTACHED_CATALOG_NAMES) {
            expect(attached).not.toContain(name);
        }
    });

    it('gives every seed recipe at least one ingredient line and at least one step', () => {
        for (const recipe of SEED_RECIPES) {
            const lines = SEED_RECIPE_INGREDIENT_LINES.filter((line) => line.recipeId === recipe.id);
            const steps = SEED_RECIPE_STEPS.filter((step) => step.recipeId === recipe.id);

            expect(lines.length, `${recipe.title} should have ingredient lines`).toBeGreaterThan(0);
            expect(steps.length, `${recipe.title} should have steps`).toBeGreaterThan(0);
        }
    });

    it('honors the recipe_ingredients constraints (real recipe, real catalog row, quantity > 0)', () => {
        const recipeIds = new Set(SEED_RECIPES.map((r) => r.id));
        const catalogIds = new Set(SEED_INGREDIENTS.map((i) => i.id));

        for (const line of SEED_RECIPE_INGREDIENT_LINES) {
            expect(recipeIds).toContain(line.recipeId);
            // The FK is to `ingredients(id)`; a line pointing at an id outside the catalog is a 23503 on
            // seed AND a 400 UNKNOWN_INGREDIENT for anything that later re-submits the recipe.
            expect(catalogIds).toContain(line.ingredient.id);
            expect(line.quantity).toBeGreaterThan(0);
            // `unit` is NOT NULL; '' is the deliberate unitless spelling ("1 lemon"), which is what the
            // read projection turns back into an ABSENT `unit` on the wire.
            expect(typeof line.unit).toBe('string');
            expect(line.unit.trim()).toBe(line.unit);
        }
    });

    /**
     * ⛔ ADR-0021 / migration 0019: the recipe database does not store food-derived nutrition, and
     * `recipe_ingredients.user_calories` (and siblings) are the USER's own overrides. A fixture has no user
     * to speak for, so inventing a value there would be fabricating data the product would then display as
     * a fact. This asserts the shape can't carry one — the mutation lens: if someone added
     * `userCalories: 120` to a line to make a nutrition figure "look better", this test goes red.
     */
    it('fabricates no per-line nutrition on any seeded ingredient line', () => {
        for (const line of SEED_RECIPE_INGREDIENT_LINES) {
            const nutritionish = Object.keys(line).filter((key) => /calor|protein|carb|fat/i.test(key));

            expect(nutritionish).toEqual([]);
        }
    });

    it('numbers each recipe’s steps contiguously from 1, with non-empty instructions', () => {
        for (const recipe of SEED_RECIPES) {
            const steps = SEED_RECIPE_STEPS.filter((step) => step.recipeId === recipe.id);
            // `recipe_steps_step_number_positive` (> 0) and `recipe_steps_recipe_step_unique`
            // (recipe_id, step_number) — contiguity from 1 satisfies both and is what the detail screen's
            // "Mark step 1 complete" control assumes.
            expect(steps.map((step) => step.stepNumber)).toEqual(steps.map((_, index) => index + 1));

            for (const step of steps) {
                expect(step.instruction.trim().length).toBeGreaterThan(0);

                if (step.timerSeconds !== undefined) {
                    // `recipe_steps_timer_seconds_positive`.
                    expect(step.timerSeconds).toBeGreaterThan(0);
                }
            }
        }
    });

    it('every step belongs to a real seed recipe', () => {
        const recipeIds = new Set(SEED_RECIPES.map((r) => r.id));

        for (const step of SEED_RECIPE_STEPS) {
            expect(recipeIds).toContain(step.recipeId);
        }
    });

    /**
     * `recipes.ingredient_names_text` is the weight-C input of the `trg_recipes_search_vector` trigger
     * (0001_initial.sql), so a seeded recipe is only findable BY ITS INGREDIENTS if the seed writes this
     * column — and it must be written in the SAME format the service's own `buildIngredientNamesText`
     * produces (`recipes.service.ts`): the catalog names, in line order, joined by a single space. The
     * exact string is pinned for one recipe so a format drift (commas, lower-casing, ids) fails here
     * rather than as a silently unfindable recipe.
     */
    it('builds ingredient_names_text as the space-joined catalog names, in line order', () => {
        const lamb = SEED_RECIPES[0];

        expect(lamb?.title).toBe('Mediterranean Grilled Lamb');
        expect(seedIngredientNamesText(lamb!.id)).toBe('Lamb loin chops Olive oil Garlic Fresh oregano Lemon');

        for (const recipe of SEED_RECIPES) {
            const expected = SEED_RECIPE_INGREDIENT_LINES.filter((line) => line.recipeId === recipe.id)
                .map((line) => line.ingredient.name)
                .join(' ');

            expect(seedIngredientNamesText(recipe.id)).toBe(expected);
            expect(seedIngredientNamesText(recipe.id)).not.toBe('');
        }
    });

    it('collection has a valid UUID and references only real seed recipes owned by its owner', () => {
        expect(SEED_COLLECTION.id).toMatch(UUID);
        const byId = new Map(SEED_RECIPES.map((r) => [r.id, r]));

        for (const recipeId of SEED_COLLECTION.recipeIds) {
            const recipe = byId.get(recipeId);
            // Existence IS the check the test name promises ("references only real seed recipes"): a
            // dangling membership id would make this a lookup miss. Asserted explicitly (rather than
            // relying on the `ownerId` mismatch below) so a dangling reference fails with a clear
            // "recipe should exist" message instead of an opaque `undefined !== ownerId` diff.
            expect(recipe).toBeDefined();
            expect(recipe?.ownerId).toBe(SEED_COLLECTION.ownerId);
        }
    });
});
