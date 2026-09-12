/**
 * Component tests for the mobile RecipeVersionsScreen (react-native-web under jsdom). The screen drives the
 * shared native `RecipeVersionList` from (mocked) `useRecipe` (current version) + `useRecipeVersions`
 * (history), wiring restore to (mocked) `useRestoreRecipeVersion`. Covers loading, error, the populated list
 * (current version marked), and the restore wiring. W6 Task 5 adds: the Preview full-screen modal (reading
 * the target's snapshot straight off the already-loaded versions list — no extra fetch — with a "changed
 * from current" line and a busy Restore-from-preview action), and the two-version Compare full-screen sheet
 * (a checkbox-per-row selection capped at two, diffed via `diffSnapshots`) — mirroring the web container's
 * `RecipeVersionsContainer.tsx` wiring (see its module docs for the fuller rationale, shared verbatim here).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeVersionMessages } from '@commise/features-recipes';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useRecipeVersions, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';

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

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useRecipe: vi.fn(),
    useRecipeVersions: vi.fn(),
    useRestoreRecipeVersion: vi.fn(),
}));

const useRecipeMock = vi.mocked(useRecipe);
const useRecipeVersionsMock = vi.mocked(useRecipeVersions);
const useRestoreRecipeVersionMock = vi.mocked(useRestoreRecipeVersion);

function recipeResult(overrides: Partial<ReturnType<typeof useRecipe>> = {}): ReturnType<typeof useRecipe> {
    return { isLoading: false, isError: false, data: undefined, ...overrides } as unknown as ReturnType<
        typeof useRecipe
    >;
}

function versionsResult(
    overrides: Partial<ReturnType<typeof useRecipeVersions>> = {},
): ReturnType<typeof useRecipeVersions> {
    return { isLoading: false, isError: false, data: undefined, ...overrides } as unknown as ReturnType<
        typeof useRecipeVersions
    >;
}

function restoreMutation(
    overrides: Partial<ReturnType<typeof useRestoreRecipeVersion>> = {},
): ReturnType<typeof useRestoreRecipeVersion> {
    return {
        mutate: vi.fn(),
        isPending: false,
        variables: undefined,
        error: null,
        ...overrides,
    } as unknown as ReturnType<typeof useRestoreRecipeVersion>;
}

afterEach(cleanup);

beforeEach(() => {
    useRecipeMock.mockReset();
    useRecipeVersionsMock.mockReset();
    useRestoreRecipeVersionMock.mockReset();
    useRestoreRecipeVersionMock.mockReturnValue(restoreMutation());
});

describe('RecipeVersionsScreen — loading and error', () => {
    it('shows the loading indicator while either query loads', () => {
        useRecipeMock.mockReturnValue(recipeResult({ isLoading: true }));
        useRecipeVersionsMock.mockReturnValue(versionsResult({ isLoading: true }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        expect(screen.getByLabelText('Loading version history…')).toBeTruthy();
    });

    it('announces WHAT is loading and captions it visibly (no bare spinner)', () => {
        useRecipeMock.mockReturnValue(recipeResult({ isLoading: true }));
        useRecipeVersionsMock.mockReturnValue(versionsResult({ isLoading: true }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        const label = mobileMessages.en.recipes.versionsLoading;
        expect(screen.getByRole('progressbar', { name: label })).toBeTruthy();
        expect(screen.getByText(label)).toBeTruthy();
    });

    it('shows an alert when the versions fail to load', () => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail() }));
        useRecipeVersionsMock.mockReturnValue(versionsResult({ isError: true }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('treats a query that SETTLED WITH NOTHING as a failure, not a pending fetch (B21 guard)', () => {
        // Neither loading nor errored, yet no data — the shape a DISABLED query has. This screen has always
        // routed it into ERROR; the web containers routed it into LOADING (a permanent spinner). Pinned here
        // so the platform that was already right cannot drift onto the wrong side of the convergence.
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail() }));
        useRecipeVersionsMock.mockReturnValue(versionsResult({ isLoading: false, isError: false, data: undefined }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByRole('progressbar', { name: mobileMessages.en.recipes.versionsLoading })).toBeNull();
    });

    it('offers a retry that re-issues BOTH requests (web parity — an error state needs a way forward)', () => {
        const recipeRefetch = vi.fn();
        const versionsRefetch = vi.fn();
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail(), refetch: recipeRefetch as never }));
        useRecipeVersionsMock.mockReturnValue(versionsResult({ isError: true, refetch: versionsRefetch as never }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: mobileMessages.en.recipes.versionsRetry }));

        expect(versionsRefetch).toHaveBeenCalledTimes(1);
        expect(recipeRefetch).toHaveBeenCalledTimes(1);
    });

    it('keeps Back alongside the retry, so the error state is never a one-way street', () => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail() }));
        useRecipeVersionsMock.mockReturnValue(versionsResult({ isError: true }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        expect(screen.getByRole('button', { name: mobileMessages.en.recipes.back })).toBeTruthy();
        expect(screen.getByRole('button', { name: mobileMessages.en.recipes.versionsRetry })).toBeTruthy();
    });
});

describe('RecipeVersionsScreen — populated', () => {
    beforeEach(() => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ currentVersion: 2 }) }));
        useRecipeVersionsMock.mockReturnValue(
            versionsResult({
                data: [
                    makeRecipeVersion({ id: 'ver_1', versionNumber: 1 }),
                    makeRecipeVersion({ id: 'ver_2', versionNumber: 2 }),
                ],
            }),
        );
    });

    it('marks the current version and offers restore for earlier ones', () => {
        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        expect(screen.getByText('Current version')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Restore version 2' })).toBeNull();
    });

    it('restores the selected earlier version', () => {
        const mutate = vi.fn();
        useRestoreRecipeVersionMock.mockReturnValue(restoreMutation({ mutate: mutate as never }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        // The mutate carries the version number plus an onError options object (B17 conflict refetch).
        expect(mutate).toHaveBeenCalledWith(
            { id: 'rec_1', versionNumber: 1 },
            expect.objectContaining({ onError: expect.any(Function) }),
        );
    });

    it('returns to the caller from the back affordance', () => {
        const onBack = vi.fn();

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={onBack} />);
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeVersionsScreen — restore failure (B17: no silent no-op)', () => {
    // Fresh spies per test — the vitest config runs without `clearMocks`, so a `vi.fn()` shared across `it`s
    // in this describe would carry stale call counts (the "refetches on conflict" test's calls would leak
    // into the "does NOT refetch" assertion that follows it).
    let recipeRefetch: ReturnType<typeof vi.fn>;
    let versionsRefetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        recipeRefetch = vi.fn();
        versionsRefetch = vi.fn();
        useRecipeMock.mockReturnValue(
            recipeResult({ data: makeRecipeDetail({ currentVersion: 2 }), refetch: recipeRefetch as never }),
        );
        useRecipeVersionsMock.mockReturnValue(
            versionsResult({
                data: [
                    makeRecipeVersion({ id: 'ver_1', versionNumber: 1 }),
                    makeRecipeVersion({ id: 'ver_2', versionNumber: 2 }),
                ],
                refetch: versionsRefetch as never,
            }),
        );
    });

    it('surfaces the conflict copy when the restore 409s', () => {
        useRestoreRecipeVersionMock.mockReturnValue(
            restoreMutation({ error: new VersionConflictError(3, 1) as never }),
        );

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        expect(
            screen.getByText(
                'This recipe changed since you opened its history. Review the refreshed list and try again.',
            ),
        ).toBeTruthy();
    });

    it('surfaces the generic copy for a non-conflict restore failure', () => {
        useRestoreRecipeVersionMock.mockReturnValue(restoreMutation({ error: new Error('network down') as never }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        expect(screen.getByText('We couldn’t restore that version. Please try again.')).toBeTruthy();
    });

    it('refetches history + recipe when the restore onError fires with a conflict', () => {
        const mutate = vi.fn();
        useRestoreRecipeVersionMock.mockReturnValue(restoreMutation({ mutate: mutate as never }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        const onError = mutate.mock.calls[0]?.[1]?.onError as (error: unknown) => void;
        onError(new VersionConflictError(3, 1));

        expect(versionsRefetch).toHaveBeenCalledTimes(1);
        expect(recipeRefetch).toHaveBeenCalledTimes(1);
    });

    it('does NOT refetch when the restore onError fires with a non-conflict error', () => {
        const mutate = vi.fn();
        useRestoreRecipeVersionMock.mockReturnValue(restoreMutation({ mutate: mutate as never }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        const onError = mutate.mock.calls[0]?.[1]?.onError as (error: unknown) => void;
        onError(new Error('network down'));

        expect(versionsRefetch).not.toHaveBeenCalled();
        expect(recipeRefetch).not.toHaveBeenCalled();
    });
});

describe('RecipeVersionsScreen — preview (W6 Task 5)', () => {
    beforeEach(() => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ currentVersion: 2 }) }));
        useRecipeVersionsMock.mockReturnValue(
            versionsResult({
                data: [
                    makeRecipeVersion({ id: 'ver_1', versionNumber: 1, snapshot: priorSnapshot }),
                    makeRecipeVersion({ id: 'ver_2', versionNumber: 2, snapshot: revisedSnapshot }),
                ],
            }),
        );
    });

    it("opens the preview with the row's version and the changed-from-current summary", () => {
        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));

        expect(screen.getByText('Version 1 Preview: Weeknight Pasta')).toBeTruthy();
        // v1 (previewed) vs v2 (current): 0 ingredient changes, 1 step (instruction) changed — singular
        // "1 step", never the ungrammatical "1 steps".
        expect(screen.getByText('Changed from current: 0 ingredients, 1 step')).toBeTruthy();
    });

    it('Keep current version closes the preview without restoring', () => {
        const mutate = vi.fn();
        useRestoreRecipeVersionMock.mockReturnValue(restoreMutation({ mutate: mutate as never }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep current version' }));

        expect(screen.queryByText('Version 1 Preview: Weeknight Pasta')).toBeNull();
        expect(mutate).not.toHaveBeenCalled();
    });

    it('restores from the preview and closes it on success', () => {
        const mutate = vi.fn();
        useRestoreRecipeVersionMock.mockReturnValue(restoreMutation({ mutate: mutate as never }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));

        expect(mutate).toHaveBeenCalledWith(
            { id: 'rec_1', versionNumber: 1 },
            expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
        );

        const onSuccess = mutate.mock.calls[0]?.[1]?.onSuccess as () => void;
        act(() => {
            onSuccess();
        });

        expect(screen.queryByText('Version 1 Preview: Weeknight Pasta')).toBeNull();
    });

    it('shows the Restore action as busy while a restore-from-preview is in flight (no double-submit)', () => {
        useRestoreRecipeVersionMock.mockReturnValue(
            restoreMutation({ isPending: true, variables: { id: 'rec_1', versionNumber: 1 } as never }),
        );

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));

        expect(screen.getByRole('button', { name: 'Restoring…' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
    });

    describe('previewed version absent from the refreshed history (B21)', () => {
        /** Open the preview on v1, then let the history refresh WITHOUT v1 (the real shape: a restore 409s,
         *  the screen refetches, and the retention window has rolled v1 out of the newest-N list). The modal
         *  is left open pointing at a version that no longer exists. */
        function openPreviewThenLoseTheVersion(): void {
            const { rerender } = render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));

            useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ currentVersion: 3 }) }));
            useRecipeVersionsMock.mockReturnValue(
                versionsResult({
                    data: [
                        makeRecipeVersion({ id: 'ver_2', versionNumber: 2, snapshot: revisedSnapshot }),
                        makeRecipeVersion({ id: 'ver_3', versionNumber: 3, snapshot: revisedSnapshot }),
                    ],
                }),
            );
            rerender(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);
        }

        it('says the version failed to load instead of spinning forever', () => {
            openPreviewThenLoseTheVersion();

            expect(screen.getByText(recipeVersionMessages.en.preview.error)).toBeTruthy();
            // The defect: with `error` never wired, this state rendered the preview's progress affordance —
            // an unrecoverable spinner the modal had no way to escape into a failure.
            expect(screen.queryByRole('progressbar', { name: recipeVersionMessages.en.preview.loading })).toBeNull();
        });

        it('still offers a way OUT — Keep current version closes the modal', () => {
            openPreviewThenLoseTheVersion();

            fireEvent.click(screen.getByRole('button', { name: 'Keep current version' }));

            expect(screen.queryByText(recipeVersionMessages.en.preview.error)).toBeNull();
        });

        it('offers no Restore action for a version it could not resolve', () => {
            openPreviewThenLoseTheVersion();

            expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
        });
    });
});

