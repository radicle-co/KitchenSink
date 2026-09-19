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
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';

import { computedContrast, renderWithRecipeClient } from '@commise/test-utils';
import { palette } from '@commise/ui';
import { NotFoundError, recipeQueries, recipeServiceKeys } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { RecipeDetailScreen } from '../../src/screens/RecipeDetailScreen.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

// The READ goes through the real hooks over a network-guarded fake client (the recipe is SEEDED into the query cache,
// so a settled suspense read renders synchronously); only the mutations are doubles.
vi.mock('@kitchensink/recipe-service-client/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@kitchensink/recipe-service-client/hooks')>()),
    useDeleteRecipe: vi.fn(),
    useSetRecipeVisibility: vi.fn(),
    useCloneRecipe: vi.fn(),
    useSetRecipeRating: vi.fn(),
    useDeleteRecipeRating: vi.fn(),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: vi.fn(),
}));

const useDeleteRecipeMock = vi.mocked(useDeleteRecipe);
const useSetRecipeVisibilityMock = vi.mocked(useSetRecipeVisibility);
const useCloneRecipeMock = vi.mocked(useCloneRecipe);
const useSetRecipeRatingMock = vi.mocked(useSetRecipeRating);
const useDeleteRecipeRatingMock = vi.mocked(useDeleteRecipeRating);
const useUserProfileMock = vi.mocked(useUserProfile);

/** The fake client and request cache each test renders over. */
let client: ReturnType<typeof createFakeRecipeServiceClient>;
let queryClient: QueryClient;

/** Put a SETTLED recipe in the cache under its id, so the suspense read renders it with no fetch. */
function seedRecipe(recipe: RecipeDetail, id = 'rec_1'): void {
    queryClient.setQueryData(recipeQueries(client).detail(id).queryKey, recipe);
}

/** Render over this test's client and cache — the providers a real app root mounts. */
function render(ui: ReactElement) {
    return renderWithRecipeClient(ui, client, { queryClient });
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
    client = createFakeRecipeServiceClient();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // Unseeded, a read stays pending — the loading state.
    vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));
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
        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
    });

    it('announces WHAT is loading and captions it visibly (no bare spinner)', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        const label = mobileMessages.en.recipes.detailLoading;
        // A named `progressbar`, not an anonymous spinning shape — and the same context shown on screen.
        expect(screen.getByRole('progressbar', { name: label })).toBeTruthy();
        expect(screen.getByText(label)).toBeTruthy();
    });

    it('keeps loading while the recipe is ready but the viewer profile is still in flight', () => {
        // Regression guard for the owner-action pop-in: with the recipe resolved but the PROFILE query
        // still loading, the screen must NOT paint the detail yet. Painting here would render it WITHOUT the
        // owner-gated actions (edit/delete/visibility) and then pop them in when the profile lands — a layout
        // shift that makes a fast (or automated) tapper race a moving target. The screen must stay loading
        // until BOTH sources resolve. Fails against a gate that only checks the recipe query.
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));
        useUserProfileMock.mockReturnValue({ isLoading: true, data: undefined } as unknown as ReturnType<
            typeof useUserProfile
        >);

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Weeknight Pasta' })).toBeNull();
    });
});

describe('RecipeDetailScreen — a failed refresh of the recipe on screen', () => {
    it('⛔ keeps the recipe and says the refresh failed, never the load error, and Try again refetches', async () => {
        seedRecipe(makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta' }));
        const getRecipe = vi
            .spyOn(client, 'getRecipeById')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta' }));

        render(<RecipeDetailScreen recipeId="rec_1" />);
        // A refresh of the settled recipe fails: a suspense read throws only when it has NO data, so it keeps it.
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipe('rec_1'), exact: true });
        });

        // TanStack batches observer notifications onto a later tick, so the notice is awaited, not read synchronously.
        expect((await screen.findAllByText('We couldn’t refresh this recipe.')).length).toBeGreaterThan(0);
        expect(screen.getByRole('heading', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.queryByText('We couldn’t load this recipe.')).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });
        expect(getRecipe).toHaveBeenCalledTimes(2);
    });
});

