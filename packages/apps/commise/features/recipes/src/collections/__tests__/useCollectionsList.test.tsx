/**
 * `useCollectionsList` — the collection list FRAME's session, shared by web's `CollectionListContainer` and mobile's
 * `CollectionsScreen`: the search text, whether the cook has a recipe to group (the first run's choice of buttons),
 * whether the list has settled empty, and the new-collection sheet with its create. Written FIRST, from the two
 * copies, which repeated all four.
 *
 * `@kitchensink/recipe-service-client/hooks` runs for real over a fake, network-guarded client stubbed per test.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { collectionQueries } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCollectionsList } from '../useCollectionsList.js';

afterEach(() => {
    vi.restoreAllMocks();
});

const recipesPage = (total: number) => ({ data: [], total, page: 1, pageSize: 1, hasMore: false });

function setup(recipeTotal = 2) {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'listRecipes').mockResolvedValue(recipesPage(recipeTotal));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
        </QueryClientProvider>
    );
    const onCreated = vi.fn();
    const view = renderHook(() => useCollectionsList({ onCreated: (id) => onCreated(id) }), { wrapper });

    return { client, queryClient, onCreated, ...view };
}

describe('useCollectionsList — the first run', () => {
    it('offers New collection while it is not yet known whether the cook has a recipe', () => {
        const { result } = setup(0);

        expect(result.current.hasRecipes).toBe(true);
    });

    it('knows the cook has no recipe to group once the library says zero', async () => {
        const { result } = setup(0);

        await waitFor(() => expect(result.current.hasRecipes).toBe(false));
    });

    it('knows the cook has a recipe once the library says so', async () => {
        const { client, result } = setup(3);

        await waitFor(() => expect(client.listRecipes).toHaveBeenCalled());
        expect(result.current.hasRecipes).toBe(true);
    });

    it('is a first run only once the collection list has settled empty in the cache', async () => {
        const { queryClient, result } = setup();

        expect(result.current.firstRun).toBe(false);

        act(() => {
            queryClient.setQueryData(result.current.read.queryKey, {
                pages: [{ data: [], total: 0, page: 1, pageSize: 20, hasMore: false }],
                pageParams: [1],
            });
        });

        await waitFor(() => expect(result.current.firstRun).toBe(true));
    });

    it('reads the SAME list key the page prefetches', () => {
        const { client, result } = setup();

        expect(result.current.read.queryKey).toEqual(collectionQueries(client).listInfinite().queryKey);
    });
});

describe('useCollectionsList — search and the new-collection sheet', () => {
    it('holds the search text', () => {
        const { result } = setup();

        act(() => result.current.search.onChange('pie'));

        expect(result.current.search.value).toBe('pie');
    });

    it('creates, closes the sheet and hands the new id to the app', async () => {
        const { client, onCreated, result } = setup();
        const create = vi
            .spyOn(client, 'createCollection')
            .mockResolvedValue({ id: 'col_new' } as Awaited<ReturnType<typeof client.createCollection>>);

        act(() => result.current.sheet.onOpen());
        expect(result.current.sheet.open).toBe(true);
        act(() => result.current.sheet.onCreate({ name: 'Suppers' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('col_new'));
        expect(create).toHaveBeenCalledWith({ name: 'Suppers' });
        expect(result.current.sheet.open).toBe(false);
    });

    it('keeps the sheet open and says so when the create is refused, and opening again clears it', async () => {
        const { client, onCreated, result } = setup();
        vi.spyOn(client, 'createCollection').mockRejectedValue(new Error('nope'));

        act(() => result.current.sheet.onOpen());
        act(() => result.current.sheet.onCreate({ name: 'Suppers' }));

        await waitFor(() => expect(result.current.sheet.failed).toBe(true));
        expect(result.current.sheet.open).toBe(true);
        expect(onCreated).not.toHaveBeenCalled();

        act(() => result.current.sheet.onOpen());

        expect(result.current.sheet.failed).toBe(false);
    });
});
