/**
 * Component tests for the mobile RecipeDiscoveryScreen (react-native-web under jsdom, T076 / US2, U7 overhaul). The
 * screen puts the shared native discovery FRAME around a suspense read of the search: `Suspense` renders the loading
 * body, the error boundary the load error (its retry refetches), and once settled the RESULTS render the rails while
 * browsing or the counted grid. The criteria are deferred, so a newer search keeps the previous results on screen.
 *
 * REWRITTEN for the suspense conversion: every read goes through the REAL hooks over a network-guarded fake client
 * (`renderWithRecipeClient`), with `searchRecipes` answering per request — where the old file mocked
 * `useInfiniteSearchRecipes` and fed the screen status flags a suspense read no longer exposes. A preset filter
 * (`initialFilters`) is the lever that puts the screen into RESULT-LIST mode; with neither a query nor a filter it
 * browses by design.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo } from 'react-native';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { RecipeSearchResponse } from '@kitchensink/recipe-service-client';
import { createElement, type ReactElement, type ReactNode } from 'react';

import { RECENT_SEARCHES_STORAGE_KEY } from '@commise/features-recipes';
import { renderWithRecipeClient } from '@commise/test-utils';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { RecipeDiscoveryScreen } from '../../src/screens/RecipeDiscoveryScreen.js';
import { makeRecipeSearchResult, makeSearchResponse } from '../__fixtures__/recipes.js';

// react-native-web does not implement `sendAccessibilityEvent`; the heading hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    // `RefreshControl` is inert under jsdom; react-native-web clones it AROUND its scroll view, so a stand-in that renders
    // a "pull" button over its children lets a test perform the gesture's effect.
    const RefreshControl = ({ onRefresh, children }: { onRefresh?: () => void; children?: ReactNode }) =>
        createElement(
            'div',
            null,
            createElement('button', { type: 'button', onClick: onRefresh }, 'Pull to refresh'),
            children,
        );

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        RefreshControl,
    };
});

// An in-memory `AsyncStorage` double: the real native module has no runtime under jsdom, and the point here is the
// screen's recent-search WIRING, not the native KV store's own behaviour.
const { asyncStorageMock } = vi.hoisted(() => ({ asyncStorageMock: { store: new Map<string, string>() } }));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => asyncStorageMock.store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            asyncStorageMock.store.set(key, value);
        },
    },
}));

// This file is not about nutrition, so the lookup is stubbed to "no batch covers this recipe" — the branch that renders
// no nutrition line at all. The wiring itself is covered by `tests/screens/screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
}));

/** A preset filter that forces RESULT-LIST mode (the screen is not browsing when a filter is active). */
const resultsMode = { tags: ['grill'] } as const;

/** The fake client and request cache each test renders over. */
let client: ReturnType<typeof createFakeRecipeServiceClient>;
let queryClient: QueryClient;

function render(ui: ReactElement) {
    return renderWithRecipeClient(ui, client, { queryClient });
}

/** Answer every search with `response`. */
function answerSearches(response: RecipeSearchResponse) {
    return vi.spyOn(client, 'searchRecipes').mockResolvedValue(response);
}

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });

    return { promise, resolve };
}

const noop = (): void => undefined;

afterEach(cleanup);

beforeEach(() => {
    vi.clearAllMocks();
    asyncStorageMock.store.clear();
    client = createFakeRecipeServiceClient();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('RecipeDiscoveryScreen — loading and error', () => {
    it('keeps the heading and search field on screen, with the loading body under them, while the search runs', () => {
        vi.spyOn(client, 'searchRecipes').mockReturnValue(new Promise(() => {}));

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search public recipes')).toBeTruthy();
        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
    });

    it('shows an alert and loads the results from Try again', async () => {
        const search = vi
            .spyOn(client, 'searchRecipes')
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(makeSearchResponse([makeRecipeSearchResult({ id: 'rec_1', title: 'Fish Tacos' })]));

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);

        expect(await screen.findByRole('alert')).toBeTruthy();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(await screen.findByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(search).toHaveBeenCalledTimes(2);
    });

    it('⛔ a failed NEXT page keeps the loaded results and offers Try again beside the reason', async () => {
        vi.spyOn(client, 'searchRecipes')
            .mockResolvedValueOnce(
                makeSearchResponse([makeRecipeSearchResult({ id: 'rec_1', title: 'Fish Tacos' })], { hasMore: true }),
            )
            .mockRejectedValueOnce(new Error('network down'));

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));

        expect(await screen.findByText('We couldn’t load more recipes.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
});

describe('RecipeDiscoveryScreen — a failed refresh of the results on screen', () => {
    it('⛔ keeps the results and says the refresh failed, never the list error, and Try again refetches', async () => {
        const response = makeSearchResponse([makeRecipeSearchResult({ id: 'rec_1', title: 'Fish Tacos' })]);
        const search = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValueOnce(response)
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(response);

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);
        await screen.findByRole('button', { name: 'Fish Tacos' });
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeSearches });
        });

        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(screen.queryByText('We couldn’t load recipes.')).toBeNull();
        expect((await screen.findAllByText('We couldn’t refresh these results.')).length).toBeGreaterThan(0);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });
        await waitFor(() => expect(screen.queryAllByText('We couldn’t refresh these results.')).toHaveLength(0));
        expect(search).toHaveBeenCalledTimes(3);
        // The pressed Try again is gone, so the screen-reader cursor goes to the heading, across the boundary.
        await waitFor(() =>
            expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
                screen.getByRole('heading', { name: 'Discover recipes' }),
                'focus',
            ),
        );
    });
});

