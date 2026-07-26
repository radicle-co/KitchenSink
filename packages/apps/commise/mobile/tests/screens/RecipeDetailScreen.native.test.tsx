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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { NotFoundError } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useRecipe,
    useSetRecipeRating,
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
    useSetRecipeRating: vi.fn(),
    useDeleteRecipeRating: vi.fn(),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: vi.fn(),
}));

const useRecipeMock = vi.mocked(useRecipe);
const useDeleteRecipeMock = vi.mocked(useDeleteRecipe);
const useSetRecipeVisibilityMock = vi.mocked(useSetRecipeVisibility);
const useCloneRecipeMock = vi.mocked(useCloneRecipe);
const useSetRecipeRatingMock = vi.mocked(useSetRecipeRating);
const useDeleteRecipeRatingMock = vi.mocked(useDeleteRecipeRating);
const useUserProfileMock = vi.mocked(useUserProfile);

function detailResult(overrides: Partial<ReturnType<typeof useRecipe>> = {}): ReturnType<typeof useRecipe> {
    return { isLoading: false, isError: false, data: undefined, ...overrides } as unknown as ReturnType<
        typeof useRecipe
    >;
}

function mutation<T>(overrides: Partial<T> = {}): T {
    // `error: null` + a no-op `reset` mirror an idle TanStack mutation — the screen reads `.error` (B17
    // banners) and calls `.reset()` on a recipeId change (leak scrub).
    return { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn(), ...overrides } as unknown as T;
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
    useSetRecipeRatingMock.mockReset();
    useDeleteRecipeRatingMock.mockReset();
    useUserProfileMock.mockReset();
    useDeleteRecipeMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>());
    useSetRecipeVisibilityMock.mockReturnValue(mutation<ReturnType<typeof useSetRecipeVisibility>>());
    useCloneRecipeMock.mockReturnValue(mutation<ReturnType<typeof useCloneRecipe>>());
    useSetRecipeRatingMock.mockReturnValue(mutation<ReturnType<typeof useSetRecipeRating>>());
    useDeleteRecipeRatingMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipeRating>>());
    useUserProfileMock.mockReturnValue(profile(undefined));
});

