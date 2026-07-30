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
import { NotFoundError, PullDriftError, type PullDiff } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';

import { makeCollection, makeCollectionWithRecipes } from './__fixtures__/collectionFixtures';

const { pushMock, useAuthMock, useUserProfileMock } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    useAuthMock: vi.fn(),
    useUserProfileMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('@clerk/nextjs', () => ({
    useAuth: useAuthMock,
}));

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: useUserProfileMock,
}));

/** Build a profile-query stub carrying only the subscription tier the visibility gate reads. */
function profileWithTier(subscriptionTier: 'free' | 'premium') {
    return { data: { account: { subscriptionTier } } };
}

beforeEach(() => {
    // Signed-in viewer with a premium tier by default (so the premium gate is OPEN unless a test overrides it);
    // the visibility-gate tests set the tier they need. The viewer id is irrelevant to the collection gates.
    useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_1' } });
    useUserProfileMock.mockReturnValue(profileWithTier('premium'));
});

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

/** A cloned collection with its source-provenance fields populated (drives clone-info + pull affordances). */
function makeClonedCollection(overrides: Partial<ReturnType<typeof makeCollectionWithRecipes>> = {}) {
    return makeCollectionWithRecipes({
        id: 'col_9',
        sourceCollectionId: 'col_src',
        sourceCollectionName: 'Origin dinners',
        sourceOwnerHandle: 'sourcechef',
        ...overrides,
    });
}

/** A pull diff with one addable recipe. */
const ADDABLE_DIFF: PullDiff = { added: ['rec_new'], removed: [], unchanged: ['rec_1'] };