describe('RecipeDiscoveryScreen — a failed refresh of the browse rails on screen', () => {
    it('⛔ keeps the rails and shows ONE notice for them, and its Try again refreshes every rail', async () => {
        const response = makeSearchResponse([makeRecipeSearchResult({ id: 'rec_1', title: 'Curated Dish' })]);
        const search = answerSearches(response);

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        await screen.findByRole('heading', { name: 'Trending' });
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Curated Dish' }).length).toBeGreaterThan(2));

        search.mockRejectedValue(new Error('down'));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeSearches });
        });

        expect((await screen.findAllByText('We couldn’t refresh these recipes.')).length).toBeGreaterThan(0);
        expect(screen.queryByText('Couldn’t load this row.')).toBeNull();
        // The results notice stays silent while browsing: its results are not on screen.
        expect(screen.queryAllByText('We couldn’t refresh these results.')).toHaveLength(0);
        const retries = screen.getAllByRole('button', { name: 'Try again' });
        expect(retries).toHaveLength(1);

        search.mockClear();
        search.mockResolvedValue(response);
        await act(async () => {
            fireEvent.click(retries[0] as HTMLElement);
        });

        // One press refreshes all three rails.
        expect(search.mock.calls.filter(([params]) => params?.pageSize !== undefined)).toHaveLength(3);
    });
});

describe('RecipeDiscoveryScreen — initial filters (D6 tag deep-link)', () => {
    it('runs the first search pre-filtered by the initial tag', () => {
        const search = answerSearches(makeSearchResponse());

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={{ tags: ['grill'] }} />);

        // Still the SAME visibility-scoped search — the preset tag only seeds its params.
        expect(search).toHaveBeenCalledWith(expect.objectContaining({ tags: ['grill'] }));
    });
});

describe('RecipeDiscoveryScreen — populated (result list)', () => {
    beforeEach(() => {
        answerSearches(makeSearchResponse([makeRecipeSearchResult({ id: 'rec_9', title: 'Fish Tacos' })]));
    });

    it('forwards a selected recipe upward', async () => {
        const onSelectRecipe = vi.fn();

        render(<RecipeDiscoveryScreen onSelectRecipe={onSelectRecipe} initialFilters={resultsMode} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Fish Tacos' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_9');
    });

    it('clones the selected recipe from its clone action', async () => {
        const cloneRecipe = vi.spyOn(client, 'cloneRecipe').mockReturnValue(new Promise(() => {}));

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Clone Fish Tacos' }));

        await waitFor(() => expect(cloneRecipe).toHaveBeenCalledWith('rec_9'));
    });
});

