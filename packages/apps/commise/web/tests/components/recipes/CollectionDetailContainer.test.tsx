/**
 * Component tests for CollectionDetailContainer (T072 web collection-detail wiring). Covers every state the
 * container renders — loading, ready (delegates to the shared CollectionDetail), generic error (with retry),
 * and a distinct not-found affordance — plus the wired member/collection mutations (remove member, delete
 * collection → navigate to list) and navigation (rename, select recipe). The real `isNotFoundError` guard
 * classifies the error.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL query/mutation hooks over
 * a real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * type-checked `vi.spyOn(client, '<method>')`. The B17 "mutation failed" banners are now driven end-to-end
 * (click the control → the client rejects → the real mutation's `error` flips) rather than forcing a
 * hand-built mutation-result shape straight into the render — a more faithful reproduction of B17, not a
 * loosened one. The Next router stays mocked — routing is not part of the recipe-service hooks seam this
 * migration targets.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';

import { makeCollectionWithRecipes } from './__fixtures__/collectionFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/** A fake client whose `getCollectionById` resolves to the given collection-with-recipes. */
function clientSeededWith(collection: ReturnType<typeof makeCollectionWithRecipes>): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getCollectionById').mockResolvedValue(collection);

    return client;
}

describe('CollectionDetailContainer', () => {
    it('renders the loading state while the query is pending', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);

        expect(screen.getByRole('status', { name: 'Loading collection' })).toBeInTheDocument();
    });

    it('renders the collection with its member recipes when it loads', async () => {
        const client = clientSeededWith(makeCollectionWithRecipes({ name: 'Weeknight dinners' }));

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);

        expect(await screen.findByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
    });

    it('removes a member recipe through the mutation', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));
        const removeSpy = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Remove Weeknight Pasta' }));

        expect(removeSpy).toHaveBeenCalledWith('col_9', 'rec_1');
    });

    it('deletes the collection and navigates back to the list', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));
        const deleteSpy = vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);

        renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/collections'));
        // A wrong-id delete must fail here (the assertion the T3 migration dropped).
        expect(deleteSpy).toHaveBeenCalledWith('col_9');
    });

    it('navigates to the rename form when rename is activated', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));

        renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Rename' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections/col_9/rename');
    });

    it('navigates to a recipe when a member row is selected', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeCollectionWithRecipes());

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });

    it('renders a generic error with retry when the load fails', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const getCollectionSpy = vi.spyOn(client, 'getCollectionById').mockRejectedValue(new Error('network down'));

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/couldn.t load this collection/i)).toBeInTheDocument();
        expect(getCollectionSpy).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(getCollectionSpy).toHaveBeenCalledTimes(2));
    });

    it('renders a distinct not-found message with no retry for a 404', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockRejectedValue(new NotFoundError());

        renderWithRecipeClient(<CollectionDetailContainer id="missing" locale="en" />, client);

        expect(await screen.findByText(/couldn.t find that collection/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    describe('mutation failure (B17: no frozen no-op)', () => {
        it('surfaces the delete-failed banner when the delete mutation errored', async () => {
            const user = userEvent.setup();
            const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));
            vi.spyOn(client, 'deleteCollection').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await user.click(await screen.findByRole('button', { name: 'Delete' }));

            await vi.waitFor(() =>
                expect(screen.getByRole('alert').textContent).toBe(
                    'We couldn’t delete this collection. Please try again.',
                ),
            );
        });

        it('surfaces the remove-failed banner when the remove mutation errored', async () => {
            const user = userEvent.setup();
            const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));
            vi.spyOn(client, 'removeRecipeFromCollection').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await user.click(await screen.findByRole('button', { name: 'Remove Weeknight Pasta' }));

            await vi.waitFor(() =>
                expect(screen.getByRole('alert').textContent).toBe('We couldn’t remove that recipe. Please try again.'),
            );
        });

        it('prefers the delete error over a concurrent remove error', async () => {
            const user = userEvent.setup();
            const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));
            vi.spyOn(client, 'removeRecipeFromCollection').mockRejectedValue(new Error('remove failed'));
            vi.spyOn(client, 'deleteCollection').mockRejectedValue(new Error('delete failed'));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await user.click(await screen.findByRole('button', { name: 'Remove Weeknight Pasta' }));
            await vi.waitFor(() =>
                expect(screen.getByRole('alert').textContent).toBe('We couldn’t remove that recipe. Please try again.'),
            );

            await user.click(screen.getByRole('button', { name: 'Delete' }));

            await vi.waitFor(() =>
                expect(screen.getByRole('alert').textContent).toBe(
                    'We couldn’t delete this collection. Please try again.',
                ),
            );
        });

        it('shows no banner when neither mutation has errored', async () => {
            const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await screen.findByRole('button', { name: 'Weeknight Pasta' });
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });
});
