/**
 * Component tests for RecipeVersionsContainer (T069 web version-history wiring). Covers every state the
 * container renders — loading (either the versions or the recipe query pending), error (with retry that
 * refetches both), and ready (delegates to the shared RecipeVersionList with the current version marked) —
 * plus the restore flow: the mutation is wired with the correct version number and the restoring row shows
 * a busy status with all restore actions disabled. The version + recipe + restore hooks are mocked, so no
 * backend or QueryClient is needed.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VersionConflictError } from '@kitchensink/recipe-service-client';

import { RecipeVersionsContainer } from '@/components/recipes/RecipeVersionsContainer';

import { makeRecipe } from './__fixtures__/recipeFixtures';
import { makeRecipeVersion } from './__fixtures__/versionFixtures';

const {
    useRecipeVersionsMock,
    useRecipeMock,
    useRestoreRecipeVersionMock,
    versionsRefetchMock,
    recipeRefetchMock,
    restoreMutateMock,
} = vi.hoisted(() => ({
    useRecipeVersionsMock: vi.fn(),
    useRecipeMock: vi.fn(),
    useRestoreRecipeVersionMock: vi.fn(),
    versionsRefetchMock: vi.fn(),
    recipeRefetchMock: vi.fn(),
    restoreMutateMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipeVersions: useRecipeVersionsMock,
    useRecipe: useRecipeMock,
    useRestoreRecipeVersion: useRestoreRecipeVersionMock,
}));

function mockRestore(overrides: Record<string, unknown> = {}): void {
    useRestoreRecipeVersionMock.mockReturnValue({
        mutate: restoreMutateMock,
        isPending: false,
        variables: undefined,
        error: null,
        ...overrides,
    });
}

/** A two-version ready state (v1 restorable, v2 current) shared by the restore-flow tests. */
function mockReadyTwoVersions(): void {
    useRecipeVersionsMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })],
        refetch: versionsRefetchMock,
    });
    useRecipeMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: makeRecipe({ currentVersion: 2 }),
        refetch: recipeRefetchMock,
    });
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('RecipeVersionsContainer', () => {
    it('renders the loading state while either query is pending', () => {
        useRecipeVersionsMock.mockReturnValue({
            isLoading: true,
            isError: false,
            data: undefined,
            refetch: versionsRefetchMock,
        });
        useRecipeMock.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: recipeRefetchMock });
        mockRestore();

        render(<RecipeVersionsContainer recipeId="rec_1" />);

        expect(screen.getByRole('status', { name: 'Loading version history' })).toBeInTheDocument();
    });

    it('renders a generic error with retry that refetches both queries', async () => {
        const user = userEvent.setup();
        useRecipeVersionsMock.mockReturnValue({
            isLoading: false,
            isError: true,
            data: undefined,
            refetch: versionsRefetchMock,
        });
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipe(),
            refetch: recipeRefetchMock,
        });
        mockRestore();

        render(<RecipeVersionsContainer recipeId="rec_1" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(versionsRefetchMock).toHaveBeenCalledTimes(1);
        expect(recipeRefetchMock).toHaveBeenCalledTimes(1);
    });

    it('renders the version list with the current version marked', () => {
        useRecipeVersionsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: [
                makeRecipeVersion({ versionNumber: 1 }),
                makeRecipeVersion({ versionNumber: 2 }),
                makeRecipeVersion({ versionNumber: 3 }),
            ],
            refetch: versionsRefetchMock,
        });
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipe({ currentVersion: 3 }),
            refetch: recipeRefetchMock,
        });
        mockRestore();

        render(<RecipeVersionsContainer recipeId="rec_1" />);

        expect(screen.getByRole('heading', { name: 'Version history' })).toBeInTheDocument();
        expect(screen.getByText('Current version')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Restore version 2' })).toBeInTheDocument();
        // The current version (3) is not restorable.
        expect(screen.queryByRole('button', { name: 'Restore version 3' })).not.toBeInTheDocument();
    });

    it('restores the chosen version with the correct version number', async () => {
        const user = userEvent.setup();
        mockReadyTwoVersions();
        mockRestore();

        render(<RecipeVersionsContainer recipeId="rec_1" />);

        await user.click(screen.getByRole('button', { name: 'Restore version 1' }));

        // The mutate carries the version number plus an onError options object (B17 conflict refetch).
        expect(restoreMutateMock).toHaveBeenCalledWith(
            { id: 'rec_1', versionNumber: 1 },
            expect.objectContaining({ onError: expect.any(Function) }),
        );
    });

    describe('restore failure (B17: no silent no-op)', () => {
        it('surfaces the conflict banner when the restore 409s (not a silent no-op)', () => {
            mockReadyTwoVersions();
            // A restore that failed with a 409 leaves the mutation carrying a VersionConflictError.
            mockRestore({ error: new VersionConflictError(3, 1) });

            render(<RecipeVersionsContainer recipeId="rec_1" />);

            // The failure is a mandated UI state — the conflict copy, not a silent no-op.
            expect(screen.getByRole('alert').textContent).toContain('This recipe changed since you opened its history');
        });

        it('surfaces the generic banner for a non-conflict restore failure', () => {
            mockReadyTwoVersions();
            mockRestore({ error: new Error('network down') });

            render(<RecipeVersionsContainer recipeId="rec_1" />);

            expect(screen.getByRole('alert').textContent).toBe('We couldn’t restore that version. Please try again.');
        });

        it('refetches both queries when the restore onError fires with a conflict', async () => {
            const user = userEvent.setup();
            mockReadyTwoVersions();
            mockRestore();

            render(<RecipeVersionsContainer recipeId="rec_1" />);
            await user.click(screen.getByRole('button', { name: 'Restore version 1' }));

            const onError = restoreMutateMock.mock.calls[0]?.[1]?.onError as (error: unknown) => void;
            onError(new VersionConflictError(3, 1));

            expect(versionsRefetchMock).toHaveBeenCalledTimes(1);
            expect(recipeRefetchMock).toHaveBeenCalledTimes(1);
        });

        it('does NOT refetch when the restore onError fires with a non-conflict error', async () => {
            const user = userEvent.setup();
            mockReadyTwoVersions();
            mockRestore();

            render(<RecipeVersionsContainer recipeId="rec_1" />);
            await user.click(screen.getByRole('button', { name: 'Restore version 1' }));

            const onError = restoreMutateMock.mock.calls[0]?.[1]?.onError as (error: unknown) => void;
            onError(new Error('network down'));

            expect(versionsRefetchMock).not.toHaveBeenCalled();
            expect(recipeRefetchMock).not.toHaveBeenCalled();
        });
    });

    it('shows a busy status on the restoring row and disables every restore action', () => {
        useRecipeVersionsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: [
                makeRecipeVersion({ versionNumber: 1 }),
                makeRecipeVersion({ versionNumber: 2 }),
                makeRecipeVersion({ versionNumber: 3 }),
            ],
            refetch: versionsRefetchMock,
        });
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipe({ currentVersion: 3 }),
            refetch: recipeRefetchMock,
        });
        mockRestore({ isPending: true, variables: { id: 'rec_1', versionNumber: 1 } });

        render(<RecipeVersionsContainer recipeId="rec_1" />);

        expect(screen.getByText('Restoring version 1…')).toBeInTheDocument();
        // Every restorable row is disabled while a restore is in flight (prevents a concurrent restore).
        expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Restore version 2' })).toBeDisabled();
    });
});
