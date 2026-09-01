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

import { RECENT_SEARCHES_STORAGE_KEY } from '@commise/features-recipes';
import {
    useCloneRecipe,
    useInfiniteSearchRecipes,
    useSearchIngredients,
} from '@kitchensink/recipe-service-client/hooks';

import { RecipeDiscoveryScreen } from '../../src/screens/RecipeDiscoveryScreen.js';
import { makeRecipeSearchResult, makeSearchResponse } from '../__fixtures__/recipes.js';

// An in-memory `AsyncStorage` double: the real native module has no runtime under jsdom, and the point here
// is the screen's recent-search WIRING, not the native KV store's own behaviour.
const { asyncStorageMock } = vi.hoisted(() => ({ asyncStorageMock: { store: new Map<string, string>() } }));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => asyncStorageMock.store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            asyncStorageMock.store.set(key, value);
        },
    },
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useInfiniteSearchRecipes: vi.fn(),
    useCloneRecipe: vi.fn(),
    // The screen's filter bar composes `useIngredientFilterSearch` (FR-006 gap #3), which calls this —
    // idle/disabled by default (no test here types an ingredient query), mirroring the empty-typeahead state.
    useSearchIngredients: vi.fn(),
}));

// The screens under test now START the deferred calorie batch (ADR-0021 §6) through this shared hook, which
// reaches the real recipe-service client and query cache. This file is not about nutrition, so the lookup is
// stubbed to "no batch covers this recipe" — the branch that renders no nutrition line at all, leaving every
// assertion below unchanged. The wiring itself is covered by `tests/screens/screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
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
    asyncStorageMock.store.clear();
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

/**
 * The ingredient facet (FR-006 gap #3) end to end THROUGH the screen — the story `search-navigation.yaml`
 * walks on-device, which nothing below the screen could catch: the filter bar's own tests stub every
 * callback, and the pure model's tests never render. It failed in CI at exactly this seam (round 5): the
 * option was named by the bare ingredient name, so the harness's name-addressed tap resolved to the search
 * FIELD (which holds the same string) instead of the option, and the pick was silently dropped — the sheet
 * closed with no chip, no count badge, `hasActiveFilters` false, and the browse rails still on screen.
 */
describe('RecipeDiscoveryScreen — ingredient facet (FR-006 gap #3)', () => {
    /** A catalog match whose name is EXACTLY what the test types — the collision the defect turned on. */
    const flour = { id: 'ing_flour', name: 'Flour', isUserEntered: false, createdAt: '2026-01-01T00:00:00Z' };

    /** Open the filter bottom sheet (U7) — every facet, the ingredient typeahead included, lives inside it. */
    function openFilters(): void {
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    }

    beforeEach(() => {
        // An empty result set, so an APPLIED ingredient filter lands on the no-match state and a DROPPED one
        // leaves the curated browse rails up — the two are distinguishable, which is the whole point.
        useSearchRecipesMock.mockReturnValue(searchResult({ data: makeSearchResponse([]) }));
        useSearchIngredientsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            isSuccess: true,
            data: [flour],
        } as unknown as ReturnType<typeof useSearchIngredients>);
    });

    it('applies a picked ingredient to the search, leaving browse for the no-match state', async () => {
        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);

        // Browse is the default surface: no query, no filter.
        expect(screen.getByRole('heading', { name: 'Trending' })).toBeTruthy();

        openFilters();
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Flour' } });

        // The option is addressable by its ACTION even though the field now holds the same word.
        const option = await screen.findByRole('button', { name: 'Filter by Flour' });
        expect((screen.getByLabelText('Search ingredients') as HTMLInputElement).value).toBe('Flour');
        fireEvent.click(option);

        // The id reached the wire params — the falsifiable core (a dropped facet sends no `ingredientIds`).
        expect(useSearchRecipesMock).toHaveBeenCalledWith(expect.objectContaining({ ingredientIds: ['ing_flour'] }));
        // …and the surface really left browse for the no-match state, with the trigger badging one filter.
        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Trending' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeTruthy();
    });

    it('restores browse when the ingredient chip is removed', async () => {
        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);

        openFilters();
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Flour' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Filter by Flour' }));

        fireEvent.click(screen.getByRole('button', { name: 'Remove Flour' }));

        expect(screen.getByRole('heading', { name: 'Trending' })).toBeTruthy();
        expect(screen.queryByText('No matching recipes')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove Flour' })).toBeNull();
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

/**
 * Recent searches, end-to-end through the screen's `AsyncStorage` adapter (mocked with an in-memory store —
 * the real native module has no runtime here). The pure list rules live in `recentSearches.test.ts` and the
 * panel's visibility rules in `RecipeDiscoveryList.native.test.tsx`; this block covers the wiring: only a
 * search that RAN is recorded, a persisted history is offered on focus, choosing one re-runs it, and
 * clear-all empties both the panel and storage.
 */
describe('RecipeDiscoveryScreen — recent searches (U7)', () => {
    /** Focus the keyword field via the bubbling `focusin` React delegates `onFocus` to. */
    function focusSearch(): void {
        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));
    }

    it('records a search that actually ran and offers it once the field goes blank again', async () => {
        useSearchRecipesMock.mockReturnValue(searchResult());

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);

        const box = screen.getByLabelText('Search public recipes');
        fireEvent.change(box, { target: { value: 'ramen' } });
        await vi.waitFor(() =>
            expect(useSearchRecipesMock).toHaveBeenCalledWith(expect.objectContaining({ query: 'ramen' })),
        );

        // Back to the idle state (field cleared, still focused) — where the history is the useful thing.
        focusSearch();
        fireEvent.change(box, { target: { value: '' } });

        expect(await screen.findByRole('button', { name: 'Search for “ramen”' })).toBeTruthy();
        await vi.waitFor(() =>
            expect(asyncStorageMock.store.get(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify(['ramen'])),
        );
    });

    it('offers a history persisted by an earlier session (the reload case)', async () => {
        asyncStorageMock.store.set(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto', 'lamb tagine']));
        useSearchRecipesMock.mockReturnValue(searchResult());

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);
        focusSearch();

        expect(await screen.findByRole('button', { name: 'Search for “risotto”' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Search for “lamb tagine”' })).toBeTruthy();
    });

    it('runs the chosen recent search', async () => {
        asyncStorageMock.store.set(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto']));
        useSearchRecipesMock.mockReturnValue(searchResult());

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);
        focusSearch();

        fireEvent.click(await screen.findByRole('button', { name: 'Search for “risotto”' }));

        expect((screen.getByLabelText('Search public recipes') as HTMLInputElement).value).toBe('risotto');
        await vi.waitFor(() =>
            expect(useSearchRecipesMock).toHaveBeenCalledWith(expect.objectContaining({ query: 'risotto' })),
        );
    });

    it('clears the whole history, panel and storage alike', async () => {
        asyncStorageMock.store.set(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto', 'ramen']));
        useSearchRecipesMock.mockReturnValue(searchResult());

        render(<RecipeDiscoveryScreen onSelectRecipe={vi.fn()} />);
        focusSearch();

        fireEvent.click(await screen.findByRole('button', { name: 'Clear recent searches' }));

        expect(screen.queryByRole('button', { name: /^Search for/ })).toBeNull();
        await vi.waitFor(() =>
            expect(asyncStorageMock.store.get(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify([])),
        );
    });
});
