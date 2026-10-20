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
import { recipeLoadMessages } from '@commise/features-recipes/detail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';

import { computedContrast, renderWithRecipeClient, withFoodClient } from '@commise/test-utils';
import { palette, tint } from '@commise/ui';
import { role } from '@commise/ui/colors';
import { SnackbarHost } from '@commise/ui/snackbar';
import { BadRequestError, NotFoundError, recipeQueries, recipeServiceKeys } from '@kitchensink/recipe-service-client';
import {
    RECIPE_VISIBILITY_MUTATION_KEY,
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';

import { RecipeDetailScreen } from '../../src/screens/RecipeDetailScreen.js';
import { useSessionClaims } from '../../src/hooks/useSessionClaims.js';
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

/** Whether the outbox has a write of the recipe on the wire (`SyncQueue.entityInFlight`), as a test sets it. */
const syncState = vi.hoisted(() => ({ saving: false }));

vi.mock('@commise/query/sync', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/query/sync')>();

    return {
        ...actual,
        useSyncQueue: () => ({ ...actual.useSyncQueue(), entityInFlight: () => syncState.saving }),
    };
});

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: vi.fn(),
}));

vi.mock('../../src/hooks/useSessionClaims.js', () => ({
    useSessionClaims: vi.fn(),
}));

const useSessionClaimsMock = vi.mocked(useSessionClaims);
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
        withFoodClient(
            <SnackbarHost>
                <CookMarksProvider subject="user_test">{ui}</CookMarksProvider>
            </SnackbarHost>,
        ),
        client,
        { queryClient },
    );
}

function mutation<T>(overrides: Partial<T> = {}): T {
    // `error: null` + a no-op `reset` mirror an idle TanStack mutation — the screen reads `.error` (B17
    // banners) and calls `.reset()` on a recipeId change (leak scrub).
    return { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn(), ...overrides } as unknown as T;
}

/** A `useUserProfile` double exposing only the viewer id + paid-feature state the screen reads. */
function profile(
    id: string | undefined,
    paidFeatures: 'granted' | 'upsell' | 'hidden' = 'upsell',
): ReturnType<typeof useUserProfile> {
    const data = id === undefined ? undefined : { user: { id }, account: { paidFeatures } };

    return { status: data === undefined ? 'pending' : 'success', data } as unknown as ReturnType<typeof useUserProfile>;
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
    // No session claim by default: the viewer id then comes from the profile, as it did before the claim was read.
    useSessionClaimsMock.mockReset();
    useSessionClaimsMock.mockReturnValue(undefined);
    useDeleteRecipeMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>());
    useSetRecipeVisibilityMock.mockReturnValue(mutation<ReturnType<typeof useSetRecipeVisibility>>());
    useCloneRecipeMock.mockReturnValue(mutation<ReturnType<typeof useCloneRecipe>>());
    useSetRecipeRatingMock.mockReturnValue(mutation<ReturnType<typeof useSetRecipeRating>>());
    useDeleteRecipeRatingMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipeRating>>());
    useUserProfileMock.mockReturnValue(profile(undefined));
});

describe('RecipeDetailScreen — loading state', () => {
    it('shows the localized loading caption while the query is loading', () => {
        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByText('Loading recipe…')).toBeTruthy();
    });

    // D3 (rewritten from "a named progressbar and a caption"): the pending state is the page's SHAPE — a 4:3 hero, the title,
    // the stat strip and the section rows — so nothing moves when the recipe lands. The caption is still shown and spoken
    // once, politely; the blocks are decorative.
    it('captions what is loading ONCE, over the page-shaped placeholder (D3)', () => {
        const { container } = render(<RecipeDetailScreen recipeId="rec_1" />);

        const label = recipeLoadMessages.en.loadingLabel;
        expect(screen.getAllByText(label)).toHaveLength(1);
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    // Rewritten (S3, 2026-10-16) from "keeps loading while the viewer profile is in flight". The wait is now only for a
    // viewer whose id nothing else names: with the session claim present the body shows at once (the next describe), and
    // this guard keeps its original job for the case that has no claim — painting before the profile lands would render
    // the detail WITHOUT the owner actions and pop them in. Fails against a gate that only checks the recipe query.
    it('keeps loading while the recipe is ready, no claim names the viewer, and the profile is still in flight', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));
        useUserProfileMock.mockReturnValue({ isLoading: true, data: undefined } as unknown as ReturnType<
            typeof useUserProfile
        >);

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByText('Loading recipe…')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Weeknight Pasta' })).toBeNull();
    });
});

