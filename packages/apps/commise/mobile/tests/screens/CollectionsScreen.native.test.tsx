/**
 * Component tests for the mobile CollectionsScreen (react-native-web under jsdom, T071 + W5/C7). The screen puts the
 * shared native collection-list FRAME around a suspense read of the viewer's collections: `Suspense` renders the
 * loading fallback, the error boundary the load error (its retry refetches), and once settled the RESULTS render the
 * flattened pages, the refresh notice and the load-more control.
 *
 * REWRITTEN for the suspense conversion: the read goes through the REAL hooks over a network-guarded fake client
 * (`renderWithRecipeClient`), with settled pages SEEDED into the query cache so they render synchronously — where the
 * old file mocked `useCollectionsInfinite` and fed the screen status flags a suspense read no longer exposes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo } from 'react-native';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { renderWithRecipeClient } from '@commise/test-utils';
import { collectionQueries } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { CollectionsScreen } from '../../src/screens/CollectionsScreen.js';
import { makeCollection, makeCollectionPage } from '../__fixtures__/recipes.js';

// react-native-web does not implement `sendAccessibilityEvent`; the heading hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

/** The fake client and request cache each test renders over. */
let client: ReturnType<typeof createFakeRecipeServiceClient>;
let queryClient: QueryClient;

/** Put SETTLED pages in the cache, so the suspense read renders them with no fetch. */
function seedPages(...collectionPages: ReturnType<typeof makeCollectionPage>[]): void {
    queryClient.setQueryData(collectionQueries(client).listInfinite().queryKey, {
        pages: collectionPages,
        pageParams: collectionPages.map((_, index) => index + 1),
    });
}

function render(ui: ReactElement) {
    return renderWithRecipeClient(ui, client, { queryClient });
}

afterEach(cleanup);

beforeEach(() => {
    vi.clearAllMocks();
    client = createFakeRecipeServiceClient();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // Unseeded, a read stays pending — the loading state.
    vi.spyOn(client, 'listCollections').mockReturnValue(new Promise(() => {}));
});

describe('CollectionsScreen — a failed refresh of the rows on screen', () => {
    it('⛔ keeps the collections and says the refresh failed, never the list error, and Try again refetches', async () => {
        seedPages(makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight dinners' })]));
        const list = vi
            .spyOn(client, 'listCollections')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight dinners' })]));

        render(<CollectionsScreen onSelect={vi.fn()} onCreateRecipe={vi.fn()} />);
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: collectionQueries(client).listInfinite().queryKey });
        });

        // TanStack batches observer notifications onto a later tick, so the notice is awaited, not read synchronously.
        expect((await screen.findAllByText('We couldn’t refresh your collections.')).length).toBeGreaterThan(0);
        expect(screen.getByRole('link', { name: 'Weeknight dinners, Private' })).toBeTruthy();
        expect(screen.queryByText('We couldn’t load your collections.')).toBeNull();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(list).toHaveBeenCalledTimes(2);
    });

    it('⛔ moves the screen-reader cursor to the heading when a retry from the notice succeeds', async () => {
        seedPages(makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight dinners' })]));
        vi.spyOn(client, 'listCollections')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight dinners' })]));

        render(<CollectionsScreen onSelect={vi.fn()} onCreateRecipe={vi.fn()} />);
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: collectionQueries(client).listInfinite().queryKey });
        });
        await screen.findAllByText('We couldn’t refresh your collections.');

        // The notice is inside the read boundary and the heading outside it: the recovery has to cross.
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        await vi.waitFor(() =>
            expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
                screen.getByRole('heading', { name: 'Recipes' }),
                'focus',
            ),
        );
    });
});

describe('CollectionsScreen — loading, error, empty', () => {
    // Slice 3: the heading is the Recipes screen's large title, and "New collection" floats (`buildSpec.md` §5.1).
    it('shows the loading indicator while collections load, under the heading and create action', () => {
        render(<CollectionsScreen onSelect={vi.fn()} onCreateRecipe={vi.fn()} />);

        expect(screen.getByLabelText('Loading collections')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New collection' })).toBeTruthy();
    });

    it('shows an alert and retries from the retry action', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const list = vi
            .spyOn(client, 'listCollections')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight dinners' })]));

        render(<CollectionsScreen onSelect={vi.fn()} onCreateRecipe={vi.fn()} />);

        expect(await screen.findByRole('alert')).toBeTruthy();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(await screen.findByRole('link', { name: 'Weeknight dinners, Private' })).toBeTruthy();
        expect(list).toHaveBeenCalledTimes(2);
    });

    it('shows the empty state when a successful load returns no collections', () => {
        seedPages(makeCollectionPage([]));

        render(<CollectionsScreen onSelect={vi.fn()} onCreateRecipe={vi.fn()} />);

        expect(screen.getByText('Group recipes your way')).toBeTruthy();
    });

    it("hides the floating New collection on the first run: the first run's own button is the one way to create", () => {
        seedPages(makeCollectionPage([]));

        render(<CollectionsScreen onSelect={vi.fn()} onCreateRecipe={vi.fn()} />);

        expect(screen.getAllByRole('button', { name: 'New collection' })).toHaveLength(1);
    });
});

describe('CollectionsScreen — populated', () => {
    beforeEach(() => {
        seedPages(makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight favourites' })]));
    });

    it('forwards the selected collection id upward', () => {
        const onSelect = vi.fn();

        render(<CollectionsScreen onSelect={onSelect} onCreateRecipe={vi.fn()} />);
        fireEvent.click(screen.getByRole('link', { name: 'Weeknight favourites, Private' }));

        expect(onSelect).toHaveBeenCalledWith('col_1');
    });

    // Slice 4 (`buildSpec.md` §5.1): New collection opens the sheet in place of the deleted `collectionCreate` screen,
    // and a created collection opens its detail.
    it('creates a collection from the sheet and opens it', async () => {
        const onSelect = vi.fn();
        vi.spyOn(client, 'createCollection').mockResolvedValue(makeCollection({ id: 'col_new', name: 'Picnics' }));

        render(<CollectionsScreen onSelect={onSelect} onCreateRecipe={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'New collection' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Picnics' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));

        await waitFor(() => expect(onSelect).toHaveBeenCalledWith('col_new'));
    });
});

describe('CollectionsScreen — server-paged load-more (W5/C7)', () => {
    it('appends the next page, flattened, when Load more is activated', async () => {
        seedPages(
            makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight favourites' })], { hasMore: true }),
        );
        const list = vi
            .spyOn(client, 'listCollections')
            .mockResolvedValue(makeCollectionPage([makeCollection({ id: 'col_2', name: 'Holiday baking' })]));

        render(<CollectionsScreen onSelect={vi.fn()} onCreateRecipe={vi.fn()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        });

        expect(await screen.findByRole('link', { name: 'Holiday baking, Private' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Weeknight favourites, Private' })).toBeTruthy();
        expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
});

describe('CollectionsScreen — a failed next page', () => {
    it('⛔ keeps the loaded collections and offers Try again beside the reason, not the list error state', async () => {
        seedPages(makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight Dinners' })], { hasMore: true }));
        const list = vi.spyOn(client, 'listCollections').mockRejectedValue(new Error('network down'));

        render(<CollectionsScreen onSelect={vi.fn()} onCreateRecipe={vi.fn()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        });

        expect(await screen.findByText('We couldn’t load more collections.')).toBeTruthy();
        expect(screen.getByText('Weeknight Dinners')).toBeTruthy();
        expect(screen.queryByText('We couldn’t load your collections.')).toBeNull();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });
        expect(list).toHaveBeenCalledTimes(2);
    });
});
