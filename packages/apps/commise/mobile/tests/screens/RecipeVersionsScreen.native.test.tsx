/**
 * Component tests for the mobile RecipeVersionsScreen (react-native-web under jsdom). The screen reads the history
 * and the recipe with suspense queries under a `QueryBoundary`, and drives the shared native `RecipeVersionList`
 * once both settle, wiring restore to `useRestoreRecipeVersion`. Covers loading, error (a retry that refetches, with
 * Back kept alongside), the populated list (current version marked), and the restore wiring. W6 Task 5 adds: the
 * Preview full-screen modal (reading the target's snapshot straight off the already-loaded versions list — no extra
 * fetch — with a "changed from current" line and a busy Restore-from-preview action), and the two-version Compare
 * full-screen sheet (a checkbox-per-row selection capped at two, diffed via `diffSnapshots`) — mirroring the web
 * container's `RecipeVersionsContainer.tsx` wiring.
 *
 * The screen renders through the REAL query and mutation hooks over a network-guarded fake client
 * (`createFakeRecipeServiceClient`, stubbed per test with `vi.spyOn`), the seam the web container test uses — so a
 * retry is proven by a second request, not by a mocked `refetch` being called.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { recipeVersionMessages } from '@commise/features-recipes';
import { renderWithRecipeClient } from '@commise/test-utils';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';
import { VersionConflictError, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { mobileMessages } from '../../src/i18n/messages.js';
import { RecipeVersionsScreen } from '../../src/screens/RecipeVersionsScreen.js';
import { makeRecipeDetail, makeRecipeVersion } from '../__fixtures__/recipes.js';

/** Two hand-authored snapshots (mirroring the web container test's identical fixture) whose title AND step
 *  content differ — so Preview/Compare's diff output is meaningful rather than the all-zero tally the
 *  default `makeRecipeVersion` fixture produces (successive versions there differ only in `snapshot.version`,
 *  a field `diffSnapshots` deliberately excludes). */
const priorSnapshot: RecipeSnapshot = {
    version: 1,
    title: 'Weeknight Pasta',
    description: 'A fast, comforting weeknight dinner.',
    steps: [{ id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Boil water.' }],
    ingredients: [],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
};
const revisedSnapshot: RecipeSnapshot = {
    ...priorSnapshot,
    version: 2,
    title: 'Weeknight Pasta, Revised',
    steps: [{ id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Boil salted water.' }],
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const t = mobileMessages.en.recipes;

/** A client whose history and recipe resolve to a two-version state (v1, v2 current). */
function readyClient(snapshots?: readonly [RecipeSnapshot, RecipeSnapshot]): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([
        makeRecipeVersion({ id: 'ver_1', versionNumber: 1, ...(snapshots ? { snapshot: snapshots[0] } : {}) }),
        makeRecipeVersion({ id: 'ver_2', versionNumber: 2, ...(snapshots ? { snapshot: snapshots[1] } : {}) }),
    ]);
    vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 2 }));

    return client;
}

/** Render the screen and wait for the settled history. */
async function renderReady(client: RecipeServiceClient, onBack = vi.fn()): Promise<void> {
    renderWithRecipeClient(<RecipeVersionsScreen recipeId="rec_1" onBack={onBack} />, client);
    await screen.findByText('Current version');
}

describe('RecipeVersionsScreen — loading and error', () => {
    function pendingClient(): RecipeServiceClient {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipeVersions').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

        return client;
    }

    it('announces WHAT is loading and captions it visibly (no bare spinner)', () => {
        renderWithRecipeClient(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />, pendingClient());

        expect(screen.getByRole('progressbar', { name: t.versionsLoading })).toBeTruthy();
        expect(screen.getByText(t.versionsLoading)).toBeTruthy();
    });

    it('keeps Back while loading, so the wait is never a one-way street', () => {
        const onBack = vi.fn();
        renderWithRecipeClient(<RecipeVersionsScreen recipeId="rec_1" onBack={onBack} />, pendingClient());

        fireEvent.click(screen.getByRole('button', { name: t.back }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('shows an alert when the versions fail to load, with Back alongside the retry', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipeVersions').mockRejectedValue(new Error('boom'));
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail());
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderWithRecipeClient(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />, client);

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByRole('button', { name: t.back })).toBeTruthy();
        expect(screen.getByRole('button', { name: t.versionsRetry })).toBeTruthy();
    });

    it('⛔ retries with a real second request and recovers (web parity — an error state needs a way forward)', async () => {
        const client = createFakeRecipeServiceClient();
        const versionsSpy = vi
            .spyOn(client, 'listRecipeVersions')
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce([makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })]);
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 2 }));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderWithRecipeClient(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />, client);
        fireEvent.click(await screen.findByRole('button', { name: t.versionsRetry }));

        expect(await screen.findByText('Current version')).toBeTruthy();
        expect(versionsSpy).toHaveBeenCalledTimes(2);
    });

    it('treats an id it cannot read as a failure, issuing no request (B21 guard)', () => {
        const client = createFakeRecipeServiceClient();
        const versionsSpy = vi.spyOn(client, 'listRecipeVersions');
        const recipeSpy = vi.spyOn(client, 'getRecipeById');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderWithRecipeClient(<RecipeVersionsScreen recipeId="" onBack={vi.fn()} />, client);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByRole('progressbar', { name: t.versionsLoading })).toBeNull();
        expect(versionsSpy).not.toHaveBeenCalled();
        expect(recipeSpy).not.toHaveBeenCalled();
    });
});

