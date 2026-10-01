/**
 * The recipe response mappers (plan 002 R9, U4): a line's own columns come from its row, and everything derived
 * by following its binding comes from its composed view. The list item carries no lines at all.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../__fixtures__/index.js';
import type { IngredientLineView } from '../../domain/ingredientLineView.js';
import { toIngredientResponse, toRecipeResponse, toRecipeSummaryResponse } from '../recipeResponse.js';

const NAMED: IngredientLineView = {
    name: 'beef brisket',
    foodId: 'food-1',
    isUserEntered: false,
    resolutionStatus: FoodResolutionStatus.RESOLVED,
};

describe('toIngredientResponse', () => {
    it('states the binding id as the line id, and the view’s derived fields beside the row’s own', () => {
        const row = makeIngredientLineRow({
            foodLookupId: 'lookup-1',
            unit: 'cup',
            displayText: 'trimmed',
            preparation: 'sliced',
            groupLabel: 'Meat',
        });

        expect(toIngredientResponse(row, NAMED)).toStrictEqual({
            ingredientId: 'lookup-1',
            name: 'beef brisket',
            foodId: 'food-1',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
            notes: 'trimmed',
            preparation: 'sliced',
            groupLabel: 'Meat',
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('omits every absent field rather than emitting an empty one', () => {
        const row = makeIngredientLineRow({ foodLookupId: 'lookup-2', unit: '' });

        expect(
            toIngredientResponse(row, {
                isUserEntered: false,
                resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
            }),
        ).toStrictEqual({
            ingredientId: 'lookup-2',
            quantity: { kind: 'exact', value: 1 },
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
        });
    });

    it('carries an unresolved line’s reason code and user-entered flag from the view', () => {
        const row = makeIngredientLineRow({ foodLookupId: 'lookup-3' });

        expect(
            toIngredientResponse(row, {
                name: 'grandma’s spice mix',
                unresolvedReason: 'author_declared',
                isUserEntered: true,
            }),
        ).toMatchObject({ name: 'grandma’s spice mix', unresolvedReason: 'author_declared', isUserEntered: true });
    });
});

describe('toRecipeResponse', () => {
    const recipe = makeRecipeRow({ id: 'recipe-1' });
    const lineA = makeIngredientLineRow({ id: 'line-a', foodLookupId: 'lookup-1', sortOrder: 0 });
    const lineB = makeIngredientLineRow({ id: 'line-b', foodLookupId: 'lookup-1', sortOrder: 1 });

    it('maps each line through ITS OWN view — keyed on the line, so two lines on one binding stay apart', () => {
        const response = toRecipeResponse(
            { recipe, steps: [makeRecipeStepRow()], ingredients: [lineA, lineB] },
            new Map<string, IngredientLineView>([
                ['line-a', NAMED],
                ['line-b', { ...NAMED, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED }],
            ]),
        );

        expect(response.ingredients.map((line) => line.resolutionStatus)).toStrictEqual([
            FoodResolutionStatus.RESOLVED,
            FoodResolutionStatus.FOOD_REMOVED,
        ]);
        expect(response.steps).toStrictEqual([{ stepNumber: 1, instruction: 'Mix the ingredients.' }]);
    });

    it('⛔ refuses to render a line whose view is missing, rather than inventing one', () => {
        expect(() =>
            toRecipeResponse(
                { recipe, steps: [], ingredients: [lineA, lineB] },
                new Map<string, IngredientLineView>([['line-a', NAMED]]),
            ),
        ).toThrow(/line-b/);
    });
});

describe('toRecipeSummaryResponse', () => {
    it('emits the published list item: the recipe and its cover, with no lines and no steps', () => {
        const summary = toRecipeSummaryResponse(
            { recipe: makeRecipeRow({ id: 'recipe-1', description: null }) },
            { coverPhotoUrl: 'https://cdn.example/cover.jpg' },
        );

        expect(summary).toMatchObject({ id: 'recipe-1', coverPhotoUrl: 'https://cdn.example/cover.jpg' });
        expect(summary).not.toHaveProperty('ingredients');
        expect(summary).not.toHaveProperty('steps');
        expect(summary).not.toHaveProperty('description');
    });
});
