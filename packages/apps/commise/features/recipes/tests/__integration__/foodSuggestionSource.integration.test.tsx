/**
 * REWRITTEN for plan 002 S7.8. Integration: the entry's food search end to end inside the app's client stack, over the
 * ONE progressive answer (`docs/design/rowEditorOpenDecisions.md`, S7 list contract; ADR-0055 points 5, 9 and 10). The
 * REAL `useIngredientEntry` and `useLineCommit` over TanStack Query, configured as the app configures it
 * (`offlineFirst`), with the real `FoodServiceClient` and `RecipeServiceClient`, their stream reader and their zod
 * parsing; only `fetch` is a double, one per origin.
 *
 * What only this tier can show:
 * - a catalog result that names a variant reaches recipe as ONE `by-food-variant` admission, and the line holds it;
 * - a remote food is ONE client command: food adopts it, then recipe admits the root it became, and the line holds it;
 * - a search held offline parks, outlasts every deadline as offline, and resumes once the connection is back;
 * - an answer with no database frame by its deadline fails; one whose source never answers ends incomplete at the
 *   overall deadline, keeping what arrived;
 * - food's `429 SEARCH_RATE_LIMITED` holds the route on the client: the next text sends nothing and fails;
 * - a frame that reports the cook's limit holds it for the session: a remote pick after it asks food nothing.
 */
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import type { FoodServiceClient } from '@kitchensink/food-service-client';
import { resetContractSkewLatchForTests } from '@kitchensink/food-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeFilledRecipeFormValues } from '../../src/__fixtures__/index.js';
import type { DraftAction } from '../../src/form/draftAction.js';
import { applyDraftAction } from '../../src/form/props.js';
import type { RecipeFormValues } from '../../src/form/values.js';
import { remoteFoodsOf, servedFoodsOf } from '../../src/hooks/foodSuggestions.model.js';
import { FOOD_SEARCH_DEADLINE_MS, PROGRESSIVE_SEARCH_DEADLINE_MS } from '../../src/hooks/ingredientSuggestionSource.js';
import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '../../src/hooks/ingredientSearchDebounce.js';
import { useIngredientEntry } from '../../src/hooks/useIngredientEntry.js';
import { useLineCommit } from '../../src/hooks/useLineCommit.js';
import { useSourceLimit } from '../../src/hooks/useSourceLimit.js';
import { HANG, foodProgressive, json, ndjson, openStream, twoOrigins, type RouteAnswer } from './twoOrigins.js';

const TRAILING = { kind: 'newLine' } as const;
const BREAST_ID = '00000000-0000-4000-8000-0000000000e1';
const STEWED_ID = '00000000-0000-4000-8000-0000000000e2';
const CREATED_AT = '2026-10-02T09:00:00.000Z';
const FRIED = { id: 'var_fried', parts: [{ attribute: 'cookingMethod', text: 'fried' }] };

/** The database frame for AE3: one root, carrying the one variant the words name. */
const AE3_DATABASE = {
    type: 'database',
    catalog: {
        outcome: 'answered',
        results: [{ id: 'food_breast', name: 'boneless skinless chicken breasts', score: 0.93, variant: FRIED }],
    },
    authored: { outcome: 'answered', results: [] },
};
const NOTHING_HERE = {
    type: 'database',
    catalog: { outcome: 'answered', results: [] },
    authored: { outcome: 'answered', results: [] },
};
const STEWED_FRAME = {
    type: 'source',
    source: 'usda',
    outcome: 'answered',
    items: [{ name: 'Apples, stewed', reference: 'sealed.s' }],
};
const COMPLETE = { type: 'complete' };
const SEARCH_LIMITED = () =>
    json({ code: 'SEARCH_RATE_LIMITED', message: 'slow down', details: { retryAfterSeconds: 30 } }, 429, {
        'retry-after': '30',
    });

/** The app's client for these reads: `createAppQueryClient` sets `offlineFirst`. */
function providers(recipes: RecipeServiceClient, food: FoodServiceClient) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { networkMode: 'offlineFirst' } } });

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

    return { values, entry, sourceLimit, lineCommit };
}

