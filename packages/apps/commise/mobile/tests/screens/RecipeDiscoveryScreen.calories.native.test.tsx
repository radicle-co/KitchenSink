/**
 * ADR-0079 on mobile: the calorie lookup never holds back a rail's "see all".
 *
 * `RecipeDiscoveryScreen.native.test.tsx` stubs the calorie lookup out, because it is not about calories. This file
 * keeps the REAL `useRecipeNutritionBatches` and answers every lookup with a promise that never settles — the worst a
 * real lookup can do before its 12 s deadline. Under ADR-0021 each rail's calorie slot suspended on that promise, and a
 * committed skeleton's retry lane could run ahead of the pinged "see all" transition. The rail's skeleton is awaited
 * BEFORE the tap, so the slots are in the state that defect needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { renderWithRecipeClient } from '@commise/test-utils';
import { SnackbarHost } from '@commise/ui/snackbar';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { RecipeDiscoveryScreen } from '../../src/screens/RecipeDiscoveryScreen.js';
import { makeRecipeSearchResult, makeSearchResponse } from '../__fixtures__/recipes.js';

// The calorie figure sits on the full card only, which discovery shows from a wide window (owner ruling D8); jsdom has no
// window to measure, so it is read as wide here. `RefreshControl` is inert under jsdom and is passed through.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const RefreshControl = ({ children }: { children?: ReactNode }) => createElement('div', null, children);

    return { ...actual, useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: 1200 }), RefreshControl };
});

// The discovery platform reads the signed-in user (recent searches are kept per user); this suite is about calories.
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'user_a' }) }));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: { getItem: async () => null, setItem: async () => undefined },
}));

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

describe('RecipeDiscoveryScreen — calories never hold back a rail’s "see all" (ADR-0079)', () => {
    it('leaves the rails for the full list while every calorie lookup is still in flight', async () => {
        vi.spyOn(client, 'getRecipeNutrition').mockReturnValue(new Promise<RecipeNutritionResponse>(() => undefined));
        vi.spyOn(client, 'searchRecipes').mockImplementation((params) =>
            Promise.resolve(
                makeSearchResponse([
                    makeRecipeSearchResult({
                        id: `rec_${params?.sortBy ?? 'main'}_${params?.pageSize ?? 'all'}`,
                        title:
                            params?.pageSize === undefined
                                ? `${params?.sortBy} full list dish`
                                : `${params.sortBy} rail dish`,
                    }),
                ]),
            ),
        );

        renderWithRecipeClient(
            <SnackbarHost>
                <RecipeDiscoveryScreen onEditRecipe={() => undefined} onSelectRecipe={() => undefined} />
            </SnackbarHost>,
            client,
            { queryClient },
        );

        // A rail card is on screen with its calorie skeleton up: the lookup is in flight.
        expect(await screen.findByText('most-cloned rail dish')).toBeTruthy();
        expect((await screen.findAllByLabelText('Loading calories')).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'See all Trending' }));

        // The default wait: leaving the rails needs the search only, never the calories.
        expect(await screen.findByText('most-cloned full list dish')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Trending' })).toBeNull();
    });
});
