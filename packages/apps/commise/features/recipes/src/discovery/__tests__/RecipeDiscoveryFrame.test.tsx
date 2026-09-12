// @vitest-environment jsdom
/**
 * Component tests for the web discovery FRAME — the chrome that renders outside the discovery suspense boundary:
 * heading, source switcher, search field with its recent-search panel, filter slot, back-to-browse, sort, and the
 * region that announces settled results. Whatever the boundary renders below it arrives as `children`.
 *
 * Moved from the retired `RecipeDiscoveryList.test.tsx` ("chrome", "source switcher (L5)", "recent searches (U7)", the
 * sort and back-to-browse cases of "populated state" and "browse slot (U7)", their touch-floor and contrast cases, the
 * focus ring, and the refresh notice's focus hand-off — which now arrives as `headingFocusSignal`). The frame no longer
 * decides whether sort and back-to-browse show while browsing: the container passes them only when they apply, which
 * `RecipeDiscoveryContainer.test.tsx` covers. "Keeps the switcher in every body state" is now structural — the body is
 * `children` — and is asserted as that.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';

import { ringContrast, utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import { RecipeDiscoveryFrame } from '../RecipeDiscoveryFrame.js';
import type { RecipeDiscoveryFrameProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

/** The source switcher's destinations — the web app's real `/{locale}/…` pair. */
const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

function frame(overrides: Partial<RecipeDiscoveryFrameProps> = {}) {
    return (
        <RecipeDiscoveryFrame
            searchValue=""
            onSearchChange={noop}
            searching={false}
            headingFocusSignal={0}
            {...overrides}
        >
            {overrides.children ?? <button type="button">boundary content</button>}
        </RecipeDiscoveryFrame>
    );
}

function renderFrame(overrides: Partial<RecipeDiscoveryFrameProps> = {}) {
    return render(frame(overrides));
}

