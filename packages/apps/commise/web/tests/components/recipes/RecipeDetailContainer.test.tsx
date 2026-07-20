/**
 * Component tests for RecipeDetailContainer (T09x web recipe-detail wiring + T068/T074/T075 action
 * composition). Covers every state the container renders — loading, ready (delegates to the shared
 * RecipeDetailView), generic error (with retry), and a distinct not-found affordance (no retry) — plus the
 * owner-gated delete (T068) and visibility (T074) controls and the public-recipe clone action (T075). The
 * recipe hook, the mutation hooks, the Next router/params, and Clerk `useAuth` are mocked, so no backend,
 * QueryClient, or Clerk provider is needed; the real `isNotFoundError` guard classifies the error.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeDetailContainer } from '@/components/recipes/RecipeDetailContainer';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const {
    useRecipeMock,
    useDeleteRecipeMock,
    useSetRecipeVisibilityMock,
    useCloneRecipeMock,
    useSetRecipeRatingMock,
    useDeleteRecipeRatingMock,
    useAuthMock,
    useUserProfileMock,
    refetchMock,
    deleteMutateMock,
    setVisibilityMutateMock,
    cloneMutateMock,
    setRatingMutateMock,
    deleteRatingMutateMock,
    pushMock,
} = vi.hoisted(() => ({
    useRecipeMock: vi.fn(),
    useDeleteRecipeMock: vi.fn(),
    useSetRecipeVisibilityMock: vi.fn(),
    useCloneRecipeMock: vi.fn(),
    useSetRecipeRatingMock: vi.fn(),
    useDeleteRecipeRatingMock: vi.fn(),
    useAuthMock: vi.fn(),
    useUserProfileMock: vi.fn(),
    refetchMock: vi.fn(),
    deleteMutateMock: vi.fn(),
    setVisibilityMutateMock: vi.fn(),
    cloneMutateMock: vi.fn(),
    setRatingMutateMock: vi.fn(),
    deleteRatingMutateMock: vi.fn(),
    pushMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: useRecipeMock,
    useDeleteRecipe: useDeleteRecipeMock,
    useSetRecipeVisibility: useSetRecipeVisibilityMock,
    useCloneRecipe: useCloneRecipeMock,
    useSetRecipeRating: useSetRecipeRatingMock,
    useDeleteRecipeRating: useDeleteRecipeRatingMock,
}));

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: useUserProfileMock,
}));

/** Build a profile-query stub carrying only the tier the visibility gate reads. */
function profileWithTier(subscriptionTier: 'free' | 'premium') {
    return { data: { account: { subscriptionTier } } };
}

vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en', id: 'rec_1' }),
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('@clerk/nextjs', () => ({
    useAuth: useAuthMock,
}));

/** The app-user ULID that matches the default fixture's `ownerId` — the signed-in owner. */
const OWNER_ID = 'usr_1';

