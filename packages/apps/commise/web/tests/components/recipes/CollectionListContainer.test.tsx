/**
 * Component tests for CollectionListContainer (T071 web collection-list wiring). Covers every state the
 * container projects onto the shared collection-list leaves — `CollectionListFrame` around `CollectionListLoading`,
 * `CollectionListLoadError` (with retry) or `CollectionListResults` (populated and empty) — plus navigation on
 * select/create.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL `useCollectionsInfinite`
 * hook (W5/C7 server-paged "Load more") over a real, network-guarded `RecipeServiceClient`
 * (`createFakeRecipeServiceClient`), stubbed per test with a type-checked `vi.spyOn(client, 'listCollections')`.
 * The Next router stays mocked — routing is not part of the recipe-service hooks seam this migration targets.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { collectionQueries } from '@kitchensink/recipe-service-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeServiceProvider, recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { CollectionListContainer } from '@/components/recipes/CollectionListContainer';

import { makeCollection, makeCollectionsPage } from './__fixtures__/collectionFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('CollectionListContainer', () => {
    it('renders the loading state while the query is pending', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listCollections').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client);

        expect(screen.getByRole('status', { name: 'Loading collections' })).toBeInTheDocument();
    });

    it('renders the populated list when collections load', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(
            makeCollectionsPage([
                makeCollection({ id: 'col_1', name: 'Weeknight dinners' }),
                makeCollection({ id: 'col_2', name: 'Holiday baking' }),
            ]),
        );

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client);

        expect(await screen.findByRole('button', { name: 'Weeknight dinners' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Holiday baking' })).toBeInTheDocument();
    });

    it('renders the empty state when the load succeeds with no collections', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(makeCollectionsPage([]));

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client);

        expect(await screen.findByText('No collections yet')).toBeInTheDocument();
    });

    it('renders the error state and retries on demand', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const listCollectionsSpy = vi.spyOn(client, 'listCollections').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(listCollectionsSpy).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await screen.findByRole('alert');
        expect(listCollectionsSpy).toHaveBeenCalledTimes(2);
    });

    it('navigates to the collection detail route when a collection is selected', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(
            makeCollectionsPage([makeCollection({ id: 'col_42', name: 'Weeknight dinners' })]),
        );

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Weeknight dinners' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections/col_42');
    });

    it('navigates to the create route from the create call to action', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(makeCollectionsPage([]));

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'New collection' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections/new');
    });

    it('advances the page and appends the next page when Load more is activated (W5/C7)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const listSpy = vi
            .spyOn(client, 'listCollections')
            .mockResolvedValueOnce(
                makeCollectionsPage([makeCollection({ id: 'col_1', name: 'Weeknight dinners' })], {
                    hasMore: true,
                    page: 1,
                }),
            )
            .mockResolvedValueOnce(
                makeCollectionsPage([makeCollection({ id: 'col_2', name: 'Holiday baking' })], {
                    hasMore: false,
                    page: 2,
                }),
            );

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client);

        await screen.findByRole('button', { name: 'Weeknight dinners' });
        await user.click(screen.getByRole('button', { name: 'Load more' }));

        expect(await screen.findByRole('button', { name: 'Holiday baking' })).toBeInTheDocument();
        expect(listSpy).toHaveBeenCalledTimes(2);
        expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    });

    /**
     * ⛔ A failed NEXT page is not a failed list. TanStack keeps the loaded pages when `fetchNextPage` rejects — and
     * still reports `isError` — so mapping `isError` to the list's error state threw away every loaded collection.
     */
    it('⛔ keeps the loaded collections when the next page fails, and Try again loads it', async () => {
        const user = userEvent.setup();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listCollections')
            .mockResolvedValueOnce(
                makeCollectionsPage([makeCollection({ id: 'col_1', name: 'Weeknight dinners' })], {
                    hasMore: true,
                    page: 1,
                }),
            )
            .mockRejectedValueOnce(new Error('recipe service unavailable'))
            .mockResolvedValueOnce(
                makeCollectionsPage([makeCollection({ id: 'col_2', name: 'Holiday baking' })], {
                    hasMore: false,
                    page: 2,
                }),
            );

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Load more' }));

        expect(await screen.findByText('We couldn’t load more collections.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Weeknight dinners' })).toBeInTheDocument();
        expect(screen.queryByText('We couldn’t load your collections.')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('button', { name: 'Holiday baking' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Weeknight dinners' })).toBeInTheDocument();
    });
});

