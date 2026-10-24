/**
 * Integration: the create-my-own-food form, composed (plan 002 S5.5). The REAL `useIngredientRowEditor` on the create
 * form, over TanStack Query, the real `FoodServiceClient` and `RecipeServiceClient` with their zod parsing. Only
 * `fetch` is a double, one per origin (owner ruling 2026-09-20: integration tests mock their dependencies).
 *
 * What only this tier can show: the food is made by FOOD (`POST /api/v1/foods/authored`), and the line is a second,
 * separate commit through RECIPE's admission (`POST /api/v1/ingredients/by-food`) of the id food answered; recipe's
 * create-and-admit route is never called. Food's `409 DUPLICATE_AUTHORED_NAME` reaches the form as its duplicate state,
 * and Use that one admits the EXISTING food. The settled commit records which of the two happened, and the trailing
 * text the form was opened on is spent.
 */
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { resetContractSkewLatchForTests } from '@kitchensink/food-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues } from '../../src/__fixtures__/index.js';
import { makeFoodResponse } from '../../src/details/__fixtures__/foodResponse.js';
import type { DraftAction } from '../../src/form/draftAction.js';
import { applyDraftAction } from '../../src/form/props.js';
import { useIngredientRowEditor } from '../../src/hooks/useIngredientRowEditor.js';
import { json, twoOrigins, type Route } from './twoOrigins.js';

const TRAILING = { kind: 'newLine' } as const;
const CREATED_AT = '2026-10-02T09:00:00.000Z';
const GRANDMA_ID = '00000000-0000-4000-8000-0000000000d1';
const PRIOR_ID = '00000000-0000-4000-8000-0000000000d2';

/** Recipe's admission of a food the cook can read: the line's binding, named for the food. */
const admits =
    (ingredientId: string, name: string): Route =>
    (request) =>
        request.method === 'POST' && request.path === '/api/v1/ingredients/by-food'
            ? json({
                  id: ingredientId,
                  name,
                  foodId: (request.body as { readonly foodId: string }).foodId,
                  foodResolutionStatus: 'RESOLVED',
                  isUserEntered: false,
                  createdAt: CREATED_AT,
              })
            : json({ code: 'NOT_FOUND', message: 'no route' }, 404);

function providers(origins: ReturnType<typeof twoOrigins>) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { networkMode: 'offlineFirst' } } });

    return ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={origins.recipes}>
                <FoodServiceProvider client={origins.food} subject="user_cook">
                    {children}
                </FoodServiceProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
}

/** The create form's composition: a draft and the row editor over it. */
function useCreateForm() {
    const [values, setValues] = useState(makeFilledRecipeFormValues({ ingredients: [] }));
    const rowEditor = useIngredientRowEditor({
        surface: {
            kind: 'createForm',
            dispatch: (action: DraftAction) => setValues((current) => applyDraftAction(current, action)),
        },
        lines: values.ingredients,
    });

    return { values, rowEditor };
}

/** Type `name` in the trailing row, open the form from it on that text, fill a valid profile, and submit it. */
function submitGrandmaBlend(result: { current: ReturnType<typeof useCreateForm> }, name: string): void {
    act(() => result.current.rowEditor.entry.setText(TRAILING, name));
    act(() => result.current.rowEditor.authoredFood.open(name, TRAILING));

    for (const [field, value] of [
        ['calories', '100'],
        ['proteinG', '10'],
        ['carbsG', '20'],
        ['fatG', '5'],
    ] as const) {
        act(() => result.current.rowEditor.authoredFood.setField(field, value));
    }

    act(() => result.current.rowEditor.authoredFood.submit());
}

beforeEach(() => {
    resetContractSkewLatchForTests();
});

afterEach(cleanup);

describe('the create-my-own-food form, in the app’s client stack (integration)', () => {
    it('food makes the food, then recipe admits the id food answered; the line holds it, recorded as created', async () => {
        const origins = twoOrigins({
            food: () =>
                json(makeFoodResponse({ id: 'food_grandma', name: 'grandma blend', visibility: 'private' }), 201),
            recipe: admits(GRANDMA_ID, 'grandma blend'),
        });
        const { result } = renderHook(() => useCreateForm(), { wrapper: providers(origins) });

        submitGrandmaBlend(result, 'grandma blend');

        await waitFor(() => expect(result.current.rowEditor.authoredFood.state).toEqual({ kind: 'closed' }));

        expect(origins.sentTo('food').map((each) => [each.method, each.path, each.body])).toEqual([
            [
                'POST',
                '/api/v1/foods/authored',
                { name: 'grandma blend', macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 } },
            ],
        ]);
        expect(origins.sentTo('recipe').map((each) => [each.method, each.path, each.body])).toEqual([
            ['POST', '/api/v1/ingredients/by-food', { foodId: 'food_grandma' }],
        ]);
        expect(result.current.values.ingredients).toEqual([
            expect.objectContaining({ ingredientId: GRANDMA_ID, name: 'grandma blend', foodId: 'food_grandma' }),
        ]);
        expect(result.current.rowEditor.settled?.origin).toEqual({ kind: 'authoredFood', outcome: 'created' });
        // The trailing text the form was opened on is spent, so it does not hold the next Next back (R7).
        expect(result.current.rowEditor.entry.textOf(TRAILING)).toBe('');
        expect(result.current.rowEditor.entry.pendingEntryText).toBe('');
    });

    it('food’s duplicate reaches the form; Use that one admits the EXISTING food, recorded as reused', async () => {
        const origins = twoOrigins({
            food: () =>
                json(
                    {
                        code: 'DUPLICATE_AUTHORED_NAME',
                        message: 'You already have a food with this name.',
                        details: { existingId: 'food_prior' },
                    },
                    409,
                ),
            recipe: admits(PRIOR_ID, 'grandma blend'),
        });
        const { result } = renderHook(() => useCreateForm(), { wrapper: providers(origins) });

        submitGrandmaBlend(result, 'grandma blend');

        await waitFor(() =>
            expect(result.current.rowEditor.authoredFood.state).toMatchObject({
                kind: 'duplicate',
                existingFoodId: 'food_prior',
            }),
        );
        expect(origins.sentTo('recipe')).toEqual([]);

        act(() => result.current.rowEditor.authoredFood.reuseExisting());

        await waitFor(() => expect(result.current.rowEditor.authoredFood.state).toEqual({ kind: 'closed' }));
        expect(origins.sentTo('recipe').map((each) => [each.method, each.path, each.body])).toEqual([
            ['POST', '/api/v1/ingredients/by-food', { foodId: 'food_prior' }],
        ]);
        expect(result.current.values.ingredients).toEqual([
            expect.objectContaining({ ingredientId: PRIOR_ID, foodId: 'food_prior' }),
        ]);
        expect(result.current.rowEditor.settled?.origin).toEqual({ kind: 'authoredFood', outcome: 'reused' });
        expect(result.current.rowEditor.entry.pendingEntryText).toBe('');
    });
});