describe('RecipeDiscoveryScreen — browse rails (U7)', () => {
    it('shows the curated rails (not a bare stream) when nothing is active, with no sort', async () => {
        answerSearches(makeSearchResponse([makeRecipeSearchResult({ id: 'rec_1', title: 'Curated' })]));

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);

        expect(await screen.findByRole('heading', { name: 'Trending' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'New' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Quick' })).toBeTruthy();
        expect(screen.queryByRole('radiogroup', { name: 'Sort by' })).toBeNull();
    });

    it('⛔ keeps a rail that failed to load to ITSELF — the other rails render, and its Try again loads it', async () => {
        let quickFails = true;
        vi.spyOn(client, 'searchRecipes').mockImplementation(async (params) => {
            if (params?.pageSize !== undefined && params.sortBy === 'quickest' && quickFails) {
                throw new Error('down');
            }

            return makeSearchResponse([
                makeRecipeSearchResult({ id: `rec_${params?.sortBy ?? 'main'}`, title: `${params?.sortBy} dish` }),
            ]);
        });

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);

        expect(await screen.findByText('Couldn’t load this row.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'most-cloned dish' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Quick' })).toBeTruthy();

        quickFails = false;
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(await screen.findByRole('button', { name: 'quickest dish' })).toBeTruthy();
        expect(screen.queryByText('Couldn’t load this row.')).toBeNull();
        // The pressed Try again unmounted as the rail reloaded, so the cursor went to that rail's own heading.
        const quick = screen.getByRole('heading', { name: 'Quick' });
        const targets = vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.map(([target]) => target);
        expect(targets.length, 'the cursor was moved').toBeGreaterThan(0);
        expect(
            targets.every((target) => (target as unknown) === quick),
            'only to the retried rail’s heading',
        ).toBe(true);
    });

    it('⛔ refreshes THE RAILS from a pull while browsing — not the main search hidden behind them (review D1)', async () => {
        const search = answerSearches(makeSearchResponse([makeRecipeSearchResult({ id: 'rec_1', title: 'Curated' })]));

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Curated' }).length).toBeGreaterThan(2));
        search.mockClear();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pull to refresh' }));
        });

        await waitFor(() =>
            expect(search.mock.calls.filter(([params]) => params?.pageSize !== undefined)).toHaveLength(3),
        );
        expect(search.mock.calls.filter(([params]) => params?.pageSize === undefined)).toHaveLength(0);
    });

    it('offers the sort on the keystroke that starts a search, while the rails are still what is on screen', async () => {
        vi.spyOn(client, 'searchRecipes').mockImplementation((params) =>
            params?.query === undefined ? Promise.resolve(makeSearchResponse()) : new Promise(() => {}),
        );

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        await screen.findByRole('heading', { name: 'Trending' });

        fireEvent.change(screen.getByLabelText('Search public recipes'), { target: { value: 'l' } });

        expect(screen.getByRole('radiogroup', { name: 'Sort by' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Trending' })).toBeTruthy();
    });

    it('leaves the rails for a rail’s full list, and returns to them through Back to browse', async () => {
        const search = answerSearches(makeSearchResponse([makeRecipeSearchResult({ id: 'rec_1', title: 'Curated' })]));

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        fireEvent.click(await screen.findByRole('button', { name: 'See all Trending' }));

        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Trending' })).toBeNull());
        expect(search).toHaveBeenCalledWith({ sortBy: 'most-cloned', page: 1 });

        fireEvent.click(screen.getByRole('button', { name: 'Back to browse' }));

        expect(await screen.findByRole('heading', { name: 'Trending' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Back to browse' })).toBeNull();
    });
});

/**
 * A newer search pending behind the results on screen (`recipe-search.md`, "Updating Results State"): the previous
 * results stay, under the pending bar and still naming their own query, until the new ones settle — and only then is
 * the new header announced. Deliberately never `aria-busy` (EVALUATE R1): JAWS hides busy content, and these results
 * must stay readable while the next ones load.
 */
describe('RecipeDiscoveryScreen — a newer search pending behind the results on screen', () => {
    const tacos = makeRecipeSearchResult({ id: 'rec_1', title: 'Fish Tacos' });
    const tagine = makeRecipeSearchResult({ id: 'rec_2', title: 'Lamb Tagine' });

    /** Elements hidden from assistive tech — the native pending bar is one, so its arrival raises the count by one. */
    function hiddenCount(): number {
        return document.querySelectorAll('[aria-hidden="true"]').length;
    }

    function politeRegionSays(text: string): boolean {
        return Array.from(document.querySelectorAll('[aria-live="polite"]')).some((node) => node.textContent === text);
    }

    it('⛔ keeps the previous results, under the pending bar and naming their own query, with no loading body — then the new ones', async () => {
        const lamb = deferred<RecipeSearchResponse>();
        const search = vi
            .spyOn(client, 'searchRecipes')
            .mockImplementation((params) =>
                params?.query === 'lamb' ? lamb.promise : Promise.resolve(makeSearchResponse([tacos])),
            );

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);
        await screen.findByRole('button', { name: 'Fish Tacos' });
        const settledHidden = hiddenCount();

        fireEvent.change(screen.getByLabelText('Search public recipes'), { target: { value: 'lamb' } });
        await vi.waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'lamb' })));

        // The pending bar arrives after its delay; nothing is marked busy.
        await vi.waitFor(() => expect(hiddenCount()).toBe(settledHidden + 1));
        expect(document.querySelector('[aria-busy="true"]')).toBeNull();
        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(screen.getAllByText('1 recipe').filter((node) => node.getAttribute('aria-live') === null)).toHaveLength(
            1,
        );
        expect(screen.queryByLabelText('Loading recipes')).toBeNull();
        expect(politeRegionSays('Showing 1 recipe for “lamb”')).toBe(false);

        await act(async () => {
            lamb.resolve(makeSearchResponse([tagine]));
        });

        expect(await screen.findByRole('button', { name: 'Lamb Tagine' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Fish Tacos' })).toBeNull();
        expect(hiddenCount()).toBe(settledHidden);
        expect(politeRegionSays('Showing 1 recipe for “lamb”')).toBe(true);
    });

    it('keeps the previous results on screen while a new sort loads', async () => {
        const quickest = deferred<RecipeSearchResponse>();
        const search = vi
            .spyOn(client, 'searchRecipes')
            .mockImplementation((params) =>
                params?.sortBy === 'quickest' ? quickest.promise : Promise.resolve(makeSearchResponse([tacos])),
            );

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);
        await screen.findByRole('button', { name: 'Fish Tacos' });

        fireEvent.click(screen.getByRole('radio', { name: 'Quickest' }));
        await vi.waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'quickest' })));

        expect(screen.getByRole('radio', { name: 'Quickest' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading recipes')).toBeNull();
    });

    it('keeps the filter bar’s last settled facets while a newer search is pending', async () => {
        // The facets come from the settled search, so the filter groups do not collapse on every keystroke.
        const search = vi.spyOn(client, 'searchRecipes').mockImplementation((params) =>
            params?.query === 'lamb'
                ? new Promise(() => {})
                : Promise.resolve(
                      makeSearchResponse([tacos], {
                          facets: {
                              dietaryFlags: [{ value: 'vegan', count: 2 }],
                              tags: [],
                              cuisine: [],
                              totalTime: [],
                          },
                      }),
                  ),
        );

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);
        await screen.findByRole('button', { name: 'Fish Tacos' });

        fireEvent.change(screen.getByLabelText('Search public recipes'), { target: { value: 'lamb' } });
        await vi.waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'lamb' })));
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));

        expect(await screen.findByRole('button', { name: 'vegan, 2 recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
    });

    it('replaces the stale results with the load error when the newer search fails, and clears it on the next term', async () => {
        const search = vi
            .spyOn(client, 'searchRecipes')
            .mockImplementation((params) =>
                params?.query === 'lamb'
                    ? Promise.reject(new Error('down'))
                    : Promise.resolve(makeSearchResponse(params?.query === 'lambs' ? [tagine] : [tacos])),
            );

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} initialFilters={resultsMode} />);
        await screen.findByRole('button', { name: 'Fish Tacos' });
        const box = screen.getByLabelText('Search public recipes');

        fireEvent.change(box, { target: { value: 'lamb' } });

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect((box as HTMLInputElement).value).toBe('lamb');
        // The facets observer only READS the settled search: mounting it on the failed key must not send it again.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(search.mock.calls.filter(([params]) => params?.query === 'lamb')).toHaveLength(1);

        fireEvent.change(box, { target: { value: 'lambs' } });

        expect(await screen.findByRole('button', { name: 'Lamb Tagine' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

/**
 * The ingredient facet (FR-006 gap #3) end to end THROUGH the screen — the story `searchNavigation.yaml` walks
 * on-device. It failed in CI at exactly this seam (round 5): the option was named by the bare ingredient name, so the
 * harness's name-addressed tap resolved to the search FIELD (which holds the same string) instead of the option, and the
 * pick was silently dropped — the sheet closed with no chip, no count badge, and the browse rails still on screen.
 */
describe('RecipeDiscoveryScreen — ingredient facet (FR-006 gap #3)', () => {
    /** A catalog match whose name is EXACTLY what the test types — the collision the defect turned on. */
    const flour = { id: 'ing_flour', name: 'Flour', isUserEntered: false, createdAt: '2026-01-01T00:00:00Z' };

    /** Open the filter bottom sheet (U7) — every facet, the ingredient typeahead included, lives inside it. */
    function openFilters(): void {
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    }

    beforeEach(() => {
        // An empty result set, so an APPLIED ingredient filter lands on the no-match state and a DROPPED one leaves the
        // curated browse rails up — the two are distinguishable, which is the whole point.
        answerSearches(makeSearchResponse([]));
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([flour] as never);
    });

    it('applies a picked ingredient to the search, leaving browse for the no-match state', async () => {
        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);

        expect(await screen.findByRole('heading', { name: 'Trending' })).toBeTruthy();

        openFilters();
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Flour' } });

        // The option is addressable by its ACTION even though the field now holds the same word.
        const option = await screen.findByRole('button', { name: 'Filter by Flour' });
        expect((screen.getByLabelText('Search ingredients') as HTMLInputElement).value).toBe('Flour');
        fireEvent.click(option);

        // The id reached the wire params — the falsifiable core (a dropped facet sends no `ingredientIds`).
        await waitFor(() =>
            expect(client.searchRecipes).toHaveBeenCalledWith(
                expect.objectContaining({ ingredientIds: ['ing_flour'] }),
            ),
        );
        // …and the surface really left browse for the no-match state, with the trigger badging one filter.
        expect((await screen.findAllByText('No matching recipes')).length).toBeGreaterThan(0);
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Trending' })).toBeNull());
        expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeTruthy();
    });

    it('restores browse when the ingredient chip is removed', async () => {
        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        await screen.findByRole('heading', { name: 'Trending' });

        openFilters();
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Flour' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Filter by Flour' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Trending' })).toBeNull());

        fireEvent.click(screen.getByRole('button', { name: 'Remove Flour' }));

        expect(await screen.findByRole('heading', { name: 'Trending' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Remove Flour' })).toBeNull();
    });
});

describe('RecipeDiscoveryScreen — debounced search (U7)', () => {
    it('echoes the typed value immediately but debounces the value fed to the search', async () => {
        const search = answerSearches(makeSearchResponse());

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);

        const box = screen.getByLabelText('Search public recipes');
        fireEvent.change(box, { target: { value: 'ramen' } });

        // Immediate echo — the field carries the typed value at once.
        expect((box as HTMLInputElement).value).toBe('ramen');
        // The search has NOT yet been sent for 'ramen' (the debounced value still lags the input).
        expect(search).not.toHaveBeenCalledWith(expect.objectContaining({ query: 'ramen' }));

        // After the debounce window, the settled value is searched.
        await vi.waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'ramen' })));
    });
});

/**
 * Recent searches, end-to-end through the screen's `AsyncStorage` adapter (mocked with an in-memory store). The pure
 * list rules live in `recentSearches.test.ts` and the panel's visibility rules in `RecipeDiscoveryFrame.native.test.tsx`;
 * this block covers the wiring: only a search that RAN is recorded, a persisted history is offered on focus, choosing one
 * re-runs it, and clear-all empties both the panel and storage.
 */
describe('RecipeDiscoveryScreen — recent searches (U7)', () => {
    /** Focus the keyword field via the bubbling `focusin` React delegates `onFocus` to. */
    function focusSearch(): void {
        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));
    }

    it('records a search that actually ran and offers it once the field goes blank again', async () => {
        const search = answerSearches(makeSearchResponse());

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);

        const box = screen.getByLabelText('Search public recipes');
        fireEvent.change(box, { target: { value: 'ramen' } });
        await vi.waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'ramen' })));

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
        answerSearches(makeSearchResponse());

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        focusSearch();

        expect(await screen.findByRole('button', { name: 'Search for “risotto”' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Search for “lamb tagine”' })).toBeTruthy();
    });

    it('runs the chosen recent search', async () => {
        asyncStorageMock.store.set(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto']));
        const search = answerSearches(makeSearchResponse());

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        focusSearch();

        fireEvent.click(await screen.findByRole('button', { name: 'Search for “risotto”' }));

        expect((screen.getByLabelText('Search public recipes') as HTMLInputElement).value).toBe('risotto');
        await vi.waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'risotto' })));
    });

    it('clears the whole history, panel and storage alike', async () => {
        asyncStorageMock.store.set(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto', 'ramen']));
        answerSearches(makeSearchResponse());

        render(<RecipeDiscoveryScreen onSelectRecipe={noop} />);
        focusSearch();

        fireEvent.click(await screen.findByRole('button', { name: 'Clear recent searches' }));

        expect(screen.queryByRole('button', { name: /^Search for/ })).toBeNull();
        await vi.waitFor(() =>
            expect(asyncStorageMock.store.get(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify([])),
        );
    });
});
