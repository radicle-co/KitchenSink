/**
 * Integration: the editor's ONE background nutrition read, end to end inside the package (plan 002 V1 B5).
 *
 * Composes the REAL modules — `useLineNutrition` → the client hook → the query factory → `RecipeServiceClient`
 * (request building and zod response parsing) → the lookup → the ingredients leaf and its panel — and mocks only the
 * network, as a `fetch` double. What the unit tiers cannot see and this does: the refs the draft names are the refs
 * on the wire, the server's answer is parsed by the published schema, and the same answer reaches both the row's
 * panel and the running total; a failed read recovers through the panel's Try again.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type FC, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeIngredientRowEditor } from '../../src/__fixtures__/index.js';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';

import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { RecipeIngredientsFields } from '../../src/form/RecipeIngredientsFields.js';
import { recipeFormMessages } from '../../src/form/messages.js';
import { toRecipeFormValues } from '../../src/form/wire.js';
import { useLineNutrition } from '../../src/hooks/useLineNutrition.js';
import type { RecipeFormValues } from '../../src/form/values.js';

const ROW_EDITOR = makeIngredientRowEditor();
afterEach(cleanup);

const en = recipeFormMessages.en;

/** A recipe with one matched line of 300 g of a food named `food_rice`, seeded through the real seed adapter. */
const values: RecipeFormValues = {
    ...toRecipeFormValues(
        makeRecipeDetail({
            servings: 1,
            ingredients: [
                {
                    ingredientId: 'ing_rice',
                    foodId: 'food_rice',
                    name: 'Arborio rice',
                    quantity: { kind: 'exact', value: 300 },
                    unit: 'g',
                    isUserEntered: false,
                    resolutionStatus: 'RESOLVED',
                },
            ],
        }),
    ),
};

const FOUND = {
    entries: [
        {
            outcome: 'found',
            ref: { kind: 'root', id: 'food_rice' },
            freshness: 'fresh',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            portions: [],
        },
    ],
};

/** The editor as a host composes it: the hook feeds the leaf. */
const Editor: FC = () => {
    const nutrition = useLineNutrition(values);

    return (
        <RecipeIngredientsFields
            values={values}
            onChange={() => undefined}

            nutrition={nutrition}
            lookupRetry={{ retry: () => undefined, retrying: new Set(), settled: undefined }}
            rowEditor={ROW_EDITOR}
        />
    );
};

/** The network, as the client calls it. */
type FetchDouble = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const renderEditor = (fetchDouble: FetchDouble) => {
    const client = new RecipeServiceClient({
        baseUrl: 'https://recipes.test',
        token: 'tok',
        fetch: (input, init) => fetchDouble(input, init),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <Editor />
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );
};

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the editor’s nutrition read (integration)', () => {
    it('asks for the draft’s food on the wire, and its answer reaches the total AND the row’s panel', async () => {
        const sent: { url: string; body: unknown }[] = [];
        const fetchDouble = vi.fn<FetchDouble>(async (input) => {
            if (input instanceof Request) {
                sent.push({ url: input.url, body: await input.clone().json() });
            }

            return json(FOUND);
        });
        renderEditor(fetchDouble);

        await waitFor(() =>
            // Build spec §7.5.6: the one total line.
            expect(screen.getByText((text) => text.endsWith('counted')).textContent).toContain('390 cal per serving'),
        );
        expect(sent).toEqual([
            {
                url: 'https://recipes.test/api/v1/ingredients/food-nutrition',
                body: { refs: [{ kind: 'root', id: 'food_rice' }] },
            },
        ]);

        // A matched row is quiet (build spec §7.5.1): its panel opens from ⋯ Food details.
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Actions for Arborio rice' }));
        await user.click(screen.getByRole('menuitem', { name: en.rowFoodDetails }));
        const panel = await screen.findByRole('dialog', { name: 'Arborio rice' });
        expect(panel.textContent).toContain(en.nutritionBasis);
        expect(within(panel).getByText(en.nutritionProteinLabel).nextElementSibling?.textContent).toBe('2.7 g');
    });

    it('a failed read says so, and the panel’s Try again reads again and recovers', async () => {
        const user = userEvent.setup();
        const fetchDouble = vi
            .fn<FetchDouble>()
            // The read retries a server error once on its own (`shouldRetryNutritionBatch`), so two failures make
            // the read FAIL; the third call, from Try again, answers.
            .mockImplementationOnce(async () => json({ code: 'INTERNAL', message: 'boom' }, 500))
            .mockImplementationOnce(async () => json({ code: 'INTERNAL', message: 'boom' }, 500))
            .mockImplementation(async () => json(FOUND));
        renderEditor(fetchDouble);

        await screen.findByText(en.nutritionLoadFailed, {}, { timeout: 10_000 });
        await user.click(screen.getByRole('button', { name: 'Actions for Arborio rice' }));
        await user.click(screen.getByRole('menuitem', { name: en.rowFoodDetails }));
        const panel = await screen.findByRole('dialog', { name: 'Arborio rice' });
        await user.click(within(panel).getByRole('button', { name: en.statusActionRetry }));

        await waitFor(() => expect(within(panel).getByText(en.nutritionBasis)).toBeTruthy());
        expect(fetchDouble).toHaveBeenCalledTimes(3);
    }, 20_000);

    it('a root’s hasVariants survives the client’s published-schema parse into the lookup (blueprint decision 4)', async () => {
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.test',
            token: 'tok',
            fetch: async () => json({ entries: [{ ...FOUND.entries[0], freshness: 'stale', hasVariants: true }] }),
        });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
            <QueryClientProvider client={queryClient}>
                <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
            </QueryClientProvider>
        );
        const { result } = renderHook(() => useLineNutrition(values), { wrapper });

        await waitFor(() => expect(result.current.read).toBe('ready'));
        expect(result.current.lookup({ kind: 'root', id: 'food_rice' })).toMatchObject({
            state: 'found',
            hasVariants: true,
        });
    });
});