describe('CollectionDetailContainer', () => {
    it('renders the loading state while the query is pending', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);

        expect(screen.getByRole('status', { name: 'Loading collection' })).toBeInTheDocument();
    });

    it('announces the loading label as the live region CONTENT, not only its aria-label', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);

        // A `role="status"` node rendered EMPTY is doubly broken: zero-height (nothing for a sighted viewer,
        // and Playwright resolves it as `hidden`) AND silent, because a live region announces its CONTENT, not
        // its label. The localized label must be the visible caption.
        expect(screen.getByRole('status', { name: 'Loading collection' })).toHaveTextContent('Loading collection');
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

    describe('settled but absent (B21 — the state you cannot get out of)', () => {
        // `useCollection` disables itself for an empty id, which is exactly the settled-with-nothing shape:
        // `isLoading` false (a disabled query is pending but not FETCHING), `isError` false, `data` undefined.
        // This container used to route that back into its LOADING affordance — a permanent spinner with no
        // retry — while the mobile `CollectionDetailScreen` routed the same shape into ERROR. Web converges.
        it('reports a failure instead of spinning forever', () => {
            const client = createFakeRecipeServiceClient();
            const getCollectionSpy = vi.spyOn(client, 'getCollectionById');

            renderWithRecipeClient(<CollectionDetailContainer id="" locale="en" />, client);

            expect(getCollectionSpy).not.toHaveBeenCalled();
            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText(/couldn.t load this collection/i)).toBeInTheDocument();
            expect(screen.queryByRole('status', { name: 'Loading collection' })).not.toBeInTheDocument();
        });

        it('offers a way OUT — a retry control, exactly as the generic error state does', () => {
            const client = createFakeRecipeServiceClient();

            renderWithRecipeClient(<CollectionDetailContainer id="" locale="en" />, client);

            expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
        });

        it('does not misreport it as a 404 — there is no evidence the collection is missing', () => {
            const client = createFakeRecipeServiceClient();

            renderWithRecipeClient(<CollectionDetailContainer id="" locale="en" />, client);

            expect(screen.queryByText(/couldn.t find that collection/i)).not.toBeInTheDocument();
        });
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

    describe('clone-info + pull affordances (render only for a cloned collection)', () => {
        it('renders the clone-info panel and the pull action for a cloned collection', async () => {
            const client = clientSeededWith(makeClonedCollection());

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            expect(await screen.findByRole('heading', { name: 'Clone Info' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Pull Updates from Source' })).toBeInTheDocument();
        });

        it('renders neither the clone-info panel nor the pull action for a non-clone', async () => {
            const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await screen.findByRole('button', { name: 'Weeknight Pasta' });
            expect(screen.queryByRole('heading', { name: 'Clone Info' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Pull Updates from Source' })).not.toBeInTheDocument();
        });

        it('navigates to the source collection when View Source is activated', async () => {
            const user = userEvent.setup();
            const client = clientSeededWith(makeClonedCollection());

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await user.click(await screen.findByRole('button', { name: 'View Source' }));

            expect(pushMock).toHaveBeenCalledWith('/en/collections/col_src');
        });
    });

    describe('pull-updates preview → commit → drift state machine', () => {
        it('runs the preview then opens the dialog with the diff; confirm commits with the previewed diff', async () => {
            const user = userEvent.setup();
            const client = clientSeededWith(makeClonedCollection());
            const previewSpy = vi.spyOn(client, 'previewPullFromSource').mockResolvedValue(ADDABLE_DIFF);
            const pullSpy = vi
                .spyOn(client, 'pullCollectionFromSource')
                .mockResolvedValue({ collection: makeCollection({ id: 'col_9' }), addedRecipeIds: ['rec_new'] });

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await user.click(await screen.findByRole('button', { name: 'Pull Updates from Source' }));

            // The dialog opens on the preview, showing the diff-driven confirm control.
            const confirm = await screen.findByRole('button', { name: 'Pull 1 Recipes' });
            expect(previewSpy).toHaveBeenCalledWith('col_9');

            await user.click(confirm);

            await vi.waitFor(() => expect(pullSpy).toHaveBeenCalledWith('col_9', { previewedDiff: ADDABLE_DIFF }));
            // On success the dialog closes.
            await vi.waitFor(() =>
                expect(
                    screen.queryByRole('heading', { name: 'Pull Updates from Source Collection' }),
                ).not.toBeInTheDocument(),
            );
        });

        it('re-previews and shows the drift message when the commit rejects with a PullDriftError', async () => {
            const user = userEvent.setup();
            const client = clientSeededWith(makeClonedCollection());
            const freshDiff: PullDiff = { added: ['rec_fresh'], removed: [], unchanged: [] };
            const previewSpy = vi
                .spyOn(client, 'previewPullFromSource')
                .mockResolvedValueOnce(ADDABLE_DIFF)
                .mockResolvedValueOnce(freshDiff);
            const pullSpy = vi
                .spyOn(client, 'pullCollectionFromSource')
                .mockRejectedValue(new PullDriftError(freshDiff));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await user.click(await screen.findByRole('button', { name: 'Pull Updates from Source' }));
            await user.click(await screen.findByRole('button', { name: 'Pull 1 Recipes' }));

            // The commit drifted → the container re-previews and surfaces the drift alert, keeping the dialog
            // open (never an infinite spinner, never a blind retry).
            const alert = await screen.findByRole('alert');
            expect(alert.textContent).toContain('The source collection changed since you last checked');
            expect(pullSpy).toHaveBeenCalledTimes(1);
            expect(previewSpy).toHaveBeenCalledTimes(2);
            // The dialog is still open (its title is present) and NOT stuck on the loading affordance.
            expect(screen.getByRole('heading', { name: 'Pull Updates from Source Collection' })).toBeInTheDocument();
            expect(screen.queryByRole('status', { name: 'Loading pull preview' })).not.toBeInTheDocument();
        });
    });

    describe('clone collection', () => {
        it('clones the collection and navigates to the new clone', async () => {
            const user = userEvent.setup();
            const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9' }));
            const cloneSpy = vi.spyOn(client, 'cloneCollection').mockResolvedValue(makeCollection({ id: 'col_clone' }));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await user.click(await screen.findByRole('button', { name: 'Clone Collection' }));

            await vi.waitFor(() => expect(cloneSpy).toHaveBeenCalledWith('col_9', undefined));
            await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/collections/col_clone'));
        });
    });

    describe('visibility save (premium-gated)', () => {
        it('saves the pending private visibility for a premium viewer', async () => {
            const user = userEvent.setup();
            useUserProfileMock.mockReturnValue(profileWithTier('premium'));
            const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', visibility: 'public' }));
            const updateSpy = vi
                .spyOn(client, 'updateCollection')
                .mockResolvedValue(makeCollection({ id: 'col_9', visibility: 'private' }));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            await user.click(await screen.findByRole('radio', { name: 'Private' }));
            await user.click(screen.getByRole('button', { name: 'Save changes' }));

            await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledWith('col_9', { visibility: 'private' }));
        });

        it('a free viewer cannot reach a private save — the private option is disabled', async () => {
            useUserProfileMock.mockReturnValue(profileWithTier('free'));
            const client = clientSeededWith(makeCollectionWithRecipes({ id: 'col_9', visibility: 'public' }));

            renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

            const privateOption = await screen.findByRole('radio', { name: 'Private' });
            expect(privateOption).toBeDisabled();
        });
    });
});
