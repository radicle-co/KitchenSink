/**
 * Component tests for the mobile RecipesScreen (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). RecipesScreen is the state-machine navigator for the recipe slice: it owns a
 * navigation stack and composes the per-screen containers, with the three top-level destinations under a
 * persistent tab bar. These tests exercise the navigation transitions end to end (the per-screen behaviour is
 * covered by each screen's own test), so the hooks are mocked only enough to render each destination.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { computedContrast } from '@commise/test-utils';
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

const useRecipesMock = vi.mocked(useRecipes);
const useRecipeMock = vi.mocked(useRecipe);

/** A query-result double (only the fields the screens read); cast to the concrete hook's result type. */
function query<T>(overrides: Record<string, unknown> = {}): T {
    return { isLoading: false, isError: false, data: undefined, refetch: vi.fn(), ...overrides } as unknown as T;
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

    it('opens the create screen from the list create action', () => {
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    });

    it('switches to the discover tab', () => {
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('tab', { name: 'Discover' }));

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
    });

    it('keeps the SELECTED tab’s label WCAG-AA legible on the screen’s sand background', () => {
        render(<RecipesScreen />);

        // The tab bar paints no background of its own, so the selected label sits on the screen container's
        // `sand`: seafoam scored 3.73:1 there, under the 4.5:1 body floor (SC 1.4.3). The selected tab's
        // `borderBottomColor` underline is a non-text accent and stays seafoam — see the palette JSDoc in
        // `@commise/ui`.
        const label = within(screen.getByRole('tab', { name: 'My recipes' })).getByText('My recipes');

        expect(computedContrast(label, { surface: palette.sand }), 'selected tab label').toBeGreaterThanOrEqual(4.5);
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
