/**
 * Component tests for RecipeVersionsContainer (T069 web version-history wiring; W6 Task 5 preview/compare
 * wiring). Covers every state the container renders — loading (either the versions or the recipe query
 * pending), error (with retry that refetches both), and ready (delegates to the shared RecipeVersionList
 * with the current version marked) — plus the restore flow: the mutation is wired with the correct version
 * number and the restoring row shows a busy status with all restore actions disabled. W6 Task 5 adds: the
 * Preview modal (opened from a row, reading the target's snapshot straight off the already-loaded versions
 * list — no extra fetch — with a "changed from current" line and a busy Restore-from-preview action), the
 * two-version Compare view (a checkbox-per-row selection capped at two, diffed via `diffSnapshots`), and a
 * "Back to Recipe" control present in every state (loading/error/populated), not just populated.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL query/mutation hooks over
 * a real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * type-checked `vi.spyOn(client, '<method>')`. The B17 conflict-refetch tests now drive the container's OWN
 * `onError` callback by rejecting `restoreRecipeVersion` for real, instead of grabbing the mutate call's
 * options object and invoking `onError` by hand — a more faithful reproduction, not a loosened one.
 *
 * `next/navigation` is mocked (mirroring `RecipeDetailContainer.test.tsx`/`RecipeListContainer.test.tsx`) —
 * the container reads `locale` off `useParams` and navigates "Back to Recipe" via `useRouter`, both of which
 * throw/return `null` outside an actual Next app-router tree.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeVersionsContainer } from '@/components/recipes/RecipeVersionsContainer';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';
import { makeRecipeVersion } from './__fixtures__/versionFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en', id: 'rec_1' }),
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/** Two hand-authored snapshots (mirroring the shared "changed-fields" fixture pattern used by
 *  `RecipeVersionList.test.tsx`) whose title AND step content differ — so Preview/Compare's diff output is
 *  meaningful rather than the all-zero tally the default `makeRecipeVersion` fixture would produce (its
 *  successive versions differ only in `snapshot.version`, a field `diffSnapshots` deliberately excludes). */
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

    it('announces the loading label as the live region CONTENT, not only its aria-label', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipeVersions').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

        // A `role="status"` node rendered EMPTY is doubly broken: zero-height (nothing for a sighted viewer,
        // and Playwright resolves it as `hidden`) AND silent, because a live region announces its CONTENT, not
        // its label. The localized label must be the visible caption.
        expect(screen.getByRole('status', { name: 'Loading version history' })).toHaveTextContent(
            'Loading version history',
        );
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

    describe('back to recipe (V6 fold-in, W6 Task 5)', () => {
        it('renders a Back to Recipe control while loading', () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'listRecipeVersions').mockReturnValue(new Promise(() => {}));
            vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

            expect(screen.getByRole('button', { name: 'Back to Recipe' })).toBeInTheDocument();
        });

        it('renders a Back to Recipe control on error', async () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'listRecipeVersions').mockRejectedValue(new Error('boom'));
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail());

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

            expect(await screen.findByRole('alert')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Back to Recipe' })).toBeInTheDocument();
        });

        it('navigates to the recipe from the loading state’s Back control', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'listRecipeVersions').mockReturnValue(new Promise(() => {}));
            vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(screen.getByRole('button', { name: 'Back to Recipe' }));

            expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
        });

        it('renders exactly one Back control in the populated state', async () => {
            const client = readyTwoVersionsClient();
            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

            expect(await screen.findAllByRole('button', { name: 'Back to Recipe' })).toHaveLength(1);
        });
    });

    describe('preview (W6 Task 5)', () => {
        it("opens the preview modal with the row's version and the changed-from-current summary", async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([
                makeRecipeVersion({ versionNumber: 1, snapshot: priorSnapshot }),
                makeRecipeVersion({ versionNumber: 2, snapshot: revisedSnapshot }),
            ]);
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 2 }));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'Preview version 1' }));

            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByText('Version 1 Preview: Weeknight Pasta')).toBeInTheDocument();
            // v1 (previewed) vs v2 (current): 0 ingredient changes, 1 step (instruction) changed — "1 step"
            // singular, never the ungrammatical "1 steps".
            expect(screen.getByText('Changed from current: 0 ingredients, 1 step')).toBeInTheDocument();
        });

        it('Keep current version closes the modal without restoring', async () => {
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            const restoreSpy = vi.spyOn(client, 'restoreRecipeVersion');

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'Preview version 1' }));
            await user.click(screen.getByRole('button', { name: 'Keep current version' }));

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(restoreSpy).not.toHaveBeenCalled();
        });

        it('restores the previewed version and closes the modal on success', async () => {
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            const restoreSpy = vi.spyOn(client, 'restoreRecipeVersion').mockResolvedValue({
                recipe: makeRecipeDetail({ currentVersion: 1 }),
                restoredFromVersion: 1,
                currentVersion: 1,
            });

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'Preview version 1' }));
            await user.click(screen.getByRole('button', { name: 'Restore this version' }));

            expect(restoreSpy).toHaveBeenCalledWith('rec_1', 1);
            await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        });

        it('shows the preview Restore action as busy while a restore-from-preview is in flight (no double-submit)', async () => {
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            vi.spyOn(client, 'restoreRecipeVersion').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'Preview version 1' }));
            await user.click(screen.getByRole('button', { name: 'Restore this version' }));

            expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restoring…' }).disabled).toBe(true);
        });
    });

    describe('compare (W6 Task 5)', () => {
        it('opens the compare view once exactly two versions are selected, ordered older/newer', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([
                makeRecipeVersion({ versionNumber: 1, snapshot: priorSnapshot }),
                makeRecipeVersion({ versionNumber: 2, snapshot: revisedSnapshot }),
            ]);
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 2 }));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

            // Select newer (2) first, then older (1) — the panel must still read "v2 vs v1" (newer vs older),
            // not selection order.
            await user.click(await screen.findByRole('checkbox', { name: 'Select version 2 to compare' }));
            await user.click(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }));

            expect(screen.getByText('Compare v2 vs v1')).toBeInTheDocument();
            // title changed (1 scalar) + steps modified (1) = 2 modified; no adds/removes.
            expect(screen.getByText('Modified: 2')).toBeInTheDocument();
        });

        it('deselecting before a second pick is made keeps the compare view closed', async () => {
            // The compare view is a MODAL Radix Dialog (mirroring VersionPreviewModal — see its module docs):
            // once it opens (exactly two selected) it aria-hides and pointer-event-blocks the page behind it,
            // so a THIRD interaction with the list is only reachable by closing the panel first. The
            // deselect-toggle itself is therefore only exercised here BELOW that two-selection threshold,
            // where the list is still fully interactive.
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

            const versionOneCheckbox = await screen.findByRole('checkbox', { name: 'Select version 1 to compare' });
            await user.click(versionOneCheckbox);
            await user.click(versionOneCheckbox);

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(
                screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select version 1 to compare' }).checked,
            ).toBe(false);
        });

        it('closing the compare view clears the selection (both checkboxes uncheck)', async () => {
            const user = userEvent.setup();
            const client = readyTwoVersionsClient();
            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

            await user.click(await screen.findByRole('checkbox', { name: 'Select version 1 to compare' }));
            await user.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));
            await user.click(screen.getByRole('button', { name: 'Close compare' }));

            expect(
                screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select version 1 to compare' }).checked,
            ).toBe(false);
            expect(
                screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select version 2 to compare' }).checked,
            ).toBe(false);
        });

        it('caps selection at two — a third checkbox is disabled once two are chosen', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([
                makeRecipeVersion({ versionNumber: 1 }),
                makeRecipeVersion({ versionNumber: 2 }),
                makeRecipeVersion({ versionNumber: 3 }),
            ]);
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ currentVersion: 3 }));

            renderWithRecipeClient(<RecipeVersionsContainer recipeId="rec_1" />, client);

            await user.click(await screen.findByRole('checkbox', { name: 'Select version 1 to compare' }));
            await user.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));

            // The now-open compare panel is a MODAL Radix Dialog, so the list behind it is aria-hidden and
            // pointer-event-blocked (see the "deselecting before a second pick" test above) — `hidden: true`
            // reaches into the inert page to confirm the container correctly threaded `selectedForCompare`
            // down (the SAME cap-at-two contract `RecipeVersionList.test.tsx` covers in isolation), even
            // though a real viewer could not click this checkbox without closing the panel first.
            expect(
                screen.getByRole<HTMLInputElement>('checkbox', {
                    name: 'Select version 3 to compare',
                    hidden: true,
                }).disabled,
            ).toBe(true);
        });
    });
});
