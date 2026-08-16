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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { useRecipes } from '@kitchensink/recipe-service-client/hooks';

import { RecipeListScreen } from '../../src/screens/RecipeListScreen.js';
import { makeRecipe, makeRecipePage } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipes: vi.fn(),
    useRecipe: vi.fn(),
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
    it('derives chips from the loaded dietary flags + cuisine and filters by an active chip', () => {
        useRecipesMock.mockReturnValue(
            listResult({
                data: makeRecipePage([
                    makeRecipe({
                        id: 'rec_1',
                        title: 'Weeknight Pasta',
                        dietaryFlags: ['Vegetarian'],
                        cuisine: 'Italian',
                    }),
                    makeRecipe({ id: 'rec_2', title: 'Sunday Roast', dietaryFlags: [], cuisine: 'British' }),
                ]),
            }),
        );

        render(<RecipeListScreen onSelectRecipe={noop} />);

        // Real facet dimensions surface as chips; tapping one narrows the rows to recipes matching it.
        fireEvent.click(screen.getByText('Vegetarian'));

        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Sunday Roast' })).toBeNull();
    });

    it('surfaces a "Quick (<30m)" chip that filters to recipes under the 30-minute threshold (#4)', () => {
        useRecipesMock.mockReturnValue(
            listResult({
                data: makeRecipePage([
                    makeRecipe({ id: 'rec_1', title: 'Overnight Oats', totalTimeMinutes: 5 }),
                    makeRecipe({ id: 'rec_2', title: "Grandma's Pasta", totalTimeMinutes: 45 }),
                ]),
            }),
        );

        render(<RecipeListScreen onSelectRecipe={noop} />);

        expect(screen.queryByText('quick')).toBeNull();
        fireEvent.click(screen.getByText('Quick (<30m)'));

        expect(screen.getByRole('button', { name: 'Overnight Oats' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: "Grandma's Pasta" })).toBeNull();
    });

    it('omits the "Quick (<30m)" chip when no loaded recipe qualifies (other facets still render)', () => {
        useRecipesMock.mockReturnValue(
            listResult({
                data: makeRecipePage([
                    makeRecipe({
                        id: 'rec_1',
                        title: "Grandma's Pasta",
                        totalTimeMinutes: 45,
                        cuisine: 'Italian',
                    }),
                ]),
            }),
        );

        render(<RecipeListScreen onSelectRecipe={noop} />);

        const chips = screen.getByLabelText('Quick filters');
        expect(within(chips).getByText('Italian')).toBeTruthy();
        expect(within(chips).queryByText('Quick (<30m)')).toBeNull();
    });
});
