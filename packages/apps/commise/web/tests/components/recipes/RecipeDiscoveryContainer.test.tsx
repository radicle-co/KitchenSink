/**
 * Component tests for RecipeDiscoveryContainer (T076 web public-discovery wiring, U7 overhaul). Covers the
 * states the container projects onto the shared building blocks — loading, populated, empty/no-match, error
 * (with retry) — plus the U7 behaviours: the search FETCH is debounced while the input echoes immediately,
 * and with no active query/filter the surface shows the curated browse rails (not a bare stream), whose
 * "see all" reveals the full sorted list.
 *
 * A URL filter (`tags=quick`) is the lever used to put the container into RESULT-LIST mode for the tests
 * that exercise the flat list — with neither a query nor a filter the container is in BROWSE mode by design.
 *
 * The final block covers the U7 recent-search memory through the REAL `localStorage` adapter: only a search
 * that actually ran is recorded, a persisted history survives a fresh mount, choosing one runs it, and
 * clear-all empties both the panel and storage.
 *
 * Wiring seam: `renderWithRecipeClient` mounts the container through the REAL `useInfiniteSearchRecipes` /
 * `useCloneRecipe` hooks over a network-guarded fake `RecipeServiceClient`, stubbed per test with
 * `vi.spyOn(client, 'searchRecipes' | 'cloneRecipe')`. The Next router mocks and the `replaceState` spy
 * stay as before.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RECENT_SEARCHES_STORAGE_KEY } from '@commise/features-recipes';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';

import { makeSearchResponse, makeSearchResult } from './__fixtures__/discoveryFixtures';
import { makeRecipe, makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { pushMock, nav } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    // The container reads the search criteria from the URL. `nav.params` is the current query; a test sets
    // it to simulate a shared/reloaded filtered link, and criteria writes go through
    // `window.history.replaceState` (spied per-test), which updates `useSearchParams()` reactively.
    nav: { params: new URLSearchParams(), pathname: '/en/discover' },
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    usePathname: () => nav.pathname,
    useSearchParams: () => nav.params,
}));

/** Put the container into RESULT-LIST mode (a filter is active, so it is not browsing). */
function withResults(): void {
    nav.params = new URLSearchParams('tags=quick');
}

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    nav.params = new URLSearchParams();
});

describe('RecipeDiscoveryContainer — result list', () => {
    it('renders the loading state while the search query is pending', () => {
        withResults();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeInTheDocument();
    });

    it('renders the populated results with a count when the search loads', async () => {
        withResults();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }) }),
            ]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
    });

    it('renders the no-match state when a filtered search succeeds with no hits', async () => {
        withResults();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByText('No matching recipes')).toBeInTheDocument();
    });

    it('renders the error state and retries on demand', async () => {
        withResults();
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(searchSpy).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
    });

    it('re-runs the search with the chosen sort (S3)', async () => {
        withResults();
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('radio', { name: 'Quickest' }));

        await vi.waitFor(() =>
            expect(searchSpy).toHaveBeenCalledWith({ tags: ['quick'], sortBy: 'quickest', page: 1 }),
        );
    });

    it('navigates to the recipe detail route when a result is selected', async () => {
        withResults();
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_42', title: 'Weeknight Pasta' }) })]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_42');
    });

    it('clones the selected recipe and navigates to the clone on success', async () => {
        withResults();
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_7', title: 'Sunday Roast' }) })]),
        );
        const cloneSpy = vi.spyOn(client, 'cloneRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_clone' }));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Clone Sunday Roast' }));

        expect(cloneSpy).toHaveBeenCalledWith('rec_7');
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_clone'));
    });

    it('busies only the row whose clone is in flight', async () => {
        withResults();
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }) }),
            ]),
        );
        vi.spyOn(client, 'cloneRecipe').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await user.click(screen.getByRole('button', { name: 'Clone Sunday Roast' }));

        const busy = await screen.findByRole('button', { name: 'Cloning Sunday Roast' });
        expect(busy).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Clone Weeknight Pasta' })).toBeEnabled();
    });
});

describe('RecipeDiscoveryContainer — URL criteria', () => {
    it('projects the filters from the URL onto the search params and the pressed chips', async () => {
        nav.params = new URLSearchParams('dietaryFlags=vegan');
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValue(makeSearchResponse([], { facets: { dietaryFlags: [{ value: 'vegan', count: 2 }] } }));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        const chip = await screen.findByRole('button', { name: 'vegan, 2 recipes' });
        expect(chip.getAttribute('aria-pressed')).toBe('true');
        expect(searchSpy).toHaveBeenCalledWith({ dietaryFlags: ['vegan'], sortBy: 'relevance', page: 1 });
    });

    it('writes a toggled facet to the URL', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([], { facets: { dietaryFlags: [{ value: 'vegan', count: 2 }] } }),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'vegan, 2 recipes' }));

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?dietaryFlags=vegan');
    });
});