/**
 * S3 drift ruling (owner, 2026-10-16): the viewer's app-user id comes from the signed token claim (`external_id`) when
 * present and falls back to the profile — on BOTH platforms. Mobile used to read the profile alone, and to hold the body
 * until the profile landed; with the claim present nothing is left to wait for.
 */
describe('RecipeDetailScreen — the viewer id: the session claim first, the profile second', () => {
    const profileInFlight = { isLoading: true, data: undefined } as unknown as ReturnType<typeof useUserProfile>;

    it('⛔ shows the body at once when the claim names the viewer, though the profile is still in flight', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta', ownerId: 'usr_1' }));
        useSessionClaimsMock.mockReturnValue({ external_id: 'usr_1' });
        useUserProfileMock.mockReturnValue(profileInFlight);

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('heading', { name: 'Weeknight Pasta' })).toBeTruthy();
        // And it is the OWNER's body, from the claim alone: Edit recipe is there with no profile.
        expect(screen.getByRole('button', { name: 'Edit recipe' })).toBeTruthy();
    });

    it('⛔ trusts the claim over the profile when the two name different viewers', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1' }));
        useSessionClaimsMock.mockReturnValue({ external_id: 'usr_1' });
        useUserProfileMock.mockReturnValue(profile('usr_other'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('button', { name: 'Edit recipe' })).toBeTruthy();
    });

    it.each([
        ['no claims at all', undefined],
        ['claims without external_id', { sub: 'user_clerk' }],
        ['an empty external_id', { external_id: '' }],
        ['a non-string external_id', { external_id: 7 }],
    ])('falls back to the profile id for %s', (_name, claims) => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1' }));
        useSessionClaimsMock.mockReturnValue(claims);
        useUserProfileMock.mockReturnValue(profile('usr_1'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('button', { name: 'Edit recipe' })).toBeTruthy();
    });

    it('offers Make private only once the profile lands: the paid features are the profile’s alone', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: RecipeVisibility.PUBLIC }));
        useSessionClaimsMock.mockReturnValue({ external_id: 'usr_1' });
        useUserProfileMock.mockReturnValue(profileInFlight);

        const { rerender } = render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));

        expect(screen.queryByRole('menuitem', { name: 'Make private' })).toBeNull();
        // An open menu keeps the list it opened with, so the cook closes it and opens it again once the profile lands.
        fireEvent.click(screen.getByRole('button', { name: 'Close more actions' }));

        useUserProfileMock.mockReturnValue(profile('usr_1', 'granted'));
        rerender(
            withFoodClient(
                <SnackbarHost>
                    <CookMarksProvider subject="user_test">
                        <RecipeDetailScreen recipeId="rec_1" />
                    </CookMarksProvider>
                </SnackbarHost>,
            ),
        );

        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));

        expect(screen.getByRole('menuitem', { name: 'Make private' })).toBeTruthy();
    });

    it('reports the arrived refusal claim as seen once the claim-shown body has mounted, profile still in flight', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1' }));
        useSessionClaimsMock.mockReturnValue({ external_id: 'usr_1' });
        useUserProfileMock.mockReturnValue(profileInFlight);
        const onFinishRefusalSeen = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" refusalArrived onFinishRefusalSeen={onFinishRefusalSeen} />);

        expect(onFinishRefusalSeen).toHaveBeenCalledTimes(1);
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

    it('keeps a labelled way back on the error and not-found screens, which have no photo to put a disc on', async () => {
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError());
        const onBack = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onBack={onBack} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Back to My recipes' }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('keeps the way back’s label WCAG-AA legible on the screen’s sand background', async () => {
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError());

        render(<RecipeDetailScreen recipeId="rec_1" onBack={vi.fn()} />);

        // A bare text control on the screen container's `sand` background: seafoam scored 3.73:1 there, under
        // the 4.5:1 body floor (SC 1.4.3). Web's equivalent back control takes the same token (§14).
        const label = within(await screen.findByRole('button', { name: 'Back to My recipes' })).getByText(
            'Back to My recipes',
        );

        expect(computedContrast(label, { surface: palette.sand }), 'back control label').toBeGreaterThanOrEqual(4.5);
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

    /**
     * A-014 / D7 (rewritten from "a text Back row above the page"): Back is a 44 pt DISC over the hero photo, named for
     * where it goes. ⛔ Never the bare "Back": Android's own navigation bar publishes a node with exactly that name, so a
     * selector or a screen-reader rotor could not tell the two apart.
     */
    it('draws Back as a disc over the hero, named for its parent, only when onBack is provided', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));
        const onBack = vi.fn();

        const { rerender } = render(<RecipeDetailScreen recipeId="rec_1" onBack={onBack} />);
        const back = screen.getByRole('button', { name: 'Back to My recipes' });
        fireEvent.click(back);

        expect(onBack).toHaveBeenCalledTimes(1);
        expect(back.querySelector('[data-icon-name="chevron-left"]')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
        // Over the photo: before the title in the reading order.
        const title = screen.getByRole('heading', { name: 'Weeknight Pasta' });
        expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        rerender(withFoodClient(<RecipeDetailScreen recipeId="rec_1" />));
        expect(screen.queryByRole('button', { name: /^Back/u })).toBeNull();
    });

    /** A navigator whose stack holds `routes`, the screen being the last. */
    /**
     * Renders the screen as the route at `own` in a stack of `routes`, the top of which is focused. A real navigator
     * provides both contexts: the navigation (its state) and the screen's OWN route (its key).
     */
    const renderInStack = (routes: readonly string[], own = routes.length - 1) => {
        const state = { index: routes.length - 1, routes: routes.map((name, at) => ({ name, key: `${name}-${at}` })) };
        const navigation = { getState: () => state } as never;

        render(
            <NavigationContext.Provider value={navigation}>
                <NavigationRouteContext.Provider value={state.routes[own] as never}>
                    <RecipeDetailScreen recipeId="rec_1" onBack={vi.fn()} />
                </NavigationRouteContext.Provider>
            </NavigationContext.Provider>,
        );
    };

    it.each([
        ['HomeRoot', 'Back to Home'],
        ['RecipesRoot', 'Back to My recipes'],
        ['DiscoverRoot', 'Back to Discover'],
        ['CollectionDetail', 'Back to Collection'],
        ['RecipeDetail', 'Back to Recipe'],
    ])('names the screen the cook came from: %s → “%s”', (previous, name) => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        renderInStack([previous, 'RecipeDetail']);

        expect(screen.getByRole('button', { name })).toBeTruthy();
    });

    it('falls back to My recipes when the stack has nothing below it (a deep link)', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        renderInStack(['RecipeDetail']);

        expect(screen.getByRole('button', { name: 'Back to My recipes' })).toBeTruthy();
    });

    // Save a copy pushes the copy's detail and its editor over this page, and the clone's settle re-renders this page
    // while it is covered. The label must name the route under THIS screen, not the one under the focused screen.
    it('names the route below its OWN screen while other screens sit on top of it', () => {
        seedRecipe(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        renderInStack(['DiscoverRoot', 'RecipeDetail', 'RecipeDetail', 'RecipeEdit'], 1);

        expect(screen.getByRole('button', { name: 'Back to Discover' })).toBeTruthy();
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
        useUserProfileMock.mockReturnValue(profile('usr_1', 'granted'));
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
        const ingredients = screen.getByRole('heading', { name: 'Ingredients' });
        const more = screen.getByRole('button', { name: /^More actions for /u });

        expect(edit.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(more.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    /** A-014 / D7: ⋯ is the second disc over the hero photo, after Back, before the title. */
    it('draws the ⋯ trigger as a disc over the hero, named for the recipe, ahead of the title', () => {
        render(<RecipeDetailScreen recipeId="rec_1" onBack={vi.fn()} />);

        const more = screen.getByRole('button', { name: /^More actions for /u });
        const back = screen.getByRole('button', { name: 'Back to My recipes' });
        const title = screen.getByRole('heading', { name: 'Weeknight Pasta' });

        const probe = document.createElement('div');
        probe.style.backgroundColor = role.photoChip;

        // The pressable is the hit frame (48 dp on Android, 2026-10-17); the photoChip disc is drawn inside it.
        expect(getComputedStyle(more.firstElementChild as Element).backgroundColor).toBe(probe.style.backgroundColor);
        expect(back.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(more.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
        // Owner 2026-10-13: say so on the screen the cook lands on. The snackbar host is above the navigator, so a message
        // raised here outlives this screen.
        expect(screen.getByText('Recipe deleted')).toBeTruthy();
    });

    /**
     * Owner ruling 2026-10-17, "Don't allow users to delete while saving": the editor can be left with a checkpoint on the
     * wire. Delete is unavailable until the outbox settles it, and says why in words a screen reader reads.
     */
    it('⛔ shows Delete as unavailable ("Saving…") while a write of the recipe is on the wire, and deletes nothing', () => {
        syncState.saving = true;

        try {
            const mutate = vi.fn();
            useDeleteRecipeMock.mockReturnValue(
                mutation<ReturnType<typeof useDeleteRecipe>>({ mutate: mutate as never }),
            );

            render(<RecipeDetailScreen recipeId="rec_1" onDeleted={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));

            expect(screen.getByRole('menuitem', { name: 'Delete recipe' }).textContent).toContain('Saving…');

            fireEvent.click(screen.getByRole('menuitem', { name: 'Delete recipe' }));

            expect(screen.queryByRole('alert')).toBeNull();
            expect(mutate).not.toHaveBeenCalled();
        } finally {
            syncState.saving = false;
        }
    });

    it('says nothing about a delete that did not succeed', () => {
        const mutate = vi.fn();
        useDeleteRecipeMock.mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>({ mutate: mutate as never }));

        render(<RecipeDetailScreen recipeId="rec_1" onDeleted={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete recipe' }));
        fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Delete recipe' }));

        expect(screen.queryByText('Recipe deleted')).toBeNull();
    });

    it('makes a granted owner’s private recipe public from the menu, at once', () => {
        useUserProfileMock.mockReturnValue(profile('usr_1', 'granted'));
        const mutate = vi.fn();
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ mutate: mutate as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', visibility: 'public' }, expect.anything());
        expect(screen.queryByRole('heading', { name: 'Make this recipe public?' })).toBeNull();
    });

    // Plan 2026-10-14-009 Q5 (UX SPECIFY 2026-10-15): a downgraded owner confirms first, and nothing is sent until then.
    it.each([
        ['hidden', "Anyone can see a public recipe and save a copy. You won't be able to make this one private again."],
        [
            'upsell',
            "Anyone can see a public recipe and save a copy. To make this one private again, you'll need Premium.",
        ],
    ] as const)('⛔ under %s, Make public asks first and sends nothing until confirmed', (state, body) => {
        useUserProfileMock.mockReturnValue(profile('usr_1', state));
        const mutate = vi.fn();
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ mutate: mutate as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));

        expect(screen.getByRole('heading', { name: 'Make this recipe public?' })).toBeTruthy();
        expect(screen.getByText(body)).toBeTruthy();
        expect(mutate).not.toHaveBeenCalled();

        const dialog = screen.getByRole('heading', { name: 'Make this recipe public?' }).closest('[role="alert"]');
        fireEvent.click(within(dialog as HTMLElement).getByRole('button', { name: 'Make public' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', visibility: 'public' }, expect.anything());
    });

    it('Keep private closes the confirm and sends nothing', () => {
        useUserProfileMock.mockReturnValue(profile('usr_1', 'hidden'));
        const mutate = vi.fn();
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ mutate: mutate as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep private' }));

        expect(screen.queryByRole('heading', { name: 'Make this recipe public?' })).toBeNull();
        expect(mutate).not.toHaveBeenCalled();
    });

    // A Private refused AFTER it was sent (the editor's follow-up, answered once the editor had gone) is read from the
    // mutation cache and said in plain words; every other failure keeps the generic "try again".
    it('⛔ says the recipe stayed public when a Private sent elsewhere was refused', async () => {
        useUserProfileMock.mockReturnValue(profile('usr_1', 'upsell'));
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', visibility: RecipeVisibility.PUBLIC }));
        await queryClient
            .getMutationCache()
            .build(queryClient, {
                mutationKey: RECIPE_VISIBILITY_MUTATION_KEY,
                mutationFn: () =>
                    Promise.reject(new BadRequestError('Public-only for free tier.', 'INVALID_VISIBILITY')),
            })
            .execute({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE })
            .catch(() => undefined);

        render(<RecipeDetailScreen recipeId="rec_1" />);

        const notice = await screen.findByText('This recipe is still public. Private recipes are part of Premium.');

        // §6.4: in the header under the rating and visibility line, where the cook lands, not at the foot of the page.
        expect(notice.closest('[aria-live="assertive"]')).not.toBeNull();
        expect(screen.getByRole('heading', { name: 'Weeknight Pasta' }).parentElement?.contains(notice)).toBe(true);
    });

    // Review S3: an earlier failure is not news to a confirm opened afresh — the request clears it.
    it('opening the confirm clears an earlier failed change', () => {
        useUserProfileMock.mockReturnValue(profile('usr_1', 'hidden'));
        const reset = vi.fn();
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ reset: reset as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        reset.mockClear();
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));

        expect(reset).toHaveBeenCalled();
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

        // §6.4: the generic failure shares the slot under the rating and visibility line, not the foot of the page.
        const notice = screen.getByText('We couldn’t change who can see this recipe. Please try again.');

        expect(screen.getByRole('heading', { name: 'Weeknight Pasta' }).parentElement?.contains(notice)).toBe(true);
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

        expect(screen.getByRole('button', { name: /Review ingredient matches$/u })).toBeTruthy();
    });

    it('offers a viewer who does not own the recipe no review: the rebind would refuse every pick', () => {
        seedRecipe(withAmbiguousLine());
        useUserProfileMock.mockReturnValue(profile('usr_viewer'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('button', { name: 'Save a copy' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Review ingredient matches$/u })).toBeNull();
    });
});

describe('RecipeDetailScreen — owner actions are design-system controls (U8)', () => {
    beforeEach(() => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'granted'));
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
    // Plan 2026-10-14-009 D14, mirroring the web suite: Make private is offered under granted and upsell only.
    it('under upsell, offers Make private, and tapping it opens the Premium sheet and sends nothing', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'upsell'));
        const mutate = vi.fn();
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ mutate: mutate as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Make private' }));

        expect(screen.getByRole('heading', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
        expect(mutate).not.toHaveBeenCalled();
    });

    it('a granted owner who taps Make private makes it private, with no sheet', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'granted'));
        const mutate = vi.fn();
        useSetRecipeVisibilityMock.mockReturnValue(
            mutation<ReturnType<typeof useSetRecipeVisibility>>({ mutate: mutate as never }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Make private' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', visibility: 'private' });
        expect(screen.queryByRole('heading', { name: 'Private recipes are part of Premium.' })).toBeNull();
    });

    it('offers a granted owner Make private', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'granted'));

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));

        expect(screen.getByRole('menuitem', { name: 'Make private' })).toBeTruthy();
    });

    // (A failed profile read has no viewer id on native — the owner key comes from the profile — so it shows no owner
    // menu at all; the web suite covers the failed read for an owner, whose key comes from the Clerk session.)
    it('⛔ under hidden, offers no Make private', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'public' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'hidden'));

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));

        expect(screen.queryByRole('menuitem', { name: 'Make private' })).toBeNull();
        expect(screen.getByRole('menuitem', { name: 'Version history' })).toBeTruthy();
    });

    it('under hidden, a private recipe still offers Make public', () => {
        seedRecipe(makeRecipeDetail({ ownerId: 'usr_1', visibility: 'private' }));
        useUserProfileMock.mockReturnValue(profile('usr_1', 'hidden'));

        render(<RecipeDetailScreen recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: /^More actions for /u }));

        expect(screen.getByRole('menuitem', { name: 'Make public' })).toBeTruthy();
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
                <SnackbarHost>
                    <CookMarksProvider subject="user_test">
                        <RecipeDetailScreen recipeId="rec_2" />
                    </CookMarksProvider>
                </SnackbarHost>,
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
            copy.compareDocumentPosition(screen.getByRole('heading', { name: 'Ingredients' })) &
                Node.DOCUMENT_POSITION_FOLLOWING,
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
        useUserProfileMock.mockReturnValue(profile('usr_1', 'granted'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.queryByRole('button', { name: 'Save a copy' })).toBeNull();
    });
});

