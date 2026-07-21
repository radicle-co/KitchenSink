/**
 * Component tests for the mobile RecipeDiscoveryScreen (react-native-web under jsdom, T076 / US2). The screen
 * drives the shared native `RecipeDiscoveryList` from (mocked) `useSearchRecipes`, mapping query state to the
 * view status, and wires each row's Clone action to (mocked) `useCloneRecipe`. Covers loading, error (+
 * retry), populated (+ select + clone), and the search field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCloneRecipe, useInfiniteSearchRecipes } from '@kitchensink/recipe-service-client/hooks';

import { RecipeDiscoveryScreen } from '../../src/screens/RecipeDiscoveryScreen.js';
import { makeRecipeSearchResult, makeSearchResponse } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useInfiniteSearchRecipes: vi.fn(),
    useCloneRecipe: vi.fn(),
}));

const useSearchRecipesMock = vi.mocked(useInfiniteSearchRecipes);
const useCloneRecipeMock = vi.mocked(useCloneRecipe);

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
});

describe('RecipeDiscoveryScreen — loading and error', () => {
    it('shows the loading indicator while the search runs', () => {
        useSearchRecipesMock.mockReturnValue(searchResult({ isLoading: true }));

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
    });

    it('shows an alert and retries the search from the retry action', () => {
        const refetch = vi.fn();
        useSearchRecipesMock.mockReturnValue(searchResult({ isError: true, refetch }));

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);

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

describe('RecipeDiscoveryScreen — populated', () => {
    beforeEach(() => {
        useSearchRecipesMock.mockReturnValue(
            searchResult({
                data: makeSearchResponse([makeRecipeSearchResult({ id: 'rec_9', title: 'Fish Tacos' })]),
            }),
        );
    });

    it('forwards a selected recipe upward', () => {
        const onSelectRecipe = vi.fn();

        render(<RecipeDiscoveryScreen onSelectRecipe={onSelectRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_9');
    });

    it('clones the selected recipe from its clone action', () => {
        const mutate = vi.fn();
        useCloneRecipeMock.mockReturnValue(cloneMutation({ mutate: mutate as never }));

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clone Fish Tacos' }));

        expect(mutate).toHaveBeenCalledWith('rec_9');
    });
});
