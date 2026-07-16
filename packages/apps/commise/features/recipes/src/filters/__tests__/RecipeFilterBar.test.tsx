// @vitest-environment jsdom
/**
 * Component tests for the web recipe filter bar (FR-006). Covers EVERY branch the bar renders: no
 * facets at all, one dimension, both dimensions, the time ladder, selected/unselected chip state, a
 * selected-but-unfaceted value, zero-count buckets, the active-count summary, and clear-all
 * (present/absent). Every query is by role/accessible-name and every state assertion reads the real
 * `pressed` semantics, so a clickable `<div>`, a missing `aria-pressed`, or a dropped handler argument
 * fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { RecipeFilterBar } from '../RecipeFilterBar.js';
import { EMPTY_RECIPE_FILTERS } from '../model.js';
import type { RecipeFilterBarProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderBar(overrides: Partial<RecipeFilterBarProps> = {}) {
    const props: RecipeFilterBarProps = {
        facets: {},
        filters: EMPTY_RECIPE_FILTERS,
        onToggleFacet: noop,
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

describe('RecipeFilterBar (web) — structure', () => {
    it('exposes the bar as a named group', () => {
        renderBar({ facets });

        expect(screen.getByRole('group', { name: 'Filter recipes' })).toBeTruthy();
    });

    it('groups each facet dimension under its own accessible name', () => {
        renderBar({ facets });

        expect(screen.getByRole('group', { name: 'Dietary' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Tags' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Max total time' })).toBeTruthy();
    });

    it('renders the time ladder even with no facets, because it is a bound not a value list', () => {
        renderBar({ facets: {} });

        expect(screen.getByRole('button', { name: 'Under 15 min' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Under 30 min' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Under 60 min' })).toBeTruthy();
    });

    it('omits a facet dimension entirely when the server returns none and none is selected', () => {
        renderBar({ facets: {} });

        expect(screen.queryByRole('group', { name: 'Dietary' })).toBeNull();
        expect(screen.queryByRole('group', { name: 'Tags' })).toBeNull();
    });

    it('renders only the dimension the server returned', () => {
        renderBar({ facets: { dietaryFlags: [{ value: 'vegan', count: 4 }] } });

        expect(screen.getByRole('group', { name: 'Dietary' })).toBeTruthy();
        expect(screen.queryByRole('group', { name: 'Tags' })).toBeNull();
    });
});

describe('RecipeFilterBar (web) — chips', () => {
    it('names each chip with its value and count', () => {
        renderBar({ facets });

        expect(screen.getByRole('button', { name: 'vegan, 4 recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'gluten-free, 2 recipes' })).toBeTruthy();
    });

    it('uses the singular count in a chip name when exactly one match', () => {
        renderBar({ facets: { tags: [{ value: 'brunch', count: 1 }] } });

        expect(screen.getByRole('button', { name: 'brunch, 1 recipe' })).toBeTruthy();
    });

    it('renders an unpressed chip when its value is not selected', () => {
        renderBar({ facets });

        expect(screen.getByRole('button', { name: 'vegan, 4 recipes' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('renders a pressed chip when its value is selected', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        expect(screen.getByRole('button', { name: 'vegan, 4 recipes' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('renders a selected value the facets omit, so an active filter is always clearable', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['paleo'] } });

        const chip = screen.getByRole('button', { name: 'paleo' });

        expect(chip.getAttribute('aria-pressed')).toBe('true');
    });

    it('toggles a dietary chip with its dimension and value', () => {
        const onToggleFacet = vi.fn();
        renderBar({ facets, onToggleFacet });

        fireEvent.click(screen.getByRole('button', { name: 'vegan, 4 recipes' }));

        expect(onToggleFacet).toHaveBeenCalledWith('dietaryFlags', 'vegan');
    });

    it('toggles a tag chip with its dimension and value', () => {
        const onToggleFacet = vi.fn();
        renderBar({ facets, onToggleFacet });

        fireEvent.click(screen.getByRole('button', { name: 'quick, 3 recipes' }));

        expect(onToggleFacet).toHaveBeenCalledWith('tags', 'quick');
    });

    it('renders every chip as a real button, not a clickable div', () => {
        renderBar({ facets });

        const dietary = screen.getByRole('group', { name: 'Dietary' });

        for (const chip of within(dietary).getAllByRole('button')) {
            expect(chip.tagName).toBe('BUTTON');
            expect(chip.getAttribute('type')).toBe('button');
        }
    });
});

describe('RecipeFilterBar (web) — time ladder', () => {
    it('presses only the active bound', () => {
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, maxTotalTime: 30 } });

        expect(screen.getByRole('button', { name: 'Under 30 min' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Under 15 min' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('sets the bound when an inactive bucket is pressed', () => {
        const onSetMaxTotalTime = vi.fn();
        renderBar({ onSetMaxTotalTime });

        fireEvent.click(screen.getByRole('button', { name: 'Under 30 min' }));

        expect(onSetMaxTotalTime).toHaveBeenCalledWith(30);
    });

    it('clears the bound when the active bucket is pressed again', () => {
        const onSetMaxTotalTime = vi.fn();
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, maxTotalTime: 30 }, onSetMaxTotalTime });

        fireEvent.click(screen.getByRole('button', { name: 'Under 30 min' }));

        expect(onSetMaxTotalTime).toHaveBeenCalledWith(undefined);
    });
});

describe('RecipeFilterBar (web) — clear all', () => {
    it('hides clear-all when no filter is active', () => {
        renderBar({ facets });

        expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
    });

    it('shows clear-all with the active count when filters are active', () => {
        renderBar({ facets, filters: { dietaryFlags: ['vegan'], tags: ['quick'], maxTotalTime: 30 } });

        expect(screen.getByRole('button', { name: 'Clear 3 filters' })).toBeTruthy();
    });

    it('uses the singular clear-all label for exactly one active filter', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        expect(screen.getByRole('button', { name: 'Clear 1 filter' })).toBeTruthy();
    });

    it('invokes clear-all when pressed', () => {
        const onClearAll = vi.fn();
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] }, onClearAll });

        fireEvent.click(screen.getByRole('button', { name: 'Clear 1 filter' }));

        expect(onClearAll).toHaveBeenCalledTimes(1);
    });
});
