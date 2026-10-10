/**
 * Component tests for the mobile RecipeDetailScreen (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). The screen drives the shared native `RecipeDetailView` from the (mocked)
 * `useRecipe` query and composes the owner/viewer action blocks (delete, visibility, clone) plus edit and
 * version-history entry points, gated by ownership + tier from the (mocked) `useUserProfile`.
 *
 * Covers EVERY UI path: loading, error, ready, the back affordance, owner-only actions, the tier-gated
 * visibility option, the delete flow, and the clone action for a public recipe the viewer does not own.
 */
import { CookMarksProvider, recipeActionMessages } from '@commise/features-recipes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';

import { computedContrast, renderWithRecipeClient, withFoodClient } from '@commise/test-utils';
import { palette, tint } from '@commise/ui';
import { role } from '@commise/ui/colors';
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

/** `#RRGGBB` → jsdom's `rgb(r, g, b)`. */
const cssRgb = (hex: string): string => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
};

// The READ goes through the real hooks over a network-guarded fake client (the recipe is SEEDED into the query cache,
// so a settled suspense read renders synchronously); only the mutations are doubles.
// react-native-web does not implement `sendAccessibilityEvent`; a cursor hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

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

/** Render over this test's client and cache — the providers a real app root mounts, the food client's included. */
function render(ui: ReactElement) {
    return renderWithRecipeClient(
        withFoodClient(<CookMarksProvider subject="user_test">{ui}</CookMarksProvider>),
        client,
        { queryClient },
    );
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

describe('RecipeDetailScreen — lines food could not name (plan 002 R2)', () => {
    it('⛔ offers ONE Try again that refetches, and the names replace the stand-ins', async () => {
        const nameless = makeRecipeDetail({
            id: 'rec_1',
            title: 'Weeknight Pasta',
            ingredients: [
                {
                    ingredientId: 'far',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'tbsp',
                    isUserEntered: false,
                    resolutionStatus: 'FOOD_UNREACHABLE',
                },
            ],
        });
        seedRecipe(nameless);
        const getRecipe = vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({
                id: 'rec_1',
                title: 'Weeknight Pasta',
                ingredients: [
                    {
                        ingredientId: 'far',
                        name: 'Za’atar',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'tbsp',
                        isUserEntered: false,
                        resolutionStatus: 'RESOLVED',
                    },
                ],
            }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(await screen.findByText('Ingredient not loaded')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(getRecipe).toHaveBeenCalledTimes(1);
        expect(await screen.findByText('Za’atar')).toBeTruthy();
        expect(screen.queryByText('Ingredient not loaded')).toBeNull();
    });
});

describe('RecipeDetailScreen — a retry that names only some lines', () => {
    const line = (ingredientId: string, named: boolean) => ({
        ingredientId,
        ...(named ? { name: 'Za’atar' } : {}),
        quantity: { kind: 'exact' as const, value: 2 },
        unit: 'tbsp',
        isUserEntered: false,
        resolutionStatus: named ? ('RESOLVED' as const) : ('FOOD_UNREACHABLE' as const),
    });

    it('⛔ leaves the screen-reader cursor alone — the Try again it is on is still there', async () => {
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
        seedRecipe(
            makeRecipeDetail({ id: 'rec_1', title: 'Flatbread', ingredients: [line('a', false), line('b', false)] }),
        );
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ id: 'rec_1', title: 'Flatbread', ingredients: [line('a', true), line('b', false)] }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
        });

        expect(await screen.findByText('Za’atar')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
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

        expect(await screen.findByText('This recipe isn’t available.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('shows the generic error, with a way out, for an id that cannot name a recipe', () => {
        const getRecipe = vi.spyOn(client, 'getRecipeById');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(<RecipeDetailScreen recipeId="" />);

        expect(getRecipe).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
        expect(screen.queryByText('This recipe isn’t available.')).toBeNull();
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
        // F22 (`buildSpec.md` §3.5): Back draws the `chevron-left` glyph beside its word.
        expect(
            screen.getByRole('button', { name: 'Back' }).querySelector('[data-icon-name="chevron-left"]'),
        ).not.toBeNull();

        rerender(withFoodClient(<RecipeDetailScreen recipeId="rec_1" />));
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
        expect(screen.queryByRole('button', { name: /^More actions for /u })).toBeNull();
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

    it('opens the editor (primary) and version history (in the ⋯ menu) from the owner actions', () => {
        const onEdit = vi.fn();
        const onViewVersions = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onEdit={onEdit} onViewVersions={onViewVersions} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit recipe' }));
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Version history' }));

        expect(onEdit).toHaveBeenCalledWith('rec_1');
        expect(onViewVersions).toHaveBeenCalledWith('rec_1');
    });

    /**
     * ⛔ THE NATIVE HALF OF THE SAME RULE: the slot is an OPTIONAL `ReactNode` on a shared props interface, so a leaf
     * that never renders it typechecks and drops the controls silently. The ordering is the one a `ScrollView`
     * traverses: the owner's primary must not sit at the foot of an unbounded scroll.
     */
    it('⛔ puts Edit and the ⋯ trigger ABOVE the recipe body', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        const edit = screen.getByRole('button', { name: 'Edit recipe' });
        const ingredients = screen.getByText('Ingredients');
        const more = screen.getByRole('button', { name: /^More actions for /u });

        expect(edit.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(more.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('confirms and runs a delete from the menu’s destructive action, then navigates away', () => {
        const mutate = vi.fn((_id: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useDeleteRecipeMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>({ mutate: mutate as never }));
        const onDeleted = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onDeleted={onDeleted} />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete recipe' }));
        // The dialog's confirm repeats the trigger's verb (spec §6.5); it is the one inside the alert.
        fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Delete recipe' }));

        expect(mutate).toHaveBeenCalledWith('rec_1', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(onDeleted).toHaveBeenCalledTimes(1);
    });

    it('makes the owner’s private recipe public from the menu', () => {
        const mutate = vi.fn();
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ mutate: mutate as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', visibility: 'public' });
    });

    it('surfaces a failed delete inside the dialog, not a silent stop (B17)', () => {
        useDeleteRecipeMock.mockReturnValue(
            mutation<ReturnType<typeof useDeleteRecipe>>({ error: new Error('network down') as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete recipe' }));

        expect(screen.getByText('We couldn’t delete this recipe. Try again.')).toBeTruthy();
    });

    it('surfaces a failed visibility change on the screen (B17: no silent snap-back)', () => {
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ error: new Error('network down') as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByText('We couldn’t change who can see this recipe. Please try again.')).toBeTruthy();
    });

    it('offers Clear checks once a row is checked, and it clears them', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        const row = screen.getAllByRole('checkbox')[0] as HTMLElement;
        fireEvent.click(row);
        expect(row.getAttribute('aria-checked')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Clear checks' }));

        expect(screen.getAllByRole('checkbox')[0]?.getAttribute('aria-checked')).toBe('false');
    });
});

/**
 * Plan U13 + owner ruling 2026-10-02 ("Fix one line at a time"): a pick in the ambiguity review re-points one line
 * through the rebind command, which only the owner may send. The screen owns the ownership gate, so it is the one that
 * must hand it to the review.
 */
describe('RecipeDetailScreen — the ambiguity review is the owner’s alone', () => {
    const withAmbiguousLine = () =>
        makeRecipeDetail({
            ownerId: 'usr_1',
            visibility: 'public',
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-0000000000a1',
                    name: 'apple sauce',
                    quantity: { kind: 'exact', value: 1 },
                    unit: 'cup',
                    isUserEntered: false,
                    resolutionStatus: 'AMBIGUOUS',
                },
            ],
        });

    it('offers the OWNER the review of a line that could match more than one food', () => {
        seedRecipe(withAmbiguousLine());
        useUserProfileMock.mockReturnValue(profile('usr_1'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('button', { name: 'Review ingredient matches' })).toBeTruthy();
    });

    it('offers a viewer who does not own the recipe no review: the rebind would refuse every pick', () => {
        seedRecipe(withAmbiguousLine());
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('button', { name: 'Save a copy' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Review ingredient matches' })).toBeNull();
    });
});

describe('RecipeDetailScreen — owner actions are design-system controls (U8)', () => {
    beforeEach(() => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'premium'));
    });

    /**
     * ⛔ THE CONFIRMATION MUST BE AN OVERLAY, NOT A BLOCK IN THE SCROLL: an inline card at the end of the ScrollView
     * once opened below every step, off-screen, with no visible response to a destructive action. Only an overlay
     * paints the scrim, so the scrim colour is the load-bearing half and the padding pins the gutter (the native
     * suite's stub insets are 24 top, 0 at the sides, so the sides show the 16 dp floor).
     */
    it('⛔ renders the delete confirmation as an overlay, not a block at the foot of the scroll', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete recipe' }));

        const scrimColour = tint(palette.charcoal, 0.4).replace(/\s/gu, '');
        let scrim: Element | null = screen.getByRole('alert').parentElement;

        while (scrim !== null && window.getComputedStyle(scrim).backgroundColor.replace(/\s/gu, '') !== scrimColour) {
            scrim = scrim.parentElement;
        }

        expect(scrim).not.toBeNull();

        const style = window.getComputedStyle(scrim as Element);

        expect(style.paddingLeft).toBe('16px');
        expect(style.paddingRight).toBe('16px');
        expect(style.paddingTop).toBe('24px');
    });

    it('labels every owner action from the shared action dictionary (no literals)', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        const t = recipeActionMessages.en.detailActions;
        expect(screen.getByRole('button', { name: t.editRecipe })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        expect(screen.getByRole('menuitem', { name: t.versionHistory })).toBeTruthy();
        expect(screen.getByRole('menuitem', { name: t.deleteRecipe })).toBeTruthy();
    });

    // REWRITTEN in UI-overhaul slice 2: the DS primary tier is ONE flat `action` fill (the gradient was removed).
    it('paints the primary Edit action with the DS primary tier’s flat action fill', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        const edit = screen.getByRole('button', { name: recipeActionMessages.en.detailActions.editRecipe });
        const painted = [edit, ...Array.from(edit.querySelectorAll<HTMLElement>('*'))].map(
            (element) => window.getComputedStyle(element).backgroundColor,
        );

        expect(painted).toContain(cssRgb(role.action));
        expect(edit.querySelector('[data-commise-stub="linear-gradient"]')).toBeNull();
    });

    it('gives Edit recipe a 44pt touch target', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        const edit = screen.getByRole('button', { name: recipeActionMessages.en.detailActions.editRecipe });

        expect(window.getComputedStyle(edit.firstElementChild as Element).minHeight).toBe('44px');
    });
});

describe('RecipeDetailScreen — visibility gating (C-004)', () => {
    it('offers a free-tier owner no Make private', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'free'));

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));

        expect(screen.queryByRole('menuitem', { name: 'Make private' })).toBeNull();
    });

    it('offers a premium owner Make private', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'premium'));

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));

        expect(screen.getByRole('menuitem', { name: 'Make private' })).toBeTruthy();
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
        rerender(
            withFoodClient(
                <CookMarksProvider subject="user_test">
                    <RecipeDetailScreen recipeId="rec_2" />
                </CookMarksProvider>,
            ),
        );

        expect(deleteRatingInstances).toBe(2);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText('This recipe isn’t available.')).toBeNull();
        expect(screen.queryByText('Saving your rating…')).toBeNull();
    });
});

