/**
 * Component tests for CollectionFormContainer (T073 web collection create/rename wiring). Covers both modes
 * over the shared CollectionForm building block: create (via useCreateCollection) and rename (seeded from
 * a suspense read of the collection under a read boundary, via useUpdateCollection), each submitting and navigating
 * on success, the empty-name guard, and a surfaced mutation error — plus the rename seed's own failure: an alert with
 * a retry that refetches, a distinct not-found, and never an empty form standing in for a name that did not load.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL query/mutation hooks over
 * a real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * type-checked `vi.spyOn(client, '<method>')`. The Next router stays mocked — routing is not part of the
 * recipe-service hooks seam this migration targets.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFoundError, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { renderToString } from 'react-dom/server';
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
            const client = createFakeRecipeServiceClient();
            const readSpy = vi.spyOn(client, 'getCollectionById');

            renderWithRecipeClient(<CollectionFormContainer mode="create" locale="en" />, client);

            expect(readSpy).not.toHaveBeenCalled();
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

    describe('rename seed failure', () => {
        it('⛔ shows the load error — never an empty rename form — when the seed fails', async () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getCollectionById').mockRejectedValue(new Error('network down'));
            vi.spyOn(console, 'error').mockImplementation(() => undefined);

            renderWithRecipeClient(<CollectionFormContainer mode="rename" collectionId="col_1" locale="en" />, client);

            expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load this collection/i);
            expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
            // A blank form here would let the cook "rename" a collection whose current name they never saw.
            expect(screen.queryByRole('form')).not.toBeInTheDocument();
        });

        it('Try again REFETCHES and then seeds the name', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            const readSpy = vi
                .spyOn(client, 'getCollectionById')
                .mockRejectedValueOnce(new Error('network down'))
                .mockResolvedValueOnce({ ...makeCollection({ id: 'col_1', name: 'Weeknight dinners' }), recipes: [] });
            vi.spyOn(console, 'error').mockImplementation(() => undefined);

            renderWithRecipeClient(<CollectionFormContainer mode="rename" collectionId="col_1" locale="en" />, client);
            await user.click(await screen.findByRole('button', { name: 'Try again' }));

            expect(await screen.findByDisplayValue('Weeknight dinners')).toBeInTheDocument();
            expect(readSpy).toHaveBeenCalledTimes(2);
        });

        it('says the collection is not there, with no retry, for a 404', async () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getCollectionById').mockRejectedValue(new NotFoundError());
            vi.spyOn(console, 'error').mockImplementation(() => undefined);

            renderWithRecipeClient(<CollectionFormContainer mode="rename" collectionId="col_1" locale="en" />, client);

            expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t find that collection/i);
            expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
        });

        it('⛔ issues NO request during the server render', () => {
            const client = clientSeededWith(makeCollection({ id: 'col_1', name: 'Weeknight dinners' }));

            const html = renderToString(
                <LocaleProvider locale="en">
                    <QueryClientProvider client={new QueryClient()}>
                        <RecipeServiceProvider client={client}>
                            <CollectionFormContainer mode="rename" collectionId="col_1" locale="en" />
                        </RecipeServiceProvider>
                    </QueryClientProvider>
                </LocaleProvider>,
            );

            expect(html).toContain('Loading collection');
            expect(client.getCollectionById).not.toHaveBeenCalled();
        });
    });
});
