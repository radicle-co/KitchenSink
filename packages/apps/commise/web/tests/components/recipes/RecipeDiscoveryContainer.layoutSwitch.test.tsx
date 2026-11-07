// @vitest-environment jsdom
/**
 * Discover across a WIDTH SWITCH: what a person keeps when `<main>` crosses the wide breakpoint and the filters move from
 * the Filters button and its sheet to the panel beside the results, or back.
 *
 * The presentation comes from `<main>`'s measured width (`useFilterPresentation` → `useMainContainerClass`, a
 * `ResizeObserver` read as a `useSyncExternalStore` source). It is `narrow` until measured, so on a wide screen the switch
 * happens once right after the first paint, and again whenever the window is resized or a tablet is turned across the
 * breakpoint. The frame used to draw the two presentations as two different trees, so every switch remounted the search
 * field, the count line and the whole results body: focus went to the page, a rail's scroll went back to its start.
 *
 * jsdom lays nothing out, so `<main>`'s width is served by the test and the observer is one the test fires, the way
 * `useMainContainerClass.test.tsx` drives it. A rail's scroll offset is not something jsdom computes, so it is proved by
 * the rail's scroller being the SAME element after the switch: a new element starts at offset 0 in a browser.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeNutritionResponse } from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';

import { renderWithSnackbar } from './__fixtures__/renderCollectionDetail';
import { makeSearchFacets, makeSearchResponse, makeSearchResult } from './__fixtures__/discoveryFixtures';
import { makeRecipe } from './__fixtures__/recipeFixtures';

const { nav } = vi.hoisted(() => ({ nav: { params: new URLSearchParams(), pathname: '/en/discover' } }));

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ userId: 'user_a' }) }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
    usePathname: () => nav.pathname,
    useSearchParams: () => nav.params,
}));

/** Below the 600 px `regular` threshold: the Filters button and its sheet. */
const NARROW_PX = 500;
/** Above the 960 px `wide` threshold: the panel beside the results. */
const WIDE_PX = 1200;

const width = { px: NARROW_PX };

/** A ResizeObserver the test drives: firing it tells `useMainContainerClass` to read `<main>`'s width again. */
class FakeObserver {
    static instances: FakeObserver[] = [];

    constructor(readonly callback: ResizeObserverCallback) {
        FakeObserver.instances.push(this);
    }

    observe(): void {}

    disconnect(): void {}
}

/** Resize `<main>` and tell every observer, as the browser does after layout. */
function resizeMainTo(px: number): void {
    width.px = px;
    act(() => {
        for (const observer of FakeObserver.instances) {
            observer.callback([], observer as unknown as ResizeObserver);
        }
    });
}

function setUrlQuery(query: string): void {
    nav.params = new URLSearchParams(query);
    window.history.replaceState(null, '', query.length > 0 ? `${nav.pathname}?${query}` : nav.pathname);
}

/** A client whose calorie lookup never settles: calories are not this file's subject (see the container suite). */
function discoveryClient(): ReturnType<typeof createFakeRecipeServiceClient> {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getRecipeNutrition').mockReturnValue(new Promise<RecipeNutritionResponse>(() => undefined));
    vi.spyOn(client, 'searchRecipes').mockResolvedValue(
        makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) })], {
            facets: makeSearchFacets({ dietaryFlags: [{ value: 'vegan', count: 2 }] }),
        }),
    );

    return client;
}

function renderDiscover(client: ReturnType<typeof createFakeRecipeServiceClient>) {
    return renderWithSnackbar(
        <main>
            <RecipeDiscoveryContainer locale="en" />
        </main>,
        client,
    );
}

/**
 * A result's row in the list. The row, not the card's link: the card itself is chosen by the same width (compact below
 * a 600 container, grid from it), so crossing the breakpoint draws the other card in the SAME row by design.
 */