describe('RecipeDetailScreen — error state', () => {
    it('shows an alert with a retry that refetches when the load fails', async () => {
        const getRecipe = vi
            .spyOn(client, 'getRecipeById')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta' }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByText('We couldn’t load this recipe.')).toBeTruthy();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });
        expect(await screen.findByRole('heading', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(getRecipe).toHaveBeenCalledTimes(2);
    });

    it('says the recipe was not found, with NO retry, for a 404 — web parity', async () => {
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError());

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(await screen.findByText('We couldn’t find that recipe.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('shows the generic error, with a way out, for an id that cannot name a recipe', () => {
        const getRecipe = vi.spyOn(client, 'getRecipeById');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(<RecipeDetailScreen recipeId="" />);

        expect(getRecipe).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
        expect(screen.queryByText('We couldn’t find that recipe.')).toBeNull();
    });
});

describe('RecipeDetailScreen — ready state', () => {
    it('renders the recipe detail view once the recipe resolves', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta', description: 'Fast and cozy.' }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('heading', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByText('Fast and cozy.')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders and wires the back affordance only when onBack is provided', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));
        const onBack = vi.fn();

        const { rerender } = render(<RecipeDetailScreen recipeId="rec_1" onBack={onBack} />);
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(onBack).toHaveBeenCalledTimes(1);

        rerender(<RecipeDetailScreen recipeId="rec_1" />);
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('keeps the back affordance’s label WCAG-AA legible on the screen’s sand background', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        render(<RecipeDetailScreen recipeId="rec_1" onBack={vi.fn()} />);

        // A bare text control on the screen container's `sand` background: seafoam scored 3.73:1 there, under
        // the 4.5:1 body floor (SC 1.4.3). Web's equivalent back control takes the same token (§14).
        const label = within(screen.getByRole('button', { name: 'Back' })).getByText('Back');

        expect(computedContrast(label, { surface: palette.sand }), 'back control label').toBeGreaterThanOrEqual(4.5);
    });

    it('hides owner actions (including the More menu) from a non-owner', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_owner' }));
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
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_owner', viewerRating: 3, averageRating: 4.5, ratingCount: 12 }));
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('radio', { name: 'Rate 3 stars', checked: true })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove my rating' })).toBeTruthy();
        // The community aggregate is shown independently — the viewer's 3 has not replaced the community 4.5.
        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('shows no rating input on the viewer’s OWN recipe (Sc8), and viewerRating is absent there', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_viewer' }));
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.queryByRole('radiogroup', { name: 'Your rating' })).toBeNull();
        expect(screen.getByText('You can’t rate your own recipe.')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — owner actions', () => {
    beforeEach(() => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private' }));
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

    /**
     * ⛔ THE NATIVE HALF OF THE SAME RULE, and it needs its own test rather than trusting the web one: the
     * slot is an OPTIONAL `ReactNode` on a shared props interface, so a leaf that never renders it
     * typechecks perfectly and drops the controls silently. That is exactly the §14 class where parity of
     * EXISTENCE passes and parity of QUALITY does not.
     *
     * ⚠️ The mobile suite renders through DOM stubs (`@testing-library/react`, not the native renderer), so
     * `compareDocumentPosition` reads the real stubbed tree here just as it does on web — the ordering is
     * the one a `ScrollView` traverses. The screen's own comment used to justify the foot-of-screen position
     * by saying the ScrollView made those controls reachable; a scroll is what makes them REACHABLE AT ALL,
     * not what makes them reachable WELL.
     */
    it('⛔ puts Edit ABOVE the recipe body, not at the foot of an unbounded scroll', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        const edit = screen.getByRole('button', { name: 'Edit recipe' });
        const ingredients = screen.getByText('Ingredients');

        expect(edit.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        const more = screen.getByRole('button', { name: 'More' });
        expect(more.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('invokes onFilterByTag when a tag chip is tapped (D6)', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private', tags: ['grill'] }));
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

describe('RecipeDetailScreen — owner actions are design-system Buttons (U8)', () => {
    beforeEach(() => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'premium'));
    });

    /** The DS `Button`'s visible pill — the element inside the accessible button that paints the surface. */
    const pillOf = (name: string): HTMLElement => {
        const button = screen.getByRole('button', { name });
        const pill = button.firstElementChild;
        expect(pill).not.toBeNull();

        return pill as HTMLElement;
    };

    /**
     * ⛔ THE CONFIRMATION MUST BE AN OVERLAY, NOT A BLOCK IN THE SCROLL — and this guards a defect that
     * actually shipped in this diff before review caught it. `RecipeDeleteDialog.native` used to be an inline
     * block: it rendered wherever it sat in this screen's tree. When the owner actions moved into the detail's
     * title band, the Delete trigger went with them and the card stayed the LAST CHILD of the ScrollView — so
     * tapping Delete opened a confirmation below the hero, every ingredient, every step and the rating block.
     * Off-screen. No visible response to a destructive action.
     *
     * ⚠️ The web leaf never had this failure, because Radix portals its `AlertDialog`. That asymmetry is the
     * trap: a `.native.tsx` can be a faithful 1:1 port of the web markup, pass every §14 parity check, and
     * still be broken — which is precisely the web→mobile translation gap §3.6 exists for.
     *
     * ⚠️ This asserts the SCRIM, not a margin. An earlier fix gave the card `marginHorizontal` to restore the
     * inset a deleted wrapper had been supplying; that treated the symptom (the card touched the screen edges)
     * and left the cause (it was in the scroll at all). The backdrop supersedes it — the inset now comes from
     * the overlay's own padding, which cannot be stranded by deleting a wrapper. Only an overlay paints a
     * scrim, so the background colour is the load-bearing half of this assertion and the padding is the half
     * that pins the gutter.
     */
    it('⛔ renders the delete confirmation as an overlay, not a block at the foot of the scroll', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('button', { name: mobileMessages.en.recipes.deleteAction }));

        const backdrop = screen.getByRole('alert').parentElement;

        if (backdrop === null) {
            throw new Error('the confirmation card has no parent, so it cannot be inside a modal backdrop');
        }

        const style = window.getComputedStyle(backdrop);

        // The scrim: only an overlay paints one. An inline card in the scroll has a transparent parent.
        expect(style.backgroundColor).toBe('rgba(44, 62, 80, 0.4)');
        // 16pt, the screen's content gutter — supplied structurally by the overlay rather than by the card.
        expect(style.padding).toBe('16px');
    });

    it('labels every owner action from the localized dictionary (no literals)', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        // Resolved from `mobileMessages.en.recipes`, so a dropped key fails here rather than shipping a blank
        // or English-only control.
        const t = mobileMessages.en.recipes;
        expect(screen.getByRole('button', { name: t.editAction })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        expect(screen.getByRole('button', { name: t.versionsAction })).toBeTruthy();
        expect(screen.getByRole('button', { name: t.deleteAction })).toBeTruthy();
    });

    it('paints the primary Edit action with the brand CTA gradient (the DS primary tier)', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        // The DS native `Button` primary surface IS the brand `LinearGradient` — a hand-rolled solid
        // `Pressable` has no gradient node, so this fails against the pre-U8 markup.
        const edit = screen.getByRole('button', { name: mobileMessages.en.recipes.editAction });
        expect(edit.querySelector('[data-commise-stub="linear-gradient"]')).not.toBeNull();
    });

    it('paints the destructive Delete action as the DS destructive tier (error-toned, not a bare label)', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        const pill = pillOf(mobileMessages.en.recipes.deleteAction);
        const style = window.getComputedStyle(pill);
        // The `palette.error` border on a real white surface — the destructive tier's flat pill. Read from the
        // TOKEN: the literal `rgb(225, 112, 85)` froze this at the pre-#113 error and made a palette move look
        // like a regression in the button tier.
        expect(style.borderTopColor).toBe(rgb(palette.error));
        expect(style.backgroundColor).toBe('rgb(255, 255, 255)');
        // Not the gradient tier.
        expect(
            screen
                .getByRole('button', { name: mobileMessages.en.recipes.deleteAction })
                .querySelector('[data-commise-stub="linear-gradient"]'),
        ).toBeNull();
    });

    it('gives every owner action a 44pt touch target', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        const t = mobileMessages.en.recipes;

        for (const name of [t.editAction, t.versionsAction, t.deleteAction]) {
            expect(window.getComputedStyle(pillOf(name)).minHeight).toBe('44px');
        }
    });
});

describe('RecipeDetailScreen — visibility gating', () => {
    it('shows the upgrade reason for a free-tier owner', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'free'));

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        expect(screen.getByText('Upgrade to premium to make a recipe private.')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — rating error does not leak across a recipeId change (mutation lens)', () => {
    it('a failed/pending rating write cannot reach the next recipe, because the id change remounts the detail', () => {
        // REWRITTEN for the suspense conversion. A `replace`/deep-link reuses THIS screen instance with a new
        // `recipeId`, and the old screen carried every mutation instance across it, resetting each by hand. The
        // settled view is now KEYED on the id, so the new recipe mounts fresh hook instances. The doubles model a real
        // `useMutation` observer: their state belongs to the mounted INSTANCE, so the first mount is mid-flight with
        // a prior failure and any later mount is idle — without the remount, recipe B would read A's instance.
        let setRatingInstances = 0;
        let deleteRatingInstances = 0;
        useSetRecipeRatingMock.mockImplementation(() => {
            const [instance] = useState(() => (setRatingInstances += 1));

            return (instance === 1
                ? { mutate: vi.fn(), isPending: true, error: new NotFoundError('Resource not found'), reset: vi.fn() }
                : { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }) as unknown as ReturnType<
                typeof useSetRecipeRating
            >;
        });
        useDeleteRecipeRatingMock.mockImplementation(() => {
            useState(() => (deleteRatingInstances += 1));

            return mutation<ReturnType<typeof useDeleteRecipeRating>>();
        });

        // A non-owner viewing a rateable public recipe — the rating control (and its error) render.
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_owner', visibility: 'public' }));
        seedRecipe(makeRecipeDetail({ id: 'rec_2', ownerId: 'usr_owner', visibility: 'public' }), 'rec_2');
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        const { rerender } = render(<RecipeDetailScreen recipeId="rec_1" />);

        // Recipe A: the failed write is surfaced and the input reports it is busy.
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('This recipe isn’t available.')).toBeTruthy();
        expect(screen.getByText('Saving your rating…')).toBeTruthy();

        // Reuse the screen for recipe B WITHOUT placing a new rating (deep-link/replace path).
        rerender(<RecipeDetailScreen recipeId="rec_2" />);

        expect(deleteRatingInstances).toBe(2);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText('This recipe isn’t available.')).toBeNull();
        expect(screen.queryByText('Saving your rating…')).toBeNull();
    });
});

describe('RecipeDetailScreen — clone', () => {
    it('groups the Clone action with the version + visibility badges in ONE footer row (C3)', () => {
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_owner', visibility: 'public', currentVersion: 2 }));
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        const footer = screen.getByLabelText('Recipe status');
        expect(within(footer).getByRole('button', { name: 'Clone' })).toBeTruthy();
        expect(within(footer).getByText('v2')).toBeTruthy();
        expect(within(footer).getByText('Public')).toBeTruthy();
    });

    it('clones a public recipe the viewer does not own and reports the new id', () => {
        const cloned = makeRecipeDetail({ id: 'rec_clone' });
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_owner', visibility: 'public' }));
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
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'premium'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.queryByRole('button', { name: 'Clone' })).toBeNull();
    });
});

/** A design-token hex (`#RRGGBB`) as the `rgb(r, g, b)` string a resolved computed style reports. */
function rgb(hex: string): string {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

    return `rgb(${channels.join(', ')})`;
}
