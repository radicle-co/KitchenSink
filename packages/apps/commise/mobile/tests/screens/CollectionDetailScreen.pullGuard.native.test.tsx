/**
 * Regression test for the collection pull-commit invariant (W5 Task 12 hardening, native mirror of
 * `CollectionDetailContainer.pullGuard.test.tsx`): `confirmPull` MUST NOT commit a pull without a previewed
 * diff, because the server only runs its drift guard when `previewedDiff` is present — an undefined diff is
 * applied BLINDLY server-side.
 *
 * Today that invariant also holds implicitly, because `PullUpdatesDialog.native` only renders its confirm
 * control once a diff has loaded (`showDiff && diff !== undefined`). That makes the undefined-diff path
 * UNREACHABLE through `CollectionDetailScreen.native.test.tsx`'s normal `getByRole` clicks — there is no
 * confirm control to press before a diff exists. To regression-proof the screen's OWN guard (not just the
 * dialog's), this file replaces `PullUpdatesDialog` with a minimal fake that renders an always-present
 * confirm control regardless of `diff` — i.e. it removes the dialog's own gating, isolating whether the
 * screen's `confirmPull` still refuses to commit. Scoped to its own file (rather than added to
 * `CollectionDetailScreen.native.test.tsx`) because `vi.mock` of `@commise/features-recipes` is
 * module-file-scoped and would otherwise replace the real dialog for every other test in that suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { PullUpdatesDialogProps } from '@commise/features-recipes';
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
import { makeCollectionWithRecipes } from '../__fixtures__/recipes.js';

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

// Replace ONLY `PullUpdatesDialog` with a fake that renders its confirm control unconditionally (no
// `diff`/`showDiff` gate). Every other export stays the REAL implementation via `importOriginal`.
vi.mock('@commise/features-recipes', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/features-recipes')>();

    return {
        ...actual,
        PullUpdatesDialog: ({ open, onConfirm }: PullUpdatesDialogProps) =>
            open ? (
                <button type="button" onClick={onConfirm}>
                    Force confirm (test seam)
                </button>
            ) : null,
    };
});

// The screens under test now START the deferred calorie batch (ADR-0021 §6) through this shared hook, which
// reaches the real recipe-service client and query cache. This file is not about nutrition, so the lookup is
// stubbed to "no batch covers this recipe" — the branch that renders no nutrition line at all, leaving every
// assertion below unchanged. The wiring itself is covered by `tests/screens/screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
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
    useCollectionMock.mockReturnValue(
        collectionResult({
            data: makeCollectionWithRecipes([], { id: 'col_1', sourceCollectionId: 'col_src' }),
        }),
    );
});

describe('CollectionDetailScreen — confirmPull guards against an undefined previewed diff', () => {
    it('does not commit the pull when confirm fires before a diff has loaded', async () => {
        // Never resolves — `pullDiff` stays undefined for the lifetime of the test, exactly the state the
        // dialog's own gate exists to prevent a confirm press from reaching.
        const previewMutateAsync = vi.fn().mockReturnValue(new Promise(() => {}));
        const commitMutateAsync = vi.fn();
        usePreviewPullMock.mockReturnValue(
            mutation<ReturnType<typeof usePreviewPull>>({ mutateAsync: previewMutateAsync as never }),
        );
        usePullCollectionFromSourceMock.mockReturnValue(
            mutation<ReturnType<typeof usePullCollectionFromSource>>({ mutateAsync: commitMutateAsync as never }),
        );

        render(<CollectionDetailScreen {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Pull Updates from Source' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Force confirm (test seam)' }));

        expect(commitMutateAsync).not.toHaveBeenCalled();
    });
});
