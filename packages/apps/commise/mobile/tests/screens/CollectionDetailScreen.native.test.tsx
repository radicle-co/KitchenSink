/**
 * Component tests for the mobile CollectionDetailScreen (react-native-web under jsdom, W5 Task 12). The screen
 * reads a collection with members (a suspense read under a `QueryBoundary`) and composes the shared native collection
 * blocks: `CollectionHeader` (name + rename/delete/back), `CollectionActions` (add/pull/clone/visibility),
 * `CloneInfoPanel` (clones only), the member list (`CollectionDetail`), and the `PullUpdatesDialog`. Covers
 * loading, not-found and the retrying load error, member select/remove, add, rename, delete (existing behavior
 * preserved), plus the wired clone, the premium-gated visibility save, the clone-info/pull conditionals, the pull
 * preview→commit→drift state machine, and the per-collection state a new collection id must not inherit. The tier
 * gate is driven by the (mocked) `useUserProfile`.
 *
 * The READ runs through the real query hook over a network-guarded fake client (`createFakeRecipeServiceClient`) —
 * a mocked read cannot suspend, and a retry is only proven by a second request. The mutations stay stubbed: these
 * cases assert the arguments and callbacks the screen wires into them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { renderWithRecipeClient } from '@commise/test-utils';
import {
    NotFoundError,
    PullDriftError,
    type CollectionWithRecipes,
    type PullDiff,
    type RecipeServiceClient,
} from '@kitchensink/recipe-service-client';
import {
    recipeServiceKeys,
    useCloneCollection,
    useDeleteCollection,
    usePreviewPull,
    usePullCollectionFromSource,
    useRemoveRecipeFromCollection,
    useUpdateCollection,
} from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { CollectionDetailScreen } from '../../src/screens/CollectionDetailScreen.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { makeCollection, makeCollectionWithRecipes, makeRecipe } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@kitchensink/recipe-service-client/hooks')>()),
    useDeleteCollection: vi.fn(),
    useRemoveRecipeFromCollection: vi.fn(),
    useUpdateCollection: vi.fn(),
    useCloneCollection: vi.fn(),
    usePreviewPull: vi.fn(),
    usePullCollectionFromSource: vi.fn(),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: vi.fn(),
}));

// The screens under test now START the deferred calorie batch (ADR-0021 §6) through this shared hook, which
// reaches the real recipe-service client and query cache. This file is not about nutrition, so the lookup is
// stubbed to "no batch covers this recipe" — the branch that renders no nutrition line at all, leaving every
// assertion below unchanged. The wiring itself is covered by `tests/screens/screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
}));

const useDeleteCollectionMock = vi.mocked(useDeleteCollection);
const useRemoveRecipeFromCollectionMock = vi.mocked(useRemoveRecipeFromCollection);
const useUpdateCollectionMock = vi.mocked(useUpdateCollection);
const useCloneCollectionMock = vi.mocked(useCloneCollection);
const usePreviewPullMock = vi.mocked(usePreviewPull);
const usePullCollectionFromSourceMock = vi.mocked(usePullCollectionFromSource);
const useUserProfileMock = vi.mocked(useUserProfile);

/** The collection the fake client serves in the current test. */
let seeded: CollectionWithRecipes;
/** The fake client the current test renders against. */
let client: RecipeServiceClient;

/** Serve `collection` from the fake client for the rest of this test. */
function seed(collection: CollectionWithRecipes): void {
    seeded = collection;
    vi.spyOn(client, 'getCollectionById').mockImplementation(async () => seeded);
}

/** Render `ui` over the fake client. */
function renderOver(ui: ReactElement, queryClient?: QueryClient) {
    return renderWithRecipeClient(ui, client, queryClient === undefined ? undefined : { queryClient });
}

/** Render `ui` and wait for the seeded collection to settle (the header's Rename action is on screen). */
async function renderReady(ui: ReactElement): Promise<void> {
    renderOver(ui);
    await screen.findByRole('button', { name: 'Rename' });
}

function mutation<T>(overrides: Partial<T> = {}): T {
    return {
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isPending: false,
        error: null,
        reset: vi.fn(),
        ...overrides,
    } as unknown as T;
}

/** A `useUserProfile` double exposing only the viewer id + tier the premium gate reads. */
function profile(tier: 'free' | 'premium' = 'premium'): ReturnType<typeof useUserProfile> {
    return {
        data: { user: { id: 'usr_1' }, account: { subscriptionTier: tier } },
        isLoading: false,
    } as unknown as ReturnType<typeof useUserProfile>;
}

/** A pull diff with one addable recipe. */
const ADDABLE_DIFF: PullDiff = { added: ['rec_new'], removed: [], unchanged: ['rec_2'] };

