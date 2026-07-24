/**
 * Component tests for RecipeVersionsContainer (T069 web version-history wiring). Covers every state the
 * container renders — loading (either the versions or the recipe query pending), error (with retry that
 * refetches both), and ready (delegates to the shared RecipeVersionList with the current version marked) —
 * plus the restore flow: the mutation is wired with the correct version number and the restoring row shows
 * a busy status with all restore actions disabled.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL query/mutation hooks over
 * a real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * type-checked `vi.spyOn(client, '<method>')`. The B17 conflict-refetch tests now drive the container's OWN
 * `onError` callback by rejecting `restoreRecipeVersion` for real, instead of grabbing the mutate call's
 * options object and invoking `onError` by hand — a more faithful reproduction, not a loosened one.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeVersionsContainer } from '@/components/recipes/RecipeVersionsContainer';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';
import { makeRecipeVersion } from './__fixtures__/versionFixtures';

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/** A client whose `listRecipeVersions`/`getRecipeById` resolve to a ready two-version state (v1, v2 current). */
function readyTwoVersionsClient(): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([
        makeRecipeVersion({ versionNumber: 1 }),
        makeRecipeVersion({ versionNumber: 2 }),
    ]);
    vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 2 }));

    return client;
}

describe('RecipeVersionsContainer', () => {
    it('renders the loading state while either query is pending', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipeVersions').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

        expect(screen.getByRole('status', { name: 'Loading version history' })).toBeInTheDocument();
    });

    it('renders a generic error with retry that refetches both queries', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const versionsSpy = vi.spyOn(client, 'listRecipeVersions').mockRejectedValue(new Error('boom'));
        const recipeSpy = vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail());

        renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(versionsSpy).toHaveBeenCalledTimes(1);
        expect(recipeSpy).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(versionsSpy).toHaveBeenCalledTimes(2));
        expect(recipeSpy).toHaveBeenCalledTimes(2);
    });

    it('renders the version list with the current version marked', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([
            makeRecipeVersion({ versionNumber: 1 }),
            makeRecipeVersion({ versionNumber: 2 }),
            makeRecipeVersion({ versionNumber: 3 }),
        ]);
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 3 }));

        renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

        expect(await screen.findByRole('heading', { name: 'Version history' })).toBeInTheDocument();
        expect(screen.getByText('Current version')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Restore version 2' })).toBeInTheDocument();
        // The current version (3) is not restorable.
        expect(screen.queryByRole('button', { name: 'Restore version 3' })).not.toBeInTheDocument();
    });

    it('restores the chosen version with the correct version number', async () => {
        const user = userEvent.setup();
        const client = readyTwoVersionsClient();
        const restoreSpy = vi.spyOn(client, 'restoreRecipeVersion').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

        await user.click(await screen.findByRole('button', { name: 'Restore version 1' }));

        expect(restoreSpy).toHaveBeenCalledWith('rec_1', 1);
    });

    describe('restore failure (B17: no silent no-op)', () => {
        it('surfaces the conflict banner when the restore 409s (not a silent no-op)', async () => {
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            // A restore that fails with a 409 leaves the mutation carrying a VersionConflictError.
            vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new VersionConflictError(3, 1));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'Restore version 1' }));

            // The failure is a mandated UI state — the conflict copy, not a silent no-op.
            await vi.waitFor(() =>
                expect(screen.getByRole('alert').textContent).toContain(
                    'This recipe changed since you opened its history',
                ),
            );
        });

        it('surfaces the generic banner for a non-conflict restore failure', async () => {
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'Restore version 1' }));

            await vi.waitFor(() =>
                expect(screen.getByRole('alert').textContent).toBe(
                    'We couldn’t restore that version. Please try again.',
                ),
            );
        });

        it('refetches both queries when the restore fails with a conflict', async () => {
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            const versionsSpy = vi.mocked(client.listRecipeVersions);
            const recipeSpy = vi.mocked(client.getRecipeById);
            vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new VersionConflictError(3, 1));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'Restore version 1' }));

            // Initial mount = 1 call each; a conflict-triggered refetch adds a second.
            await vi.waitFor(() => expect(versionsSpy).toHaveBeenCalledTimes(2));
            expect(recipeSpy).toHaveBeenCalledTimes(2);
        });

        it('does NOT refetch when the restore fails with a non-conflict error', async () => {
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            const versionsSpy = vi.mocked(client.listRecipeVersions);
            const recipeSpy = vi.mocked(client.getRecipeById);
            vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'Restore version 1' }));

            await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
            expect(versionsSpy).toHaveBeenCalledTimes(1);
            expect(recipeSpy).toHaveBeenCalledTimes(1);
        });
    });

    it('shows a busy status on the restoring row and disables every restore action', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([
            makeRecipeVersion({ versionNumber: 1 }),
            makeRecipeVersion({ versionNumber: 2 }),
            makeRecipeVersion({ versionNumber: 3 }),
        ]);
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 3 }));
        vi.spyOn(client, 'restoreRecipeVersion').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
        await user.click(await screen.findByRole('button', { name: 'Restore version 1' }));

        expect(await screen.findByText('Restoring version 1…')).toBeInTheDocument();
        // Every restorable row is disabled while a restore is in flight (prevents a concurrent restore).
        expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Restore version 2' })).toBeDisabled();
    });
});