describe('RecipeDetailScreen — Save a copy', () => {
    it('gives another cook of a public recipe Save a copy as the primary, before the recipe body', () => {
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_owner', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        const copy = screen.getByRole('button', { name: 'Save a copy' });
        expect(
            copy.compareDocumentPosition(screen.getByText('Ingredients')) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('saves a copy of a public recipe the viewer does not own and reports the new id', () => {
        const cloned = makeRecipeDetail({ id: 'rec_clone' });
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_owner', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));
        const mutate = vi.fn((_id: string, options?: { onSuccess?: (recipe: typeof cloned) => void }) =>
            options?.onSuccess?.(cloned),
        );
        useCloneRecipeMock.mockReturnValue(mutation<ReturnType<typeof useCloneRecipe>>({ mutate: mutate as never }));
        const onCloned = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onCloned={onCloned} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save a copy' }));

        expect(mutate).toHaveBeenCalledWith('rec_1', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(onCloned).toHaveBeenCalledWith('rec_clone');
    });

    it('does NOT render Save a copy for the viewer’s OWN public recipe (D7 parity — matches web)', () => {
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'premium'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.queryByRole('button', { name: 'Save a copy' })).toBeNull();
    });
});

/** A design-token hex (`#RRGGBB`) as the `rgb(r, g, b)` string a resolved computed style reports. */
