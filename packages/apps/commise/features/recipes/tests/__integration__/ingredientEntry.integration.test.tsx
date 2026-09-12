/**
 * REWRITTEN for plan 002 S7.8. Integration: the row editor's entry, composed with the REAL `RecipeServiceClient` and
 * `FoodServiceClient` (their request building, their stream reader and their zod parsing of every answer) and TanStack
 * Query; only `fetch` is a double, one per origin (owner ruling 2026-09-20: integration tests mock their dependencies).
 *
 * What only this tier can show:
 * - the entry asks food's ONE progressive search for the settled text (`docs/design/rowEditorOpenDecisions.md`, S7 list
 *   contract), and a pick from its list reaches recipe as the admission the route needs;
 * - the cook's own limit arrives as food's real `429 REQUESTER_LIMIT_REACHED` on the adopt, maps through the client to the
 *   refusal `adoptRefusalOf` reads, costs ONE request, and is held for the session: the next remote press sends nothing
 *   and says the limit again (item 10, P8).
 *
 * Rows 6 and 7 are `rowEditor.integration.test.tsx`'s; the authored-food form is `authoredFoodCreate.integration.test.tsx`.
 */
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import type { FoodServiceClient } from '@kitchensink/food-service-client';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues } from '../../src/__fixtures__/index.js';
import type { DraftAction } from '../../src/form/draftAction.js';
import { applyDraftAction } from '../../src/form/props.js';
import type { RecipeFormValues } from '../../src/form/values.js';
import { remoteFoodsOf, servedFoodsOf } from '../../src/hooks/foodSuggestions.model.js';
import { useIngredientEntry } from '../../src/hooks/useIngredientEntry.js';
import { useLineCommit } from '../../src/hooks/useLineCommit.js';
import { useSourceLimit } from '../../src/hooks/useSourceLimit.js';
import { foodProgressive, json, ndjson, twoOrigins } from './twoOrigins.js';

afterEach(cleanup);

const CHICKPEA_ID = '00000000-0000-4000-8000-0000000000c1';
const CREATED_AT = '2026-10-02T09:00:00.000Z';

/** The cook's own limit, exactly as food answers it on the adopt. */
const limitReached = (): Response =>
    json({ code: 'REQUESTER_LIMIT_REACHED', message: 'limit', details: { retryAfterSeconds: 120 } }, 429, {
        'retry-after': '120',
    });

/** Food's answer for chickpeas: canned chickpeas in the catalog, none of the cook's own, and a remote one from USDA. */
const chickpeaAnswer = () =>
    ndjson(
        {
            type: 'database',
            catalog: {
                outcome: 'answered',
                results: [{ id: 'food_chickpea', name: 'Chickpeas, canned', score: 0.92 }],
            },
            authored: { outcome: 'answered', results: [] },
        },
        {
            type: 'source',
            source: 'usda',
            outcome: 'answered',
            items: [{ name: 'Chickpeas, dry', reference: 'sealed.d' }],
        },
        { type: 'complete' },
    );

function providers(recipes: RecipeServiceClient, food: FoodServiceClient) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={recipes}>
                <FoodServiceProvider client={food} subject="user_cook">
                    {children}
                </FoodServiceProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
}

/** The create form's composition: a draft, the session's limit, the commit hook, and the entry on its lines. */
function useCreateForm(seed: RecipeFormValues) {
    const [values, setValues] = useState(seed);
    const sourceLimit = useSourceLimit();
    const lineCommit = useLineCommit<'entry'>(
        {
            kind: 'createForm',
            dispatch: (action: DraftAction) => setValues((current) => applyDraftAction(current, action)),
        },
        sourceLimit,
    );
    const entry = useIngredientEntry({
        lines: values.ingredients,
        commit: (pick, target) => lineCommit.commit(pick, target, 'entry'),
        sourceLimit,
    });

    return { values, entry, lineCommit, sourceLimit };
}

const ADMITTED = {
    id: CHICKPEA_ID,
    name: 'Chickpeas, canned',
    foodId: 'food_chickpea',
    foodResolutionStatus: 'RESOLVED',
    isUserEntered: false,
    createdAt: CREATED_AT,
};

describe('the entry, on the create form (integration)', () => {
    it('asks food’s progressive search for the settled text, and a catalog pick is admitted by recipe and appended', async () => {
        const origins = twoOrigins({ food: foodProgressive({ search: chickpeaAnswer }), recipe: () => json(ADMITTED) });
        const { result } = renderHook(() => useCreateForm(makeFilledRecipeFormValues({ ingredients: [] })), {
            wrapper: providers(origins.recipes, origins.food),
        });

        act(() => result.current.entry.setText({ kind: 'newLine' }, 'chickpeas'));
        await waitFor(() => expect(result.current.entry.view).toMatchObject({ kind: 'served', progress: 'complete' }));

        const [food] = servedFoodsOf(result.current.entry.view);

        await act(async () => {
            result.current.entry.selectFood(food!);
        });
        await waitFor(() => expect(result.current.values.ingredients).toHaveLength(1));

        expect(origins.sentTo('food').map((each) => [each.path, each.query.get('query')])).toEqual([
            ['/api/v1/foods/search/progressive', 'chickpeas'],
        ]);
        expect(origins.sentTo('recipe').map((each) => [each.method, each.path, each.body])).toEqual([
            ['POST', '/api/v1/ingredients/by-food', { foodId: 'food_chickpea' }],
        ]);
        expect(result.current.values.ingredients[0]).toMatchObject({
            ingredientId: CHICKPEA_ID,
            foodId: 'food_chickpea',
        });
        expect(result.current.entry.textOf({ kind: 'newLine' })).toBe('');
    });

    it('⛔ the cook’s limit: one adopt, the real 429 held for the session, and the next remote press sends nothing', async () => {
        const origins = twoOrigins({ food: foodProgressive({ search: chickpeaAnswer, adopt: limitReached }) });
        const { result } = renderHook(() => useCreateForm(makeFilledRecipeFormValues({ ingredients: [] })), {
            wrapper: providers(origins.recipes, origins.food),
        });

        act(() => result.current.entry.setText({ kind: 'newLine' }, 'chickpeas'));
        await waitFor(() => expect(remoteFoodsOf(result.current.entry.view)).toHaveLength(1));
        const [dry] = remoteFoodsOf(result.current.entry.view);

        await act(async () => {
            result.current.entry.selectRemoteFood(dry!);
        });
        await waitFor(() => expect(result.current.sourceLimit.retryAt).toBeDefined());

        const adopts = () => origins.sentTo('food').filter((each) => each.path === '/api/v1/foods/remote/adopt');
        expect(adopts()).toHaveLength(1);
        // Received now plus 120 s, rounded up to the minute: never sooner than the server's window.
        expect(result.current.sourceLimit.retryAt).toBeGreaterThanOrEqual(Date.now() + 119_000);

        await act(async () => {
            result.current.entry.selectRemoteFood(dry!);
        });

        expect(adopts()).toHaveLength(1);
        expect(result.current.lineCommit.limitRefusals).toBe(1);
        expect(result.current.lineCommit.settled?.outcome).toMatchObject({ kind: 'limited' });
        expect(origins.sentTo('recipe')).toEqual([]);
    });
});