const props = {
    collectionId: 'col_1',
    onSelectRecipe: vi.fn(),
    onAddRecipe: vi.fn(),
    onRename: vi.fn(),
    onDeleted: vi.fn(),
    onCloned: vi.fn(),
    onViewSource: vi.fn(),
    onBack: vi.fn(),
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.clearAllMocks();
    client = createFakeRecipeServiceClient();
    seed(makeCollectionWithRecipes([], { id: 'col_1', name: 'Weeknight favourites' }));
    useUserProfileMock.mockReturnValue(profile('premium'));
    useDeleteCollectionMock.mockReturnValue(mutation<ReturnType<typeof useDeleteCollection>>());
    useRemoveRecipeFromCollectionMock.mockReturnValue(mutation<ReturnType<typeof useRemoveRecipeFromCollection>>());
    useUpdateCollectionMock.mockReturnValue(mutation<ReturnType<typeof useUpdateCollection>>());
    useCloneCollectionMock.mockReturnValue(mutation<ReturnType<typeof useCloneCollection>>());
    usePreviewPullMock.mockReturnValue(mutation<ReturnType<typeof usePreviewPull>>());
    usePullCollectionFromSourceMock.mockReturnValue(mutation<ReturnType<typeof usePullCollectionFromSource>>());
});

describe('CollectionDetailScreen — loading and error', () => {
    function pendingRead(): void {
        vi.spyOn(client, 'getCollectionById').mockReturnValue(new Promise(() => {}));
    }

    it('shows the loading indicator while the collection loads', () => {
        pendingRead();

        renderOver(<CollectionDetailScreen {...props} />);

        expect(screen.getByLabelText('Loading collection…')).toBeTruthy();
    });

    it('announces WHAT is loading and captions it visibly (no bare spinner)', () => {
        pendingRead();

        renderOver(<CollectionDetailScreen {...props} />);

        const label = mobileMessages.en.collections.detailLoading;
        expect(screen.getByRole('progressbar', { name: label })).toBeTruthy();
        expect(screen.getByText(label)).toBeTruthy();
    });

    it('shows an alert with a retry and a way back when the collection fails to load', async () => {
        const onBack = vi.fn();
        vi.spyOn(client, 'getCollectionById').mockRejectedValue(new Error('network down'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} onBack={onBack} />);

        expect((await screen.findByRole('alert')).textContent).toBe(mobileMessages.en.collections.detailError);
        expect(screen.getByRole('button', { name: mobileMessages.en.collections.detailRetry })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: mobileMessages.en.collections.back }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('⛔ Try again REFETCHES and the collection renders', async () => {
        const collection = makeCollectionWithRecipes([], { id: 'col_1', name: 'Weeknight favourites' });
        const read = vi
            .spyOn(client, 'getCollectionById')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce(collection);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} />);
        fireEvent.click(await screen.findByRole('button', { name: mobileMessages.en.collections.detailRetry }));

        expect(await screen.findByRole('button', { name: 'Rename' })).toBeTruthy();
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('says the collection is not there — with no retry, and a way back — for a 404', async () => {
        vi.spyOn(client, 'getCollectionById').mockRejectedValue(new NotFoundError());
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderOver(<CollectionDetailScreen {...props} />);

        expect((await screen.findByRole('alert')).textContent).toBe(mobileMessages.en.collections.detailNotFound);
        expect(screen.queryByRole('button', { name: mobileMessages.en.collections.detailRetry })).toBeNull();
        expect(screen.getByRole('button', { name: mobileMessages.en.collections.back })).toBeTruthy();
    });

    it('⛔ keeps a loaded collection when a background refetch fails, says so, and a Try again that works clears it', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        renderOver(<CollectionDetailScreen {...props} />, queryClient);
        await screen.findByRole('button', { name: 'Rename' });
        // One failed refetch; the seeded collection answers every read after it.
        const getCollection = vi.mocked(client.getCollectionById).mockRejectedValueOnce(new Error('network down'));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.collection('col_1') });
        });
        expect(queryClient.getQueryState(recipeServiceKeys.collection('col_1'))?.status).toBe('error');
        // TanStack batches observer notifications onto a timer; let that batch reach React before asserting absence.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getAllByText('We couldn’t refresh this collection.').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(screen.queryAllByText('We couldn’t refresh this collection.')).toHaveLength(0));
        expect(getCollection).toHaveBeenCalledTimes(3);
    });
});