describe('RecipeDiscoveryFrame (web) — chrome', () => {
    it('renders the heading, the search box and whatever the boundary below it renders', () => {
        renderFrame();

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
        expect(screen.getByRole('searchbox', { name: 'Search public recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'boundary content' })).toBeTruthy();
    });

    it('reflects the controlled search value', () => {
        renderFrame({ searchValue: 'risotto' });

        expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('risotto');
    });

    it('reports search input changes upward', async () => {
        const user = userEvent.setup();
        const onSearchChange = vi.fn();
        renderFrame({ onSearchChange });

        // `user.paste`, not `user.type`: the input is controlled by an inert `vi.fn()`, so React resets the node to the
        // unchanged prop after every keystroke and typing would report four one-letter values. A paste fires one input
        // event with the whole value through the same `onChange`.
        await user.click(screen.getByRole('searchbox'));
        await user.paste('lamb');

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });

    it('renders the filter slot under the search field, above the boundary', () => {
        renderFrame({ filterSlot: <div>FILTER BAR</div> });

        const filters = screen.getByText('FILTER BAR');
        const search = screen.getByRole('searchbox');
        const boundary = screen.getByRole('button', { name: 'boundary content' });

        expect(search.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(filters.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('RecipeDiscoveryFrame (web) — source switcher (L5)', () => {
    // THE regression this surface existed without: it rendered a heading and nothing else, so a viewer who chose
    // "Community" on /recipes arrived here with no route back to their own library. The switcher's own contract lives
    // in `../../list/__tests__/RecipeSourceTabs.test.tsx`; what belongs here is that this surface MOUNTS it.
    it('renders no source switcher when no tab prop is given (a shell may own it)', () => {
        renderFrame();

        expect(screen.queryByRole('navigation', { name: 'Recipe source' })).toBeNull();
    });

    it('offers a link BACK to My Recipes, with Community marked as the current source', () => {
        renderFrame({ tab: { active: 'community', href: HREF } });

        const nav = screen.getByRole('navigation', { name: 'Recipe source' });
        expect(within(nav).getByRole('link', { name: 'My Recipes' }).getAttribute('href')).toBe('/en/recipes');
        expect(within(nav).getByRole('link', { name: 'Community' }).getAttribute('aria-current')).toBe('page');
    });

    it('keeps the switcher above ANY body — the way back cannot depend on the search having succeeded', () => {
        renderFrame({ tab: { active: 'community', href: HREF }, children: <div role="alert">load failed</div> });

        expect(screen.getByRole('link', { name: 'My Recipes' }).getAttribute('href')).toBe('/en/recipes');
        expect(screen.getByRole('alert')).toBeTruthy();
    });
});

describe('RecipeDiscoveryFrame (web) — sort (S3)', () => {
    it('renders the sort control with the active option checked and reports a change', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderFrame({ searching: true, sort: { active: RecipeSearchSortBy.RELEVANCE, onChange } });

        const group = screen.getByRole('radiogroup', { name: 'Sort by' });
        expect(within(group).getByRole('radio', { name: 'Relevance' }).getAttribute('aria-checked')).toBe('true');
        expect(within(group).getByRole('radio', { name: 'Quickest' }).getAttribute('aria-checked')).toBe('false');

        await user.click(within(group).getByRole('radio', { name: 'Quickest' }));
        expect(onChange).toHaveBeenCalledWith('quickest');
    });

    it('renders no sort control when no sort prop is given (the container omits it while browsing)', () => {
        renderFrame();

        expect(screen.queryByRole('radiogroup', { name: 'Sort by' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (web) — back to browse (U7)', () => {
    it('renders a back-to-browse action and reports it', async () => {
        const user = userEvent.setup();
        const onExitToBrowse = vi.fn();
        renderFrame({ onExitToBrowse });

        await user.click(screen.getByRole('button', { name: 'Back to browse' }));

        expect(onExitToBrowse).toHaveBeenCalledTimes(1);
    });

    it('renders no back-to-browse action when none is offered', () => {
        renderFrame();

        expect(screen.queryByRole('button', { name: 'Back to browse' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (web) — recent searches (U7)', () => {
    const recent = { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop };

    /** Focus the search field — the panel is an idle-state affordance, not always-on chrome. */
    async function focusSearch(user: ReturnType<typeof userEvent.setup>): Promise<void> {
        await user.click(screen.getByRole('searchbox', { name: 'Search public recipes' }));
    }

    it('renders nothing when the surface wires no recent-search memory', async () => {
        const user = userEvent.setup();
        renderFrame();

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('stays hidden until the search field is focused', () => {
        renderFrame({ recentSearches: recent });

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('lists the recent searches, newest first, once focused while not searching', async () => {
        const user = userEvent.setup();
        renderFrame({ recentSearches: recent });

        await focusSearch(user);

        const panel = screen.getByRole('region', { name: 'Recent searches' });
        const options = within(panel).getAllByRole('button', { name: /^Search for/ });
        expect(options.map((option) => option.textContent)).toEqual(['risotto', 'pasta']);
    });

    it('stays hidden while searching, even when focused — a typed query OR an active filter is the RESULT state', async () => {
        // `searching` is query OR filters. A filter applied from the sheet leaves the query blank, and gating on the
        // query alone once left this idle-only panel drawn over the result list — on a phone it covered the middle of
        // the screen, where a swipe to scroll the results lands.
        const user = userEvent.setup();
        renderFrame({ searchValue: '', searching: true, recentSearches: recent });

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('renders no panel at all when the history is empty', async () => {
        const user = userEvent.setup();
        renderFrame({ recentSearches: { ...recent, queries: [] } });

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('reports the chosen recent search upward (so the container runs it)', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderFrame({ recentSearches: { ...recent, onSelect } });

        await focusSearch(user);
        // Clicking a suggestion moves focus INTO the panel: if a blur handler tore the panel down first, this click
        // would never land — the regression this asserts.
        await user.click(screen.getByRole('button', { name: 'Search for “pasta”' }));

        expect(onSelect).toHaveBeenCalledWith('pasta');
    });

    it('reports clear-all upward', async () => {
        const user = userEvent.setup();
        const onClear = vi.fn();
        renderFrame({ recentSearches: { ...recent, onClear } });

        await focusSearch(user);
        await user.click(screen.getByRole('button', { name: 'Clear recent searches' }));

        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('hides again once focus leaves the search area entirely', async () => {
        const user = userEvent.setup();
        renderFrame({ recentSearches: recent });

        await focusSearch(user);
        expect(screen.getByRole('region', { name: 'Recent searches' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'boundary content' }));

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (web) — announcing settled results', () => {
    /**
     * The region is mounted EMPTY with the frame, outside the boundary, so it exists before any result does: a live
     * region that mounts with its text already inside is not reliably announced, and the results body is swapped out
     * for loading, error and no-match states. Its text is the settled header sentence, so identical results (a sort
     * change with the same count) stay silent.
     */
    function announcementRegion(): HTMLElement {
        const regions = screen.getAllByRole('status').filter((node) => node.classList.contains('sr-only'));
        expect(regions, 'exactly one visually hidden announcement region').toHaveLength(1);

        return regions[0] as HTMLElement;
    }

    it('mounts the region empty while no results have settled', () => {
        renderFrame();

        expect(announcementRegion().textContent).toBe('');
    });

    it('announces the settled results header, naming the query they belong to', () => {
        const { rerender } = renderFrame();

        rerender(frame({ resultsSummary: { count: 9, query: 'pasta', searching: true } }));

        expect(announcementRegion().textContent).toBe('Showing 9 recipes for “pasta”');
    });

    it('announces a search that settled with nothing as a no-match', () => {
        renderFrame({ resultsSummary: { count: 0, query: 'tiramisu', searching: true } });

        expect(announcementRegion().textContent).toBe('No matching recipes');
    });

    it('keeps the region outside the boundary’s body, so swapping the body never remounts it', () => {
        const { rerender } = renderFrame({ resultsSummary: { count: 2, query: '', searching: false } });
        const before = announcementRegion();

        rerender(frame({ resultsSummary: { count: 2, query: '', searching: false }, children: <p>loading</p> }));

        expect(announcementRegion()).toBe(before);
    });
});

describe('RecipeDiscoveryFrame (web) — heading focus', () => {
    it('⛔ moves focus to the heading when the recovery signal changes, since the notice’s button is gone', () => {
        const { rerender } = renderFrame({ headingFocusSignal: 0 });

        rerender(frame({ headingFocusSignal: 1 }));

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Discover recipes' }));
    });

    it('leaves focus alone on the first render', () => {
        renderFrame({ headingFocusSignal: 0 });

        expect(document.activeElement).toBe(document.body);
    });
});

describe('RecipeDiscoveryFrame (web) — touch targets (44px floor)', () => {
    /**
     * Every interactive control on this surface clears the 44px floor the rest of the app was raised to (`min-h-11` at
     * base, reset at `md:` for the mouse — the `@commise/ui` Button recipe's own treatment). The native leaf already
     * carries `minHeight: 44` on its equivalents, so a web control without it is also a parity break.
     */
    function expectTouchFloor(control: HTMLElement, what: string): void {
        expect(control.className, `${what} has no 44px touch floor`).toContain('min-h-11');
        expect(control.className, `${what} does not reset the floor for the mouse`).toContain('md:min-h-0');
    }

    it('gives the back-to-browse action the floor', () => {
        renderFrame({ onExitToBrowse: noop });

        expectTouchFloor(screen.getByRole('button', { name: 'Back to browse' }), 'back to browse');
    });

    it('gives every sort option the floor', () => {
        renderFrame({ searching: true, sort: { active: RecipeSearchSortBy.RELEVANCE, onChange: noop } });

        for (const option of within(screen.getByRole('radiogroup', { name: 'Sort by' })).getAllByRole('radio')) {
            expectTouchFloor(option, `sort option ${option.textContent ?? ''}`);
        }
    });

    it('gives the clear control and every recent-search row the floor', async () => {
        const user = userEvent.setup();
        renderFrame({ recentSearches: { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop } });

        await user.click(screen.getByRole('searchbox', { name: 'Search public recipes' }));

        expectTouchFloor(screen.getByRole('button', { name: 'Clear recent searches' }), 'clear recent searches');

        for (const option of screen.getAllByRole('button', { name: /^Search for/ })) {
            expectTouchFloor(option, `recent search ${option.textContent ?? ''}`);
        }
    });
});

describe('RecipeDiscoveryFrame (web) — text contrast (WCAG 2.1 AA)', () => {
    /**
     * Every tertiary control here is TEXT a reader reads, so it owes the 4.5:1 SC 1.4.3 floor. The ratio is read from
     * the class list the control actually rendered, and the HOVER state is measured as its own state, because a control
     * that clears the floor at rest and drops under it under the cursor is still inaccessible.
     */
    const CARD = semantic.card;
    const PAGE = semantic.background;

    it('keeps the clear-recent-searches control legible at rest and under its mist hover tint', async () => {
        const user = userEvent.setup();
        renderFrame({ recentSearches: { queries: ['risotto'], onSelect: noop, onClear: noop } });
        await user.click(screen.getByRole('searchbox', { name: 'Search public recipes' }));

        const clear = screen.getByRole('button', { name: 'Clear recent searches' });
        expect(utilityContrast(clear.className, { surface: CARD }), 'at rest on the panel').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(clear.className, { surface: CARD, variant: 'hover' }),
            'under its hover:bg-mist/20 tint',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the back-to-browse control legible at rest and under its mist hover tint', () => {
        renderFrame({ onExitToBrowse: noop });

        // It paints no card of its own, so it sits on the page background — darker than white, the stricter surface.
        const back = screen.getByRole('button', { name: 'Back to browse' });
        expect(utilityContrast(back.className, { surface: PAGE }), 'at rest on the page').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(back.className, { surface: PAGE, variant: 'hover' }),
            'under its hover:bg-mist/20 tint',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the search field’s PLACEHOLDER text legible on the field', () => {
        renderFrame();

        // The placeholder is the field's only visible instruction before typing, so it owes 4.5:1 like body copy; `mist`
        // measured 1.90:1. The base `text-charcoal` is the value colour and would mask the defect, so the placeholder
        // state is measured as its own state.
        const search = screen.getByRole('searchbox', { name: 'Search public recipes' });

        expect(
            utilityContrast(search.className, { surface: CARD, variant: 'placeholder' }),
            'placeholder on the card-white field',
        ).toBeGreaterThanOrEqual(4.5);
    });

    /**
     * The frame is a `<section>` on the app background, which is what the search field's focus ring is drawn on (a
     * Tailwind ring is a spread box-shadow outside the border box). It shipped as `ring-seafoam-light` (2.58:1), under
     * SC 1.4.11's 3:1 (#114), and with `outline-none` it is a keyboard viewer's only position cue.
     */
    it('rings the search box legibly against the page it sits on, out-measuring the `seafoam-light` it replaced', () => {
        renderFrame();

        const search = screen.getByRole('searchbox', { name: 'Search public recipes' });

        expect(search.className, 'the browser outline is suppressed, so the ring is the whole indicator').toContain(
            'outline-none',
        );
        expect(ringContrast(search.className, { surface: PAGE })).toBeGreaterThanOrEqual(3);
        expect(ringContrast(search.className, { surface: PAGE })).toBeGreaterThan(
            ringContrast('ring-2 ring-seafoam-light', { surface: PAGE }),
        );
    });
});