/** A design-token hex (`#RRGGBB`) as the `rgb(r, g, b)` string a resolved computed style reports. */

/**
 * Plan 2026-10-14-009 T3 (buildSpec §6.4): a Private the editor withheld is said on the recipe page, inline, in the header.
 * The route hands the screen a CLAIM (`refusalArrived`) and keeps the result (`finishRefused`); the screen reports the
 * claim as seen only once its body has mounted, so the live region is filled one render after it exists.
 *
 * ⛔ The claim is not trusted: the sentence needs the owner, a public recipe and a profile that refuses Private.
 */
describe('RecipeDetailScreen — the refused Private, said inline (§6.4)', () => {
    const FINAL = 'This recipe is still public: it couldn’t be made private.';
    const PREMIUM = 'This recipe is still public. Private recipes are part of Premium.';
    const seed = (visibility: RecipeVisibility = RecipeVisibility.PUBLIC): void =>
        seedRecipe(makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', visibility }));

    it('⛔ says the recipe is still public, in the header, once the route has kept the claim', () => {
        seed();
        useUserProfileMock.mockReturnValue(profile('usr_1', 'hidden'));

        render(<RecipeDetailScreen recipeId="rec_1" finishRefused />);

        const notice = screen.getByText(FINAL);

        expect(notice.closest('[aria-live="assertive"]')).not.toBeNull();
        expect(screen.getByRole('heading', { name: 'Weeknight Pasta' }).parentElement?.contains(notice)).toBe(true);
    });

    it('takes the words from the profile: the upsell gets the Premium sentence', () => {
        seed();
        useUserProfileMock.mockReturnValue(profile('usr_1', 'upsell'));

        render(<RecipeDetailScreen recipeId="rec_1" finishRefused />);

        expect(screen.getByText(PREMIUM)).toBeTruthy();
        expect(screen.queryByText(FINAL)).toBeNull();
    });

    it('mounts an empty assertive region for the owner when there is nothing to say', () => {
        seed();
        useUserProfileMock.mockReturnValue(profile('usr_1', 'hidden'));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        const regions = document.querySelectorAll('[aria-live="assertive"]');

        expect(regions).toHaveLength(1);
        expect(regions[0]?.textContent).toBe('');
    });

    it.each([
        ['a cook who does not own the recipe', 'usr_viewer', 'hidden', RecipeVisibility.PUBLIC],
        ['the owner of a PRIVATE recipe', 'usr_1', 'hidden', RecipeVisibility.PRIVATE],
        ['an owner who may make recipes private', 'usr_1', 'granted', RecipeVisibility.PUBLIC],
    ] as const)('⛔ says nothing for a forged claim for %s', (_who, viewer, paid, visibility) => {
        seed(visibility);
        useUserProfileMock.mockReturnValue(profile(viewer, paid));

        render(<RecipeDetailScreen recipeId="rec_1" finishRefused refusalArrived />);

        expect(screen.queryByText(FINAL)).toBeNull();
        expect(screen.queryByText(PREMIUM)).toBeNull();
    });

    it('reports the arrived claim as seen once the body has mounted, and only once', () => {
        seed();
        useUserProfileMock.mockReturnValue(profile('usr_1', 'hidden'));
        const onFinishRefusalSeen = vi.fn();

        const { rerender } = render(
            <RecipeDetailScreen recipeId="rec_1" refusalArrived onFinishRefusalSeen={onFinishRefusalSeen} />,
        );

        expect(onFinishRefusalSeen).toHaveBeenCalledTimes(1);

        rerender(
            withFoodClient(
                <SnackbarHost>
                    <CookMarksProvider subject="user_test">
                        <RecipeDetailScreen recipeId="rec_1" refusalArrived onFinishRefusalSeen={onFinishRefusalSeen} />
                    </CookMarksProvider>
                </SnackbarHost>,
            ),
        );

        expect(onFinishRefusalSeen).toHaveBeenCalledTimes(1);
    });

    it('⛔ does not report the claim while the skeleton shows: the body must mount empty first', () => {
        seed();
        useUserProfileMock.mockReturnValue({ isLoading: true, data: undefined } as unknown as ReturnType<
            typeof useUserProfile
        >);
        const onFinishRefusalSeen = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" refusalArrived onFinishRefusalSeen={onFinishRefusalSeen} />);

        expect(onFinishRefusalSeen).not.toHaveBeenCalled();
    });

    it('does not report a claim that never arrived', () => {
        seed();
        useUserProfileMock.mockReturnValue(profile('usr_1', 'hidden'));
        const onFinishRefusalSeen = vi.fn();

        render(<RecipeDetailScreen recipeId="rec_1" onFinishRefusalSeen={onFinishRefusalSeen} />);

        expect(onFinishRefusalSeen).not.toHaveBeenCalled();
    });
});