function renderForm(origins: ReturnType<typeof twoOrigins>) {
    return renderHook(() => useCreateForm(makeFilledRecipeFormValues({ ingredients: [] })), {
        wrapper: providers(origins.recipes, origins.food),
    });
}

/** Advance the fake clock, letting promises and React settle between timers. */
async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

/**
 * Type `text` into the trailing field and let the debounce and the first frames settle. A request crosses several promise
 * hops (the token, the double, the stream reader, TanStack), so the clock is advanced in small steps, each of which
 * flushes them; the whole stays far inside every deadline.
 */
async function typeAndSettle(result: { current: ReturnType<typeof useCreateForm> }, text: string): Promise<void> {
    act(() => result.current.entry.setText(TRAILING, text));
    await advance(INGREDIENT_SEARCH_DEBOUNCE_MS);

    for (let step = 0; step < 5; step += 1) {
        await advance(10);
    }
}

/** Recipe's answer to an admission: the line for `id`, named `name`. */
const admitted = (id: string, name: string, foodId: string, extra: Record<string, unknown> = {}) =>
    json({
        id,
        name,
        foodId,
        foodResolutionStatus: 'RESOLVED',
        isUserEntered: false,
        createdAt: CREATED_AT,
        ...extra,
    });

beforeEach(() => {
    vi.useFakeTimers();
    resetContractSkewLatchForTests();
    onlineManager.setOnline(true);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    onlineManager.setOnline(true);
});

