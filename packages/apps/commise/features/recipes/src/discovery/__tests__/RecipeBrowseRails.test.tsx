// @vitest-environment jsdom
/**
 * ⚠️ REWRITTEN for slice 5 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.4). The rails lose the teal
 * accent bar under their heading, "See all" becomes a ghost button, a rail's track becomes a focusable region the arrow
 * keys scroll, a fine pointer gets Previous and Next buttons, the cuisine shortcuts become a row of chips, and a card's
 * Save a copy replaces its Clone. The accent-bar test is deleted with the accent; the heading-focus, refresh-notice and
 * enter-motion assertions are kept.
 *
 * Component tests for the web curated browse-rails block (U7, net-new). Covers the default browse surface shown when
 * discovery has no active query/filter: the three fixed-sort rails (Trending/New/Quick) with a per-rail "see all", each
 * rail's body, the cuisine shortcuts, the enter motion, and the ONE refresh notice — so the rails cannot silently
 * regress into a bare stream.
 *
 * REWRITTEN for the per-rail read boundaries: each rail's body is now a slot (its own boundary renders loading, a load
 * error, or `RecipeBrowseRailResults`), so the block no longer knows a rail's status. "Rail states" moved to
 * `RecipeBrowseRailLoading.test.tsx`, `RecipeBrowseRailLoadError.test.tsx` and `RecipeBrowseRailResults.test.tsx`; the
 * bodies here are the real results leaf, so selection still crosses the composition.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';

import { utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import { makeRecipe } from '../../__fixtures__/index.js';
import type { SaveCopy } from '../../hooks/useSaveCopy.js';
import { RecipeBrowseRailResults } from '../RecipeBrowseRailResults.js';
import { RecipeBrowseRails } from '../RecipeBrowseRails.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

/** A save-a-copy surface where nothing has been copied. */
const SAVE_COPY: SaveCopy = { stateOf: () => ({ kind: 'idle' }), save: noop };