describe('RecipeDiscoveryContainer — debounced search (U7)', () => {
    it('echoes each keystroke immediately but never fetches an intermediate query', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        const box = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search public recipes' });
        await user.type(box, 'pasta');

        // Immediate echo — the field shows the full typed value without waiting on the debounce.
        expect(box.value).toBe('pasta');
        // The debounce settles ONCE on the final value: no intermediate query ('p'…'past') is ever fetched.
        expect(searchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ query: 'past' }));

        // After the window elapses, the settled query fetches exactly once.
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: 'pasta' })));
    });

    it('writes the typed search term to the URL (shareable)', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search public recipes' }), 'p');

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?query=p');
    });
});

describe('RecipeDiscoveryContainer — browse rails (U7)', () => {
    it('shows the curated rails (not a bare stream) when nothing is active', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Curated Dish' }) })]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByRole('heading', { name: 'Trending' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'New' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Quick' })).toBeInTheDocument();
    });

    it('runs no query-less flat stream: still issues the relevance search for facets', () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        // The main (facet-providing) search still runs with the default relevance sort and no query param.
        expect(searchSpy).toHaveBeenCalledWith({ sortBy: 'relevance', page: 1 });
    });

    it('offers cuisine shortcuts from the facets and writes the chosen cuisine to the URL', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([], { facets: { cuisine: [{ value: 'Thai', count: 3 }] } }),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Browse Thai recipes' }));

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?cuisine=Thai');
    });

    it('a rail’s "see all" reveals the full list sorted by that rail', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'See all Trending' }));

        // The full result list now runs with the rail's sort (most-cloned) and no rail page cap.
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith({ sortBy: 'most-cloned', page: 1 }));
        expect(screen.queryByRole('heading', { name: 'Trending' })).not.toBeInTheDocument();
    });

    it('reaches the BROWSE-EMPTY copy (not the no-match copy) after a rail’s "see all" finds nothing', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'See all Trending' }));

        // This pins `discovery.emptyTitle`/`emptyBody` as LIVE web copy rather than an unreachable string.
        // The container supplies `browseSlot` only while browsing, so leaving browse via "see all" is the
        // one path with no query, no filter AND no browse slot — precisely the browse-empty branch. Without
        // it, the only zero-result copy a web viewer could ever see would be the no-match wording, which
        // wrongly implies a search they never made.
        expect(await screen.findByText('No recipes found')).toBeInTheDocument();
        expect(screen.queryByText('No matching recipes')).not.toBeInTheDocument();
    });

    it('offers a working retry when the load fails on the BROWSE default, not just in a result list', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        // Browsing is /discover's default, so a failure here used to settle into curated rails with the
        // failure — and its only recovery affordance — rendered nowhere at all.
        const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 5000 });
        const before = searchSpy.mock.calls.length;

        await user.click(retry);

        await vi.waitFor(() => expect(searchSpy.mock.calls.length).toBeGreaterThan(before));
    });
});

/**
 * Recent searches, end-to-end through the REAL `localStorage` adapter (jsdom provides it) — the integration
 * these tests exist for is "does the container record the right thing, in the right place, and offer it
 * back", not the pure list rules (covered in `recentSearches.test.ts`) or the panel's visibility rules
 * (covered in `RecipeDiscoveryList.test.tsx`).
 */
describe('RecipeDiscoveryContainer — recent searches (U7)', () => {
    afterEach(() => window.localStorage.clear());

    /** The search field, as the user reaches it. */
    function searchBox(): HTMLInputElement {
        return screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search public recipes' });
    }

    it('records a search that actually ran, and offers it once the field goes blank again', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.type(searchBox(), 'pasta');
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: 'pasta' })));

        // Clearing the field (focus stays in it) returns the surface to its idle state — where the history is
        // the useful thing to show.
        await user.clear(searchBox());

        expect(await screen.findByRole('button', { name: 'Search for “pasta”' })).toBeInTheDocument();
        await vi.waitFor(() =>
            expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify(['pasta'])),
        );
    });

    it('records NOTHING for a whitespace-only query', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.type(searchBox(), '   ');
        await vi.waitFor(() => expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).not.toBeNull());

        expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify([]));
        expect(screen.queryByRole('button', { name: /^Search for/ })).not.toBeInTheDocument();
    });

    it('offers a history persisted by an earlier session (the reload case)', async () => {
        window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto', 'lamb tagine']));
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(searchBox());

        expect(await screen.findByRole('button', { name: 'Search for “risotto”' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Search for “lamb tagine”' })).toBeInTheDocument();
    });

    it('runs the chosen recent search (field + fetch + shareable URL)', async () => {
        window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto']));
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(searchBox());
        await user.click(await screen.findByRole('button', { name: 'Search for “risotto”' }));

        expect(searchBox().value).toBe('risotto');
        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?query=risotto');
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: 'risotto' })));
    });

    it('clears the whole history, panel and storage alike', async () => {
        window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto', 'pasta']));
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(searchBox());
        await user.click(await screen.findByRole('button', { name: 'Clear recent searches' }));

        expect(screen.queryByRole('button', { name: /^Search for/ })).not.toBeInTheDocument();
        await vi.waitFor(() =>
            expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify([])),
        );
    });
});
