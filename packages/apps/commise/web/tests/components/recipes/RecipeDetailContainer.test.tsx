/**
 * Component tests for RecipeDetailContainer (T09x web recipe-detail wiring + T068/T074/T075 action
 * composition). Covers every state the container renders — loading, ready (delegates to the shared
 * RecipeDetailView), generic error (with retry), and a distinct not-found affordance (no retry) — plus the
 * owner-gated delete (T068) and visibility (T074) controls and the public-recipe clone action (T075).
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam for `useRecipe` / `useDeleteRecipe` / `useSetRecipeVisibility` / `useCloneRecipe`:
 * `renderWithRecipeClient` mounts the container through the REAL hooks over a real, network-guarded
 * `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with type-checked
 * `vi.spyOn(client, '<method>')`. `useSetRecipeRating` / `useDeleteRecipeRating` stay a narrow, type-checked
 * module mock for the WHOLE file (see the `vi.mock` factory below for why), each double built by the
 * `setRatingResult`/`deleteRatingResult` factories below as a COMPLETE, individually-valid
 * `MutationObserverResult` member — never a hand-forced combination TanStack itself cannot produce.
 * `@/hooks/useUserProfile`, `next/navigation` (`useParams`/`useRouter`), and `@clerk/nextjs` (`useAuth`) stay
 * mocked exactly as before — out of scope for this migration (only the recipe-service hooks are the seam
 * being migrated); the real `isNotFoundError` guard classifies the error.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SetRecipeRatingInput } from '@kitchensink/recipe-core';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { useDeleteRecipeRating, useSetRecipeRating } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeDetailContainer } from '@/components/recipes/RecipeDetailContainer';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { useAuthMock, useUserProfileMock, pushMock, setRatingMutateMock, deleteRatingMutateMock } = vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    useUserProfileMock: vi.fn(),
    pushMock: vi.fn(),
    setRatingMutateMock: vi.fn(),
    deleteRatingMutateMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@kitchensink/recipe-service-client/hooks')>()),
    // CP-6 T3 pragmatism clause: the rating-write hooks stay a narrow, type-checked mock for this file. One
    // test below ("does not leak across a client navigation") needs `setRating` mid-flight and `deleteRating`
    // carrying a prior failure AT THE SAME TIME to reach the container's "busy + error" rendering in one
    // render — reachable in principle (two independent mutations), but not from a single quick interaction in
    // a unit test — so the whole rating-write domain stays on one, consistent testing strategy rather than
    // splitting it across two. Every other hook (`useRecipe`, `useDeleteRecipe`, `useSetRecipeVisibility`,
    // `useCloneRecipe`) passes straight through to the real implementation, driven by `renderWithRecipeClient`
    // over a real, network-guarded client.
    useSetRecipeRating: vi.fn(),
    useDeleteRecipeRating: vi.fn(),
}));

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: useUserProfileMock,
}));

vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en', id: 'rec_1' }),
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('@clerk/nextjs', () => ({
    useAuth: useAuthMock,
}));

const useSetRecipeRatingMock = vi.mocked(useSetRecipeRating);
const useDeleteRecipeRatingMock = vi.mocked(useDeleteRecipeRating);

/** Build a profile-query stub carrying only the tier the visibility gate reads. */
function profileWithTier(subscriptionTier: 'free' | 'premium') {
    return { data: { account: { subscriptionTier } } };
}

/** The app-user ULID that matches the default fixture's `ownerId` — the signed-in owner. */
const OWNER_ID = 'usr_1';

/**
 * Fields every `UseMutationResult` needs beyond the four this container reads (`mutate`/`isPending`/`error`/
 * `reset`) — shared so the factories below build a genuinely COMPLETE, valid double (one full discriminated-
 * union member) rather than a partial object forced through an unsound `as unknown as` cast.
 */
const NEUTRAL_MUTATION_FIELDS = { context: undefined, failureCount: 0, isPaused: false, submittedAt: 0 } as const;

/** A placeholder `{id, input}` pair — the exact values are irrelevant, only the ERROR variant's `variables`
 * field needs to be present (and correctly shaped) at all; the container never reads it. */
const RATING_VARIABLES_PLACEHOLDER: { id: string; input: SetRecipeRatingInput } = { id: 'rec_1', input: { stars: 1 } };

/**
 * Build a `useSetRecipeRating` return value. IDLE by default (the state every test starts from); pass an
 * `error` for the settled-failed state, or `pending: true` for the in-flight state — each branch below is a
 * real, individually valid `MutationObserverResult` member (never a combination TanStack itself cannot hold).
 */
