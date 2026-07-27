// @vitest-environment jsdom
/**
 * Component tests for the web curated browse-rails block (U7, net-new). Covers the default browse surface
 * shown when discovery has no active query/filter: the three fixed-sort rails (Trending/New/Quick) with a
 * per-rail "see all", each rail's own loading/error/empty/populated state, the cuisine shortcuts, and the
 * selection/clone interaction contracts — so the rails cannot silently regress into a bare stream.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import { RecipeBrowseRails } from '../RecipeBrowseRails.js';
import type { RecipeBrowseRailsProps, RecipeBrowseRailView } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function result(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

function rail(overrides: Partial<RecipeBrowseRailView> & Pick<RecipeBrowseRailView, 'id'>): RecipeBrowseRailView {
    return { status: 'ready', results: [], onSeeAll: noop, ...overrides };
}

function renderRails(overrides: Partial<RecipeBrowseRailsProps> = {}) {
    const props: RecipeBrowseRailsProps = {
        rails: [
            rail({ id: 'trending', results: [result({ id: 'rec_t', title: 'Viral Pad Thai' })] }),
            rail({ id: 'new', results: [result({ id: 'rec_n', title: 'Fresh Ceviche' })] }),
            rail({ id: 'quick', results: [result({ id: 'rec_q', title: 'Ten-Minute Omelette' })] }),
        ],
        cuisines: [],
        onSelectRecipe: noop,
        onClone: noop,
        ...overrides,
    };
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
        renderRails({
            rails: [rail({ id: 'trending', results: [result({ id: 'rec_t', title: 'Viral Pad Thai' })], onSeeAll })],
        });

        await user.click(screen.getByRole('button', { name: 'See all Trending' }));

        expect(onSeeAll).toHaveBeenCalledTimes(1);
    });

    it('reports a selected recipe upward', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderRails({ onSelectRecipe });

        await user.click(screen.getByRole('button', { name: 'Fresh Ceviche' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_n');
    });
});

describe('RecipeBrowseRails (web) — U8 rail header accent', () => {
    it('paints a brand gradient accent under each rail section header', () => {
        const { container } = render(
            <RecipeBrowseRails
                rails={[
                    rail({ id: 'trending', results: [result({ id: 'rec_t', title: 'Viral Pad Thai' })] }),
                    rail({ id: 'new', results: [result({ id: 'rec_n', title: 'Fresh Ceviche' })] }),
                    rail({ id: 'quick', results: [result({ id: 'rec_q', title: 'Ten-Minute Omelette' })] }),
                ]}
                cuisines={[]}
                onSelectRecipe={noop}
                onClone={noop}
            />,
        );

        // Each rail header carries a decorative GradientSurface accent bar (an inline linear-gradient), so
        // three rails ⇒ at least three gradient accents.
        const accents = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((el) =>
            el.style.backgroundImage.startsWith('linear-gradient'),
        );
        expect(accents.length).toBeGreaterThanOrEqual(3);
    });
});

describe('RecipeBrowseRails (web) — rail states', () => {
    it('shows a busy status for a loading rail', () => {
        renderRails({ rails: [rail({ id: 'trending', status: 'loading' })] });

        expect(screen.getByRole('status')).toBeTruthy();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        renderRails({ rails: [rail({ id: 'trending', status: 'loading' })] });

        // The rail's shimmer cards are all `aria-hidden`, so without a visible caption the live region has NO
        // content — and a live region announces its CONTENT, not its label. Screen readers hear nothing.
        expect(screen.getByRole('status').textContent).toContain('Loading recipes');
    });

    it('shows an error message for a failed rail', () => {
        renderRails({ rails: [rail({ id: 'trending', status: 'error' })] });

        expect(screen.getByText('Couldn’t load this row.')).toBeTruthy();
    });

    it('shows an empty message for a settled rail with no recipes', () => {
        renderRails({ rails: [rail({ id: 'trending', status: 'ready', results: [] })] });

        expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    });
});

describe('RecipeBrowseRails (web) — cuisine shortcuts', () => {
    it('renders cuisine shortcuts and reports a selection', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderRails({ cuisines: [{ value: 'Thai', onSelect }] });

        await user.click(screen.getByRole('button', { name: 'Browse Thai recipes' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('omits the cuisine section when there are no shortcuts', () => {
        renderRails({ cuisines: [] });

        expect(screen.queryByRole('heading', { name: 'Browse by cuisine' })).toBeNull();
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
