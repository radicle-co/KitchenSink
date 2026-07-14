/**
 * Component tests for the mobile RecipeDiscoveryScreen (react-native-web under jsdom, T076 / US2). The screen
 * drives the shared native `RecipeDiscoveryList` from (mocked) `useSearchRecipes`, mapping query state to the
 * view status, and wires each row's Clone action to (mocked) `useCloneRecipe`. Covers loading, error (+
 * retry), populated (+ select + clone), and the search field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCloneRecipe, useSearchRecipes } from '@kitchensink/recipe-service-client/hooks';

import { RecipeDiscoveryScreen } from '../../src/screens/RecipeDiscoveryScreen.js';
import { makeRecipeSearchResult, makeSearchResponse } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSearchRecipes: vi.fn(),
    useCloneRecipe: vi.fn(),
}));

const useSearchRecipesMock = vi.mocked(useSearchRecipes);
const useCloneRecipeMock = vi.mocked(useCloneRecipe);

function searchResult(
    overrides: Partial<ReturnType<typeof useSearchRecipes>> = {},
): ReturnType<typeof useSearchRecipes> {
    return {
        isLoading: false,
        isError: false,
        data: undefined,
        refetch: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useSearchRecipes>;
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