describe('RecipeDetailScreen — loading state', () => {
    it('shows the localized loading indicator while the query is loading', () => {
        useRecipeMock.mockReturnValue(detailResult({ isLoading: true }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
    });

    it('keeps loading while the recipe is ready but the viewer profile is still in flight', () => {
        // Regression guard for the owner-action pop-in: with the recipe resolved but the PROFILE query
        // still loading, the screen must NOT paint the detail yet. Painting here would render it WITHOUT the
        // owner-gated actions (edit/delete/visibility) and then pop them in when the profile lands — a layout
        // shift that makes a fast (or automated) tapper race a moving target. The screen must stay loading
        // until BOTH sources resolve. Fails against a gate that only checks the recipe query.
        useRecipeMock.mockReturnValue(detailResult({ data: makeRecipeDetail({ title: 'Weeknight Pasta' }) }));
        useUserProfileMock.mockReturnValue({ isLoading: true, data: undefined } as unknown as ReturnType<
            typeof useUserProfile
        >);

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Weeknight Pasta' })).toBeNull();
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

    it('hides owner actions (including the More menu) from a non-owner', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: makeRecipeDetail({ ownerId: 'usr_owner' }) }));
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.queryByRole('button', { name: 'Edit recipe' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete recipe' })).toBeNull();
    });

    it('pre-selects the viewer’s own rating from viewerRating and reveals remove, keeping the community score distinct', () => {
        // FR-013: a non-owner viewing a recipe they have already rated 3 sees the rating INPUT pre-selected to 3
        // and the remove affordance revealed on load, driven by the detail's `viewerRating` — while the community
        // `averageRating` (4.5) stays the displayed social-proof score. Mutation lens: if the screen stops passing
        // `viewerRating` through, the selection is empty and both assertions below fail.
        useRecipeMock.mockReturnValue(
            detailResult({
                data: makeRecipeDetail({ ownerId: 'usr_owner', viewerRating: 3, averageRating: 4.5, ratingCount: 12 }),
            }),
        );
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('radio', { name: 'Rate 3 stars', checked: true })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove my rating' })).toBeTruthy();
        // The community aggregate is shown independently — the viewer's 3 has not replaced the community 4.5.
        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('shows no rating input on the viewer’s OWN recipe (Sc8), and viewerRating is absent there', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: makeRecipeDetail({ ownerId: 'usr_viewer' }) }));
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.queryByRole('radiogroup', { name: 'Your rating' })).toBeNull();
        expect(screen.getByText('You can’t rate your own recipe.')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — owner actions', () => {
    beforeEach(() => {
        useRecipeMock.mockReturnValue(
            detailResult({ data: makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private' }) }),
        );
        useUserProfileMock.mockReturnValue(profile('usr_1', 'premium'));
    });

    it('opens the editor (primary) and version history (behind More) from the owner actions', () => {
        const onEdit = vi.fn();
        const onViewVersions = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onEdit={onEdit} onViewVersions={onViewVersions} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit recipe' }));
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('button', { name: 'Version history' }));

        expect(onEdit).toHaveBeenCalledWith('rec_1');
        expect(onViewVersions).toHaveBeenCalledWith('rec_1');
    });

    it('invokes onFilterByTag when a tag chip is tapped (D6)', () => {
        useRecipeMock.mockReturnValue(
            detailResult({ data: makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private', tags: ['grill'] }) }),
        );
        const onFilterByTag = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onFilterByTag={onFilterByTag} />);
        fireEvent.click(screen.getByLabelText('Find recipes tagged grill'));

        expect(onFilterByTag).toHaveBeenCalledWith('grill');
    });

    it('confirms and runs a delete, then navigates away', () => {
        const mutate = vi.fn((_id: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useDeleteRecipeMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>({ mutate: mutate as never }));
        const onDeleted = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onDeleted={onDeleted} />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Public' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', visibility: 'public' });
    });

    it('surfaces a failed delete inside the dialog, not a silent stop (B17)', () => {
        useDeleteRecipeMock.mockReturnValue(
            mutation<ReturnType<typeof useDeleteRecipe>>({ error: new Error('network down') as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }));

        expect(screen.getByText('We couldn’t delete this recipe. Please try again.')).toBeTruthy();
    });

    it('surfaces a failed visibility change on the toggle (B17: no silent snap-back)', () => {
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ error: new Error('network down') as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        expect(screen.getByText('We couldn’t change who can see this recipe. Please try again.')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — visibility gating', () => {
    it('shows the upgrade reason for a free-tier owner', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: makeRecipeDetail({ ownerId: 'usr_1' }) }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'free'));

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        expect(screen.getByText('Upgrade to premium to make a recipe private.')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — rating error does not leak across a recipeId change (mutation lens)', () => {
    it('scrubs a failed/pending rating write when the screen is reused with a new recipeId', () => {
        // A `replace`/deep-link reuses THIS screen instance with a new `recipeId` param, so the rating
        // `useMutation` instances survive. A stateful double models real TanStack: `reset()` clears the
        // observer, and every render reads the CURRENT state. If the screen fails to reset on the id change,
        // the previous recipe's error and busy state leak onto the new one. Mutation lens: drop the `.reset()`
        // calls and this test goes red.
        const setRatingState = {
            mutate: vi.fn(),
            isPending: true,
            error: new NotFoundError('Resource not found') as Error | null,
            reset: vi.fn(() => {
                setRatingState.isPending = false;
                setRatingState.error = null;
            }),
        };
        const deleteRatingState = { mutate: vi.fn(), isPending: false, error: null as Error | null, reset: vi.fn() };
        useSetRecipeRatingMock.mockImplementation(
            () => ({ ...setRatingState }) as unknown as ReturnType<typeof useSetRecipeRating>,
        );
        useDeleteRecipeRatingMock.mockImplementation(
            () => ({ ...deleteRatingState }) as unknown as ReturnType<typeof useDeleteRecipeRating>,
        );

        // A non-owner viewing a rateable public recipe — the rating control (and its error) render.
        useRecipeMock.mockReturnValue(
            detailResult({ data: makeRecipeDetail({ ownerId: 'usr_owner', visibility: 'public' }) }),
        );
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        const { rerender } = render(<RecipeDetailScreen recipeId="rec_1" />);

        // Recipe A: the failed write is surfaced and the input reports it is busy.
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('This recipe isn’t available.')).toBeTruthy();
        expect(screen.getByText('Saving your rating…')).toBeTruthy();

        // Reuse the screen for recipe B WITHOUT placing a new rating (deep-link/replace path).
        rerender(<RecipeDetailScreen recipeId="rec_2" />);

        // Both rating mutations are reset, so neither the error nor the pending state reaches recipe B.
        expect(setRatingState.reset).toHaveBeenCalled();
        expect(deleteRatingState.reset).toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText('This recipe isn’t available.')).toBeNull();
        expect(screen.queryByText('Saving your rating…')).toBeNull();
    });
});

describe('RecipeDetailScreen — clone', () => {
    it('groups the Clone action with the version + visibility badges in ONE footer row (C3)', () => {
        useRecipeMock.mockReturnValue(
            detailResult({
                data: makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_owner', visibility: 'public', currentVersion: 2 }),
            }),
        );
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        const footer = screen.getByLabelText('Recipe status');
        expect(within(footer).getByRole('button', { name: 'Clone' })).toBeTruthy();
        expect(within(footer).getByText('v2')).toBeTruthy();
        expect(within(footer).getByText('Public')).toBeTruthy();
    });

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

    it('does NOT render Clone for the viewer’s OWN public recipe (D7 parity — matches web)', () => {
        // D7: the shared `canClone` predicate excludes the owner even on a PUBLIC recipe. Regression guard for
        // the drift this task fixes — web previously ignored ownership here while mobile checked it; now both
        // platforms read the SAME predicate, so an inverted/dropped ownership check fails this test.
        useRecipeMock.mockReturnValue(
            detailResult({ data: makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', visibility: 'public' }) }),
        );
        useUserProfileMock.mockReturnValue(profile('usr_1', 'premium'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.queryByRole('button', { name: 'Clone' })).toBeNull();
    });
});
