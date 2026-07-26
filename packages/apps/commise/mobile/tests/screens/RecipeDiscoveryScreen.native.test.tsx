/**
 * Component tests for the mobile RecipeDiscoveryScreen (react-native-web under jsdom, T076 / US2, U7
 * overhaul). The screen drives the shared native `RecipeDiscoveryList` from (mocked)
 * `useInfiniteSearchRecipes`, mapping query state to the view status, and wires each row's Clone action to
 * (mocked) `useCloneRecipe`. Covers loading, error (+ retry), populated (+ select + clone) in RESULT-LIST
 * mode, plus the U7 behaviours: the search FETCH is debounced while the field echoes immediately, and with
 * no active query/filter the screen shows the curated browse rails.
 *
 * A preset filter (`initialFilters`) is the lever that puts the screen into RESULT-LIST mode — with neither
 * a query nor a filter the screen is in BROWSE mode by design.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    useCloneRecipe,
    useInfiniteSearchRecipes,
    useSearchIngredients,
} from '@kitchensink/recipe-service-client/hooks';

import { RecipeDiscoveryScreen } from '../../src/screens/RecipeDiscoveryScreen.js';
import { makeRecipeSearchResult, makeSearchResponse } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useInfiniteSearchRecipes: vi.fn(),
    useCloneRecipe: vi.fn(),
    // The screen's filter bar composes `useIngredientFilterSearch` (FR-006 gap #3), which calls this —
    // idle/disabled by default (no test here types an ingredient query), mirroring the empty-typeahead state.
    useSearchIngredients: vi.fn(),
}));

const useSearchRecipesMock = vi.mocked(useInfiniteSearchRecipes);
const useCloneRecipeMock = vi.mocked(useCloneRecipe);
const useSearchIngredientsMock = vi.mocked(useSearchIngredients);

/** A preset filter that forces RESULT-LIST mode (the screen is not browsing when a filter is active). */
const resultsMode = { tags: ['grill'] } as const;

/**
 * Build a paginated-search hook double from a flat `data` response — the screen reads `data.pages`,
 * `hasNextPage`, and `fetchNextPage` (S4), so wrap the response as a single page.
 */
function searchResult(
    overrides: { readonly data?: ReturnType<typeof makeSearchResponse> } & Record<string, unknown> = {},
): ReturnType<typeof useInfiniteSearchRecipes> {
    const { data, ...rest } = overrides;

    return {
        isLoading: false,
        isError: false,
        data: data === undefined ? undefined : { pages: [data] },
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
        ...rest,
    } as unknown as ReturnType<typeof useInfiniteSearchRecipes>;
}

function cloneMutation(overrides: Partial<ReturnType<typeof useCloneRecipe>> = {}): ReturnType<typeof useCloneRecipe> {
    return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides } as unknown as ReturnType<
        typeof useCloneRecipe
    >;
}

afterEach(cleanup);

beforeEach(() => {
    useSearchRecipesMock.mockReset();
    useCloneRecipeMock.mockReset();
    useCloneRecipeMock.mockReturnValue(cloneMutation());
    useSearchIngredientsMock.mockReset();
    useSearchIngredientsMock.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: false,
        data: undefined,
    } as unknown as ReturnType<typeof useSearchIngredients>);
});

describe('RecipeDiscoveryScreen — loading and error', () => {
    it('shows the loading skeleton while the search runs', () => {
        useSearchRecipesMock.mockReturnValue(searchResult({ isLoading: true }));

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} initialFilters={resultsMode} />);

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
    });

    it('shows an alert and retries the search from the retry action', () => {
        const refetch = vi.fn();
        useSearchRecipesMock.mockReturnValue(searchResult({ isError: true, refetch }));

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} initialFilters={resultsMode} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeDiscoveryScreen — initial filters (D6 tag deep-link)', () => {
    it('runs the first search pre-filtered by the initial tag', () => {
        useSearchRecipesMock.mockReturnValue(searchResult());

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} initialFilters={{ tags: ['grill'] }} />);

        // Still the SAME visibility-scoped search hook — the preset tag only seeds its params.
        expect(useSearchRecipesMock).toHaveBeenCalledWith(expect.objectContaining({ tags: ['grill'] }));
    });
});

describe('RecipeDiscoveryScreen — populated (result list)', () => {
    beforeEach(() => {
        useSearchRecipesMock.mockReturnValue(
            searchResult({
                data: makeSearchResponse([makeRecipeSearchResult({ id: 'rec_9', title: 'Fish Tacos' })]),
            }),
        );
    });

    it('forwards a selected recipe upward', () => {
        const onSelectRecipe = vi.fn();

        render(<RecipeDiscoveryScreen onSelectRecipe={onSelectRecipe} initialFilters={resultsMode} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_9');
    });

    it('clones the selected recipe from its clone action', () => {
        const mutate = vi.fn();
        useCloneRecipeMock.mockReturnValue(cloneMutation({ mutate: mutate as never }));

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} initialFilters={resultsMode} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clone Fish Tacos' }));

        expect(mutate).toHaveBeenCalledWith('rec_9');
    });
});

describe('RecipeDiscoveryScreen — browse rails (U7)', () => {
    it('shows the curated rails (not a bare stream) when nothing is active', () => {
        useSearchRecipesMock.mockReturnValue(
            searchResult({ data: makeSearchResponse([makeRecipeSearchResult({ id: 'rec_1', title: 'Curated' })]) }),
        );

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'Trending' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'New' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Quick' })).toBeTruthy();
    });
});

describe('RecipeDiscoveryScreen — debounced search (U7)', () => {
    it('echoes the typed value immediately but debounces the value fed to the query', async () => {
        useSearchRecipesMock.mockReturnValue(searchResult());

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);

        const box = screen.getByLabelText('Search public recipes');
        fireEvent.change(box, { target: { value: 'ramen' } });

        // Immediate echo — the field carries the typed value at once.
        expect((box as HTMLInputElement).value).toBe('ramen');
        // The query fetch has NOT yet been asked for 'ramen' (the debounced value still lags the input).
        expect(useSearchRecipesMock).not.toHaveBeenCalledWith(expect.objectContaining({ query: 'ramen' }));

        // After the debounce window, the settled value feeds the search.
        await vi.waitFor(() =>
            expect(useSearchRecipesMock).toHaveBeenCalledWith(expect.objectContaining({ query: 'ramen' })),
        );
    });
});