function setRatingResult(state: { error?: Error; pending?: boolean } = {}): ReturnType<typeof useSetRecipeRating> {
    const shared = {
        ...NEUTRAL_MUTATION_FIELDS,
        mutate: setRatingMutateMock,
        mutateAsync: vi.fn(),
        reset: vi.fn(),
    };

    if (state.error !== undefined) {
        return {
            ...shared,
            data: undefined,
            variables: RATING_VARIABLES_PLACEHOLDER,
            error: state.error,
            failureReason: state.error,
            isError: true,
            isIdle: false,
            isPending: false,
            isSuccess: false,
            status: 'error',
        };
    }

    if (state.pending === true) {
        return {
            ...shared,
            data: undefined,
            variables: RATING_VARIABLES_PLACEHOLDER,
            error: null,
            failureReason: null,
            isError: false,
            isIdle: false,
            isPending: true,
            isSuccess: false,
            status: 'pending',
        };
    }

    return {
        ...shared,
        data: undefined,
        variables: undefined,
        error: null,
        failureReason: null,
        isError: false,
        isIdle: true,
        isPending: false,
        isSuccess: false,
        status: 'idle',
    };
}

/** Build a `useDeleteRecipeRating` return value — same shape/rationale as {@link setRatingResult}. */
function deleteRatingResult(
    state: { error?: Error; pending?: boolean } = {},
): ReturnType<typeof useDeleteRecipeRating> {
    const shared = {
        ...NEUTRAL_MUTATION_FIELDS,
        mutate: deleteRatingMutateMock,
        mutateAsync: vi.fn(),
        reset: vi.fn(),
    };

    if (state.error !== undefined) {
        return {
            ...shared,
            data: undefined,
            variables: 'rec_1',
            error: state.error,
            failureReason: state.error,
            isError: true,
            isIdle: false,
            isPending: false,
            isSuccess: false,
            status: 'error',
        };
    }

    if (state.pending === true) {
        return {
            ...shared,
            data: undefined,
            variables: 'rec_1',
            error: null,
            failureReason: null,
            isError: false,
            isIdle: false,
            isPending: true,
            isSuccess: false,
            status: 'pending',
        };
    }

    return {
        ...shared,
        data: undefined,
        variables: undefined,
        error: null,
        failureReason: null,
        isError: false,
        isIdle: true,
        isPending: false,
        isSuccess: false,
        status: 'idle',
    };
}

