/**
 * Integration test for the Home → recipe-detail navigation chain (mobile).
 *
 * This is the test that actually proves the feature: it renders the REAL `AppRoot` with the REAL `HomeScreen`,
 * `HomeWidgetSurface`, `RecipeWidgetSlot`, the real lazily-loaded recipe widget, and the real shared card
 * leaves — then taps a "Recent recipes" card and asserts the recipes surface opens on THAT recipe's detail.
 * Each seam in the chain has its own unit test, but only this one fails if any single link is unwired, which
 * is precisely how the original defect survived: every leaf already accepted `onSelectRecipe`, and the host
 * simply never passed one, so the cards rendered inert with nothing failing.
 *
 * It lives in its own file (mirroring `CollectionDetailScreen.pullGuard.native.test.tsx`) because
 * `AppRoot.native.test.tsx` stubs `HomeScreen` wholesale to drive the root error boundary, and `vi.mock` is
 * file-scoped — a real Home cannot coexist with that stub.
 *
 * NOTE on navigation: this app deliberately has NO Expo Router / react-navigation (see `AppRoot`'s B13 note).
 * The chain is `RecipeWidgetSlot` → `HomeWidgetSurface` → `HomeScreen` → `AppRoot`'s destination state →
 * `RecipesScreen`'s seeded stack, which is what these assertions walk.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { makeRecipeDetail, makeRecipePage, makeRecipe } from '../__fixtures__/recipes.js';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: () => ({ data: { account: { subscriptionTier: 'free' }, user: { displayName: 'Jane Doe' } } }),
    useDeleteAccount: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ signOut: () => undefined }) }));

/** The recipe the Home widget lists and the detail then resolves — ONE id threaded through the whole chain. */

// The screens under test now START the deferred calorie batch (ADR-0021 §6) through this shared hook, which
// reaches the real recipe-service client and query cache. This file is not about nutrition, so the lookup is
// stubbed to "no batch covers this recipe" — the branch that renders no nutrition line at all, leaving every
// assertion below unchanged. The wiring itself is covered by `tests/screens/screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
}));

const TAPPED = makeRecipe({ id: 'rec_home_tap', title: 'Weeknight Pasta' });
/** A second recipe, so a chain that hardcoded "the first card" cannot pass. */
const OTHER = makeRecipe({ id: 'rec_other', title: 'Herb Risotto' });

const { useRecipeSpy } = vi.hoisted(() => ({ useRecipeSpy: vi.fn() }));

// `AppRoot` statically imports every screen, so the recipe-service hook surface must cover both the Home
// widget's list query and the detail screen's single-recipe query (plus the mutations the detail composes).
vi.mock('@kitchensink/recipe-service-client/hooks', () => {
    const idle = { mutate: () => undefined, mutateAsync: async () => undefined, isPending: false, isError: false };

    return {
        useRecipes: () => ({ isLoading: false, isError: false, data: undefined }),
        useRecipe: (id: string) => {
            useRecipeSpy(id);

            return { isLoading: false, isError: false, data: makeRecipeDetail({ id, title: 'Weeknight Pasta' }) };
        },
        useInfiniteSearchRecipes: () => ({ isLoading: false, isError: false, data: undefined }),
        useCollectionsInfinite: () => ({ isLoading: false, isError: false, data: undefined }),
        useSearchIngredients: () => ({ isLoading: false, data: undefined }),
        useAllOwnerRecipes: () => ({ recipes: [], isLoading: false, isError: false }),
        useDeleteRecipe: () => idle,
        useSetRecipeVisibility: () => idle,
        useSetRecipeRating: () => idle,
        useDeleteRecipeRating: () => idle,
        useCloneRecipe: () => idle,
        useCreateRecipe: () => idle,
        useUpdateRecipe: () => idle,
        useCreateIngredient: () => idle,
        useRequestAccountErasure: () => idle,
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Home → recipe detail (mobile, end to end)', () => {
    it('opens the tapped recipe’s detail from a Home "Recent recipes" card', async () => {
        const hooks = await import('@kitchensink/recipe-service-client/hooks');
        vi.spyOn(hooks, 'useRecipes').mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipePage([TAPPED, OTHER]),
        } as unknown as ReturnType<typeof hooks.useRecipes>);

        const { AppRoot } = await import('../../src/screens/AppRoot.js');
        renderWithProviders(<AppRoot />);

        // The Home widget chunk loads lazily, so wait for the real card to appear.
        const card = await screen.findByRole('button', { name: 'Weeknight Pasta' });
        fireEvent.click(card);

        // The recipes surface opened on the TAPPED recipe — the id survived every hop.
        expect(useRecipeSpy).toHaveBeenCalledWith('rec_home_tap');
        expect(useRecipeSpy).not.toHaveBeenCalledWith('rec_other');
        // And we really left Home: the greeting is gone, a recipe detail heading is present.
        expect(screen.queryByText(/Chef/u)).toBeNull();
        expect(await screen.findByRole('heading', { name: 'Weeknight Pasta' })).toBeTruthy();
        // 20s, not the 5s default. This is the heaviest test in the monorepo — the ONLY one that exceeds
        // 2s — because it deliberately renders the REAL `AppRoot` + REAL `HomeScreen`, waits for the
        // lazily-loaded widget chunk, and then drives a second screen. That integration depth IS the
        // test's value (it is what proves the tapped id survives every hop), so the cost is inherent
        // rather than a fixable slowness: ~1.5s idle, but ~5.4s when `turbo run test` saturates every
        // core across 39 packages, which tripped the default and made the whole monorepo run flake.
        // Raised HERE rather than as a global `testTimeout` on purpose — a repo-wide bump would mask
        // genuine slowness in the other 3000+ tests, which all finish well under 2s.
    }, 20_000);
});