function result(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

/** A rail whose body is the settled results leaf over `results`. */
function rail(
    id: RecipeBrowseRailId,
    results: readonly RecipeSearchResult[],
    overrides: Partial<RecipeBrowseRailView> & { readonly onSelectRecipe?: (id: string) => void } = {},
): RecipeBrowseRailView {
    const { onSelectRecipe = noop, ...view } = overrides;

    return {
        id,
        onSeeAll: noop,
        headingFocusSignal: 0,
        body: <RecipeBrowseRailResults results={results} saveCopy={SAVE_COPY} onSelectRecipe={onSelectRecipe} />,
        ...view,
    };
}

function threeRails(onSelectRecipe: (id: string) => void = noop): readonly RecipeBrowseRailView[] {
    return [
        rail('trending', [result({ id: 'rec_t', title: 'Viral Pad Thai' })], { onSelectRecipe }),
        rail('new', [result({ id: 'rec_n', title: 'Fresh Ceviche' })], { onSelectRecipe }),
        rail('quick', [result({ id: 'rec_q', title: 'Ten-Minute Omelette' })], { onSelectRecipe }),
    ];
}

function renderRails(overrides: Partial<RecipeBrowseRailsProps> = {}) {
    const props: RecipeBrowseRailsProps = { rails: threeRails(), cuisines: [], ...overrides };
    render(<RecipeBrowseRails {...props} />);

    return props;
}

describe('RecipeBrowseRails (web) — rails', () => {
    it('renders the three curated rails with their titles', () => {
        renderRails();

        expect(screen.getByRole('heading', { name: 'Trending' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'New' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Quick' })).toBeTruthy();
    });

    it('renders each rail’s recipe cards', () => {
        renderRails();

        expect(screen.getByRole('button', { name: 'Viral Pad Thai' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fresh Ceviche' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Ten-Minute Omelette' })).toBeTruthy();
    });

    it('reports a "see all" for the rail that was activated', async () => {
        const user = userEvent.setup();
        const onSeeAll = vi.fn();
        renderRails({ rails: [rail('trending', [result({ id: 'rec_t', title: 'Viral Pad Thai' })], { onSeeAll })] });

        await user.click(screen.getByRole('button', { name: 'See all Trending' }));

        expect(onSeeAll).toHaveBeenCalledTimes(1);
    });

    it('renders each rail’s body under its own heading, whatever that body is', () => {
        renderRails({
            rails: [rail('trending', [], { body: <p>TRENDING BODY</p> }), rail('new', [], { body: <p>NEW BODY</p> })],
        });

        const trending = screen.getByRole('heading', { name: 'Trending' }).closest('section');
        expect(trending?.textContent).toContain('TRENDING BODY');
        expect(trending?.textContent).not.toContain('NEW BODY');
    });

    it('reports a selected recipe upward', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderRails({ rails: threeRails(onSelectRecipe) });

        await user.click(screen.getByRole('button', { name: 'Fresh Ceviche' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_n');
    });
});

describe('RecipeBrowseRails (web) — a rail’s own Try again', () => {
    it('⛔ moves focus to THAT rail’s heading when its retry signal changes, since the pressed button is gone', () => {
        const { rerender } = render(<RecipeBrowseRails rails={threeRails()} cuisines={[]} />);
        const [trending, fresh, quick] = threeRails();

        rerender(
            <RecipeBrowseRails
                rails={[
                    trending as RecipeBrowseRailView,
                    { ...(fresh as RecipeBrowseRailView), headingFocusSignal: 1 },
                    quick as RecipeBrowseRailView,
                ]}
                cuisines={[]}
            />,
        );

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'New' }));
    });
});

describe('RecipeBrowseRails (web) — structure and touch targets', () => {
    it('exposes the block as a named region', () => {
        renderRails();

        expect(screen.getByRole('region', { name: 'Browse recipes' })).toBeTruthy();
    });

    it('names each rail’s track a region ("Trending recipes") the keyboard can reach', () => {
        renderRails();
        const track = screen.getByRole('region', { name: 'Trending recipes' });

        expect(track.getAttribute('tabindex')).toBe('0');
        expect(within(track).getByRole('button', { name: 'Viral Pad Thai' })).toBeTruthy();
    });
});

describe('RecipeBrowseRails (web) — browse by cuisine', () => {
    it('draws the cuisines as a row of chips under “Browse by cuisine”, and reports a selection', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderRails({ cuisines: [{ value: 'Thai', onSelect }] });

        expect(screen.getByRole('heading', { level: 2, name: 'Browse by cuisine' })).toBeTruthy();

        await user.click(
            within(screen.getByRole('group', { name: 'Browse by cuisine' })).getByRole('button', { name: 'Thai' }),
        );

        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('omits the section when there are no shortcuts', () => {
        renderRails({ cuisines: [] });

        expect(screen.queryByRole('heading', { name: 'Browse by cuisine' })).toBeNull();
    });
});

/**
 * Previous and Next (`buildSpec.md` §4.4): two 36 px round ghost buttons for a fine pointer only (the swipe cue serves
 * touch), at the end of the heading row before "See all". They scroll the track by one view less one card and disable at
 * the ends. jsdom has no layout, so the track's geometry is stubbed.
 */
describe('RecipeBrowseRails (web) — Previous and Next', () => {
    /** Give the Trending track a scroll width, a view width and a scroll position. */
    function geometry(scrollLeft: number, { view = 600, content = 1400 } = {}): HTMLElement {
        const track = screen.getByRole('region', { name: 'Trending recipes' });

        Object.defineProperty(track, 'clientWidth', { configurable: true, value: view });
        Object.defineProperty(track, 'scrollWidth', { configurable: true, value: content });
        Object.defineProperty(track, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
        track.scrollBy = vi.fn();
        fireEvent.scroll(track);

        return track;
    }

    it('are drawn for a fine pointer only, named Previous and Next, in the Trending heading row', () => {
        renderRails();
        const next = screen.getAllByRole('button', { name: 'Next' })[0];

        expect(next?.className).toContain('pointer-fine:inline-flex');
        expect(next?.className).toContain('hidden');
        expect(screen.getAllByRole('button', { name: 'Previous' })).toHaveLength(3);
    });

    it('disable Previous at the start and Next at the end', () => {
        renderRails();
        const track = geometry(0);
        const row = track.closest('section') as HTMLElement;

        expect(within(row).getByRole('button', { name: 'Previous' }).getAttribute('aria-disabled')).toBe('true');
        expect(within(row).getByRole('button', { name: 'Next' }).getAttribute('aria-disabled')).toBe('false');

        Object.defineProperty(track, 'scrollLeft', { configurable: true, writable: true, value: 800 });
        fireEvent.scroll(track);

        expect(within(row).getByRole('button', { name: 'Previous' }).getAttribute('aria-disabled')).toBe('false');
        expect(within(row).getByRole('button', { name: 'Next' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('scroll the track forward and back, and do nothing at an end', async () => {
        const user = userEvent.setup();
        renderRails();
        const track = geometry(0);
        const row = track.closest('section') as HTMLElement;

        await user.click(within(row).getByRole('button', { name: 'Previous' }));

        expect(track.scrollBy).not.toHaveBeenCalled();

        await user.click(within(row).getByRole('button', { name: 'Next' }));

        expect(track.scrollBy).toHaveBeenCalledOnce();
        const [scrollOptions] = vi.mocked(track.scrollBy).mock.calls[0] ?? [];
        expect(scrollOptions).toMatchObject({ left: expect.any(Number) as number });
        expect((scrollOptions as ScrollToOptions).left).toBeGreaterThan(0);
    });

    it('both stay disabled when the rail fits without scrolling', () => {
        renderRails();
        const track = geometry(0, { view: 1000, content: 900 });
        const row = track.closest('section') as HTMLElement;

        expect(within(row).getByRole('button', { name: 'Previous' }).getAttribute('aria-disabled')).toBe('true');
        expect(within(row).getByRole('button', { name: 'Next' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('moves the track with the arrow keys, by one card a press', () => {
        renderRails();
        const track = geometry(0);

        fireEvent.keyDown(track, { key: 'ArrowRight' });
        fireEvent.keyDown(track, { key: 'ArrowLeft' });

        const lefts = vi.mocked(track.scrollBy).mock.calls.map((call) => (call[0] as ScrollToOptions).left);

        expect(lefts[0]).toBeGreaterThan(0);
        expect(lefts[1]).toBeLessThan(0);
    });
});

describe('RecipeBrowseRails (web) — section enter motion (U8 motion pass)', () => {
    /** The `EnterTransition` wrappers each section is composed inside. */
    const enterWrappers = (): readonly HTMLElement[] => [
        ...document.querySelectorAll<HTMLElement>('[class*="animate-section-enter"]'),
    ];

    it('wraps every rail section in the design-system enter transition', () => {
        renderRails({ cuisines: [{ value: 'Thai', onSelect: noop }] });

        // Three rails + the cuisine section.
        expect(enterWrappers()).toHaveLength(4);

        for (const wrapper of enterWrappers()) {
            // Each wrapper actually contains a section heading — it wraps the section, not a stray node.
            expect(wrapper.querySelector('h2')).not.toBeNull();
        }
    });

    it('gates the enter motion on motion-safe (reduce-motion viewers get the settled sections)', () => {
        renderRails();

        for (const wrapper of enterWrappers()) {
            expect(wrapper.className).toContain('motion-safe:animate-section-enter');
            expect(wrapper.className).not.toMatch(/(?<!safe:)\banimate-section-enter/);
        }
    });

    it('staggers the sections so they do not all flash in at once', () => {
        renderRails();

        const delays = enterWrappers().map((wrapper) => wrapper.style.animationDelay);
        // The first section enters immediately; each subsequent one is held slightly longer.
        expect(delays[0]).toBe('');
        expect(delays.slice(1).every((delay) => delay !== '')).toBe(true);
        expect(new Set(delays).size).toBe(delays.length);
    });

    it('keeps the rail content reachable regardless of the motion wrapper', () => {
        renderRails();

        // The gesture is decorative; the cards must still be present and named.
        expect(screen.getByRole('button', { name: 'Viral Pad Thai' })).toBeTruthy();
    });
});

describe('RecipeBrowseRails (web) — text contrast (WCAG 2.1 AA)', () => {
    it('keeps the per-rail "see all" legible at rest and under its mist hover tint', () => {
        renderRails();

        // "See all" is TEXT a reader reads, so it owes the 4.5:1 SC 1.4.3 floor, not the 3:1 an accent owes;
        // `seafoam` is 3.73:1 on the page background it sits on and 3.37:1 once the `mist/20` hover tint lands
        // underneath. The palette JSDoc in `@commise/ui`'s `tokens/colors.ts` states the rule once, and names
        // `ocean-dark` as the text-weight substitute that keeps the control in its own hue family.
        //
        // Measured from the class list the button ACTUALLY rendered (a `toContain('text-…')` check would pin a
        // spelling, not a ratio), with the hover state measured as its own state.
        const seeAll = screen.getByRole('button', { name: 'See all Trending' });
        expect(
            utilityContrast(seeAll.className, { surface: semantic.background }),
            'see-all at rest on the page',
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(seeAll.className, { surface: semantic.background, variant: 'hover' }),
            'see-all under its hover:bg-ink/6 tint',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe('RecipeBrowseRails (web) — a failed refresh of the rails on screen', () => {
    const notice = (overrides: Partial<NonNullable<RecipeBrowseRailsProps['refreshNotice']>> = {}) => ({
        failed: false,
        refreshing: false,
        onRetry: noop,
        recoveries: 0,
        ...overrides,
    });

    it('shows no notice while nothing has failed', () => {
        renderRails({ refreshNotice: notice() });

        expect(screen.queryByText('We couldn’t refresh these recipes.')).toBeNull();
    });

    it('⛔ keeps every rail’s rows and shows ONE notice for the block, with a Try again that retries', () => {
        const onRetry = vi.fn();
        renderRails({ refreshNotice: notice({ failed: true, onRetry }) });

        expect(screen.getByText('Viral Pad Thai')).toBeTruthy();
        expect(screen.getByText('Ten-Minute Omelette')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
        screen.getByRole('button', { name: 'Try again' }).click();
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('⛔ moves focus to the first rail’s heading when a retry from the notice succeeds', () => {
        const props = renderRails({ refreshNotice: notice({ failed: true }) });
        cleanup();
        const { rerender } = render(<RecipeBrowseRails {...props} refreshNotice={notice({ failed: true })} />);

        rerender(<RecipeBrowseRails {...props} refreshNotice={notice({ recoveries: 1 })} />);

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Trending' }));
    });
});