/** Register the default hook returns every test relies on (a signed-in owner, idle mutations). */
beforeEach(() => {
    useAuthMock.mockReturnValue({ sessionClaims: { external_id: OWNER_ID } });
    // Default the viewer to the free tier; premium-specific tests override this.
    useUserProfileMock.mockReturnValue(profileWithTier('free'));

    // Mutation mocks invoke `onSuccess` synchronously so the container's navigation wiring is exercised.
    deleteMutateMock.mockImplementation((_id: string, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
    });
    cloneMutateMock.mockImplementation(
        (_id: string, options?: { onSuccess?: (created: ReturnType<typeof makeRecipeDetail>) => void }) => {
            options?.onSuccess?.(makeRecipeDetail({ id: 'rec_clone' }));
        },
    );

    // Rating mutations invoke `onSuccess` synchronously so the container's selection wiring is exercised.
    setRatingMutateMock.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    deleteRatingMutateMock.mockImplementation((_id: string, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );

    useDeleteRecipeMock.mockReturnValue({ mutate: deleteMutateMock, isPending: false });
    useSetRecipeVisibilityMock.mockReturnValue({ mutate: setVisibilityMutateMock, isPending: false });
    useCloneRecipeMock.mockReturnValue({ mutate: cloneMutateMock, isPending: false });
    useSetRecipeRatingMock.mockReturnValue({ mutate: setRatingMutateMock, isPending: false, error: null });
    useDeleteRecipeRatingMock.mockReturnValue({ mutate: deleteRatingMutateMock, isPending: false, error: null });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('RecipeDetailContainer', () => {
    describe('fetch states', () => {
        it('renders the loading state while the query is pending', () => {
            useRecipeMock.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: refetchMock });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeInTheDocument();
        });

        it('renders the recipe detail view when the recipe loads', () => {
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ title: 'Weeknight Pasta' }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('heading', { level: 1, name: 'Weeknight Pasta' })).toBeInTheDocument();
        });

        it('renders a generic error with retry when the load fails', async () => {
            const user = userEvent.setup();
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: true,
                error: new Error('network down'),
                data: undefined,
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText(/couldn.t load this recipe/i)).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Try again' }));

            expect(refetchMock).toHaveBeenCalledTimes(1);
        });

        it('renders a distinct not-found message with no retry for a 404', () => {
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: true,
                error: new NotFoundError(),
                data: undefined,
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="missing" />);

            expect(screen.getByText(/couldn.t find that recipe/i)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
        });
    });

    describe('delete (T068) — owner only', () => {
        it('opens the confirmation dialog, confirms, deletes, and navigates to the recipe list', async () => {
            const user = userEvent.setup();
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, title: 'Weeknight Pasta' }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            // The dialog is closed until the owner triggers it.
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Delete recipe' }));

            const dialog = screen.getByRole('alertdialog');
            expect(dialog).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Delete' }));

            expect(deleteMutateMock).toHaveBeenCalledWith('rec_1', expect.any(Object));
            expect(pushMock).toHaveBeenCalledWith('/en/recipes');
        });

        it('does not render the delete control for a non-owner viewer', () => {
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.queryByRole('button', { name: 'Delete recipe' })).not.toBeInTheDocument();
        });
    });

    describe('detail entry points (W2/D1 dead-end + D7 clone gating)', () => {
        it('gives the OWNER Edit + Version-history links and NO Clone control', () => {
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            // D1: the web detail was a dead end — the owner could not reach the editor or the version history.
            expect(screen.getByRole('link', { name: 'Edit recipe' })).toHaveAttribute('href', '/en/recipes/rec_1/edit');
            expect(screen.getByRole('link', { name: 'Version history' })).toHaveAttribute(
                'href',
                '/en/recipes/rec_1/versions',
            );
            // D7: an owner never clones their own recipe — the control is ABSENT, not merely disabled.
            expect(screen.queryByRole('button', { name: 'Clone' })).not.toBeInTheDocument();
        });

        it('gives a NON-OWNER viewer of a public recipe Clone, and NO Edit/History links (D7 parity)', () => {
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('button', { name: 'Clone' })).toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Edit recipe' })).not.toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Version history' })).not.toBeInTheDocument();
        });
    });

    describe('visibility (T074) — owner only, premium-gated', () => {
        it('sets visibility to public when the owner selects the public option', async () => {
            const user = userEvent.setup();
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PRIVATE }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            await user.click(screen.getByRole('radio', { name: 'Public' }));

            expect(setVisibilityMutateMock).toHaveBeenCalledWith({ id: 'rec_1', visibility: RecipeVisibility.PUBLIC });
        });

        it('gates the private option off for a free-tier owner and explains why', () => {
            useUserProfileMock.mockReturnValue(profileWithTier('free'));
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('radio', { name: 'Private' })).toBeDisabled();
            expect(screen.getByText(/premium/i)).toBeInTheDocument();
        });

        it('enables the private option for a premium-tier owner', () => {
            useUserProfileMock.mockReturnValue(profileWithTier('premium'));
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('radio', { name: 'Private' })).toBeEnabled();
        });

        it('fails safe (private gated off) while the profile is still loading', () => {
            useUserProfileMock.mockReturnValue({ data: undefined });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('radio', { name: 'Private' })).toBeDisabled();
        });
    });

    describe('clone (T075) — public recipes', () => {
        it('clones a public recipe and navigates to the new recipe', async () => {
            const user = userEvent.setup();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            const cloneButton = screen.getByRole('button', { name: 'Clone' });
            expect(cloneButton).toBeEnabled();

            await user.click(cloneButton);

            expect(cloneMutateMock).toHaveBeenCalledWith('rec_1', expect.any(Object));
            expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_clone');
        });

        it('shows the source attribution when the recipe carries one', () => {
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({
                    ownerId: OWNER_ID,
                    visibility: RecipeVisibility.PUBLIC,
                    sourceAttribution: 'Grandma’s cookbook',
                }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByText(/Grandma’s cookbook/)).toBeInTheDocument();
        });

        it('disables the clone action for a non-public recipe', () => {
            // The clone control only renders for a non-owner (D7); a private source keeps it disabled.
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PRIVATE }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled();
        });

        it('marks the clone action busy while the clone mutation is in flight', () => {
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            useCloneRecipeMock.mockReturnValue({ mutate: cloneMutateMock, isPending: true });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled();
        });
    });

    describe('rating (FR-013) — non-owner viewer', () => {
        /** A public recipe owned by someone else, so the viewer may rate it. */
        function renderRateable() {
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });
            render(<RecipeDetailContainer id="rec_1" />);
        }

        it('wires the rate mutation to THIS recipe id and the selected star value (Sc6, mutation lens)', async () => {
            const user = userEvent.setup();
            renderRateable();

            await user.click(screen.getByRole('radio', { name: 'Rate 4 stars' }));

            expect(setRatingMutateMock).toHaveBeenCalledWith({ id: 'rec_1', input: { stars: 4 } }, expect.any(Object));
        });

        it('re-rates to a new value, replacing the prior rating (Sc7)', async () => {
            const user = userEvent.setup();
            renderRateable();

            await user.click(screen.getByRole('radio', { name: 'Rate 4 stars' }));
            await user.click(screen.getByRole('radio', { name: 'Rate 2 stars' }));

            expect(setRatingMutateMock).toHaveBeenLastCalledWith(
                { id: 'rec_1', input: { stars: 2 } },
                expect.any(Object),
            );
        });

        it('reveals remove after rating and wires it to THIS recipe id (Sc10, mutation lens)', async () => {
            const user = userEvent.setup();
            renderRateable();

            // The remove affordance appears only once a rating is placed this session.
            expect(screen.queryByRole('button', { name: 'Remove my rating' })).not.toBeInTheDocument();
            await user.click(screen.getByRole('radio', { name: 'Rate 3 stars' }));
            await user.click(screen.getByRole('button', { name: 'Remove my rating' }));

            expect(deleteRatingMutateMock).toHaveBeenCalledWith('rec_1', expect.any(Object));
        });

        it('surfaces a not-found rating write as "not available", never "forbidden" (Sc9)', () => {
            useSetRecipeRatingMock.mockReturnValue({
                mutate: setRatingMutateMock,
                isPending: false,
                error: new NotFoundError('Resource not found'),
            });
            renderRateable();

            expect(screen.getByRole('alert')).toHaveTextContent('This recipe isn’t available.');
        });
    });

    describe('rating error does not leak across a client navigation (mutation lens)', () => {
        it('scrubs recipe A’s failed/pending rating write when the container navigates to recipe B', () => {
            // The App Router keeps THIS container mounted across `/recipes/A` → `/recipes/B` (same dynamic
            // segment), so the rating `useMutation` instances survive the navigation. A stateful double models
            // that: `reset()` clears the observer, and every render reads the CURRENT observer state — exactly
            // what real TanStack does. If the container fails to reset on the id change, recipe A's error and
            // busy state leak onto B. Mutation lens: drop the `.reset()` calls and this test goes red.
            const setRatingState = {
                mutate: setRatingMutateMock,
                isPending: true,
                error: new NotFoundError('Resource not found') as Error | null,
                reset: vi.fn(() => {
                    setRatingState.isPending = false;
                    setRatingState.error = null;
                }),
            };
            const deleteRatingState = {
                mutate: deleteRatingMutateMock,
                isPending: false,
                error: null as Error | null,
                reset: vi.fn(),
            };
            useSetRecipeRatingMock.mockImplementation(() => ({ ...setRatingState }));
            useDeleteRecipeRatingMock.mockImplementation(() => ({ ...deleteRatingState }));

            // A non-owner viewing a rateable public recipe — the rating control (and its error) render.
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                refetch: refetchMock,
            });

            const { rerender } = render(<RecipeDetailContainer id="rec_1" />);

            // Recipe A: the failed write is surfaced and the input is busy/disabled.
            expect(screen.getByRole('alert')).toHaveTextContent('This recipe isn’t available.');
            expect(screen.getByRole('radio', { name: 'Rate 3 stars' })).toBeDisabled();

            // Navigate to recipe B WITHOUT placing a new rating (the container instance is preserved).
            rerender(<RecipeDetailContainer id="rec_2" />);

            // Both rating mutations are reset, so neither A's error nor its pending state reaches B.
            expect(setRatingState.reset).toHaveBeenCalled();
            expect(deleteRatingState.reset).toHaveBeenCalled();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.queryByText('This recipe isn’t available.')).not.toBeInTheDocument();
            expect(screen.getByRole('radio', { name: 'Rate 3 stars' })).toBeEnabled();
        });
    });

    describe('rating (FR-013) — own recipe (Sc8, mutation lens)', () => {
        it('does NOT offer a rating input on the viewer’s own recipe, only the aggregate + a reason', () => {
            // The signed-in owner (default) viewing their own recipe.
            useRecipeMock.mockReturnValue({
                isLoading: false,
                isError: false,
                data: makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID }),
                refetch: refetchMock,
            });

            render(<RecipeDetailContainer id="rec_1" />);

            expect(screen.queryByRole('radiogroup', { name: 'Your rating' })).not.toBeInTheDocument();
            expect(screen.queryByRole('radio', { name: 'Rate 4 stars' })).not.toBeInTheDocument();
            expect(screen.getByText('You can’t rate your own recipe.')).toBeInTheDocument();
            expect(setRatingMutateMock).not.toHaveBeenCalled();
        });
    });
});
