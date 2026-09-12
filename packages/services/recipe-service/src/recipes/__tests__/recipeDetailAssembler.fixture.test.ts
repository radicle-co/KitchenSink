/**
 * ⛔ The assembler fixture's DEFAULTS are real doubles — proven by driving a detail read through them.
 *
 * `recipesService.fixture.ts` promises "every default is a REAL double, never a no-op", and 217 call sites
 * rely on it because they name only the collaborators their test is about. Two defaults broke that promise
 * silently: the food double answered `{ byId, unknownIds }` where `FoodNutritionLookup` is
 * `{ byFoodId, degraded }`, and a catalog double lacked a method the read called. The `as unknown
 * as` casts hid both, and the assembler's fail-open reads turned each into a logged warning inside a green
 * suite — so a test built on the defaults exercised the FAILURE path while claiming the ordinary one.
 *
 * The assertion is on the fail-open signal itself: a detail read over the defaults must log nothing.
 */
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import { CallerToken } from '../../auth/CallerToken.js';
import { makeRecipeDetailAssembler } from '../__fixtures__/recipeDetailAssembler.fixture.js';
import type { RecipeAggregate } from '../dal/recipes.dal.js';

const LOOKUP_ID = '00000000-0000-4000-8000-00000000fd01';

/** A one-line recipe whose line is bound to a food, so every loader has work to do. */
function aggregate(): RecipeAggregate {
    const recipe = makeRecipeRow();

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [
            makeIngredientLineRow({ recipeId: recipe.id, foodLookupId: LOOKUP_ID, quantity: '2', unit: 'cup' }),
        ],
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('makeRecipeDetailAssembler defaults', () => {
    it('drive a detail read without tripping a single fail-open path', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const caller = CallerToken.fromAuthorizationHeader('Bearer fixture-caller');

        const detail = await makeRecipeDetailAssembler().toDetailResponse(aggregate(), [], {
            budget: 'read',
            caller,
            viewerId: '01JFIXTUREVIEWER000000000A',
        });

        expect(warn.mock.calls).toEqual([]);
        expect(detail.ingredients).toStrictEqual([expect.objectContaining({ ingredientId: LOOKUP_ID, name: 'Onion' })]);
    });
});
