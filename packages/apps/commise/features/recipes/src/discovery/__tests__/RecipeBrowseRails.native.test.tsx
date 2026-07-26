/**
 * Native component tests for the curated browse-rails block (U7), rendered via react-native-web under
 * jsdom. Mirrors the web leaf: the three fixed-sort rails with per-rail "see all", each rail's own
 * loading/error/empty/populated state, the cuisine shortcuts, and the selection contract — so the two
 * platform renders of the net-new browse surface cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeBrowseRails } from '../RecipeBrowseRails.native.js';
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

describe('RecipeBrowseRails (native) — rails', () => {
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

    it('reports a "see all" for the rail that was activated', () => {
        const onSeeAll = vi.fn();
        renderRails({
            rails: [rail({ id: 'trending', results: [result({ id: 'rec_t', title: 'Viral Pad Thai' })], onSeeAll })],
        });

        fireEvent.click(screen.getByRole('button', { name: 'See all Trending' }));

        expect(onSeeAll).toHaveBeenCalledTimes(1);
    });

    it('reports a selected recipe upward', () => {
        const onSelectRecipe = vi.fn();
        renderRails({ onSelectRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Fresh Ceviche' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_n');
    });
});

describe('RecipeBrowseRails (native) — U8 rail header accent', () => {
    it('paints a brand gradient accent on each rail section header', () => {
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

        // Each rail header carries a decorative GradientSurface accent (expo-linear-gradient stub); three
        // rails ⇒ at least three gradient markers.
        const accents = container.querySelectorAll('[data-commise-stub="linear-gradient"]');
        expect(accents.length).toBeGreaterThanOrEqual(3);
    });
});

describe('RecipeBrowseRails (native) — rail states', () => {
    it('shows a busy status for a loading rail', () => {
        renderRails({ rails: [rail({ id: 'trending', status: 'loading' })] });

        expect(screen.getByRole('status')).toBeTruthy();
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

describe('RecipeBrowseRails (native) — cuisine shortcuts', () => {
    it('renders cuisine shortcuts and reports a selection', () => {
        const onSelect = vi.fn();
        renderRails({ cuisines: [{ value: 'Thai', onSelect }] });

        fireEvent.click(screen.getByRole('button', { name: 'Browse Thai recipes' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('omits the cuisine section when there are no shortcuts', () => {
        renderRails({ cuisines: [] });

        expect(screen.queryByRole('heading', { name: 'Browse by cuisine' })).toBeNull();
    });
});
