/**
 * `useRecipeVersions` — the ONE version-history session web's `RecipeVersionsContainer` and mobile's
 * `RecipeVersionsScreen` sit on: both reads, the restore (with its snackbar, Undo and conflict refetch), the preview and
 * the compare. Written FIRST, from the two copies, which agreed except where they are settled here:
 *
 * - the snackbar's "Restored version {n}." fills its number through `fillTemplate` (web had a private `fillVersion`,
 *   mobile an inline `.replace`);
 * - the busy version is read null-safely (`variables?.versionNumber ?? null`), as mobile already did.
 *
 * `@kitchensink/recipe-service-client/hooks` runs for real over a fake, network-guarded client stubbed per test.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { makeRecipeDetail, makeRecipeVersion } from '@kitchensink/recipe-core/testing';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { Suspense, type FC, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRecipeVersions } from '../useRecipeVersions.js';

afterEach(() => {
    vi.restoreAllMocks();
});

function setup(recipeId = 'rec_1') {
    const client = createFakeRecipeServiceClient();
    const listVersions = vi
        .spyOn(client, 'listRecipeVersions')
        .mockResolvedValue([
            makeRecipeVersion({ id: 'ver_1', versionNumber: 1 }),
            makeRecipeVersion({ id: 'ver_2', versionNumber: 2 }),
            makeRecipeVersion({ id: 'ver_3', versionNumber: 3 }),
        ]);
    const getRecipe = vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 3 }));
    const restore = vi.spyOn(client, 'restoreRecipeVersion').mockResolvedValue({
        recipe: makeRecipeDetail({ currentVersion: 4 }),
        restoredFromVersion: 1,
        currentVersion: 4,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <SnackbarHost>
                    <Suspense fallback={null}>{children}</Suspense>
                </SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
    const view = renderHook(() => useRecipeVersions({ recipeId }), { wrapper });

    return { client, listVersions, getRecipe, restore, ...view };
}

describe('useRecipeVersions — the reads', () => {
    it('hands the list the history, the recipe’s current version and its title once both reads settle', async () => {
        const { result } = setup();

        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current.list.versions.map((version) => version.versionNumber)).toEqual([1, 2, 3]);
        expect(result.current.list.currentVersion).toBe(3);
        expect(result.current.list.recipeTitle).toBeTypeOf('string');
    });

    it('fails an empty recipe id into the boundary instead of requesting "" (B21)', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useRecipeVersions({ recipeId: '' }))).toThrow(
            'A recipe version history needs a recipe id.',
        );

        errors.mockRestore();
    });
});

describe('useRecipeVersions — restore', () => {
    it('restores the chosen version, says so with its number filled in, and busies only that version meanwhile', async () => {
        const { result, restore } = setup();
        await waitFor(() => expect(result.current.list.versions).toHaveLength(3));
        restore.mockReturnValue(new Promise(() => undefined));

        act(() => result.current.list.onRestore(2));

        await waitFor(() => expect(restore).toHaveBeenCalledWith('rec_1', 2));
        await waitFor(() => expect(result.current.list.restoringVersion).toBe(2));
    });

    it('announces "Restored version N." and offers Undo, which restores the version that WAS current without another Undo', async () => {
        const { result, restore } = setup();
        await waitFor(() => expect(result.current.list.versions).toHaveLength(3));

        act(() => result.current.list.onRestore(1));

        await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Restored version 1.'));
        act(() => screen.getByRole('button', { name: 'Undo' }).click());

        await waitFor(() => expect(restore).toHaveBeenLastCalledWith('rec_1', 3));
        await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Restored version 3.'));
        expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    });

    it('classifies a refused restore for the version it targeted', async () => {
        const { result, restore } = setup();
        await waitFor(() => expect(result.current.list.versions).toHaveLength(3));
        restore.mockRejectedValue(new VersionConflictError(3, 1));

        act(() => result.current.list.onRestore(1));

        await waitFor(() => expect(result.current.list.restoreError).toBeDefined());
        expect(result.current.preview.restoreError).toEqual(result.current.list.restoreError);
    });

    it('refetches the history and the recipe after a CONFLICT, and only then', async () => {
        const { result, restore, listVersions, getRecipe } = setup();
        await waitFor(() => expect(result.current.list.versions).toHaveLength(3));
        restore.mockRejectedValueOnce(new Error('plain failure'));
        act(() => result.current.list.onRestore(1));
        await waitFor(() => expect(result.current.list.restoreError).toBeDefined());
        expect(listVersions).toHaveBeenCalledTimes(1);
        expect(getRecipe).toHaveBeenCalledTimes(1);

        restore.mockRejectedValueOnce(new VersionConflictError(3, 1));
        act(() => result.current.list.onRestore(2));

        await waitFor(() => expect(listVersions).toHaveBeenCalledTimes(2));
        expect(getRecipe).toHaveBeenCalledTimes(2);
    });
});

describe('useRecipeVersions — preview and compare', () => {
    it('opens the preview for a row, offers no fetch, and closes on cancel', async () => {
        const { result, listVersions } = setup();
        await waitFor(() => expect(result.current.list.versions).toHaveLength(3));

        expect(result.current.preview.open).toBe(false);
        act(() => result.current.list.onPreview?.(2));

        expect(result.current.preview.open).toBe(true);
        expect(result.current.preview.version?.versionNumber).toBe(2);
        expect(listVersions).toHaveBeenCalledTimes(1);

        act(() => result.current.preview.onCancel());

        expect(result.current.preview.open).toBe(false);
    });

    it('closes the preview when a restore started from it lands', async () => {
        const { result } = setup();
        await waitFor(() => expect(result.current.list.versions).toHaveLength(3));

        act(() => result.current.list.onPreview?.(2));
        act(() => result.current.preview.onRestore(2));

        await waitFor(() => expect(result.current.preview.open).toBe(false));
    });

    it('opens the compare for one version against the current one, and closes it', async () => {
        const { result } = setup();
        await waitFor(() => expect(result.current.list.versions).toHaveLength(3));

        expect(result.current.compare.open).toBe(false);
        act(() => result.current.list.onCompare?.(1));

        expect(result.current.compare.version?.versionNumber).toBe(1);
        expect(result.current.compare.diff).toBeDefined();
        expect(result.current.compare.open).toBe(true);

        act(() => result.current.compare.onClose());

        expect(result.current.compare.open).toBe(false);
    });
});