describe('RecipeVersionsScreen — populated', () => {
    it('marks the current version and offers restore for earlier ones', async () => {
        await renderReady(readyClient());

        expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Restore version 2' })).toBeNull();
    });

    it('restores the selected earlier version', async () => {
        const client = readyClient();
        const restoreSpy = vi.spyOn(client, 'restoreRecipeVersion').mockReturnValue(new Promise(() => {}));
        await renderReady(client);

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        await vi.waitFor(() => expect(restoreSpy).toHaveBeenCalledWith('rec_1', 1));
    });

    it('returns to the caller from the back affordance', async () => {
        const onBack = vi.fn();
        await renderReady(readyClient(), onBack);

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeVersionsScreen — restore failure (B17: no silent no-op)', () => {
    it('surfaces the conflict copy when the restore 409s', async () => {
        const client = readyClient();
        vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new VersionConflictError(3, 1));
        await renderReady(client);

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        expect(
            await screen.findByText(
                'This recipe changed since you opened its history. Review the refreshed list and try again.',
            ),
        ).toBeTruthy();
    });

    it('surfaces the generic copy for a non-conflict restore failure', async () => {
        const client = readyClient();
        vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new Error('network down'));
        await renderReady(client);

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        expect(await screen.findByText('We couldn’t restore that version. Please try again.')).toBeTruthy();
    });

    it('refetches history + recipe when the restore fails with a conflict', async () => {
        const client = readyClient();
        vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new VersionConflictError(3, 1));
        await renderReady(client);

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        // Initial mount = 1 call each; the conflict-triggered refetch adds a second.
        await vi.waitFor(() => expect(client.listRecipeVersions).toHaveBeenCalledTimes(2));
        expect(client.getRecipeById).toHaveBeenCalledTimes(2);
    });

    it('does NOT refetch when the restore fails with a non-conflict error', async () => {
        const client = readyClient();
        vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new Error('network down'));
        await renderReady(client);

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        await screen.findByText('We couldn’t restore that version. Please try again.');
        expect(client.listRecipeVersions).toHaveBeenCalledTimes(1);
        expect(client.getRecipeById).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeVersionsScreen — preview (W6 Task 5)', () => {
    it("opens the preview with the row's version and the changed-from-current summary", async () => {
        await renderReady(readyClient([priorSnapshot, revisedSnapshot]));

        fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));

        expect(screen.getByText('Version 1 Preview: Weeknight Pasta')).toBeTruthy();
        // v1 (previewed) vs v2 (current): 0 ingredient changes, 1 step (instruction) changed — singular
        // "1 step", never the ungrammatical "1 steps".
        expect(screen.getByText('Changed from current: 0 ingredients, 1 step')).toBeTruthy();
    });

    it('Keep current version closes the preview without restoring', async () => {
        const client = readyClient([priorSnapshot, revisedSnapshot]);
        const restoreSpy = vi.spyOn(client, 'restoreRecipeVersion');
        await renderReady(client);

        fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep current version' }));

        expect(screen.queryByText('Version 1 Preview: Weeknight Pasta')).toBeNull();
        expect(restoreSpy).not.toHaveBeenCalled();
    });

    it('restores from the preview and closes it on success', async () => {
        const client = readyClient([priorSnapshot, revisedSnapshot]);
        const restoreSpy = vi
            .spyOn(client, 'restoreRecipeVersion')
            .mockResolvedValue({ recipe: makeRecipeDetail({ currentVersion: 3 }) } as never);
        await renderReady(client);

        fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));

        await vi.waitFor(() => expect(restoreSpy).toHaveBeenCalledWith('rec_1', 1));
        await vi.waitFor(() => expect(screen.queryByText('Version 1 Preview: Weeknight Pasta')).toBeNull());
    });

    it('shows the Restore action as busy while a restore-from-preview is in flight (no double-submit)', async () => {
        const client = readyClient([priorSnapshot, revisedSnapshot]);
        vi.spyOn(client, 'restoreRecipeVersion').mockReturnValue(new Promise(() => {}));
        await renderReady(client);

        fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));

        expect(await screen.findByRole('button', { name: 'Restoring…' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
    });

    describe('previewed version absent from the refreshed history (B21)', () => {
        /** Open the preview on v1, then fire the restore whose 409 refetches a history without v1 (the real shape:
         *  the retention window has rolled v1 out of the newest-N list). The modal is left open pointing at a
         *  version that no longer exists. */
        async function openPreviewThenLoseTheVersion(): Promise<void> {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'listRecipeVersions')
                .mockResolvedValueOnce([
                    makeRecipeVersion({ id: 'ver_1', versionNumber: 1, snapshot: priorSnapshot }),
                    makeRecipeVersion({ id: 'ver_2', versionNumber: 2, snapshot: revisedSnapshot }),
                ])
                .mockResolvedValue([
                    makeRecipeVersion({ id: 'ver_2', versionNumber: 2, snapshot: revisedSnapshot }),
                    makeRecipeVersion({ id: 'ver_3', versionNumber: 3, snapshot: revisedSnapshot }),
                ]);
            vi.spyOn(client, 'getRecipeById')
                .mockResolvedValueOnce(makeRecipeDetail({ currentVersion: 2 }))
                .mockResolvedValue(makeRecipeDetail({ currentVersion: 3 }));
            vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(new VersionConflictError(3, 1));
            await renderReady(client);

            fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));
            fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
            await screen.findByText(recipeVersionMessages.en.preview.error);
        }

        it('says the version failed to load instead of spinning forever', async () => {
            await openPreviewThenLoseTheVersion();

            // The defect: with `error` never wired, this state rendered the preview's progress affordance —
            // an unrecoverable spinner the modal had no way to escape into a failure.
            expect(screen.queryByRole('progressbar', { name: recipeVersionMessages.en.preview.loading })).toBeNull();
        });

        it('still offers a way OUT — Keep current version closes the modal', async () => {
            await openPreviewThenLoseTheVersion();

            fireEvent.click(screen.getByRole('button', { name: 'Keep current version' }));

            expect(screen.queryByText(recipeVersionMessages.en.preview.error)).toBeNull();
        });

        it('offers no Restore action for a version it could not resolve', async () => {
            await openPreviewThenLoseTheVersion();

            expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
        });
    });
});

