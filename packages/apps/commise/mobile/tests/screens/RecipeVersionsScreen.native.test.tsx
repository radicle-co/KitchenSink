/**
 * Component tests for the mobile RecipeVersionsScreen (react-native-web under jsdom). The screen drives the
 * shared native `RecipeVersionList` from (mocked) `useRecipe` (current version) + `useRecipeVersions`
 * (history), wiring restore to (mocked) `useRestoreRecipeVersion`. Covers loading, error, the populated list
 * (current version marked), and the restore wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { VersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useRecipeVersions, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';

import { RecipeVersionsScreen } from '../../src/screens/RecipeVersionsScreen.js';
import { makeRecipeDetail, makeRecipeVersion } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
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

    it('shows an alert when the versions fail to load', () => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail() }));
        useRecipeVersionsMock.mockReturnValue(versionsResult({ isError: true }));

        render(<RecipeVersionsScreen recipeId="rec_1" onBack={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
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
    const recipeRefetch = vi.fn();
    const versionsRefetch = vi.fn();

    beforeEach(() => {
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
