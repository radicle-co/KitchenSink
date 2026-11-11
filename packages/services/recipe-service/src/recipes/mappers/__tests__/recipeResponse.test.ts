/**
 * The recipe response mappers (plan 002 R9, U4): a line's own columns come from its row, and everything derived
 * by following its binding comes from its composed view. The list item carries no lines at all.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../__fixtures__/index.js';
import type { IngredientLineView } from '../../domain/ingredientLineView.js';
import { transcriptionAudienceOf } from '../../domain/transcriptionDisclosure.js';
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
            note: '9 inch',
            preparation: 'sliced',
            groupLabel: 'Meat',
        });

        expect(toIngredientResponse(row, NAMED, undefined)).toStrictEqual({
            ingredientId: 'lookup-1',
            name: 'beef brisket',
            foodId: 'food-1',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
            displayText: 'trimmed',
            note: '9 inch',
            preparation: 'sliced',
            groupLabel: 'Meat',
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('omits every absent field rather than emitting an empty one', () => {
        const row = makeIngredientLineRow({ foodLookupId: 'lookup-2', unit: '' });

        expect(
            toIngredientResponse(
                row,
                {
                    isUserEntered: false,
                    resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
                },
                undefined,
            ),
        ).toStrictEqual({
            ingredientId: 'lookup-2',
            quantity: { kind: 'exact', value: 1 },
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
        });
    });

    describe('boundBy (ADR-0072 §5)', () => {
        it.each(['exact', 'curated', 'review', 'default', 'autoBest', 'cook'] as const)(
            'states who bound the line when the row records %s',
            (boundBy) => {
                const row = makeIngredientLineRow({ foodLookupId: 'lookup-4', boundBy });

                expect(toIngredientResponse(row, NAMED, undefined).boundBy).toBe(boundBy);
            },
        );

        it('OMITS the key for a line with no recorded origin, never emitting null', () => {
            const row = makeIngredientLineRow({ foodLookupId: 'lookup-5', boundBy: null });

            expect('boundBy' in toIngredientResponse(row, NAMED, undefined)).toBe(false);
        });

        it('omits a stored value outside the closed set rather than publishing it (the CHECK keeps one out; the wire does not trust it)', () => {
            const row = makeIngredientLineRow({ foodLookupId: 'lookup-6', boundBy: 'migration' });

            expect('boundBy' in toIngredientResponse(row, NAMED, undefined)).toBe(false);
        });

        it('never states the import link: provenance, not part of the recipe a cook reads', () => {
            const row = makeIngredientLineRow({
                importLineId: '66666666-6666-4666-8666-000000000001',
                boundBy: 'cook',
            });

            expect(toIngredientResponse(row, NAMED, undefined)).not.toHaveProperty('importLineId');
        });
    });

    it('carries an unresolved line’s reason code and user-entered flag from the view', () => {
        const row = makeIngredientLineRow({ foodLookupId: 'lookup-3' });

        expect(
            toIngredientResponse(
                row,
                {
                    name: 'grandma’s spice mix',
                    unresolvedReason: 'author_declared',
                    isUserEntered: true,
                },
                undefined,
            ),
        ).toMatchObject({ name: 'grandma’s spice mix', unresolvedReason: 'author_declared', isUserEntered: true });
    });
});

describe('toRecipeResponse', () => {
    const READER = transcriptionAudienceOf({ ownerId: 'owner-1' }, 'someone-else');
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
            READER,
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
                READER,
            ),
        ).toThrow(/line-b/);
    });
});

describe('sourceLine disclosure (owner-only; ADR-0082 §2)', () => {
    const TEXT = '2 cups flour, sifted (my grandmother’s words)';
    const recipe = makeRecipeRow({ id: 'recipe-1', ownerId: 'owner-1' });
    const line = makeIngredientLineRow({ id: 'line-a', foodLookupId: 'lookup-1', sourceLine: TEXT });
    const views = new Map<string, IngredientLineView>([['line-a', NAMED]]);
    const aggregate = { recipe, steps: [], ingredients: [line] };

    it('states the text on the line when the caller passes it', () => {
        expect(toIngredientResponse(line, NAMED, TEXT).sourceLine).toBe(TEXT);
    });

    it('omits the key when the caller passes none, whatever the row holds', () => {
        expect(toIngredientResponse(line, NAMED, undefined)).not.toHaveProperty('sourceLine');
    });

    it('the transcriber receives the verbatim line', () => {
        const response = toRecipeResponse(aggregate, views, transcriptionAudienceOf(recipe, 'owner-1'));

        expect(response.ingredients[0]?.sourceLine).toBe(TEXT);
    });

    it.each([
        ['another cook', 'someone-else'],
        ['no viewer', undefined],
    ] as const)('a reader (%s) never receives the line, key or text', (_label, viewerId) => {
        const response = toRecipeResponse(aggregate, views, transcriptionAudienceOf(recipe, viewerId));

        expect(response.ingredients[0]).not.toHaveProperty('sourceLine');
        expect(JSON.stringify(response)).not.toContain('grandmother');
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