describe('RecipeVersionsScreen — compare (W6 Task 5)', () => {
    it('opens the compare view once exactly two versions are selected, ordered older/newer', async () => {
        await renderReady(readyClient([priorSnapshot, revisedSnapshot]));

        // Select newer (2) first, then older (1) — the sheet must still read "v2 vs v1" (newer vs older).
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }));

        expect(screen.getByText('Compare v2 vs v1')).toBeTruthy();
        // title changed (1 scalar) + steps modified (1) = 2 modified; no adds/removes.
        expect(screen.getByText('Modified: 2')).toBeTruthy();
    });

    it('deselecting a version before a second pick keeps the compare sheet closed', async () => {
        await renderReady(readyClient([priorSnapshot, revisedSnapshot]));

        const versionOneCheckbox = screen.getByRole('checkbox', { name: 'Select version 1 to compare' });
        fireEvent.click(versionOneCheckbox);
        fireEvent.click(versionOneCheckbox);

        expect(screen.queryByText('Compare v2 vs v1')).toBeNull();
    });

    it('closing the compare sheet clears the selection (both checkboxes uncheck)', async () => {
        // react-native-web renders role="checkbox" but not `aria-checked` — assert the checked glyph
        // (mirrors `RecipeDetailView.native.test.tsx`'s ingredient-checkbox convention).
        await renderReady(readyClient([priorSnapshot, revisedSnapshot]));

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close compare' }));

        expect(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }).textContent).toContain('☐');
        expect(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }).textContent).toContain('☐');
    });

    it('caps selection at two — a third checkbox does not fire onToggleCompare once two are chosen', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([
            makeRecipeVersion({ id: 'ver_1', versionNumber: 1 }),
            makeRecipeVersion({ id: 'ver_2', versionNumber: 2 }),
            makeRecipeVersion({ id: 'ver_3', versionNumber: 3 }),
        ]);
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 2 }));
        await renderReady(client);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 3 to compare' }));

        expect(screen.getByRole('checkbox', { name: 'Select version 3 to compare' }).textContent).toContain('☐');
    });
});