describe('RecipeVersionsScreen — compare (W6 Task 5)', () => {
    beforeEach(() => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ currentVersion: 2 }) }));
        useRecipeVersionsMock.mockReturnValue(
            versionsResult({
                data: [
                    makeRecipeVersion({ id: 'ver_1', versionNumber: 1, snapshot: priorSnapshot }),
                    makeRecipeVersion({ id: 'ver_2', versionNumber: 2, snapshot: revisedSnapshot }),
                ],
            }),
        );
    });

    it('opens the compare view once exactly two versions are selected, ordered older/newer', () => {
        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        // Select newer (2) first, then older (1) — the sheet must still read "v2 vs v1" (newer vs older).
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }));

        expect(screen.getByText('Compare v2 vs v1')).toBeTruthy();
        // title changed (1 scalar) + steps modified (1) = 2 modified; no adds/removes.
        expect(screen.getByText('Modified: 2')).toBeTruthy();
    });

    it('deselecting a version before a second pick keeps the compare sheet closed', () => {
        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        const versionOneCheckbox = screen.getByRole('checkbox', { name: 'Select version 1 to compare' });
        fireEvent.click(versionOneCheckbox);
        fireEvent.click(versionOneCheckbox);

        expect(screen.queryByText('Compare v2 vs v1')).toBeNull();
    });

    it('closing the compare sheet clears the selection (both checkboxes uncheck)', () => {
        // react-native-web renders role="checkbox" but not `aria-checked` — assert the checked glyph
        // (mirrors `RecipeDetailView.native.test.tsx`'s ingredient-checkbox convention).
        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close compare' }));

        expect(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }).textContent).toContain('☐');
        expect(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }).textContent).toContain('☐');
    });

    it('caps selection at two — a third checkbox does not fire onToggleCompare once two are chosen', () => {
        useRecipeVersionsMock.mockReturnValue(
            versionsResult({
                data: [
                    makeRecipeVersion({ id: 'ver_1', versionNumber: 1 }),
                    makeRecipeVersion({ id: 'ver_2', versionNumber: 2 }),
                    makeRecipeVersion({ id: 'ver_3', versionNumber: 3 }),
                ],
            }),
        );

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 3 to compare' }));

        expect(screen.getByRole('checkbox', { name: 'Select version 3 to compare' }).textContent).toContain('☐');
    });
});
