/**
 * ADR-0079 on mobile: the calorie lookup never holds back a new sort of My recipes.
 *
 * `RecipeListScreen.native.test.tsx` stubs the calorie lookup out, because it is not about calories. This file keeps
 * the REAL `useRecipeNutritionBatches` and answers every lookup with a promise that never settles — the worst a real
 * lookup can do before its 12 s deadline. A new sort is a new library key read under `useDeferredValue`; under ADR-0021
 * the cards' calorie slots suspended on the batch and held that deferred render back. The skeletons are on screen
 * before the sort is chosen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

import { renderWithRecipeClient } from '@commise/test-utils';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { RecipeListScreen } from '../../src/screens/RecipeListScreen.js';
import { makeRecipe, makeRecipePage } from '../__fixtures__/recipes.js';

// The grid/list choice is an account setting (ADR-0059) with its own tests; this file is about calories.
vi.mock('../../src/hooks/useRecipeViewSetting.js', () => ({
    useRecipeViewSetting: () => ({ viewChoice: undefined, chooseView: () => undefined, saveFailed: false }),
}));

// Real UUIDs: the batch request is validated against the published contract before it leaves the client.
const PASTA = makeRecipe({ id: '00000000-0000-4000-8000-00000000000a', title: 'Weeknight Pasta' });
const ROAST = makeRecipe({ id: '00000000-0000-4000-8000-00000000000b', title: 'Sunday Roast' });

let client: ReturnType<typeof createFakeRecipeServiceClient>;
let queryClient: QueryClient;

beforeEach(() => {
    client = createFakeRecipeServiceClient();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** The two cards' titles, in the order they are drawn. */
function titlesInOrder(): string[] {
    return screen
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label') ?? link.textContent ?? '')
        .filter((name) => name === PASTA.title || name === ROAST.title);
}

describe('RecipeListScreen — calories never hold back a new sort (ADR-0079)', () => {
    it('re-orders the cards for a new sort while the calorie lookup is still in flight', async () => {
        vi.spyOn(client, 'getRecipeNutrition').mockReturnValue(new Promise<RecipeNutritionResponse>(() => undefined));
        vi.spyOn(client, 'listRecipes').mockImplementation(async (params) =>
            params?.sortBy === 'title' ? makeRecipePage([ROAST, PASTA]) : makeRecipePage([PASTA, ROAST]),
        );

        renderWithRecipeClient(
            <RecipeListScreen onSelectRecipe={() => undefined} onCreateRecipe={() => undefined} />,
            client,
            { queryClient },
        );

        expect((await screen.findAllByLabelText('Loading calories')).length).toBeGreaterThan(0);
        expect(titlesInOrder()).toEqual([PASTA.title, ROAST.title]);

        fireEvent.click(screen.getByRole('button', { name: 'Sort: Recently edited' }));
        fireEvent.click(await screen.findByRole('radio', { name: 'A–Z' }));

        // The default wait: the new order needs the list read only, never the calories.
        await waitFor(() => expect(titlesInOrder()).toEqual([ROAST.title, PASTA.title]));
    });
});
