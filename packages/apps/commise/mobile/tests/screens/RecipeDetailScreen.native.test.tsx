/**
 * Component tests for the mobile RecipeDetailScreen (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). The screen drives the shared native `RecipeDetailView` from the (mocked)
 * `useRecipe` query and composes the owner/viewer action blocks (delete, visibility, clone) plus edit and
 * version-history entry points, gated by ownership + tier from the (mocked) `useUserProfile`.
 *
 * Covers EVERY UI path: loading, error, ready, the back affordance, owner-only actions, the tier-gated
 * visibility option, the delete flow, and the clone action for a public recipe the viewer does not own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    useCloneRecipe,
    useDeleteRecipe,
    useRecipe,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';

import { RecipeDetailScreen } from '../../src/screens/RecipeDetailScreen.js';
import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: vi.fn(),
    useDeleteRecipe: vi.fn(),
    useSetRecipeVisibility: vi.fn(),
    useCloneRecipe: vi.fn(),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: vi.fn(),
}));

const useRecipeMock = vi.mocked(useRecipe);
const useDeleteRecipeMock = vi.mocked(useDeleteRecipe);
const useSetRecipeVisibilityMock = vi.mocked(useSetRecipeVisibility);
const useCloneRecipeMock = vi.mocked(useCloneRecipe);
const useUserProfileMock = vi.mocked(useUserProfile);

function detailResult(overrides: Partial<ReturnType<typeof useRecipe>> = {}): ReturnType<typeof useRecipe> {
    return { isLoading: false, isError: false, data: undefined, ...overrides } as unknown as ReturnType<
        typeof useRecipe
    >;
}

function mutation<T>(overrides: Partial<T> = {}): T {
    return { mutate: vi.fn(), isPending: false, ...overrides } as unknown as T;
}

/** A `useUserProfile` double exposing only the viewer id + tier the screen reads. */
function profile(id: string | undefined, tier: 'free' | 'premium' = 'free'): ReturnType<typeof useUserProfile> {
    const data = id === undefined ? undefined : { user: { id }, account: { subscriptionTier: tier } };

    return { data } as unknown as ReturnType<typeof useUserProfile>;
}

afterEach(cleanup);

beforeEach(() => {
    useRecipeMock.mockReset();
    useDeleteRecipeMock.mockReset();
    useSetRecipeVisibilityMock.mockReset();
    useCloneRecipeMock.mockReset();
    useUserProfileMock.mockReset();
    useDeleteRecipeMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>());
    useSetRecipeVisibilityMock.mockReturnValue(mutation<ReturnType<typeof useSetRecipeVisibility>>());
    useCloneRecipeMock.mockReturnValue(mutation<ReturnType<typeof useCloneRecipe>>());
    useUserProfileMock.mockReturnValue(profile(undefined));
});

describe('RecipeDetailScreen — loading state', () => {
    it('shows the localized loading indicator while the query is loading', () => {
        useRecipeMock.mockReturnValue(detailResult({ isLoading: true }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — error state', () => {
    it('shows an alert when the query errors', () => {
        useRecipeMock.mockReturnValue(detailResult({ isError: true }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('We couldn’t load this recipe.')).toBeTruthy();
    });

    it('shows the error state when the query settled without data', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: undefined }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('alert')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — ready state', () => {
    it('renders the recipe detail view once the recipe resolves', () => {
        useRecipeMock.mockReturnValue(
            detailResult({ data: makeRecipeDetail({ title: 'Weeknight Pasta', description: 'Fast and cozy.' }) }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('heading', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByText('Fast and cozy.')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders and wires the back affordance only when onBack is provided', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: makeRecipeDetail({ title: 'Weeknight Pasta' }) }));
        const onBack = vi.fn();

        const { rerender } = render(<RecipeDetailScreen recipeId="rec_1" onBack={onBack} />);
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(onBack).toHaveBeenCalledTimes(1);

        rerender(<RecipeDetailScreen recipeId="rec_1" />);
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('hides owner actions from a non-owner', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: makeRecipeDetail({ ownerId: 'usr_owner' }) }));
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.queryByRole('button', { name: 'Edit recipe' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete recipe' })).toBeNull();
    });
});

describe('RecipeDetailScreen — owner actions', () => {
    beforeEach(() => {
        useRecipeMock.mockReturnValue(
            detailResult({ data: makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private' }) }),
        );
        useUserProfileMock.mockReturnValue(profile('usr_1', 'premium'));
    });

    it('opens the editor and version history from the owner actions', () => {
        const onEdit = vi.fn();
        const onViewVersions = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onEdit={onEdit} onViewVersions={onViewVersions} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit recipe' }));
        fireEvent.click(screen.getByRole('button', { name: 'Version history' }));

        expect(onEdit).toHaveBeenCalledWith('rec_1');
        expect(onViewVersions).toHaveBeenCalledWith('rec_1');
    });

    it('confirms and runs a delete, then navigates away', () => {
        const mutate = vi.fn((_id: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useDeleteRecipeMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>({ mutate: mutate as never }));
        const onDeleted = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onDeleted={onDeleted} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(mutate).toHaveBeenCalledWith('rec_1', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(onDeleted).toHaveBeenCalledTimes(1);
    });

    it('changes visibility for a premium owner', () => {
        const mutate = vi.fn();
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ mutate: mutate as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('radio', { name: 'Public' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', visibility: 'public' });
    });
});

describe('RecipeDetailScreen — visibility gating', () => {
    it('shows the upgrade reason for a free-tier owner', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: makeRecipeDetail({ ownerId: 'usr_1' }) }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'free'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByText('Upgrade to premium to make a recipe private.')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — clone', () => {
    it('clones a public recipe the viewer does not own and reports the new id', () => {
        const cloned = makeRecipeDetail({ id: 'rec_clone' });
        useRecipeMock.mockReturnValue(
            detailResult({ data: makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_owner', visibility: 'public' }) }),
        );
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));
        const mutate = vi.fn((_id: string, options?: { onSuccess?: (recipe: typeof cloned) => void }) =>
            options?.onSuccess?.(cloned),
        );
        useCloneRecipeMock.mockReturnValue(mutation<ReturnType<typeof useCloneRecipe>>({ mutate: mutate as never }));
        const onCloned = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onCloned={onCloned} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

        expect(mutate).toHaveBeenCalledWith('rec_1', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(onCloned).toHaveBeenCalledWith('rec_clone');
    });
});