/** Register the default hook returns every test relies on (a signed-in owner, idle rating mutations). */
beforeEach(() => {
    useAuthMock.mockReturnValue({ sessionClaims: { external_id: OWNER_ID } });
    // Default the viewer to the free tier; premium-specific tests override this.
    useUserProfileMock.mockReturnValue(profileWithTier('free'));
    useSetRecipeRatingMock.mockReturnValue(setRatingResult());
    useDeleteRecipeRatingMock.mockReturnValue(deleteRatingResult());
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('RecipeDetailContainer', () => {
    describe('fetch states', () => {
        it('renders the loading state while the query is pending', () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeInTheDocument();
        });

        it('renders the recipe detail view when the recipe loads', async () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ title: 'Weeknight Pasta' }));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            expect(await screen.findByRole('heading', { level: 1, name: 'Weeknight Pasta' })).toBeInTheDocument();
        });

        it('renders a generic error with retry when the load fails', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            const getRecipeSpy = vi.spyOn(client, 'getRecipeById').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            expect(await screen.findByRole('alert')).toBeInTheDocument();
            expect(screen.getByText(/couldn.t load this recipe/i)).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Try again' }));

            await vi.waitFor(() => expect(getRecipeSpy).toHaveBeenCalledTimes(2));
        });

        it('renders a distinct not-found message with no retry for a 404', async () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError());

            renderWithRecipeClient(<RecipeDetailContainer id="missing" />, client);

            expect(await screen.findByText(/couldn.t find that recipe/i)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
        });
    });

    describe('back (C1 wireframe parity)', () => {
        it('renders a Back link to the recipe list', async () => {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ id: 'rec_1' }));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/en/recipes');
        });
    });

    describe('delete (T068) — owner only, behind the More menu (C4)', () => {
        it('opens the confirmation dialog, confirms, deletes, and navigates to the recipe list', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, title: 'Weeknight Pasta' }),
            );
            const deleteSpy = vi.spyOn(client, 'deleteRecipe').mockResolvedValue(undefined);

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            // The dialog is closed until the owner triggers it.
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

            await user.click(await screen.findByRole('button', { name: 'More' }));
            await user.click(screen.getByRole('button', { name: 'Delete recipe' }));

            const dialog = screen.getByRole('alertdialog');
            expect(dialog).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Delete' }));

            expect(deleteSpy).toHaveBeenCalledWith('rec_1');
            await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes'));
        });

        it('does not render the delete control (or the More menu) for a non-owner viewer', async () => {
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            // Wait for the ready (non-owner) render before asserting the owner-only controls are absent.
            await screen.findByRole('button', { name: 'Clone' });
            expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Delete recipe' })).not.toBeInTheDocument();
        });

        it('surfaces a failed delete inside the dialog, not a silent stop (B17)', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, title: 'Weeknight Pasta' }),
            );
            vi.spyOn(client, 'deleteRecipe').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);
            await user.click(await screen.findByRole('button', { name: 'More' }));
            await user.click(screen.getByRole('button', { name: 'Delete recipe' }));
            await user.click(screen.getByRole('button', { name: 'Delete' }));

            expect(await screen.findByText('We couldn’t delete this recipe. Please try again.')).toBeInTheDocument();
        });
    });

    describe('visibility (T074) — change error (B17: no silent snap-back)', () => {
        it('surfaces a failed visibility change on the toggle', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PRIVATE }),
            );
            vi.spyOn(client, 'setRecipeVisibility').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            await user.click(await screen.findByRole('button', { name: 'More' }));
            await user.click(screen.getByRole('radio', { name: 'Public' }));

            expect(
                await screen.findByText('We couldn’t change who can see this recipe. Please try again.'),
            ).toBeInTheDocument();
        });
    });

    describe('interactivity wiring (W2/D4/D5/D6)', () => {
        it('deep-links a tapped tag to the visibility-scoped discover search (D6)', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, tags: ['grill'] }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            await user.click(await screen.findByRole('button', { name: 'Find recipes tagged grill' }));

            expect(pushMock).toHaveBeenCalledWith('/en/discover?tags=grill');
        });

        it('connects the cooking-progress hook to the view so an ingredient checkbox toggles (D5)', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_cook', ownerId: OWNER_ID }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_cook" />, client);

            const box = (await screen.findAllByRole('checkbox'))[0];
            const before = box?.getAttribute('aria-checked');
            await user.click(box as HTMLElement);

            // The container passes the store-backed toggle through; the checkbox reflects the flipped state.
            expect(box?.getAttribute('aria-checked')).not.toBe(before);
        });
    });

    describe('detail entry points (W2/D1 dead-end + D7 clone gating)', () => {
        it('gives the OWNER Edit + Version-history (behind More) and NO Clone control', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            // D1: the web detail was a dead end — the owner could not reach the editor or the version history.
            // C4: Edit stays a primary, always-visible control; Version history moves behind "More".
            expect(await screen.findByRole('link', { name: 'Edit recipe' })).toHaveAttribute(
                'href',
                '/en/recipes/rec_1/edit',
            );
            await user.click(screen.getByRole('button', { name: 'More' }));
            expect(screen.getByRole('link', { name: 'Version history' })).toHaveAttribute(
                'href',
                '/en/recipes/rec_1/versions',
            );
            // D7: an owner never clones their own recipe — the control is ABSENT, not merely disabled.
            expect(screen.queryByRole('button', { name: 'Clone' })).not.toBeInTheDocument();
        });

        it('gives a NON-OWNER viewer of a public recipe Clone, and NO Edit/History links (D7 parity)', async () => {
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            expect(await screen.findByRole('button', { name: 'Clone' })).toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Edit recipe' })).not.toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Version history' })).not.toBeInTheDocument();
        });
    });

    describe('visibility (T074) — owner only, premium-gated, behind the More menu (C4)', () => {
        it('sets visibility to public when the owner selects the public option', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PRIVATE }),
            );
            const setVisibilitySpy = vi
                .spyOn(client, 'setRecipeVisibility')
                .mockResolvedValue(
                    makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
                );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            await user.click(await screen.findByRole('button', { name: 'More' }));
            await user.click(screen.getByRole('radio', { name: 'Public' }));

            expect(setVisibilitySpy).toHaveBeenCalledWith('rec_1', RecipeVisibility.PUBLIC);
        });

        it('gates the private option off for a free-tier owner and explains why', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            useUserProfileMock.mockReturnValue(profileWithTier('free'));
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            await user.click(await screen.findByRole('button', { name: 'More' }));
            expect(screen.getByRole('radio', { name: 'Private' })).toBeDisabled();
            expect(screen.getByText(/premium/i)).toBeInTheDocument();
        });

        it('enables the private option for a premium-tier owner', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            useUserProfileMock.mockReturnValue(profileWithTier('premium'));
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            await user.click(await screen.findByRole('button', { name: 'More' }));
            expect(screen.getByRole('radio', { name: 'Private' })).toBeEnabled();
        });

        it('fails safe (private gated off) while the profile is still loading', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            useUserProfileMock.mockReturnValue({ data: undefined });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            await user.click(await screen.findByRole('button', { name: 'More' }));
            expect(screen.getByRole('radio', { name: 'Private' })).toBeDisabled();
        });
    });

    describe('clone (T075) — public recipes', () => {
        it('groups the Clone action with the version + visibility badges in ONE footer row (C3)', async () => {
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({
                    id: 'rec_1',
                    ownerId: OWNER_ID,
                    visibility: RecipeVisibility.PUBLIC,
                    currentVersion: 2,
                }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            const footer = await screen.findByRole('group', { name: 'Recipe status' });
            expect(within(footer).getByRole('button', { name: 'Clone' })).toBeInTheDocument();
            expect(within(footer).getByText('v2')).toBeInTheDocument();
            expect(within(footer).getByText('Public')).toBeInTheDocument();
        });

        it('clones a public recipe and navigates to the new recipe', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );
            vi.spyOn(client, 'cloneRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_clone' }));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            const cloneButton = await screen.findByRole('button', { name: 'Clone' });
            expect(cloneButton).toBeEnabled();

            await user.click(cloneButton);

            await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_clone'));
        });

        it('shows the source attribution when the recipe carries one', async () => {
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({
                    ownerId: OWNER_ID,
                    visibility: RecipeVisibility.PUBLIC,
                    sourceAttribution: 'Grandma’s cookbook',
                }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            expect(await screen.findByText(/Grandma’s cookbook/)).toBeInTheDocument();
        });

        it('disables the clone action for a non-public recipe', async () => {
            // The clone control only renders for a non-owner (D7); a private source keeps it disabled.
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PRIVATE }),
            );

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            expect(await screen.findByRole('button', { name: 'Clone' })).toBeDisabled();
        });

        it('marks the clone action busy while the clone mutation is in flight', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );
            vi.spyOn(client, 'cloneRecipe').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            await user.click(await screen.findByRole('button', { name: 'Clone' }));

            expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled();
        });
    });

    describe('rating (FR-013) — non-owner viewer', () => {
        /**
         * A public recipe owned by someone else, so the viewer may rate it. DA4 — the optimistic pre-select
         * lives in the (module-mocked) `useSetRecipeRating`/`useDeleteRecipeRating` hooks, not the container,
         * so `recipeOverrides.viewerRating` is how a test seeds "the viewer already rated N" straight off the
         * detail the real, client-backed `useRecipe` resolves. Awaits the ready render (the rating radiogroup)
         * before returning, so callers can interact synchronously.
         */
        async function renderRateable(
            recipeOverrides: Partial<ReturnType<typeof makeRecipeDetail>> = {},
        ): Promise<void> {
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({
                    id: 'rec_1',
                    ownerId: OWNER_ID,
                    visibility: RecipeVisibility.PUBLIC,
                    ...recipeOverrides,
                }),
            );
            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);
            await screen.findByRole('radiogroup', { name: 'Your rating' });
        }

        it('wires the rate mutation to THIS recipe id and the selected star value (Sc6, mutation lens)', async () => {
            const user = userEvent.setup();
            await renderRateable();

            await user.click(screen.getByRole('radio', { name: 'Rate 4 stars' }));

            expect(setRatingMutateMock).toHaveBeenCalledWith({ id: 'rec_1', input: { stars: 4 } });
        });

        it('re-rates to a new value, replacing the prior rating (Sc7)', async () => {
            const user = userEvent.setup();
            await renderRateable();

            await user.click(screen.getByRole('radio', { name: 'Rate 4 stars' }));
            await user.click(screen.getByRole('radio', { name: 'Rate 2 stars' }));

            expect(setRatingMutateMock).toHaveBeenLastCalledWith({ id: 'rec_1', input: { stars: 2 } });
        });

        it('does not reveal remove before the viewer has rated (no server viewerRating yet)', async () => {
            await renderRateable();

            expect(screen.queryByRole('button', { name: 'Remove my rating' })).not.toBeInTheDocument();
        });

        it('pre-selects from the server viewerRating, reveals remove, and wires it to THIS recipe id (Sc10, FR-013)', async () => {
            // DA4 — the optimistic hook layer keeps `recipe.viewerRating` fresh the instant a rate/remove
            // succeeds; the container itself no longer tracks any local selection, so this asserts the SAME
            // pre-select + reveal behavior straight off the detail's `viewerRating`.
            const user = userEvent.setup();
            await renderRateable({ viewerRating: 3 });

            expect(screen.getByRole('radio', { name: 'Rate 3 stars', checked: true })).toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: 'Remove my rating' }));

            expect(deleteRatingMutateMock).toHaveBeenCalledWith('rec_1');
        });

        it('surfaces a not-found rating write as "not available", never "forbidden" (Sc9)', async () => {
            useSetRecipeRatingMock.mockReturnValue(setRatingResult({ error: new NotFoundError('Resource not found') }));
            await renderRateable();

            expect(screen.getByRole('alert')).toHaveTextContent('This recipe isn’t available.');
        });
    });

    describe('rating error does not leak across a client navigation (mutation lens)', () => {
        it('scrubs recipe A’s failed/pending rating write when the container navigates to recipe B', async () => {
            // The App Router keeps THIS container mounted across `/recipes/A` → `/recipes/B` (same dynamic
            // segment), so the rating `useMutation` instances survive the navigation. A stateful double models
            // that: `reset()` clears the observer, and every render reads the CURRENT observer state — exactly
            // what real TanStack does. If the container fails to reset on the id change, recipe A's error and
            // busy state leak onto B. Mutation lens: drop the `.reset()` calls and this test goes red.
            //
            // The container reads `ratingError = setRating.error ?? deleteRating.error` and
            // `pending = setRating.isPending || deleteRating.isPending` — i.e. it independently ORs two SEPARATE
            // hook instances. A single mutation can never hold `isPending: true` and a truthy `error` at once
            // (TanStack clears `error` the instant a new attempt starts pending), but the PAIR legitimately can:
            // here `setRating` is genuinely mid-flight (a real `pending` member) while `deleteRating` genuinely
            // carries a prior failure (a real `error` member) — e.g. the viewer removed their rating, that
            // failed, and they are now re-rating. Both doubles are complete, individually valid
            // `MutationObserverResult` members (via the shared factories above), never a combination TanStack
            // itself cannot produce.
            let setRatingScrubbed = false;
            let deleteRatingScrubbed = false;
            const setRatingReset = vi.fn(() => {
                setRatingScrubbed = true;
            });
            const deleteRatingReset = vi.fn(() => {
                deleteRatingScrubbed = true;
            });
            useSetRecipeRatingMock.mockImplementation(() => ({
                ...(setRatingScrubbed ? setRatingResult() : setRatingResult({ pending: true })),
                reset: setRatingReset,
            }));
            useDeleteRecipeRatingMock.mockImplementation(() => ({
                ...(deleteRatingScrubbed
                    ? deleteRatingResult()
                    : deleteRatingResult({ error: new NotFoundError('Resource not found') })),
                reset: deleteRatingReset,
            }));

            // A non-owner viewing a rateable public recipe — the rating control (and its error) render.
            const client = createFakeRecipeServiceClient();
            useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(
                makeRecipeDetail({ ownerId: OWNER_ID, visibility: RecipeVisibility.PUBLIC }),
            );

            const { rerender } = renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            // Recipe A: the failed write is surfaced and the input is busy/disabled.
            expect(await screen.findByRole('alert')).toHaveTextContent('This recipe isn’t available.');
            expect(screen.getByRole('radio', { name: 'Rate 3 stars' })).toBeDisabled();

            // Navigate to recipe B WITHOUT placing a new rating (the container instance is preserved).
            rerender(<RecipeDetailContainer id="rec_2" />);

            // Both rating mutations are reset, so neither A's error nor its pending state reaches B.
            await vi.waitFor(() => expect(setRatingReset).toHaveBeenCalled());
            expect(deleteRatingReset).toHaveBeenCalled();
            expect(await screen.findByRole('radio', { name: 'Rate 3 stars' })).toBeEnabled();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.queryByText('This recipe isn’t available.')).not.toBeInTheDocument();
        });
    });

    describe('rating (FR-013) — own recipe (Sc8, mutation lens)', () => {
        it('does NOT offer a rating input on the viewer’s own recipe, only the aggregate + a reason', async () => {
            // The signed-in owner (default) viewing their own recipe.
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID }));

            renderWithRecipeClient(<RecipeDetailContainer id="rec_1" />, client);

            expect(await screen.findByText('You can’t rate your own recipe.')).toBeInTheDocument();
            expect(screen.queryByRole('radiogroup', { name: 'Your rating' })).not.toBeInTheDocument();
            expect(screen.queryByRole('radio', { name: 'Rate 4 stars' })).not.toBeInTheDocument();
            expect(setRatingMutateMock).not.toHaveBeenCalled();
        });
    });
});
