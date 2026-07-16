/**
 * Component tests for RecipeDiscoveryContainer (T076 web public-discovery wiring). Covers every state the
 * container projects onto the shared RecipeDiscoveryList building block — loading, populated, empty, error
 * (with retry) — plus search-query wiring, recipe selection navigation, and the clone flow (mutation wired
 * with the row id, per-row busy state, and navigation to the cloned recipe on success). The search + clone
 * hooks and the Next router are mocked, so no backend or QueryClient is needed.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';

import { makeSearchResponse, makeSearchResult } from './__fixtures__/discoveryFixtures';
import { makeRecipe, makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { useSearchRecipesMock, useCloneRecipeMock, pushMock, refetchMock, cloneMutateMock, nav } = vi.hoisted(() => ({
    useSearchRecipesMock: vi.fn(),
    useCloneRecipeMock: vi.fn(),
    pushMock: vi.fn(),
    refetchMock: vi.fn(),
    cloneMutateMock: vi.fn(),
    // The container reads the search criteria from the URL. `nav.params` is the current query; a test sets it
    // to simulate a shared/reloaded filtered link, and criteria writes go through `window.history.replaceState`
    // (spied per-test), which in the real app updates `useSearchParams()` reactively.
    nav: { params: new URLSearchParams(), pathname: '/en/discover' },
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSearchRecipes: useSearchRecipesMock,
    useCloneRecipe: useCloneRecipeMock,
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    usePathname: () => nav.pathname,
    useSearchParams: () => nav.params,
}));

function mockClone(overrides: Record<string, unknown> = {}): void {
    useCloneRecipeMock.mockReturnValue({
        mutate: cloneMutateMock,
        isPending: false,
        variables: undefined,
        ...overrides,
    });
}

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    nav.params = new URLSearchParams();
});

describe('RecipeDiscoveryContainer', () => {
    it('renders the loading state while the search query is pending', () => {
        useSearchRecipesMock.mockReturnValue({
            isLoading: true,
            isError: false,
            data: undefined,
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeInTheDocument();
    });

    it('renders the populated results with a count when the search loads', () => {
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }) }),
            ]),
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
    });

    it('renders the empty state when the search succeeds with no hits', () => {
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([]),
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        expect(screen.getByText('No recipes found')).toBeInTheDocument();
    });

    it('renders the error state and retries on demand', async () => {
        const user = userEvent.setup();
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: true,
            data: undefined,
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetchMock).toHaveBeenCalledTimes(1);
    });

    it('writes the typed search term to the URL (shareable), not to local state', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([]),
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        // A single keystroke — the input is URL-controlled, so cumulative typing depends on the router
        // reactivity that only the real runtime (Playwright) provides; the container's job here is to WRITE.
        await user.type(screen.getByRole('searchbox', { name: 'Search public recipes' }), 'p');

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?query=p');
    });

    it('searches with no query param before the user types', () => {
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([]),
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        expect(useSearchRecipesMock).toHaveBeenLastCalledWith({});
    });

    it('projects the filters from the URL onto the search params and the pressed chips', () => {
        nav.params = new URLSearchParams('dietaryFlags=vegan');
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([], { facets: { dietaryFlags: [{ value: 'vegan', count: 2 }] } }),
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        expect(useSearchRecipesMock).toHaveBeenLastCalledWith({ dietaryFlags: ['vegan'] });
        expect(screen.getByRole('button', { name: 'vegan, 2 recipes' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('writes a toggled facet to the URL', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([], { facets: { dietaryFlags: [{ value: 'vegan', count: 2 }] } }),
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        await user.click(screen.getByRole('button', { name: 'vegan, 2 recipes' }));

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?dietaryFlags=vegan');
    });

    it('navigates to the recipe detail route when a result is selected', async () => {
        const user = userEvent.setup();
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_42', title: 'Weeknight Pasta' }) }),
            ]),
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_42');
    });

    it('clones the selected recipe and navigates to the clone on success', async () => {
        const user = userEvent.setup();
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_7', title: 'Sunday Roast' }) }),
            ]),
            refetch: refetchMock,
        });
        mockClone();

        render(<RecipeDiscoveryContainer locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Clone Sunday Roast' }));

        expect(cloneMutateMock).toHaveBeenCalledWith(
            'rec_7',
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );

        // Drive the success callback the container passed to the mutation and assert navigation to the clone.
        const onSuccess = cloneMutateMock.mock.calls[0]?.[1]?.onSuccess as (recipe: { id: string }) => void;
        onSuccess(makeRecipeDetail({ id: 'rec_clone' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_clone');
    });

    it('busies only the row whose clone is in flight', () => {
        useSearchRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }) }),
            ]),
            refetch: refetchMock,
        });
        mockClone({ isPending: true, variables: 'rec_2' });

        render(<RecipeDiscoveryContainer locale="en" />);

        const busy = screen.getByRole('button', { name: 'Cloning Sunday Roast' });
        expect(busy).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Clone Weeknight Pasta' })).toBeEnabled();
    });
});
