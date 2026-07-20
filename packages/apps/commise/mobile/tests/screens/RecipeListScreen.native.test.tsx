/**
 * Component tests for the mobile RecipeListScreen (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). The screen is the container that drives the shared native `RecipeList`
 * building block from the (mocked) `useRecipes` query: it maps query state → view status, owns the search
 * field, derives the filtered rows, and forwards selection/create/retry upward.
 *
 * Covers EVERY UI path the screen produces: persistent chrome, loading, error (+ retry), empty, populated
 * (+ selection), and client-side search filtering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useRecipes } from '@kitchensink/recipe-service-client/hooks';

import { RecipeListScreen } from '../../src/screens/RecipeListScreen.js';
import { makeRecipe, makeRecipePage } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipes: vi.fn(),
    useRecipe: vi.fn(),
}));

const useRecipesMock = vi.mocked(useRecipes);

/** Build a `useRecipes` result double from the fields the screen reads. */
function listResult(overrides: Partial<ReturnType<typeof useRecipes>> = {}): ReturnType<typeof useRecipes> {
    return {
        isLoading: false,
        isError: false,
        data: undefined,
        refetch: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useRecipes>;
}

const noop = (): void => undefined;

afterEach(cleanup);

beforeEach(() => {
    useRecipesMock.mockReset();
});

describe('RecipeListScreen — chrome', () => {
    it('always renders the heading, search field, and create action', () => {
        useRecipesMock.mockReturnValue(listResult({ isLoading: true }));

        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search recipes')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('forwards create requests to the onCreateRecipe prop', () => {
        useRecipesMock.mockReturnValue(listResult({ data: makeRecipePage([]) }));
        const onCreateRecipe = vi.fn();

        render(<RecipeListScreen onSelectRecipe={noop} onCreateRecipe={onCreateRecipe} />);
        // Empty library → the create control is the empty-state CTA (the FAB is suppressed on empty; L1).
        fireEvent.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeListScreen — loading state', () => {
    it('shows the loading indicator and no recipe rows while the query is loading', () => {
        useRecipesMock.mockReturnValue(listResult({ isLoading: true }));

        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
        expect(screen.queryByText('1 recipe')).toBeNull();
    });
});

describe('RecipeListScreen — error state', () => {
    it('shows an alert and retries the query from the retry action', () => {
        const refetch = vi.fn();
        useRecipesMock.mockReturnValue(listResult({ isError: true, refetch }));

        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeListScreen — empty state', () => {
    it('shows the empty message when a successful load returns no recipes', () => {
        useRecipesMock.mockReturnValue(listResult({ data: makeRecipePage([]) }));

        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.getByText('No recipes yet')).toBeTruthy();
    });
});

describe('RecipeListScreen — populated state', () => {
    const page = makeRecipePage([
        makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
        makeRecipe({ id: 'rec_2', title: 'Fish Tacos' }),
    ]);

    it('renders a pluralized count and one row per recipe', () => {
        useRecipesMock.mockReturnValue(listResult({ data: page }));

        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.getByText('2 recipes')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
    });

    it('forwards the selected recipe id upward', () => {
        useRecipesMock.mockReturnValue(listResult({ data: page }));
        const onSelectRecipe = vi.fn();

        render(<RecipeListScreen onSelectRecipe={onSelectRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });
});

describe('RecipeListScreen — search', () => {
    const page = makeRecipePage([
        makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
        makeRecipe({ id: 'rec_2', title: 'Fish Tacos' }),
    ]);

    it('filters the loaded recipes by title as the search value changes', () => {
        useRecipesMock.mockReturnValue(listResult({ data: page }));

        render(<RecipeListScreen onSelectRecipe={noop} />);
        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'taco' } });

        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).toBeNull();
        expect(screen.getByText('1 recipe')).toBeTruthy();
    });
});

describe('RecipeListScreen — quick-filter chips (L4)', () => {
    it('derives chips from the loaded tags and filters the rows by an active chip', () => {
        useRecipesMock.mockReturnValue(
            listResult({
                data: makeRecipePage([
                    makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta', tags: ['quick'] }),
                    makeRecipe({ id: 'rec_2', title: 'Sunday Roast', tags: ['weekend'] }),
                ]),
            }),
        );

        render(<RecipeListScreen onSelectRecipe={noop} />);

        // Both tags surface as chips; tapping one narrows the visible rows to recipes carrying it.
        fireEvent.click(screen.getByText('quick'));

        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Sunday Roast' })).toBeNull();
    });
});
