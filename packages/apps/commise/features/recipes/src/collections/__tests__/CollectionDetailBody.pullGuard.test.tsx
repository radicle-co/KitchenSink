/**
 * Regression test for the collection pull-commit invariant (W5 Task 12 hardening), MOVED here from web's
 * `CollectionDetailContainer.pullGuard.test.tsx` when the detail's composition became ONE shared body: `confirm` MUST NOT
 * commit a pull without a previewed diff, because the server only runs its drift guard when `previewedDiff` is present —
 * an undefined diff is applied BLINDLY server-side.
 *
 * `PullUpdatesDialog` only renders its confirm control once a diff has loaded, which makes the undefined-diff path
 * UNREACHABLE through ordinary clicks. This file replaces the dialog with a minimal fake that renders an always-present
 * confirm control, removing the dialog's own gate to isolate whether the BODY's wiring of `onConfirm` still refuses to
 * commit. Scoped to its own file because `vi.mock` is module-file-scoped and would otherwise replace the real dialog for
 * every other body test. (The hook's own guard is `useCollectionPull.test.tsx` "never commits without a previewed diff".)
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionDetailBody } from '../CollectionDetailBody.js';
import type { PullUpdatesDialogProps } from '../model.js';
import { useCollectionDetail } from '../useCollectionDetail.js';

vi.mock('../PullUpdatesDialog.js', () => ({
    PullUpdatesDialog: ({ open, onConfirm }: PullUpdatesDialogProps) =>
        open ? (
            <button type="button" onClick={onConfirm}>
                Force confirm (test seam)
            </button>
        ) : null,
}));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const copyOf = (): CollectionWithRecipes => ({
    id: 'col_9',
    ownerId: 'usr_1',
    name: 'Weeknight dinners',
    visibility: RecipeVisibility.PUBLIC,
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    sourceCollectionId: 'col_src',
    sourceCollectionName: 'Origin dinners',
    sourceOwnerDisplayName: 'sourcechef',
    recipes: [],
});

const PassThrough: FC<{ readonly children: ReactNode }> = ({ children }) => <>{children}</>;

const Screen: FC = () => {
    const detail = useCollectionDetail({
        collection: copyOf(),
        refreshNotice: undefined,
        paidFeatures: 'granted',
        viewChoice: undefined,
        onViewChoice: vi.fn(),
        nav: { onDeleted: vi.fn(), onCloned: vi.fn(), onCreateRecipe: vi.fn() },
    });

    return (
        <CollectionDetailBody
            detail={detail}
            onBack={vi.fn()}
            onSelectRecipe={vi.fn()}
            onViewSource={vi.fn()}
            PickerBoundary={({ children }) => <PassThrough>{children}</PassThrough>}
        />
    );
};

describe('CollectionDetailBody — confirmPull guards against an undefined previewed diff', () => {
    it('does not commit the pull when confirm fires before a diff has loaded', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        // Never resolves — the diff stays undefined for the lifetime of the test.
        vi.spyOn(client, 'previewPullFromSource').mockReturnValue(new Promise(() => {}));
        const pullSpy = vi.spyOn(client, 'pullCollectionFromSource');

        render(
            <QueryClientProvider client={new QueryClient()}>
                <RecipeServiceProvider client={client}>
                    <SnackbarHost>
                        <Screen />
                    </SnackbarHost>
                </RecipeServiceProvider>
            </QueryClientProvider>,
        );

        await user.click(screen.getByRole('button', { name: 'More actions for Weeknight dinners' }));
        await user.click(await screen.findByRole('menuitem', { name: 'Pull updates' }));
        await user.click(await screen.findByRole('button', { name: 'Force confirm (test seam)' }));

        expect(pullSpy).not.toHaveBeenCalled();
    });
});
