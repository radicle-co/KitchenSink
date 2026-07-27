/**
 * Component tests for CollectionFormContainer (T073 web collection create/rename wiring). Covers both modes
 * over the shared CollectionForm building block: create (via useCreateCollection) and rename (seeded from
 * useCollection, via useUpdateCollection), each submitting and navigating on success, the empty-name guard,
 * and a surfaced mutation error.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL query/mutation hooks over
 * a real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * type-checked `vi.spyOn(client, '<method>')`. The Next router stays mocked — routing is not part of the
 * recipe-service hooks seam this migration targets.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { CollectionFormContainer } from '@/components/recipes/CollectionFormContainer';

import { makeCollection } from './__fixtures__/collectionFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/** A fake client whose `getCollectionById` resolves to the given collection (rename-mode seed). */
function clientSeededWith(collection: ReturnType<typeof makeCollection>): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getCollectionById').mockResolvedValue({ ...collection, recipes: [] });

    return client;
}

describe('CollectionFormContainer', () => {
    describe('rename seed-loading state', () => {
        it('shows a busy status (and no form yet) while the collection seed loads', () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<CollectionFormContainer mode="rename" locale="en" collectionId="col_1" />, client);

            expect(screen.getByRole('status', { name: 'Loading collection' })).toBeInTheDocument();
            expect(screen.queryByRole('form')).not.toBeInTheDocument();
        });

        it('announces the loading label as the live region CONTENT, not only its aria-label', () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<CollectionFormContainer mode="rename" locale="en" collectionId="col_1" />, client);

            // A `role="status"` node rendered EMPTY is doubly broken: zero-height (nothing for a sighted
            // viewer, and Playwright resolves it as `hidden`) AND silent, because a live region announces its
            // CONTENT, not its label. The localized label must be the visible caption.
            expect(screen.getByRole('status', { name: 'Loading collection' })).toHaveTextContent('Loading collection');
        });

        it('never shows the seed-loading status in create mode (it fetches nothing)', () => {
            renderWithRecipeClient(
                <CollectionFormContainer mode="create" locale="en" />,
                createFakeRecipeServiceClient(),
            );

            expect(screen.queryByRole('status')).not.toBeInTheDocument();
            expect(screen.getByRole('form', { name: 'New collection' })).toBeInTheDocument();
        });
    });

    describe('create mode', () => {
        it('renders the create form', () => {
            renderWithRecipeClient(
                <CollectionFormContainer mode="create" locale="en" />,
                createFakeRecipeServiceClient(),
            );

            expect(screen.getByRole('form', { name: 'New collection' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
        });

        it('creates a collection and navigates to it on success', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            const createCollectionSpy = vi
                .spyOn(client, 'createCollection')
                .mockResolvedValue(makeCollection({ id: 'col_new' }));

            renderWithRecipeClient(<CollectionFormContainer mode="create" locale="en" />, client);

            await user.type(screen.getByRole('textbox', { name: 'Collection name' }), 'Holiday baking');
            await user.click(screen.getByRole('button', { name: 'Create' }));

            expect(createCollectionSpy).toHaveBeenCalledWith({ name: 'Holiday baking' });
            await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/collections/col_new'));
        });

        it('does not submit an empty name and surfaces a validation error', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            const createCollectionSpy = vi.spyOn(client, 'createCollection');

            renderWithRecipeClient(<CollectionFormContainer mode="create" locale="en" />, client);

            await user.click(screen.getByRole('button', { name: 'Create' }));

            expect(createCollectionSpy).not.toHaveBeenCalled();
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });

        it('surfaces a mutation error', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'createCollection').mockRejectedValue(new Error('server down'));

            renderWithRecipeClient(<CollectionFormContainer mode="create" locale="en" />, client);

            await user.type(screen.getByRole('textbox', { name: 'Collection name' }), 'Holiday baking');
            await user.click(screen.getByRole('button', { name: 'Create' }));

            expect(await screen.findByRole('alert')).toBeInTheDocument();
        });
    });

    describe('rename mode', () => {
        it('seeds the current name and renders the rename form', async () => {
            const client = clientSeededWith(makeCollection({ id: 'col_1', name: 'Weeknight dinners' }));

            renderWithRecipeClient(<CollectionFormContainer mode="rename" collectionId="col_1" locale="en" />, client);

            expect(await screen.findByRole('form', { name: 'Rename collection' })).toBeInTheDocument();
            expect(screen.getByDisplayValue('Weeknight dinners')).toBeInTheDocument();
        });

        it('updates the collection and navigates to it on success', async () => {
            const user = userEvent.setup();
            const client = clientSeededWith(makeCollection({ id: 'col_1', name: 'Weeknight dinners' }));
            const updateCollectionSpy = vi
                .spyOn(client, 'updateCollection')
                .mockResolvedValue(makeCollection({ id: 'col_1', name: 'Cozy dinners' }));

            renderWithRecipeClient(<CollectionFormContainer mode="rename" collectionId="col_1" locale="en" />, client);

            const input = await screen.findByRole('textbox', { name: 'Collection name' });
            await user.clear(input);
            await user.type(input, 'Cozy dinners');
            await user.click(screen.getByRole('button', { name: 'Save' }));

            expect(updateCollectionSpy).toHaveBeenCalledWith('col_1', { name: 'Cozy dinners' });
            await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/collections/col_1'));
        });
    });
});
