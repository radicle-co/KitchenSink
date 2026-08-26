/**
 * Component tests for the mobile RecipesScreen (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). RecipesScreen is the state-machine navigator for the recipe slice: it owns a
 * navigation stack and composes the per-screen containers, with the three top-level destinations under a
 * persistent tab bar. These tests exercise the navigation transitions end to end (the per-screen behaviour is
 * covered by each screen's own test), so the hooks are mocked only enough to render each destination.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { compositeOver, computedContrast, contrastRatio } from '@commise/test-utils';
import { palette } from '@commise/ui';
import {
    useCloneRecipe,
    useCollectionsInfinite,
    useCreateIngredient,
    useCreateRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useInfiniteSearchRecipes,
    useRecipe,
    useRecipes,
    useSearchIngredients,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';

import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { RecipesScreen } from '../../src/screens/RecipesScreen.js';
import {
    makeCollectionPage,
    makeRecipe,
    makeRecipeDetail,
    makeRecipePage,
    makeSearchResponse,
} from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipes: vi.fn(),
    // U33 — the create screen now composes the real photo surface (a pick lands in the draft and flushes
    // once the recipe has an id), so its hooks must exist even though this suite never picks a file.
    useRecipePhotos: () => ({ data: [], isLoading: false, isError: false }),
    useCreatePhotoUploadUrl: () => ({ mutateAsync: async () => ({}), isPending: false, reset: () => undefined }),
    useConfirmPhotoUpload: () => ({ mutateAsync: async () => ({}), isPending: false, reset: () => undefined }),
    useDeleteRecipePhoto: () => ({ mutate: () => undefined, isPending: false, reset: () => undefined }),
    useReorderRecipePhotos: () => ({ mutate: () => undefined, isPending: false, reset: () => undefined }),
    useRecipe: vi.fn(),
    useDeleteRecipe: vi.fn(),
    useSetRecipeVisibility: vi.fn(),
    useCloneRecipe: vi.fn(),
    useCreateRecipe: vi.fn(),
    useSearchIngredients: vi.fn(),
    useCreateIngredient: vi.fn(),
    // The ingredient picker + editor also read the async-resolution hooks; inert idle defaults keep them in
    // the search branch (this screen never drives an UNRESOLVED disambiguation or a poll-after-add).
    useAddIngredientByName: () => ({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
    }),
    useIngredientStatus: () => ({ data: undefined }),
    useIngredientCandidates: () => ({ isLoading: false, isError: false, isSuccess: false, data: undefined }),
    useResolveIngredient: () => ({ mutate: () => undefined, isPending: false, isError: false, reset: () => undefined }),
    useInfiniteSearchRecipes: vi.fn(),
    useCollectionsInfinite: vi.fn(),
    useSetRecipeRating: vi.fn(),
    useDeleteRecipeRating: vi.fn(),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: vi.fn(),
}));

// react-native-safe-area-context ships RN-flavoured source vitest's transform chokes on, and jsdom has no
// native safe-area provider. RecipesScreen reads useSafeAreaInsets for the status-bar inset; a zero-inset
// stub renders it faithfully under test (the inset value is a device concern, not a navigation one).
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

// The screens under test now START the deferred calorie batch (ADR-0021 §6) through this shared hook, which
// reaches the real recipe-service client and query cache. This file is not about nutrition, so the lookup is
// stubbed to "no batch covers this recipe" — the branch that renders no nutrition line at all, leaving every
// assertion below unchanged. The wiring itself is covered by `tests/screens/screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
}));

const useRecipesMock = vi.mocked(useRecipes);
const useRecipeMock = vi.mocked(useRecipe);

/** A query-result double (only the fields the screens read); cast to the concrete hook's result type. */
function query<T>(overrides: Record<string, unknown> = {}): T {
    return { isLoading: false, isError: false, data: undefined, refetch: vi.fn(), ...overrides } as unknown as T;
}

/** The opaque colour a tab's own fill resolves to, read off the DOM and flattened onto the screen. */
function fillOf(tab: Element): string {
    return compositeOver(window.getComputedStyle(tab).backgroundColor, palette.sand);
}

/** A mutation-result double; cast to the concrete hook's result type. */
function mutation<T>(overrides: Record<string, unknown> = {}): T {
    return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides } as unknown as T;
}

afterEach(cleanup);

beforeEach(() => {
    vi.mocked(useRecipes).mockReturnValue(
        query<ReturnType<typeof useRecipes>>({
            data: makeRecipePage([makeRecipe({ id: 'rec_2', title: 'Fish Tacos' })]),
        }),
    );
    vi.mocked(useRecipe).mockReturnValue(
        query<ReturnType<typeof useRecipe>>({
            data: makeRecipeDetail({ id: 'rec_2', title: 'Fish Tacos', description: 'Bright and zesty.' }),
        }),
    );
    vi.mocked(useDeleteRecipe).mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>());
    vi.mocked(useSetRecipeVisibility).mockReturnValue(mutation<ReturnType<typeof useSetRecipeVisibility>>());
    vi.mocked(useCloneRecipe).mockReturnValue(mutation<ReturnType<typeof useCloneRecipe>>());
    vi.mocked(useCreateRecipe).mockReturnValue(mutation<ReturnType<typeof useCreateRecipe>>());
    vi.mocked(useSetRecipeRating).mockReturnValue(mutation<ReturnType<typeof useSetRecipeRating>>());
    vi.mocked(useDeleteRecipeRating).mockReturnValue(mutation<ReturnType<typeof useDeleteRecipeRating>>());
    vi.mocked(useSearchIngredients).mockReturnValue(query<ReturnType<typeof useSearchIngredients>>({ data: [] }));
    vi.mocked(useCreateIngredient).mockReturnValue(mutation<ReturnType<typeof useCreateIngredient>>());
    // The discover tab reads the PAGINATED search hook (S4) — an inert single-page, no-next-page shape keeps
    // it in the "ready, no results" state without exercising pagination.
    vi.mocked(useInfiniteSearchRecipes).mockReturnValue(
        query<ReturnType<typeof useInfiniteSearchRecipes>>({
            data: { pages: [makeSearchResponse([])] },
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
        }),
    );
    vi.mocked(useCollectionsInfinite).mockReturnValue(
        query<ReturnType<typeof useCollectionsInfinite>>({ data: { pages: [makeCollectionPage([])] } as never }),
    );
    vi.mocked(useUserProfile).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useUserProfile>);
});

