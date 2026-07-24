/**
 * Component tests for CollectionListContainer (T071 web collection-list wiring). Covers every state the
 * container projects onto the shared CollectionList building block — loading, populated, empty, error (with
 * retry) — plus navigation on select/create.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL `useCollections` hook
 * over a real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * a type-checked `vi.spyOn(client, 'listCollections')`. The Next router stays mocked — routing is not part of
 * the recipe-service hooks seam this migration targets.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
});
