/**
 * Native component tests for the recipe filter bar (FR-006), rendered via react-native-web under jsdom.
 * Mirrors the web leaf across EVERY branch — no facets, one/both dimensions, the time ladder, selected vs
 * unselected chips, a selected-but-unfaceted value, the active-count summary, and clear-all — and reads the
 * real `aria-pressed` semantics react-native-web surfaces for a selected `Pressable`, so a chip that dropped
 * its pressed state, its dimension/value, or its handler argument fails the test. The two platform renders
 * therefore cannot drift on behavior or accessibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeFilterBar } from '../RecipeFilterBar.native.js';
import { EMPTY_RECIPE_FILTERS } from '../model.js';
import type { RecipeFilterBarProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderBar(overrides: Partial<RecipeFilterBarProps> = {}) {
    const props: RecipeFilterBarProps = {
        facets: {},
        filters: EMPTY_RECIPE_FILTERS,
        onToggleFacet: noop,
        onSetCuisine: noop,
        onSetMaxPrepTime: noop,
        onSetMaxCookTime: noop,
        onSetMaxTotalTime: noop,
        onClearAll: noop,
        ...overrides,
    };
    render(<RecipeFilterBar {...props} />);

    return props;
}

const facets = {
    dietaryFlags: [
        { value: 'vegan', count: 4 },
        { value: 'gluten-free', count: 2 },
    ],
    tags: [{ value: 'quick', count: 3 }],
};

describe('RecipeFilterBar (native) — structure', () => {
    it('exposes the bar and each dimension as a named group', () => {
        renderBar({ facets });

        expect(screen.getByRole('group', { name: 'Filter recipes' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Dietary' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Tags' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Prep time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Cook time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Total time' })).toBeTruthy();
    });

    it('renders the time ladders even with no facets', () => {
        renderBar({ facets: {} });

        const total = within(screen.getByRole('group', { name: 'Total time' }));
        expect(total.getByRole('button', { name: 'Under 15 min' })).toBeTruthy();
        expect(total.getByRole('button', { name: 'Under 30 min' })).toBeTruthy();
        expect(total.getByRole('button', { name: 'Under 60 min' })).toBeTruthy();
    });

    it('omits a facet dimension when the server returns none and none is selected', () => {
        renderBar({ facets: {} });

        expect(screen.queryByRole('group', { name: 'Dietary' })).toBeNull();
        expect(screen.queryByRole('group', { name: 'Tags' })).toBeNull();
    });
});

describe('RecipeFilterBar (native) — chips', () => {
    it('names each chip with its value and count', () => {
        renderBar({ facets });

        expect(screen.getByRole('button', { name: 'vegan, 4 recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'quick, 3 recipes' })).toBeTruthy();
    });

    it('uses the singular count in a chip name when exactly one match', () => {
        renderBar({ facets: { tags: [{ value: 'brunch', count: 1 }] } });

        expect(screen.getByRole('button', { name: 'brunch, 1 recipe' })).toBeTruthy();
    });

    it('marks a selected chip pressed and an unselected chip unpressed', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        expect(screen.getByRole('button', { name: 'vegan, 4 recipes' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'gluten-free, 2 recipes' }).getAttribute('aria-pressed')).toBe(
            'false',
        );
    });

    it('renders a selected value the facets omit, so an active filter is always clearable', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['paleo'] } });

        expect(screen.getByRole('button', { name: 'paleo' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('toggles a chip with its dimension and value', () => {
        const onToggleFacet = vi.fn();
        renderBar({ facets, onToggleFacet });

        fireEvent.click(screen.getByRole('button', { name: 'quick, 3 recipes' }));

        expect(onToggleFacet).toHaveBeenCalledWith('tags', 'quick');
    });

    it('renders chips as real buttons', () => {
        renderBar({ facets });

        const dietary = screen.getByRole('group', { name: 'Dietary' });
        for (const chip of within(dietary).getAllByRole('button')) {
            expect(chip.tagName).toBe('BUTTON');
        }
    });
});

describe('RecipeFilterBar (native) — time ladder', () => {
    it('presses only the active bound', () => {
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, maxTotalTime: 30 } });

        const total = within(screen.getByRole('group', { name: 'Total time' }));
        expect(total.getByRole('button', { name: 'Under 30 min' }).getAttribute('aria-pressed')).toBe('true');
        expect(total.getByRole('button', { name: 'Under 15 min' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('sets the bound when an inactive bucket is pressed', () => {
        const onSetMaxTotalTime = vi.fn();
        renderBar({ onSetMaxTotalTime });

        const total = within(screen.getByRole('group', { name: 'Total time' }));
        fireEvent.click(total.getByRole('button', { name: 'Under 30 min' }));

        expect(onSetMaxTotalTime).toHaveBeenCalledWith(30);
    });

    it('clears the bound when the active bucket is pressed again', () => {
        const onSetMaxTotalTime = vi.fn();
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, maxTotalTime: 30 }, onSetMaxTotalTime });

        const total = within(screen.getByRole('group', { name: 'Total time' }));
        fireEvent.click(total.getByRole('button', { name: 'Under 30 min' }));

        expect(onSetMaxTotalTime).toHaveBeenCalledWith(undefined);
    });

    it('sets a prep bound from the Prep time ladder (S2)', () => {
        const onSetMaxPrepTime = vi.fn();
        renderBar({ onSetMaxPrepTime });

        const prep = within(screen.getByRole('group', { name: 'Prep time' }));
        fireEvent.click(prep.getByRole('button', { name: 'Under 15 min' }));

        expect(onSetMaxPrepTime).toHaveBeenCalledWith(15);
    });

    it('renders the single-select Cuisine group and reports a selection (S2)', () => {
        const onSetCuisine = vi.fn();
        renderBar({ facets: { cuisine: [{ value: 'Thai', count: 5 }] }, onSetCuisine });

        const cuisine = within(screen.getByRole('group', { name: 'Cuisine' }));
        fireEvent.click(cuisine.getByRole('button', { name: /Thai/ }));

        expect(onSetCuisine).toHaveBeenCalledWith('Thai');
    });
});

describe('RecipeFilterBar (native) — cook-time bound (REQ-030f)', () => {
    it('renders the Cook time ladder even with no facets', () => {
        renderBar({ facets: {} });

        const group = within(screen.getByRole('group', { name: 'Cook time' }));
        expect(group.getByRole('button', { name: 'Under 15 min' })).toBeTruthy();
        expect(group.getByRole('button', { name: 'Under 30 min' })).toBeTruthy();
        expect(group.getByRole('button', { name: 'Under 60 min' })).toBeTruthy();
    });

    it('sets a cook bound from the Cook time ladder', () => {
        const onSetMaxCookTime = vi.fn();
        renderBar({ onSetMaxCookTime });

        const group = within(screen.getByRole('group', { name: 'Cook time' }));
        fireEvent.click(group.getByRole('button', { name: 'Under 30 min' }));

        expect(onSetMaxCookTime).toHaveBeenCalledWith(30);
    });

    it('presses only the active cook bound', () => {
        renderBar({ filters: { maxCookTime: 30 } });

        const group = within(screen.getByRole('group', { name: 'Cook time' }));
        expect(group.getByRole('button', { name: 'Under 30 min' }).getAttribute('aria-pressed')).toBe('true');
        expect(group.getByRole('button', { name: 'Under 15 min' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('clears the cook bound when the active bucket is pressed again', () => {
        const onSetMaxCookTime = vi.fn();
        renderBar({ filters: { maxCookTime: 30 }, onSetMaxCookTime });

        const group = within(screen.getByRole('group', { name: 'Cook time' }));
        fireEvent.click(group.getByRole('button', { name: 'Under 30 min' }));

        expect(onSetMaxCookTime).toHaveBeenCalledWith(undefined);
    });
});

describe('RecipeFilterBar (native) — clear all', () => {
    it('hides clear-all when no filter is active', () => {
        renderBar({ facets });

        expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
    });

    it('shows clear-all with the active count and invokes it when pressed', () => {
        const onClearAll = vi.fn();
        renderBar({ facets, filters: { dietaryFlags: ['vegan'], tags: ['quick'], maxTotalTime: 30 }, onClearAll });

        const clear = screen.getByRole('button', { name: 'Clear 3 filters' });
        fireEvent.click(clear);

        expect(onClearAll).toHaveBeenCalledTimes(1);
    });

    it('uses the singular clear-all label for exactly one active filter', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        expect(screen.getByRole('button', { name: 'Clear 1 filter' })).toBeTruthy();
    });
});