describe('the entry’s food search, over the progressive answer, in the app’s client stack (integration)', () => {
    it('AE3: a result that names one variant is admitted as that variant by recipe, and the line holds it', async () => {
        const origins = twoOrigins({
            food: foodProgressive({ search: () => ndjson(AE3_DATABASE, COMPLETE) }),
            recipe: () => admitted(BREAST_ID, 'boneless skinless chicken breasts', 'food_breast', { variant: FRIED }),
        });
        const { result } = renderForm(origins);

        await typeAndSettle(result, 'fried boneless skinless chicken breasts');
        const [breast] = servedFoodsOf(result.current.entry.view);

        expect(breast?.hit).toMatchObject({ variant: FRIED });

        await act(async () => {
            result.current.entry.selectFood(breast!);
        });
        await advance(0);

        expect(origins.sentTo('recipe').map((each) => [each.method, each.path, each.body])).toEqual([
            ['POST', '/api/v1/ingredients/by-food-variant', { foodVariantId: 'var_fried' }],
        ]);
        expect(result.current.values.ingredients).toEqual([
            expect.objectContaining({ ingredientId: BREAST_ID, foodId: 'food_breast', variant: FRIED }),
        ]);
    });

    // ADR-0055 point 10, plan 002 S7: "a remote pick runs the adopt command and then the line's commit as one client
    // command".
    it('a remote food is adopted by food, then its root is admitted by recipe, and the line holds it', async () => {
        const origins = twoOrigins({
            food: foodProgressive({
                search: () => ndjson(NOTHING_HERE, STEWED_FRAME, COMPLETE),
                adopt: () => json({ id: 'food_stewed' }),
            }),
            recipe: () => admitted(STEWED_ID, 'Apples, stewed', 'food_stewed'),
        });
        const { result } = renderForm(origins);

        await typeAndSettle(result, 'stewed apples');
        const [stewed] = remoteFoodsOf(result.current.entry.view);

        await act(async () => {
            result.current.entry.selectRemoteFood(stewed!);
        });
        await advance(0);
        await advance(0);

        expect(
            origins.requests
                .filter((each) => each.method === 'POST')
                .map((each) => [each.origin, each.path, each.body]),
        ).toEqual([
            ['food', '/api/v1/foods/remote/adopt', { reference: 'sealed.s' }],
            ['recipe', '/api/v1/ingredients/by-food', { foodId: 'food_stewed' }],
        ]);
        expect(result.current.values.ingredients).toEqual([
            expect.objectContaining({ ingredientId: STEWED_ID, foodId: 'food_stewed' }),
        ]);
    });

    it('offline: the search parks, is still offline after every deadline, and resumes once the connection is back', async () => {
        onlineManager.setOnline(false);
        const origins = twoOrigins({ food: foodProgressive({ search: () => ndjson(AE3_DATABASE, COMPLETE) }) });
        const { result } = renderForm(origins);

        await typeAndSettle(result, 'chicken breasts');
        expect(result.current.entry.view).toEqual({ kind: 'offline' });

        await advance(PROGRESSIVE_SEARCH_DEADLINE_MS * 2);
        expect(result.current.entry.view).toEqual({ kind: 'offline' });
        expect(origins.sentTo('food')).toEqual([]);

        act(() => onlineManager.setOnline(true));
        await advance(50);

        expect(result.current.entry.view).toMatchObject({ kind: 'served', progress: 'complete', resumed: true });
    });

    it('with no database frame by its deadline, the answer has failed', async () => {
        const origins = twoOrigins({ food: foodProgressive({ search: () => HANG }) });
        const { result } = renderForm(origins);

        await typeAndSettle(result, 'chicken breasts');
        expect(result.current.entry.view).toEqual({ kind: 'searching', resumed: false });

        await advance(FOOD_SEARCH_DEADLINE_MS);

        expect(result.current.entry.view).toEqual({ kind: 'failed', resumed: false });
    });

    it('a source that never answers: the answer ends incomplete at the overall deadline, keeping what arrived', async () => {
        const stream = openStream();
        const origins = twoOrigins({ food: foodProgressive({ search: () => stream.response }) });
        const { result } = renderForm(origins);

        await typeAndSettle(result, 'chicken breasts');
        stream.write(AE3_DATABASE);
        await advance(10);
        expect(result.current.entry.view).toMatchObject({ kind: 'served', progress: 'running' });

        await advance(PROGRESSIVE_SEARCH_DEADLINE_MS);

        expect(result.current.entry.view).toMatchObject({ kind: 'served', progress: 'incomplete' });
        expect(servedFoodsOf(result.current.entry.view)).toHaveLength(1);
    });

    it('food’s search limit holds the route: the answer fails, and the next text sends nothing', async () => {
        const origins = twoOrigins({ food: foodProgressive({ search: (): RouteAnswer => SEARCH_LIMITED() }) });
        const { result } = renderForm(origins);

        await typeAndSettle(result, 'chicken');
        expect(result.current.entry.view).toEqual({ kind: 'failed', resumed: false });

        await typeAndSettle(result, 'chicken breasts');

        expect(result.current.entry.view).toEqual({ kind: 'failed', resumed: false });
        expect(origins.sentTo('food').map((each) => each.query.get('query'))).toEqual(['chicken']);
    });

    // System change 9 and P8: "Up to {time}, a press on any remote hit … makes no request and repeats it."
    it('a frame that reports the cook’s limit holds it: a remote pick after it asks food nothing', async () => {
        const origins = twoOrigins({
            food: foodProgressive({
                search: () =>
                    ndjson(
                        NOTHING_HERE,
                        STEWED_FRAME,
                        { type: 'source', source: 'cnf', outcome: 'limited', retryAfterSeconds: 600 },
                        COMPLETE,
                    ),
                adopt: () => json({ id: 'food_stewed' }),
            }),
        });
        const { result } = renderForm(origins);

        await typeAndSettle(result, 'stewed apples');
        expect(result.current.sourceLimit.retryAt).toBeDefined();

        const [stewed] = remoteFoodsOf(result.current.entry.view);

        await act(async () => {
            result.current.entry.selectRemoteFood(stewed!);
        });
        await advance(0);

        expect(origins.sentTo('food').filter((each) => each.method === 'POST')).toEqual([]);
        expect(result.current.lineCommit.limitRefusals).toBe(1);
    });
});