describe('RecipesScreen — navigation', () => {
    it('starts on the my-recipes list', () => {
        render(<RecipesScreen />);

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
    });

    it('opens the detail for the selected recipe and returns to the list on back', () => {
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        expect(useRecipeMock).toHaveBeenCalledWith('rec_2');
        expect(screen.getByText('Bright and zesty.')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Recipes' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
    });

    /**
     * Entering the recipes surface DIRECTLY at a recipe detail — what a Home "Recent recipes" card tap does.
     * The stack is seeded `[list, detail]` rather than `[detail]` so Back lands on the recipe list instead of
     * dead-ending, matching what `RecipeCreateScreen`'s `onCreated` already does.
     */
    it('opens straight into the detail for initialRecipeId', () => {
        render(<RecipesScreen initialRecipeId="rec_2" />);

        expect(useRecipeMock).toHaveBeenCalledWith('rec_2');
        expect(screen.getByText('Bright and zesty.')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Recipes' })).toBeNull();
    });

    it('leaves the recipe list beneath the seeded detail, so Back does not dead-end', () => {
        render(<RecipesScreen initialRecipeId="rec_2" />);

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
    });

    it('still starts on the list when no initialRecipeId is given', () => {
        render(<RecipesScreen />);

        // Guards the default: seeding unconditionally would send every recipes-tab entry to a detail.
        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.queryByText('Bright and zesty.')).toBeNull();
    });

    it('opens the create screen from the create dial s ONE destination', () => {
        // REWRITTEN for U34 (owner ruling 2026-08-25): the list's pinned FAB is now a menu TRIGGER, so the
        // create screen is reached from "Create from Scratch". Asserting that opening the dial alone
        // navigates NOWHERE is what stops this passing against a dial wired to nothing — the accepted +1 tap
        // is precisely the behaviour under test.
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.queryByLabelText('Title')).toBeNull();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    });

    it('switches to the discover tab', () => {
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('tab', { name: 'Discover' }));

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
    });

    it('keeps the SELECTED tab’s label WCAG-AA legible on its own fill', () => {
        render(<RecipesScreen />);

        // The selected tab now paints a white "front folder" fill; seafoam-as-label scored 3.73:1 on the
        // screen's sand, under the 4.5:1 body floor (SC 1.4.3), which is why the label is `ocean-dark`. The
        // `borderBottomColor` underline is a non-text accent and stays seafoam — see the palette JSDoc in
        // `@commise/ui`.
        const tab = screen.getByRole('tab', { name: 'My recipes' });
        const label = within(tab).getByText('My recipes');

        expect(computedContrast(label, { surface: fillOf(tab) }), 'selected tab label').toBeGreaterThanOrEqual(4.5);
    });

    it('gives the UNSELECTED tabs a resting affordance a thumb can see (no hover exists on touch)', () => {
        // The owner-reported defect, on the surface a phone user actually touches: an unselected tab was a
        // transparent border over no fill — bare text, indistinguishable from a heading. It now rests as a
        // visible folder (fill + hairline), from the SAME shared `RecipeSourceTab` the web strip mirrors, and
        // both halves are measured rather than spelled: the label owes 4.5:1 (SC 1.4.3) on that fill and the
        // hairline, being the control's boundary, owes 3:1 (SC 1.4.11) against it.
        render(<RecipesScreen />);

        const inactive = screen.getByRole('tab', { name: 'Discover' });
        const style = window.getComputedStyle(inactive);

        expect(style.backgroundColor, 'an unselected tab must paint a fill').not.toBe('rgba(0, 0, 0, 0)');
        expect(Number.parseFloat(style.borderBottomWidth), 'and a visible boundary').toBeGreaterThan(0);
        expect(
            computedContrast(within(inactive).getByText('Discover'), { surface: fillOf(inactive) }),
            'unselected tab label on its resting fill',
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            contrastRatio(compositeOver(style.borderBottomColor, fillOf(inactive)), fillOf(inactive)),
            'unselected tab boundary against its own fill',
        ).toBeGreaterThanOrEqual(3);
    });

    it('marks the active destination as the selected tab', () => {
        render(<RecipesScreen />);

        expect(screen.getByRole('tab', { name: 'My recipes' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'Discover' }).getAttribute('aria-selected')).not.toBe('true');
    });

    it('gives the top-level tabs a 44pt touch target (U4 / RC-3)', () => {
        render(<RecipesScreen />);

        for (const tab of screen.getAllByRole('tab')) {
            expect(window.getComputedStyle(tab).minHeight).toBe('44px');
        }
    });

    it('switches to the collections tab', () => {
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));

        expect(screen.getByRole('heading', { name: 'Collections' })).toBeTruthy();
    });

    it('keeps the list query bound to the source of truth', () => {
        render(<RecipesScreen />);

        expect(useRecipesMock).toHaveBeenCalled();
    });
});
