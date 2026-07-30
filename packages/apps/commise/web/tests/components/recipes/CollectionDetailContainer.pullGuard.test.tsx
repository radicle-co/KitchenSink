/**
 * Regression test for the collection pull-commit invariant (W5 Task 12 hardening): `confirmPull` MUST NOT
 * commit a pull without a previewed diff, because the server only runs its drift guard when `previewedDiff`
 * is present — an undefined diff is applied BLINDLY server-side.
 *
 * Today that invariant also holds implicitly, because `PullUpdatesDialog` only renders its confirm control
 * once a diff has loaded (see `PullUpdatesDialog.tsx`'s `showDiff && diff !== undefined` gate). That makes the
 * undefined-diff path UNREACHABBLE through `CollectionDetailContainer.test.tsx`'s normal `getByRole` clicks —
 * there is no confirm button to click before a diff exists. To regression-proof the container's OWN guard
 * (not just the dialog's), this file replaces `PullUpdatesDialog` with a minimal fake that renders an
 * always-present confirm control regardless of `diff` — i.e. it removes the dialog's own gating, isolating
 * whether the container's `confirmPull` still refuses to commit. This is scoped to its own file (rather than
 * added to `CollectionDetailContainer.test.tsx`) because `vi.mock` of `@commise/features-recipes` is
 * module-file-scoped and would otherwise replace the real dialog for every other test in that suite.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';
import type { PullUpdatesDialogProps } from '@commise/features-recipes';

import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';

import { makeCollectionWithRecipes } from './__fixtures__/collectionFixtures';

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

// Replace ONLY `PullUpdatesDialog` with a fake that renders its confirm control unconditionally (no
// `diff`/`showDiff` gate). Every other export (`CollectionHeader`, `CollectionActions`, `CloneInfoPanel`,
// `CollectionDetail`, `collectionMessages`) stays the REAL implementation via `importOriginal`.
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

/** A cloned collection with its source-provenance fields populated (drives the pull affordance). */
function makeClonedCollection() {
    return makeCollectionWithRecipes({
        id: 'col_9',
        sourceCollectionId: 'col_src',
        sourceCollectionName: 'Origin dinners',
        sourceOwnerHandle: 'sourcechef',
    });
}

function clientSeededWith(collection: ReturnType<typeof makeCollectionWithRecipes>): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getCollectionById').mockResolvedValue(collection);

    return client;
}

beforeEach(() => {
    useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_1' } });
    useUserProfileMock.mockReturnValue({ data: { account: { subscriptionTier: 'premium' } } });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('CollectionDetailContainer — confirmPull guards against an undefined previewed diff', () => {
    it('does not commit the pull when confirm fires before a diff has loaded', async () => {
        const user = userEvent.setup();
        const client = clientSeededWith(makeClonedCollection());
        // Never resolves — `pullDiff` stays undefined for the lifetime of the test, exactly the state the
        // dialog's own gate exists to prevent a confirm click from reaching.
        vi.spyOn(client, 'previewPullFromSource').mockReturnValue(new Promise(() => {}));
        const pullSpy = vi.spyOn(client, 'pullCollectionFromSource');

        renderWithRecipeClient(<CollectionDetailContainer id="col_9" locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Pull Updates from Source' }));
        await user.click(await screen.findByRole('button', { name: 'Force confirm (test seam)' }));

        expect(pullSpy).not.toHaveBeenCalled();
    });
});
