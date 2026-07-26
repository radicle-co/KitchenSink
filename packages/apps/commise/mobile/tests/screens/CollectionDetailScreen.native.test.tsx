/**
 * Component tests for the mobile CollectionDetailScreen (react-native-web under jsdom, W5 Task 12). The screen
 * loads a collection with members via (mocked) `useCollection` and composes the shared native collection
 * blocks: `CollectionHeader` (name + rename/delete/back), `CollectionActions` (add/pull/clone/visibility),
 * `CloneInfoPanel` (clones only), the member list (`CollectionDetail`), and the `PullUpdatesDialog`. Covers
 * loading/error, member select/remove, add, rename, delete (existing behavior preserved), plus the wired
 * clone, the premium-gated visibility save, the clone-info/pull conditionals, and the pull preview→commit→
 * drift state machine. The tier gate is driven by the (mocked) `useUserProfile`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { PullDriftError, type PullDiff } from '@kitchensink/recipe-service-client';
import {
    useCloneCollection,
    useCollection,
    useDeleteCollection,
    usePreviewPull,
    usePullCollectionFromSource,
    useRemoveRecipeFromCollection,
    useUpdateCollection,
} from '@kitchensink/recipe-service-client/hooks';

import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { CollectionDetailScreen } from '../../src/screens/CollectionDetailScreen.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { makeCollection, makeCollectionWithRecipes, makeRecipe } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCollection: vi.fn(),
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

const useCollectionMock = vi.mocked(useCollection);
const useDeleteCollectionMock = vi.mocked(useDeleteCollection);
const useRemoveRecipeFromCollectionMock = vi.mocked(useRemoveRecipeFromCollection);
const useUpdateCollectionMock = vi.mocked(useUpdateCollection);
const useCloneCollectionMock = vi.mocked(useCloneCollection);
const usePreviewPullMock = vi.mocked(usePreviewPull);
const usePullCollectionFromSourceMock = vi.mocked(usePullCollectionFromSource);
const useUserProfileMock = vi.mocked(useUserProfile);

function collectionResult(overrides: Partial<ReturnType<typeof useCollection>> = {}): ReturnType<typeof useCollection> {
    return { isLoading: false, isError: false, data: undefined, ...overrides } as unknown as ReturnType<
        typeof useCollection
    >;
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

afterEach(cleanup);

beforeEach(() => {
    vi.clearAllMocks();
    useUserProfileMock.mockReturnValue(profile('premium'));
    useDeleteCollectionMock.mockReturnValue(mutation<ReturnType<typeof useDeleteCollection>>());
    useRemoveRecipeFromCollectionMock.mockReturnValue(mutation<ReturnType<typeof useRemoveRecipeFromCollection>>());
    useUpdateCollectionMock.mockReturnValue(mutation<ReturnType<typeof useUpdateCollection>>());
    useCloneCollectionMock.mockReturnValue(mutation<ReturnType<typeof useCloneCollection>>());
    usePreviewPullMock.mockReturnValue(mutation<ReturnType<typeof usePreviewPull>>());
    usePullCollectionFromSourceMock.mockReturnValue(mutation<ReturnType<typeof usePullCollectionFromSource>>());
});

describe('CollectionDetailScreen — loading and error', () => {
    it('shows the loading indicator while the collection loads', () => {
        useCollectionMock.mockReturnValue(collectionResult({ isLoading: true }));

        render(<CollectionDetailScreen {...props} />);

        expect(screen.getByLabelText('Loading collection…')).toBeTruthy();
    });

    it('announces WHAT is loading and captions it visibly (no bare spinner)', () => {
        useCollectionMock.mockReturnValue(collectionResult({ isLoading: true }));

        render(<CollectionDetailScreen {...props} />);

        const label = mobileMessages.en.collections.detailLoading;
        expect(screen.getByRole('progressbar', { name: label })).toBeTruthy();
        expect(screen.getByText(label)).toBeTruthy();
    });

    it('shows an alert when the collection fails to load', () => {
        useCollectionMock.mockReturnValue(collectionResult({ isError: true }));

        render(<CollectionDetailScreen {...props} />);

        expect(screen.getByRole('alert')).toBeTruthy();
    });
});

describe('CollectionDetailScreen — populated', () => {
    beforeEach(() => {
        useCollectionMock.mockReturnValue(
            collectionResult({
                data: makeCollectionWithRecipes([makeRecipe({ id: 'rec_2', title: 'Fish Tacos' })], {
                    id: 'col_1',
                    name: 'Weeknight favourites',
                }),
            }),
        );
    });

    it('forwards a selected member recipe upward', () => {
        const onSelectRecipe = vi.fn();

        render(<CollectionDetailScreen {...props} onSelectRecipe={onSelectRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('removes a member recipe from the collection', () => {
        const mutate = vi.fn();
        useRemoveRecipeFromCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useRemoveRecipeFromCollection>>({ mutate: mutate as never }),
        );

        render(<CollectionDetailScreen {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Fish Tacos' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'col_1', recipeId: 'rec_2' });
    });

    it('forwards an add-a-recipe request upward', () => {
        const onAddRecipe = vi.fn();

        render(<CollectionDetailScreen {...props} onAddRecipe={onAddRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(onAddRecipe).toHaveBeenCalledTimes(1);
    });

    it('requests a rename with the current name from the header edit action', () => {
        const onRename = vi.fn();

        render(<CollectionDetailScreen {...props} onRename={onRename} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

        expect(onRename).toHaveBeenCalledWith('Weeknight favourites');
    });

    it('deletes the collection and navigates away on success', () => {
        const mutate = vi.fn((_id: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useDeleteCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useDeleteCollection>>({ mutate: mutate as never }),
        );
        const onDeleted = vi.fn();

        render(<CollectionDetailScreen {...props} onDeleted={onDeleted} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(mutate).toHaveBeenCalledWith('col_1', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(onDeleted).toHaveBeenCalledTimes(1);
    });

    describe('mutation failure (B17: no frozen no-op)', () => {
        it('surfaces the delete-failed copy when the delete mutation errored', () => {
            useDeleteCollectionMock.mockReturnValue(
                mutation<ReturnType<typeof useDeleteCollection>>({ error: new Error('network down') as never }),
            );

            render(<CollectionDetailScreen {...props} />);

            expect(screen.getByText('We couldn’t delete this collection. Please try again.')).toBeTruthy();
        });

        it('surfaces the remove-failed copy when the remove mutation errored', () => {
            useRemoveRecipeFromCollectionMock.mockReturnValue(
                mutation<ReturnType<typeof useRemoveRecipeFromCollection>>({
                    error: new Error('network down') as never,
                }),
            );

            render(<CollectionDetailScreen {...props} />);

            expect(screen.getByText('We couldn’t remove that recipe. Please try again.')).toBeTruthy();
        });

        it('prefers the delete error over a concurrent remove error', () => {
            useDeleteCollectionMock.mockReturnValue(
                mutation<ReturnType<typeof useDeleteCollection>>({ error: new Error('delete failed') as never }),
            );
            useRemoveRecipeFromCollectionMock.mockReturnValue(
                mutation<ReturnType<typeof useRemoveRecipeFromCollection>>({
                    error: new Error('remove failed') as never,
                }),
            );

            render(<CollectionDetailScreen {...props} />);

            expect(screen.getByText('We couldn’t delete this collection. Please try again.')).toBeTruthy();
        });
    });

    it('clones the collection and navigates to the new clone', () => {
        const mutate = vi.fn((_vars: { id: string }, options?: { onSuccess?: (created: { id: string }) => void }) =>
            options?.onSuccess?.(makeCollection({ id: 'col_clone' })),
        );
        useCloneCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useCloneCollection>>({ mutate: mutate as never }),
        );
        const onCloned = vi.fn();

        render(<CollectionDetailScreen {...props} onCloned={onCloned} />);
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
        useCollectionMock.mockReturnValue(
            collectionResult({
                data: makeCollectionWithRecipes([], {
                    id: 'col_1',
                    name: 'Weeknight favourites',
                    visibility: 'public',
                }),
            }),
        );
    });

    it('saves the pending private visibility for a premium viewer', () => {
        useUserProfileMock.mockReturnValue(profile('premium'));
        const mutate = vi.fn();
        useUpdateCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useUpdateCollection>>({ mutate: mutate as never }),
        );

        render(<CollectionDetailScreen {...props} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'col_1', request: { visibility: 'private' } });
    });

    it('gates the private option off for a free viewer', () => {
        useUserProfileMock.mockReturnValue(profile('free'));

        render(<CollectionDetailScreen {...props} />);

        expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-disabled')).toBe('true');
    });
});

describe('CollectionDetailScreen — clone-info + pull affordances (cloned collections only)', () => {
    it('renders neither the clone-info panel nor the pull action for a non-clone', () => {
        useCollectionMock.mockReturnValue(collectionResult({ data: makeCollectionWithRecipes([], { id: 'col_1' }) }));

        render(<CollectionDetailScreen {...props} />);

        expect(screen.queryByText('Clone Info')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Pull Updates from Source' })).toBeNull();
    });

    it('renders the clone-info panel and the pull action for a cloned collection', () => {
        useCollectionMock.mockReturnValue(
            collectionResult({
                data: makeCollectionWithRecipes([], { id: 'col_1', sourceCollectionId: 'col_src' }),
            }),
        );

        render(<CollectionDetailScreen {...props} />);

        expect(screen.getByRole('button', { name: 'Pull Updates from Source' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'View Source' })).toBeTruthy();
    });
});

describe('CollectionDetailScreen — pull preview → commit → drift state machine', () => {
    beforeEach(() => {
        useCollectionMock.mockReturnValue(
            collectionResult({
                data: makeCollectionWithRecipes([], { id: 'col_1', sourceCollectionId: 'col_src' }),
            }),
        );
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

        render(<CollectionDetailScreen {...props} />);
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

        render(<CollectionDetailScreen {...props} />);
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
