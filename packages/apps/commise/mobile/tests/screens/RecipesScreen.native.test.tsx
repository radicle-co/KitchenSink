/**
 * Component tests for the mobile RecipesScreen (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). RecipesScreen is the state-machine navigator for the recipe slice: it owns a
 * navigation stack and composes the per-screen containers, with the three top-level destinations under a
 * persistent tab bar. These tests exercise the navigation transitions end to end (the per-screen behaviour is
 * covered by each screen's own test), so the hooks are mocked only enough to render each destination.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    useCloneRecipe,
    useCollections,
    useCreateIngredient,
    useCreateRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useRecipe,
    useRecipes,
    useSearchIngredients,
    useSearchRecipes,
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
    useSearchRecipes: vi.fn(),
    useCollections: vi.fn(),
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
    vi.mocked(useSearchRecipes).mockReturnValue(
        query<ReturnType<typeof useSearchRecipes>>({ data: makeSearchResponse([]) }),
    );
    vi.mocked(useCollections).mockReturnValue(
        query<ReturnType<typeof useCollections>>({ data: makeCollectionPage([]) }),
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

    it('opens the create screen from the list create action', () => {
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.getByRole('heading', { name: 'New recipe' })).toBeTruthy();
    });

    it('switches to the discover tab', () => {
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('tab', { name: 'Discover' }));

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
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