function resultRow(link: HTMLElement): HTMLElement {
    const row = link.closest('li');
    expect(row, 'a result sits in a list row').not.toBeNull();

    return row as HTMLElement;
}

/** The panel is the presentation on screen. Without this, every "it survived" below could be a switch that never happened. */
function expectPanel(): void {
    expect(screen.getByRole('complementary', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Filters/u })).not.toBeInTheDocument();
}

beforeEach(() => {
    width.px = NARROW_PX;
    FakeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeObserver);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width.px);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setUrlQuery('');
});

describe('RecipeDiscoveryContainer — switching from the Filters sheet to the panel', () => {
    it('keeps each rail’s scroller, so a rail scrolled part way stays where it was', async () => {
        renderDiscover(discoveryClient());
        const trending = await screen.findByRole('region', { name: 'Trending recipes' });
        const browse = screen.getByRole('region', { name: 'Browse recipes' });

        resizeMainTo(WIDE_PX);

        expectPanel();
        expect(screen.getByRole('region', { name: 'Trending recipes' })).toBe(trending);
        expect(screen.getByRole('region', { name: 'Browse recipes' })).toBe(browse);
    });

    it('keeps the typed search, the field’s focus and the results, with no loading state in between', async () => {
        const user = userEvent.setup();
        renderDiscover(discoveryClient());
        const search = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search recipes' });

        await user.type(search, 'pasta');
        const result = resultRow(await screen.findByRole('link', { name: 'Weeknight Pasta' }));

        resizeMainTo(WIDE_PX);

        expectPanel();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBe(search);
        expect(search.value).toBe('pasta');
        expect(document.activeElement).toBe(search);
        expect(resultRow(screen.getByRole('link', { name: 'Weeknight Pasta' }))).toBe(result);
        expect(screen.queryByRole('status', { name: 'Loading recipes' })).not.toBeInTheDocument();
    });

    // The chosen filters live in the address (the criteria store), above the frame. The mocked `useSearchParams` does not
    // follow `replaceState`, so the filter is put in the address the way a shared link would, and seen pressed in the sheet
    // first.
    it('keeps the chosen filter, pressed in the sheet and then in the panel', async () => {
        setUrlQuery('dietaryFlags=vegan');
        const user = userEvent.setup();
        renderDiscover(discoveryClient());

        await user.click(await screen.findByRole('button', { name: /^Filters/u }));
        expect((await screen.findByRole('button', { name: 'Vegan 2' })).getAttribute('aria-pressed')).toBe('true');
        await user.keyboard('{Escape}');

        resizeMainTo(WIDE_PX);

        expectPanel();
        expect(screen.getByRole('button', { name: 'Vegan 2' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps a rail’s “See all” list, with its way back to the rails', async () => {
        const user = userEvent.setup();
        renderDiscover(discoveryClient());

        await user.click(await screen.findByRole('button', { name: 'See all Trending' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Trending' })).not.toBeInTheDocument());
        const result = resultRow(screen.getByRole('link', { name: 'Weeknight Pasta' }));

        resizeMainTo(WIDE_PX);

        expectPanel();
        expect(screen.queryByRole('heading', { name: 'Trending' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Back to browse' })).toBeInTheDocument();
        expect(resultRow(screen.getByRole('link', { name: 'Weeknight Pasta' }))).toBe(result);
    });
});

describe('RecipeDiscoveryContainer — switching from the panel back to the Filters sheet', () => {
    it('keeps the rails’ scrollers and the search field', async () => {
        width.px = WIDE_PX;
        renderDiscover(discoveryClient());
        const trending = await screen.findByRole('region', { name: 'Trending recipes' });
        expectPanel();
        const search = screen.getByRole('searchbox', { name: 'Search recipes' });

        resizeMainTo(NARROW_PX);

        expect(screen.getByRole('button', { name: /^Filters/u })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Trending recipes' })).toBe(trending);
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBe(search);
    });
});