describe('CollectionListContainer — a failed refresh of the rows on screen', () => {
    it('⛔ keeps the rows, says the refresh failed, and a Try again that works clears it and moves focus to the heading', async () => {
        const user = userEvent.setup();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const client = createFakeRecipeServiceClient();
        const page = makeCollectionsPage([makeCollection({ id: 'col_1', name: 'Weeknight dinners' })]);
        const listCollections = vi
            .spyOn(client, 'listCollections')
            .mockResolvedValueOnce(page)
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(page);

        renderWithRecipeClient(<CollectionListContainer locale="en" />, client, { queryClient });
        await screen.findByRole('button', { name: 'Weeknight dinners' });

        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.collections });
        });

        expect(await screen.findAllByText('We couldn’t refresh your collections.')).not.toHaveLength(0);
        expect(screen.getByRole('button', { name: 'Weeknight dinners' })).toBeInTheDocument();
        expect(screen.queryByText('We couldn’t load your collections.')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await waitFor(() => expect(screen.queryAllByText('We couldn’t refresh your collections.')).toHaveLength(0));
        expect(listCollections).toHaveBeenCalledTimes(3);
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Collections' })));
    });
});

/**
 * `/collections` is server-prefetched. The heading and create action are the frame, outside the read boundary, so they
 * ship in the HTML either way; the rows ship only when the prefetch succeeded, and a failed one ships the loading state
 * with no read on the server (B19).
 */
describe('CollectionListContainer — across the server render', () => {
    function page(client: ReturnType<typeof createFakeRecipeServiceClient>, queryClient: QueryClient): ReactNode {
        return (
            <LocaleProvider locale="en">
                <QueryClientProvider client={queryClient}>
                    <RecipeServiceProvider client={client}>
                        <CollectionListContainer locale="en" />
                    </RecipeServiceProvider>
                </QueryClientProvider>
            </LocaleProvider>
        );
    }

    /** The request's cache after a SUCCESSFUL prefetch, built exactly as the page builds it. */
    async function prefetched(client: ReturnType<typeof createFakeRecipeServiceClient>): Promise<QueryClient> {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

        await queryClient.prefetchInfiniteQuery(collectionQueries(client).listInfinite());

        return queryClient;
    }

    it('⛔ ships the heading AND the prefetched rows in the server HTML, reading nothing more', async () => {
        const client = createFakeRecipeServiceClient();
        const list = vi
            .spyOn(client, 'listCollections')
            .mockResolvedValue(makeCollectionsPage([makeCollection({ id: 'col_1', name: 'Weeknight Dinners' })]));
        const queryClient = await prefetched(client);

        const html = renderToString(page(client, queryClient));

        expect(html).toContain('Collections');
        expect(html).toContain('Weeknight Dinners');
        expect(list).toHaveBeenCalledTimes(1);
    });

    it('ships the heading and the loading state, reading nothing, when the prefetch failed', () => {
        const client = createFakeRecipeServiceClient();
        const list = vi.spyOn(client, 'listCollections');

        const html = renderToString(page(client, new QueryClient({ defaultOptions: { queries: { retry: false } } })));

        expect(html).toContain('New collection');
        expect(html).toContain('Loading collections');
        expect(list).not.toHaveBeenCalled();
    });

    it('hydrates the prefetched rows with no recoverable error and no refetch', async () => {
        const client = createFakeRecipeServiceClient();
        const list = vi
            .spyOn(client, 'listCollections')
            .mockResolvedValue(makeCollectionsPage([makeCollection({ id: 'col_1', name: 'Weeknight Dinners' })]));
        const container = document.createElement('div');
        container.innerHTML = renderToString(page(client, await prefetched(client)));
        document.body.append(container);
        const hydrating = await prefetched(client);
        const onRecoverableError = vi.fn();

        await act(async () => {
            hydrateRoot(container, page(client, hydrating), { onRecoverableError });
        });

        expect(onRecoverableError).not.toHaveBeenCalled();
        // Two prefetches (one per simulated request), and nothing from the hydrated page.
        expect(list).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Weeknight Dinners');
        container.remove();
    });
});
