/**
 * Unit tests for {@link RecipesDal.findNutritionInputs} — the deferred-nutrition read.
 *
 * The three properties this read exists for, pinned without a database:
 *
 *  1. **ONE round trip for the whole batch.** The endpoint's entire reason to exist is that a card grid can
 *     ask for N recipes' nutrition without paying N reads, so a per-recipe `findById` loop would defeat it
 *     silently — everything would still be correct, just quadratically slower. Asserted as "exactly one
 *     `select`", which a loop cannot satisfy.
 *  2. **Visibility is a SQL term, not a post-filter.** A recipe the caller may not read must never be
 *     LOADED, let alone answered for. Asserted by identity against `readableBy` — the one place the three
 *     read terms (tombstone + visibility + draft) are AND-ed together — so a re-listed subset of them here
 *     would fail rather than quietly drop the draft boundary.
 *  3. **A recipe with NO ingredient lines still comes back.** It is a real state (`no_resolved_ingredients`),
 *     and an inner join would erase it — turning "this recipe has nothing to account for" into "this recipe
 *     is not yours", which is the authorization signal.
 *
 * The SQL itself is proven against a real Postgres in `__tests__/integration/recipes/`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { and, inArray } from 'drizzle-orm';

import { RecipesDal } from '../dal/recipes.dal.js';
import { readableBy } from '../dal/recipePredicates.js';
import type { RecipeDrizzle } from '../../database/client.js';
import { makeFakeDrizzle, type FakeDrizzle } from '../../__testing__/makeFakeDrizzle.js';
import { recipes } from '../../database/schema/index.js';
import { makeRecipeIngredientRow, makeRecipeRow } from '../../__fixtures__/index.js';

const VIEWER = '01J000000000000000000FREE0';

describe('RecipesDal.findNutritionInputs', () => {
    let control: FakeDrizzle<RecipeDrizzle>;
    let dal: RecipesDal;

    beforeEach(() => {
        control = makeFakeDrizzle<RecipeDrizzle>();
        dal = new RecipesDal(control.db);
    });

    it('⛔ issues exactly ONE select for the whole batch — the property the endpoint exists for', async () => {
        const first = makeRecipeRow({ id: 'r-1', servings: 2 });
        const second = makeRecipeRow({ id: 'r-2', servings: 4 });
        control.enqueue([
            { recipe: first, line: makeRecipeIngredientRow({ recipeId: 'r-1', sortOrder: 0 }) },
            { recipe: second, line: makeRecipeIngredientRow({ recipeId: 'r-2', sortOrder: 0 }) },
        ]);

        await dal.findNutritionInputs(['r-1', 'r-2'], VIEWER);

        expect(control.calls.filter((call) => call.method === 'select')).toHaveLength(1);
        expect(control.calls.filter((call) => call.method === 'leftJoin')).toHaveLength(1);
    });

    it('⛔ filters with the SHARED `readableBy` predicate, not a re-listed copy of its terms', async () => {
        // Identity against the composed condition, so inlining `activeRecipe() + viewableBy() +
        // publishedOrOwnedBy()` here — which flattens the conjunction — fails. That matters because the
        // easiest way to lose the W8-a.3 draft boundary is to re-list only two of the three terms.
        control.enqueue([]);

        await dal.findNutritionInputs(['r-1'], VIEWER);

        const where = control.calls.find((call) => call.method === 'where');

        expect(where?.args[0]).toStrictEqual(and(inArray(recipes.id, ['r-1']), readableBy(VIEWER)));
    });

    it('groups each recipe’s lines under its own id, in author order', async () => {
        const recipe = makeRecipeRow({ id: 'r-1', servings: 3 });
        const second = makeRecipeIngredientRow({ recipeId: 'r-1', ingredientName: 'Salt', sortOrder: 1 });
        const first = makeRecipeIngredientRow({ recipeId: 'r-1', ingredientName: 'Flour', sortOrder: 0 });
        // The query orders by (recipe_id, sort_order); the grouping must preserve the order it receives.
        control.enqueue([
            { recipe, line: first },
            { recipe, line: second },
        ]);

        const inputs = await dal.findNutritionInputs(['r-1'], VIEWER);

        expect(inputs).toHaveLength(1);
        expect(inputs[0]?.recipeId).toBe('r-1');
        expect(inputs[0]?.servings).toBe(3);
        expect(inputs[0]?.lines.map((line) => line.ingredientName)).toStrictEqual(['Flour', 'Salt']);
    });

    it('⛔ returns a recipe with NO lines — `no_resolved_ingredients` is an answer, absence is not', async () => {
        // The LEFT JOIN's null row. An inner join would drop this recipe entirely, and an omitted recipe is
        // this endpoint's "not yours" signal — so the bug would read as an authorization decision.
        control.enqueue([{ recipe: makeRecipeRow({ id: 'r-empty', servings: 1 }), line: null }]);

        const inputs = await dal.findNutritionInputs(['r-empty'], VIEWER);

        expect(inputs).toStrictEqual([{ recipeId: 'r-empty', servings: 1, lines: [] }]);
    });

    it('does not touch the database for an empty id list', async () => {
        expect(await dal.findNutritionInputs([], VIEWER)).toStrictEqual([]);
        expect(control.calls).toStrictEqual([]);
    });
});