describe('CollectionDetailScreen — a new collection id', () => {
    it('does not carry the previous collection’s pull dialog or unsaved visibility onto the next', async () => {
        vi.spyOn(client, 'getCollectionById').mockImplementation(async (collectionId) =>
            makeCollectionWithRecipes([], {
                id: collectionId,
                name: collectionId === 'col_a' ? 'Collection A' : 'Collection B',
                sourceCollectionId: 'col_src',
                visibility: 'public',
            }),
        );
        usePreviewPullMock.mockReturnValue(
            mutation<ReturnType<typeof usePreviewPull>>({ mutateAsync: vi.fn(() => new Promise(() => {})) as never }),
        );

        const { rerender } = renderOver(<CollectionDetailScreen {...props} collectionId="col_a" />);
        await screen.findByText('Collection A');
        fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
        expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-checked')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Pull Updates from Source' }));
        expect(screen.getByText('Pull Updates from Source Collection')).toBeTruthy();

        rerender(<CollectionDetailScreen {...props} collectionId="col_b" />);

        expect(await screen.findByText('Collection B')).toBeTruthy();
        expect(screen.queryByText('Pull Updates from Source Collection')).toBeNull();
        expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-checked')).toBe('false');
    });
});

describe('CollectionDetailScreen — populated', () => {
    beforeEach(() => {
        seed(
            makeCollectionWithRecipes([makeRecipe({ id: 'rec_2', title: 'Fish Tacos' })], {
                id: 'col_1',
                name: 'Weeknight favourites',
            }),
        );
    });

    it('forwards a selected member recipe upward', async () => {
        const onSelectRecipe = vi.fn();

        await renderReady(<CollectionDetailScreen {...props} onSelectRecipe={onSelectRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('removes a member recipe from the collection', async () => {
        const mutate = vi.fn();
        useRemoveRecipeFromCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useRemoveRecipeFromCollection>>({ mutate: mutate as never }),
        );

        await renderReady(<CollectionDetailScreen {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Fish Tacos' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'col_1', recipeId: 'rec_2' });
    });

    it('forwards an add-a-recipe request upward', async () => {
        const onAddRecipe = vi.fn();

        await renderReady(<CollectionDetailScreen {...props} onAddRecipe={onAddRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(onAddRecipe).toHaveBeenCalledTimes(1);
    });

    it('requests a rename with the current name from the header edit action', async () => {
        const onRename = vi.fn();

        await renderReady(<CollectionDetailScreen {...props} onRename={onRename} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

        expect(onRename).toHaveBeenCalledWith('Weeknight favourites');
    });

    it('deletes the collection and navigates away on success', async () => {
        const mutate = vi.fn((_id: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useDeleteCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useDeleteCollection>>({ mutate: mutate as never }),
        );
        const onDeleted = vi.fn();

        await renderReady(<CollectionDetailScreen {...props} onDeleted={onDeleted} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(mutate).toHaveBeenCalledWith('col_1', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(onDeleted).toHaveBeenCalledTimes(1);
    });

    describe('mutation failure (B17: no frozen no-op)', () => {
        it('surfaces the delete-failed copy when the delete mutation errored', async () => {
            useDeleteCollectionMock.mockReturnValue(
                mutation<ReturnType<typeof useDeleteCollection>>({ error: new Error('network down') as never }),
            );

            await renderReady(<CollectionDetailScreen {...props} />);

            expect(screen.getByText('We couldn’t delete this collection. Please try again.')).toBeTruthy();
        });

        it('surfaces the remove-failed copy when the remove mutation errored', async () => {
            useRemoveRecipeFromCollectionMock.mockReturnValue(
                mutation<ReturnType<typeof useRemoveRecipeFromCollection>>({
                    error: new Error('network down') as never,
                }),
            );

            await renderReady(<CollectionDetailScreen {...props} />);

            expect(screen.getByText('We couldn’t remove that recipe. Please try again.')).toBeTruthy();
        });

        it('prefers the delete error over a concurrent remove error', async () => {
            useDeleteCollectionMock.mockReturnValue(
                mutation<ReturnType<typeof useDeleteCollection>>({ error: new Error('delete failed') as never }),
            );
            useRemoveRecipeFromCollectionMock.mockReturnValue(
                mutation<ReturnType<typeof useRemoveRecipeFromCollection>>({
                    error: new Error('remove failed') as never,
                }),
            );

            await renderReady(<CollectionDetailScreen {...props} />);

            expect(screen.getByText('We couldn’t delete this collection. Please try again.')).toBeTruthy();
        });
    });

    it('clones the collection and navigates to the new clone', async () => {
        const mutate = vi.fn((_vars: { id: string }, options?: { onSuccess?: (created: { id: string }) => void }) =>
            options?.onSuccess?.(makeCollection({ id: 'col_clone' })),
        );
        useCloneCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useCloneCollection>>({ mutate: mutate as never }),
        );
        const onCloned = vi.fn();

        await renderReady(<CollectionDetailScreen {...props} onCloned={onCloned} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clone Collection' }));

        expect(mutate).toHaveBeenCalledWith(
            { id: 'col_1' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        expect(onCloned).toHaveBeenCalledWith('col_clone');
    });
});

describe('CollectionDetailScreen — visibility save (premium-gated)', () => {
    beforeEach(() => {
        seed(
            makeCollectionWithRecipes([], {
                id: 'col_1',
                name: 'Weeknight favourites',
                visibility: 'public',
            }),
        );
    });

    it('saves the pending private visibility for a premium viewer', async () => {
        useUserProfileMock.mockReturnValue(profile('premium'));
        const mutate = vi.fn();
        useUpdateCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useUpdateCollection>>({ mutate: mutate as never }),
        );

        await renderReady(<CollectionDetailScreen {...props} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'col_1', request: { visibility: 'private' } });
    });

    it('gates the private option off for a free viewer', async () => {
        useUserProfileMock.mockReturnValue(profile('free'));

        await renderReady(<CollectionDetailScreen {...props} />);

        expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-disabled')).toBe('true');
    });
});

describe('CollectionDetailScreen — clone-info + pull affordances (cloned collections only)', () => {
    it('renders neither the clone-info panel nor the pull action for a non-clone', async () => {
        seed(makeCollectionWithRecipes([], { id: 'col_1' }));

        await renderReady(<CollectionDetailScreen {...props} />);

        expect(screen.queryByText('Clone Info')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Pull Updates from Source' })).toBeNull();
    });

    it('renders the clone-info panel and the pull action for a cloned collection', async () => {
        seed(makeCollectionWithRecipes([], { id: 'col_1', sourceCollectionId: 'col_src' }));

        await renderReady(<CollectionDetailScreen {...props} />);

        expect(screen.getByRole('button', { name: 'Pull Updates from Source' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'View Source' })).toBeTruthy();
    });
});

describe('CollectionDetailScreen — pull preview → commit → drift state machine', () => {
    beforeEach(() => {
        seed(makeCollectionWithRecipes([], { id: 'col_1', sourceCollectionId: 'col_src' }));
    });

    it('previews, opens the dialog with the diff, and commits with the previewed diff on confirm', async () => {
        const previewMutateAsync = vi.fn().mockResolvedValue(ADDABLE_DIFF);
        const commitMutateAsync = vi
            .fn()
            .mockResolvedValue({ collection: makeCollection({ id: 'col_1' }), addedRecipeIds: ['rec_new'] });
        usePreviewPullMock.mockReturnValue(
            mutation<ReturnType<typeof usePreviewPull>>({ mutateAsync: previewMutateAsync as never }),
        );
        usePullCollectionFromSourceMock.mockReturnValue(
            mutation<ReturnType<typeof usePullCollectionFromSource>>({ mutateAsync: commitMutateAsync as never }),
        );

        await renderReady(<CollectionDetailScreen {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Pull Updates from Source' }));

        const confirm = await screen.findByRole('button', { name: 'Pull 1 Recipes' });
        expect(previewMutateAsync).toHaveBeenCalledWith('col_1');

        fireEvent.click(confirm);

        await vi.waitFor(() =>
            expect(commitMutateAsync).toHaveBeenCalledWith({ id: 'col_1', previewedDiff: ADDABLE_DIFF }),
        );
        await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Pull 1 Recipes' })).toBeNull());
    });

    it('re-previews and shows the drift message when the commit rejects with a PullDriftError', async () => {
        const freshDiff: PullDiff = { added: ['rec_fresh'], removed: [], unchanged: [] };
        const previewMutateAsync = vi.fn().mockResolvedValueOnce(ADDABLE_DIFF).mockResolvedValueOnce(freshDiff);
        const commitMutateAsync = vi.fn().mockRejectedValue(new PullDriftError(freshDiff));
        usePreviewPullMock.mockReturnValue(
            mutation<ReturnType<typeof usePreviewPull>>({ mutateAsync: previewMutateAsync as never }),
        );
        usePullCollectionFromSourceMock.mockReturnValue(
            mutation<ReturnType<typeof usePullCollectionFromSource>>({ mutateAsync: commitMutateAsync as never }),
        );

        await renderReady(<CollectionDetailScreen {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Pull Updates from Source' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pull 1 Recipes' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('The source collection changed since you last checked');
        expect(commitMutateAsync).toHaveBeenCalledTimes(1);
        expect(previewMutateAsync).toHaveBeenCalledTimes(2);
        // The dialog stays open (its title is present) and is NOT stuck on the loading affordance.
        expect(screen.getByText('Pull Updates from Source Collection')).toBeTruthy();
        expect(screen.queryByLabelText('Loading pull preview')).toBeNull();
    });
});
