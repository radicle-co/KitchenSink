// @vitest-environment jsdom
/**
 * Component tests for the web recipe filter bar (FR-006). Covers EVERY branch the bar renders: no
 * facets at all, one dimension, both dimensions, the time ladder, selected/unselected chip state, a
 * selected-but-unfaceted value, zero-count buckets, the active-count summary, and clear-all
 * (present/absent). Every query is by role/accessible-name and every state assertion reads the real
 * `pressed` semantics, so a clickable `<div>`, a missing `aria-pressed`, or a dropped handler argument
 * fails the test.
 */
import { startTransition, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ringContrast, utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';
import { buttonSurfaceClass } from '@commise/ui/button';

import { MAX_SEARCH_FOOD_FILTERS } from '@kitchensink/schema-recipe';

import { RecipeFilterBar } from '../RecipeFilterBar.js';
import { EMPTY_RECIPE_FILTERS, applyFilterAction } from '../model.js';
import { FILTER_BAR_INLINE_QUERY } from '../useFilterBarLayout.js';
import type { FoodIngredient, RecipeFilterBarProps, RecipeFilterState, RecipeIngredientSearchState } from '../model.js';

/** A window size, in CSS px. */
interface WindowSize {
    readonly width: number;
    readonly height: number;
}

/** An upright phone at the narrowest supported width: the bar is a Sheet here (spec §S8.1a). */
const PHONE: WindowSize = { width: 320, height: 640 };
/** The same phone turned sideways: still the Sheet, because the window is compact in height. */
const PHONE_SIDEWAYS: WindowSize = { width: 640, height: 320 };
/** A laptop: the bar is inline here. */
const LAPTOP: WindowSize = { width: 1280, height: 800 };

/**
 * The Tailwind arbitrary variant for the bar's inline query, derived from the query itself, so the class the server
 * renders and the query the client asks cannot drift apart unseen.
 */
const INLINE_VARIANT = `[@media${FILTER_BAR_INLINE_QUERY.replaceAll(': ', ':').replaceAll(' ', '_')}]`;

/** The size the fake `matchMedia` answers for, and the listeners a resize notifies. */
let windowSize: WindowSize = LAPTOP;
const mediaListeners = new Set<() => void>();

/**
 * Evaluate a media query made of `min-width`/`min-height` features joined by `and`, the only shape the bar uses, at
 * 16 px to the rem (a media query's rem is the browser's initial font size, never the root element's). Any other shape
 * throws, so a change to the bar's query cannot slip past a fake that silently answers `false`.
 */
function evaluateMedia(query: string, size: WindowSize): boolean {
    return query.split(/\s+and\s+/u).every((feature) => {
        const match = /^\(\s*min-(width|height)\s*:\s*([\d.]+)(rem|px)\s*\)$/u.exec(feature.trim());

        if (match === null) {
            throw new Error(`the test's matchMedia does not understand "${feature}"`);
        }

        const threshold = Number(match[2]) * (match[3] === 'rem' ? 16 : 1);

        return (match[1] === 'width' ? size.width : size.height) >= threshold;
    });
}

/** Stand in for the browser's `matchMedia` at {@link windowSize}. jsdom implements none. */
function stubMatchMedia(): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: evaluateMedia(query, windowSize),
        media: query,
        addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    }));
}

/** Resize the window, as rotating a phone or dragging a browser edge does, and notify every media listener. */
function resizeWindow(size: WindowSize): void {
    act(() => {
        windowSize = size;

        for (const listener of [...mediaListeners]) {
            listener();
        }
    });
}

beforeEach(() => {
    windowSize = LAPTOP;
    stubMatchMedia();
});

afterEach(() => {
    cleanup();
    mediaListeners.clear();
    vi.unstubAllGlobals();
});

const noop = () => undefined;

/** `count` foods already in the filter. */
const foods = (count: number): { foodId: string; name: string }[] =>
    Array.from({ length: count }, (_, index) => ({ foodId: `ing_${String(index)}`, name: `Food ${String(index)}` }));

/**
 * The bar under a parent that holds the filter, as the containers do, so the parent's update and the bar's own
 * focus signal land in the same render. The search offers one food until the filter is full.
 */
function StatefulBar({ initial, late = false }: { readonly initial: number; readonly late?: boolean }) {
    const [filters, setFilters] = useState<RecipeFilterState>({ ...EMPTY_RECIPE_FILTERS, ingredients: foods(initial) });
    const full = (filters.ingredients?.length ?? 0) >= MAX_SEARCH_FOOD_FILTERS;

    return (
        <RecipeFilterBar
            facets={{}}
            filters={filters}
            onFilterAction={(action) => {
                const apply = (): void => setFilters((current) => applyFilterAction(current, action));

                // `late`: the web container writes the filter to the URL with `history.replaceState`, which Next applies
                // in a transition, so it lands a render after the press.
                if (late) {
                    startTransition(apply);
                } else {
                    apply();
                }
            }}
            ingredientSearch={{
                query: 'new',
                onQueryChange: noop,
                viewState: full
                    ? { kind: 'full', max: MAX_SEARCH_FOOD_FILTERS }
                    : {
                          kind: 'results',
                          results: [NEW_FOOD],
                          isError: false,
                      },
            }}
        />
    );
}

/** The one food the search offers in {@link StatefulBar}. */
const NEW_FOOD: FoodIngredient = { ...makeIngredient({ id: 'new', name: 'Newfood' }), foodId: 'food_new' };

const FULL_NOTE = `You can filter by up to ${String(MAX_SEARCH_FOOD_FILTERS)} ingredients. Remove one to add another.`;

const idleIngredientSearch: RecipeIngredientSearchState = {
    query: '',
    onQueryChange: noop,
    viewState: { kind: 'idle' },
};

function renderBar(overrides: Partial<RecipeFilterBarProps> = {}) {
    const props: RecipeFilterBarProps = {
        facets: {},
        filters: EMPTY_RECIPE_FILTERS,
        onFilterAction: noop,
        ingredientSearch: idleIngredientSearch,
        ...overrides,
    };
    render(<RecipeFilterBar {...props} />);

    return props;
}

/** Render the bar on a phone and open its Sheet through the trigger, as a cook does. */
async function renderBarInSheet(
    overrides: Partial<RecipeFilterBarProps> = {},
): Promise<ReturnType<typeof userEvent.setup>> {
    windowSize = PHONE;
    const user = userEvent.setup();
    renderBar(overrides);
    await user.click(screen.getByRole('button', { name: /^Filters/u }));

    return user;
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
        expect(screen.getByRole('group', { name: 'Prep time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Cook time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Total time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Ingredients' })).toBeTruthy();
    });

    it('renders the time ladders even with no facets, because they are bounds not value lists', () => {
        renderBar({ facets: {} });

        const total = within(screen.getByRole('group', { name: 'Total time' }));
        expect(total.getByRole('button', { name: 'Under 15 min' })).toBeTruthy();
        expect(total.getByRole('button', { name: 'Under 30 min' })).toBeTruthy();
        expect(total.getByRole('button', { name: 'Under 60 min' })).toBeTruthy();
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

    it('toggles a dietary chip with its dimension and value', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ facets, onFilterAction });

        await user.click(screen.getByRole('button', { name: 'vegan, 4 recipes' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'vegan' });
    });

    it('toggles a tag chip with its dimension and value', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ facets, onFilterAction });

        await user.click(screen.getByRole('button', { name: 'quick, 3 recipes' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'toggleFacet', dimension: 'tags', value: 'quick' });
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

        const total = within(screen.getByRole('group', { name: 'Total time' }));
        expect(total.getByRole('button', { name: 'Under 30 min' }).getAttribute('aria-pressed')).toBe('true');
        expect(total.getByRole('button', { name: 'Under 15 min' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('sets the bound when an inactive bucket is pressed', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ onFilterAction });

        const total = within(screen.getByRole('group', { name: 'Total time' }));
        await user.click(total.getByRole('button', { name: 'Under 30 min' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxTotalTime', minutes: 30 });
    });

    it('clears the bound when the active bucket is pressed again', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, maxTotalTime: 30 }, onFilterAction });

        const total = within(screen.getByRole('group', { name: 'Total time' }));
        await user.click(total.getByRole('button', { name: 'Under 30 min' }));

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'setTimeBound',
            field: 'maxTotalTime',
            minutes: undefined,
        });
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

    it('invokes clear-all when pressed', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] }, onFilterAction });

        await user.click(screen.getByRole('button', { name: 'Clear 1 filter' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'clearAll' });
    });
});

describe('RecipeFilterBar (web) — cuisine + prep facets (S2)', () => {
    const s2Facets = {
        cuisine: [
            { value: 'Thai', count: 5 },
            { value: 'Italian', count: 3 },
        ],
    };

    it('renders the Cuisine group as single-select chips and reports a selection', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ facets: s2Facets, onFilterAction });

        const group = screen.getByRole('group', { name: 'Cuisine' });
        await user.click(within(group).getByRole('button', { name: /Thai/ }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setCuisine', cuisine: 'Thai' });
    });

    it('marks only the active cuisine pressed (single-select)', () => {
        renderBar({ facets: s2Facets, filters: { cuisine: 'Thai' } });

        const group = screen.getByRole('group', { name: 'Cuisine' });
        expect(within(group).getByRole('button', { name: /Thai/ }).getAttribute('aria-pressed')).toBe('true');
        expect(
            within(group)
                .getByRole('button', { name: /Italian/ })
                .getAttribute('aria-pressed'),
        ).toBe('false');
    });

    it('omits the Cuisine group when the search returned no cuisines', () => {
        renderBar({ facets: {} });

        expect(screen.queryByRole('group', { name: 'Cuisine' })).toBeNull();
    });

    it('sets a prep-time bound from the Prep time ladder', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ onFilterAction });

        const group = screen.getByRole('group', { name: 'Prep time' });
        await user.click(within(group).getByRole('button', { name: 'Under 15 min' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxPrepTime', minutes: 15 });
    });

    it('clears a prep bound by pressing the active bucket again', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ filters: { maxPrepTime: 15 }, onFilterAction });

        const group = screen.getByRole('group', { name: 'Prep time' });
        expect(within(group).getByRole('button', { name: 'Under 15 min' }).getAttribute('aria-pressed')).toBe('true');

        await user.click(within(group).getByRole('button', { name: 'Under 15 min' }));
        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxPrepTime', minutes: undefined });
    });
});

describe('RecipeFilterBar (web) — cook-time bound (REQ-030f)', () => {
    it('renders the Cook time ladder even with no facets, because it is a bound not a value list', () => {
        renderBar({ facets: {} });

        const group = within(screen.getByRole('group', { name: 'Cook time' }));
        expect(group.getByRole('button', { name: 'Under 15 min' })).toBeTruthy();
        expect(group.getByRole('button', { name: 'Under 30 min' })).toBeTruthy();
        expect(group.getByRole('button', { name: 'Under 60 min' })).toBeTruthy();
    });

    it('sets a cook-time bound from the Cook time ladder', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ onFilterAction });

        const group = screen.getByRole('group', { name: 'Cook time' });
        await user.click(within(group).getByRole('button', { name: 'Under 30 min' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxCookTime', minutes: 30 });
    });

    it('presses only the active cook bound', () => {
        renderBar({ filters: { maxCookTime: 30 } });

        const group = within(screen.getByRole('group', { name: 'Cook time' }));
        expect(group.getByRole('button', { name: 'Under 30 min' }).getAttribute('aria-pressed')).toBe('true');
        expect(group.getByRole('button', { name: 'Under 15 min' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('clears a cook bound by pressing the active bucket again', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({ filters: { maxCookTime: 30 }, onFilterAction });

        const group = screen.getByRole('group', { name: 'Cook time' });
        await user.click(within(group).getByRole('button', { name: 'Under 30 min' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxCookTime', minutes: undefined });
    });

    it('counts an active cook bound in the clear-all summary', () => {
        renderBar({ filters: { maxCookTime: 30 } });

        expect(screen.getByRole('button', { name: 'Clear 1 filter' })).toBeTruthy();
    });
});

describe('RecipeFilterBar (web) — ingredient filter typeahead (FR-006 gap #3)', () => {
    it('renders the search box with an accessible name and placeholder', () => {
        renderBar();

        const input = screen.getByLabelText('Search ingredients');
        expect(input).toBeTruthy();
        expect(input.getAttribute('placeholder')).toBe('e.g. chicken');
    });

    it('renders no results list while idle', () => {
        renderBar();

        expect(screen.queryByRole('list')).toBeNull();
    });

    it('shows a loading state while searching, with its label as VISIBLE text', () => {
        renderBar({
            ingredientSearch: { query: 'chi', onQueryChange: noop, viewState: { kind: 'searching' } },
        });

        // The live region must carry its label as CONTENT, not only as `aria-label`: an empty `role="status"`
        // node is zero-height (invisible to a sighted viewer, and Playwright resolves it as `hidden`) AND
        // silent — a live region announces content CHANGES, and there is no content to change. Same doctrine
        // as `RecipePhotoManager`'s upload status and the mobile `LoadingState`.
        const status = screen.getByRole('status', { name: 'Searching ingredients…' });

        expect(status.textContent).toBe('Searching ingredients…');
    });

    it('shows a no-matches message for an empty settled result set', () => {
        renderBar({
            ingredientSearch: {
                query: 'zzz',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [], isError: false },
            },
        });

        expect(screen.getByText('No matching ingredients')).toBeTruthy();
    });

    /**
     * The FR-010a empty state (003-FR-010a, plan U37).
     *
     * ⛔ Asserted as VISIBLE TEXT, not as "the results list is absent". A below-minimum query rendered
     * nothing before this unit; the requirement is that the cook is TOLD why, so a test that only checks
     * for the absence of results would pass on the broken behaviour it exists to reject.
     */
    it('explains the three-character minimum, and does NOT say "no matching ingredients"', () => {
        renderBar({
            ingredientSearch: {
                query: 'eg',
                onQueryChange: noop,
                viewState: { kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH },
            },
        });

        expect(
            screen.getByText('Keep typing — 3 characters or more. Anything shorter matches half the pantry.'),
        ).toBeTruthy();
        // ⛔ The two must not be confused: "no matching ingredients" asserts the catalog was searched and
        // came back empty, which is exactly what did NOT happen.
        expect(screen.queryByText('No matching ingredients')).toBeNull();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('interpolates the minimum from the state rather than hard-coding it in the copy', () => {
        // The dictionary carries `{minimum}`; the number comes from the shared constant the SERVER also
        // reads. A literal in the dictionary would make the sentence lie the moment the floor moves.
        renderBar({
            ingredientSearch: {
                query: 'e',
                onQueryChange: noop,
                viewState: { kind: 'tooShort', minimum: 5 },
            },
        });

        expect(screen.getByText(/5 characters or more/)).toBeTruthy();
    });

    it('says nothing at all while the box is untouched', () => {
        renderBar();

        expect(screen.queryByText(/characters or more/)).toBeNull();
    });

    it('shows no searching spinner below the minimum', () => {
        renderBar({
            ingredientSearch: {
                query: 'eg',
                onQueryChange: noop,
                viewState: { kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH },
            },
        });

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('shows an error message when the search failed', () => {
        renderBar({
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [], isError: true },
            },
        });

        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('lists matching ingredients as buttons and reports a pick', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: {
                    kind: 'results',
                    results: [
                        {
                            id: 'lookup_1',
                            foodId: 'ing_1',
                            name: 'Chicken',
                            isUserEntered: false,
                            createdAt: '2026-01-01T00:00:00Z',
                        },
                    ],
                    isError: false,
                },
            },
            onFilterAction,
        });

        await user.click(screen.getByRole('button', { name: 'Filter by Chicken' }));

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'addIngredient',
            ingredient: { foodId: 'ing_1', name: 'Chicken' },
        });
    });

    /**
     * Curated U15 (`docs/design/ingredientSpecialization.md` §S1): the filter bar drops a variant's parts. A result
     * that carries a variant shows its root's name alone, and picking it filters by the root, which matches every
     * variant (U9). The native leaf holds the same test.
     */
    it('shows a variant-carrying result by its root name alone, and adds the root', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();

        renderBar({
            onFilterAction,
            ingredientSearch: {
                query: 'brisket',
                onQueryChange: noop,
                viewState: {
                    kind: 'results',
                    results: [
                        {
                            id: 'lookup_variant',
                            foodId: 'food_brisket',
                            name: 'beef brisket',
                            variant: {
                                id: 'fdc:169432',
                                parts: [
                                    { attribute: 'cut', text: 'flat half' },
                                    { attribute: 'grade', text: 'select' },
                                ],
                            },
                            isUserEntered: false,
                            createdAt: '2026-01-01T00:00:00Z',
                        },
                    ],
                    isError: false,
                },
            },
        });

        const option = screen.getByRole('button', { name: 'Filter by beef brisket' });
        expect(option.textContent).toBe('beef brisket');
        expect(screen.queryByText(/flat half/u)).toBeNull();

        await user.click(option);

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'addIngredient',
            ingredient: { foodId: 'food_brisket', name: 'beef brisket' },
        });
    });

    // Parity with the native leaf's same test: an option named by the bare ingredient name is
    // indistinguishable from the query the sibling search box already holds, so any name-addressed
    // activation (voice control, a switch-access menu, a UI harness) can resolve to the FIELD instead of the
    // option. The name states the ACTION, exactly as the removal chip's "Remove {name}" already does.
    it('names each option by its ACTION, so it cannot collide with the query the field already holds', () => {
        renderBar({
            ingredientSearch: {
                query: 'Chicken',
                onQueryChange: noop,
                viewState: {
                    kind: 'results',
                    results: [
                        {
                            id: 'lookup_1',
                            foodId: 'ing_1',
                            name: 'Chicken',
                            isUserEntered: false,
                            createdAt: '2026-01-01T00:00:00Z',
                        },
                    ],
                    isError: false,
                },
            },
        });

        expect((screen.getByLabelText('Search ingredients') as HTMLInputElement).value).toBe('Chicken');
        expect(screen.getByRole('button', { name: 'Filter by Chicken' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Chicken' })).toBeNull();
    });

    it('excludes an already-selected ingredient from the suggestion list', () => {
        renderBar({
            filters: { ...EMPTY_RECIPE_FILTERS, ingredients: [{ foodId: 'ing_1', name: 'Chicken' }] },
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: {
                    kind: 'results',
                    results: [
                        {
                            id: 'lookup_1',
                            foodId: 'ing_1',
                            name: 'Chicken',
                            isUserEntered: false,
                            createdAt: '2026-01-01T00:00:00Z',
                        },
                    ],
                    isError: false,
                },
            },
        });

        expect(screen.queryByRole('button', { name: 'Filter by Chicken' })).toBeNull();
    });

    it('updates the search box via onQueryChange', async () => {
        const user = userEvent.setup();
        const onQueryChange = vi.fn();
        renderBar({ ingredientSearch: { ...idleIngredientSearch, onQueryChange } });

        await user.type(screen.getByLabelText('Search ingredients'), 'c');

        expect(onQueryChange).toHaveBeenCalledWith('c');
    });

    it('renders selected ingredients as removable chips', () => {
        renderBar({
            filters: {
                ...EMPTY_RECIPE_FILTERS,
                ingredients: [
                    { foodId: 'ing_1', name: 'Chicken' },
                    { foodId: 'ing_2', name: 'Garlic' },
                ],
            },
        });

        expect(screen.getByRole('button', { name: 'Remove Chicken' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove Garlic' })).toBeTruthy();
    });

    it('shows each ingredient chip’s remove mark to the eye only, at a 44 px touch height (spec §S8.1a)', () => {
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, ingredients: [{ foodId: 'ing_1', name: 'Chicken' }] } });

        const chip = screen.getByRole('button', { name: 'Remove Chicken' });
        const mark = within(chip).getByText('×');

        expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(chip.className.split(' ')).toContain('min-h-11');
    });

    it('replaces the search with a note once the filter holds as many ingredients as search allows (curated U9)', () => {
        renderBar({
            filters: {
                ...EMPTY_RECIPE_FILTERS,
                ingredients: Array.from({ length: MAX_SEARCH_FOOD_FILTERS }, (_, index) => ({
                    foodId: `ing_${String(index)}`,
                    name: `Food ${String(index)}`,
                })),
            },
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: { kind: 'full', max: MAX_SEARCH_FOOD_FILTERS },
            },
        });

        expect(screen.queryByLabelText('Search ingredients')).toBeNull();
        expect(screen.queryByText('No matching ingredients')).toBeNull();
        expect(
            screen.getByText(
                `You can filter by up to ${String(MAX_SEARCH_FOOD_FILTERS)} ingredients. Remove one to add another.`,
            ),
        ).toBeTruthy();
        // Positive control: the chips that free a place stay.
        expect(screen.getByRole('button', { name: 'Remove Food 0' })).toBeTruthy();
    });

    it('keeps the search one ingredient below the bound', () => {
        renderBar({
            filters: {
                ...EMPTY_RECIPE_FILTERS,
                ingredients: Array.from({ length: MAX_SEARCH_FOOD_FILTERS - 1 }, (_, index) => ({
                    foodId: `ing_${String(index)}`,
                    name: `Food ${String(index)}`,
                })),
            },
        });

        expect(screen.getByLabelText('Search ingredients')).toBeTruthy();
        expect(screen.queryByText(/You can filter by up to/u)).toBeNull();
    });

    it('removes an ingredient chip by food id when pressed', async () => {
        const user = userEvent.setup();
        const onFilterAction = vi.fn();
        renderBar({
            filters: { ...EMPTY_RECIPE_FILTERS, ingredients: [{ foodId: 'ing_1', name: 'Chicken' }] },
            onFilterAction,
        });

        await user.click(screen.getByRole('button', { name: 'Remove Chicken' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'removeIngredient', foodId: 'ing_1' });
    });

    it('counts each selected ingredient in the clear-all summary', () => {
        renderBar({
            filters: {
                ...EMPTY_RECIPE_FILTERS,
                ingredients: [
                    { foodId: 'ing_1', name: 'Chicken' },
                    { foodId: 'ing_2', name: 'Garlic' },
                ],
            },
        });

        expect(screen.getByRole('button', { name: 'Clear 2 filters' })).toBeTruthy();
    });
});

describe('RecipeFilterBar (web) — text contrast (WCAG 2.1 AA)', () => {
    it('keeps the clear-all summary legible on the page it sits on, focus ring intact', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        // The clear-all summary is TEXT a reader reads, so it owes the 4.5:1 SC 1.4.3 floor, not the 3:1 an
        // accent owes; `seafoam` is 3.73:1 on the page background the bar sits on. See the palette JSDoc in
        // `@commise/ui`'s `tokens/colors.ts` for the one authoritative statement of the rule.
        //
        // The control paints no background of its own and its hover adds only an underline, so there is no
        // second tint to measure here — unlike the discovery buttons, which hover to a `mist/20` wash.
        const clear = screen.getByRole('button', { name: 'Clear 1 filter' });
        expect(
            utilityContrast(clear.className, { surface: semantic.background }),
            'clear-all filters label',
        ).toBeGreaterThanOrEqual(4.5);
        // The seafoam FOCUS RING stays: a focus indicator is a non-text graphic on the 3:1 SC 1.4.11 floor,
        // which seafoam clears. Demoting it too would be an over-correction, so it is pinned here — by
        // MEASUREMENT, not by a class spelling, which passes just as happily after a re-theme.
        expect(
            ringContrast(clear.className, { surface: semantic.background }),
            'the focus indicator must survive the text fix',
        ).toBeGreaterThanOrEqual(3);
    });

    it('keeps the ingredient typeahead’s PLACEHOLDER text legible on the field', () => {
        renderBar();

        // Placeholder copy is TEXT a reader reads — the field's only visible instruction before they type — so
        // it owes the same 4.5:1 as body copy; `mist` measured 1.90:1 on this `bg-white` field. `placeholder:`
        // is just another Tailwind variant, measured as its own state (the base `text-charcoal` on the same
        // element is the VALUE colour and would mask the defect).
        const search = screen.getByLabelText('Search ingredients');

        expect(
            utilityContrast(search.className, { variant: 'placeholder' }),
            'ingredient typeahead placeholder on its white field',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * The bar sits directly on the app background (the discovery `<section>` paints no surface of its own), so
 * that is the backdrop every one of its focus rings is drawn on — a Tailwind `ring-*` is a spread box-shadow
 * OUTSIDE the border box, so neither the field's white fill nor the selected chip's seafoam fill is what the
 * reader sees the ring against.
 *
 * All three rings shipped as `ring-seafoam-light`, which measures 2.58:1 there — under the 3:1 SC 1.4.11 floor
 * a focus indicator owes (#114). Keyboard-only viewers have nothing else telling them where they are, and the
 * chips are the bar's primary control, so the ring is not decoration.
 */
describe('RecipeFilterBar (web) — focus rings clear the 3:1 SC 1.4.11 floor', () => {
    const PAGE = semantic.background;

    it('rings an UNSELECTED facet chip legibly against the page', () => {
        renderBar({ facets, filters: EMPTY_RECIPE_FILTERS });

        const chip = screen.getByRole('button', { name: 'vegan, 4 recipes' });

        expect(chip.getAttribute('aria-pressed'), 'the chip measured must be the unselected one').toBe('false');
        expect(ringContrast(chip.className, { surface: PAGE }), 'unselected facet chip focus ring') //
            .toBeGreaterThanOrEqual(3);
    });

    it('rings a SELECTED facet chip legibly against the page (its own seafoam fill is NOT the backdrop)', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        const chip = screen.getByRole('button', { name: 'vegan, 4 recipes' });

        expect(chip.getAttribute('aria-pressed'), 'the chip measured must be the selected one').toBe('true');
        expect(ringContrast(chip.className, { surface: PAGE }), 'selected facet chip focus ring') //
            .toBeGreaterThanOrEqual(3);
    });

    it('rings the ingredient typeahead legibly', () => {
        renderBar();

        expect(
            ringContrast(screen.getByLabelText('Search ingredients').className, { surface: PAGE }),
            'ingredient typeahead focus ring',
        ).toBeGreaterThanOrEqual(3);
    });

    it('out-measures the `seafoam-light` it replaced, so a re-theme cannot quietly restore the defect', () => {
        renderBar({ facets });

        const baseline = ringContrast('ring-2 ring-seafoam-light', { surface: PAGE });

        expect(
            ringContrast(screen.getByRole('button', { name: 'vegan, 4 recipes' }).className, { surface: PAGE }),
        ).toBeGreaterThan(baseline);
    });
});

/**
 * Curated U9, EVALUATE 2026-10-01 (spec §S8.1a "Focus at the cap", SC 2.4.3): the control the cook pressed unmounts
 * on every add and every chip removal, so focus would drop to the page. It goes to whatever holds the search slot, in
 * the inline bar and in the Sheet alike (the spec's "inline and in the Sheet").
 */
describe.each([
    // Where focus rests before any press: nowhere inline, and on the title in the Sheet, where the Sheet puts it.
    ['inline, on a laptop', LAPTOP, (): Element => document.body],
    ['in the Sheet, on a phone', PHONE, (): Element => screen.getByRole('heading', { name: 'Filter recipes' })],
] as const)('RecipeFilterBar (web) — focus after an ingredient add or removal, %s', (_where, size, resting) => {
    /** Mount the stateful bar at `size`, opening the Sheet first where there is one. */
    const mount = async (initial: number, late = false): Promise<ReturnType<typeof userEvent.setup>> => {
        windowSize = size;
        const user = userEvent.setup();
        render(<StatefulBar initial={initial} late={late} />);

        if (size === PHONE) {
            await user.click(screen.getByRole('button', { name: /^Filters/u }));
        }

        return user;
    };

    it('moves focus to the note when the add fills the filter', async () => {
        const user = await mount(MAX_SEARCH_FOOD_FILTERS - 1);

        await user.click(screen.getByRole('button', { name: 'Filter by Newfood' }));

        expect(document.activeElement).toBe(screen.getByText(FULL_NOTE));
    });

    it('moves focus to the note when the filling add lands a render after the press, as the URL makes it', async () => {
        const user = await mount(MAX_SEARCH_FOOD_FILTERS - 1, true);

        await user.click(screen.getByRole('button', { name: 'Filter by Newfood' }));

        await waitFor(() => expect(document.activeElement).toBe(screen.getByText(FULL_NOTE)));
    });

    it('moves focus to the search box after any other add', async () => {
        const user = await mount(0);

        await user.click(screen.getByRole('button', { name: 'Filter by Newfood' }));

        expect(document.activeElement).toBe(screen.getByLabelText('Search ingredients'));
    });

    it('moves focus to the search box after a chip removal frees a place', async () => {
        const user = await mount(MAX_SEARCH_FOOD_FILTERS);

        await user.click(screen.getByRole('button', { name: 'Remove Food 0' }));

        expect(document.activeElement).toBe(screen.getByLabelText('Search ingredients'));
    });

    it('moves nothing on mount, even when the filter starts full (a shared URL)', async () => {
        await mount(MAX_SEARCH_FOOD_FILTERS);

        expect(document.activeElement).toBe(resting());
    });
});

/**
 * Spec §S8.1a "Web below 640 px" (curated U15, E2 I9): on a phone the seven facet groups move into the design-system
 * Sheet behind a `Filters` trigger, the native anatomy; on a laptop the inline bar stays. Each row of the spec's web
 * table has a test here.
 */
describe('RecipeFilterBar (web) — which layout', () => {
    it('keeps the inline bar, named "Filter recipes", and no trigger on a laptop', () => {
        renderBar({ facets });

        expect(screen.getByRole('group', { name: 'Filter recipes' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Filters/u })).toBeNull();
    });

    it('shows only the trigger on a phone: no facet group above the results', () => {
        windowSize = PHONE;
        renderBar({ facets });

        expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
        expect(screen.queryByRole('group', { name: 'Filter recipes' })).toBeNull();
        expect(screen.queryByRole('group', { name: 'Dietary' })).toBeNull();
        expect(screen.queryByRole('group', { name: 'Total time' })).toBeNull();
        expect(screen.queryByLabelText('Search ingredients')).toBeNull();
    });

    /**
     * The Sheet below 640 px wide OR below 480 px tall (staff-ux-engineer SPECIFY, 2026-10-02): at 844 × 390, a phone
     * turned sideways, the inline bar put the first result at y = 921, two screens down.
     */
    it.each([
        [{ width: 639, height: 800 }, 'Sheet'],
        [{ width: 640, height: 800 }, 'inline'],
        [{ width: 844, height: 390 }, 'Sheet'],
        [{ width: 1280, height: 479 }, 'Sheet'],
        [{ width: 1280, height: 480 }, 'inline'],
    ] as const)('lays out a %o window as the %s bar', (size, layout) => {
        windowSize = size;
        renderBar({ facets });

        expect(screen.queryByRole('button', { name: 'Filters' }) !== null).toBe(layout === 'Sheet');
        expect(screen.queryByRole('group', { name: 'Filter recipes' }) !== null).toBe(layout === 'inline');
    });

    /**
     * Before hydration the server cannot know the window, so it sends both and CSS decides by the same query: nothing
     * above the results moves when the client takes over.
     */
    it('server-renders both the trigger and the inline bar, each hidden by CSS where the other belongs', () => {
        const host = document.createElement('div');
        host.innerHTML = renderToString(
            <RecipeFilterBar
                facets={facets}
                filters={EMPTY_RECIPE_FILTERS}
                onFilterAction={noop}
                ingredientSearch={idleIngredientSearch}
            />,
        );

        const trigger = within(host).getByRole('button', { name: 'Filters' });
        const inline = within(host).getByRole('group', { name: 'Filter recipes' });

        expect(trigger.className.split(/\s+/u)).toContain(`${INLINE_VARIANT}:hidden`);
        expect(inline.className.split(/\s+/u)).toEqual(expect.arrayContaining(['hidden', `${INLINE_VARIANT}:flex`]));
    });
});

describe('RecipeFilterBar (web) — hydration', () => {
    /** RTL's `cleanup` knows nothing of a root this suite hydrates itself. */
    let dispose: (() => void) | undefined;

    afterEach(() => {
        dispose?.();
        dispose = undefined;
    });

    /** Server HTML for the bar, hydrated in this window, as the discovery page does. */
    const hydrateBar = async (): Promise<void> => {
        const bar = (
            <RecipeFilterBar
                facets={facets}
                filters={EMPTY_RECIPE_FILTERS}
                onFilterAction={noop}
                ingredientSearch={idleIngredientSearch}
            />
        );
        const host = document.createElement('div');
        host.innerHTML = renderToString(bar);
        document.body.append(host);
        const root = await act(async () => Promise.resolve(hydrateRoot(host, bar)));

        dispose = () => {
            act(() => root.unmount());
            host.remove();
        };
    };

    it.each([
        ['a laptop', LAPTOP, 'inline'],
        ['a phone', PHONE, 'Sheet'],
    ] as const)('keeps one layout on %s once hydrated, and takes no focus for it', async (_name, size, layout) => {
        windowSize = size;

        await hydrateBar();

        expect(screen.queryByRole('button', { name: 'Filters' }) !== null).toBe(layout === 'Sheet');
        expect(screen.queryByRole('group', { name: 'Filter recipes' }) !== null).toBe(layout === 'inline');
        expect(document.activeElement).toBe(document.body);
    });
});

describe('RecipeFilterBar (web) — with no matchMedia to ask', () => {
    it('lets CSS pick, and draws the facets once when the Sheet opens', async () => {
        vi.unstubAllGlobals();
        const user = userEvent.setup();
        renderBar({ facets });

        expect(screen.getByRole('group', { name: 'Filter recipes' })).toBeTruthy();
        await user.click(screen.getByRole('button', { name: 'Filters' }));

        expect(screen.getByRole('dialog', { name: 'Filter recipes' })).toBeTruthy();
        expect(document.querySelectorAll('[aria-label="Search ingredients"]')).toHaveLength(1);
    });
});

describe('RecipeFilterBar (web) — the trigger, on a phone', () => {
    it('is named "Filters" and shows no count while nothing is filtered', () => {
        windowSize = PHONE;
        renderBar({ facets });

        const trigger = screen.getByRole('button', { name: 'Filters' });

        expect(trigger.textContent).toBe('Filters');
    });

    it('shows the active count in a badge, and says it in its name', () => {
        windowSize = PHONE;
        renderBar({ facets, filters: { dietaryFlags: ['vegan'], tags: ['quick'], maxTotalTime: 30 } });

        const trigger = screen.getByRole('button', { name: 'Filters, 3 active' });

        expect(within(trigger).getByText('3')).toBeTruthy();
        expect(within(trigger).getByText('Filters')).toBeTruthy();
    });

    it('has a 44 px touch height and a radius of half that, white with the house border (§S13)', () => {
        windowSize = PHONE;
        renderBar({ facets });

        const classes = screen.getByRole('button', { name: 'Filters' }).className.split(/\s+/u);

        expect(classes).toEqual(
            expect.arrayContaining(['min-h-11', 'rounded-[calc(var(--spacing)*5.5)]', 'bg-white', 'border-border']),
        );
    });

    /** E2 I10: a fixed height let a scaled digit outgrow its fill and sit white on white. */
    it('lets the count badge grow with the text: a 22 px floor in rem, with padding, and no fixed height', () => {
        windowSize = PHONE;
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        const badge = within(screen.getByRole('button', { name: 'Filters, 1 active' })).getByText('1');
        const classes = badge.className.split(/\s+/u);

        expect(classes).toEqual(
            expect.arrayContaining(['min-h-5.5', 'min-w-5.5', 'py-0.5', 'bg-seafoam', 'text-white']),
        );
        expect(classes.some((name) => /^h-/u.test(name))).toBe(false);
    });

    it('rings the trigger legibly against the page when focused (SC 1.4.11)', () => {
        windowSize = PHONE;
        renderBar({ facets });

        expect(
            ringContrast(screen.getByRole('button', { name: 'Filters' }).className, { surface: semantic.background }),
        ).toBeGreaterThanOrEqual(3);
    });
});

describe('RecipeFilterBar (web) — the Sheet, on a phone', () => {
    it('opens a dialog named "Filter recipes", with the facet groups in their inline order', async () => {
        await renderBarInSheet({ facets: { ...facets, cuisine: [{ value: 'Thai', count: 5 }] } });

        const dialog = screen.getByRole('dialog', { name: 'Filter recipes' });
        const names = within(dialog)
            .getAllByRole('group')
            .map((group) => group.getAttribute('aria-label'));

        expect(names).toEqual(['Dietary', 'Cuisine', 'Tags', 'Prep time', 'Cook time', 'Total time', 'Ingredients']);
    });

    it('drops the group named "Filter recipes" inside the dialog, which already carries the name', async () => {
        await renderBarInSheet({ facets });

        expect(screen.queryByRole('group', { name: 'Filter recipes' })).toBeNull();
    });

    it('applies a facet at once and stays open, so a cook can pick several', async () => {
        const onFilterAction = vi.fn();
        const user = await renderBarInSheet({ facets, onFilterAction });

        await user.click(screen.getByRole('button', { name: 'vegan, 4 recipes' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'vegan' });
        expect(screen.getByRole('dialog', { name: 'Filter recipes' })).toBeTruthy();
    });

    it('keeps Clear all after the facets in the scroll region, and Done after it in the footer', async () => {
        await renderBarInSheet({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        const total = screen.getByRole('group', { name: 'Total time' });
        const clear = screen.getByRole('button', { name: 'Clear 1 filter' });
        const done = screen.getByRole('button', { name: 'Done' });

        expect(total.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(clear.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // The footer is the Sheet's own slot, under its hairline; the facets are not in it.
        const footer = done.closest('.border-t');
        expect(footer).not.toBeNull();
        expect(footer?.contains(clear)).toBe(false);
    });

    it('gives Done the full width of the footer and a 44 px touch height', async () => {
        await renderBarInSheet({ facets });

        expect(screen.getByRole('button', { name: 'Done' }).className.split(/\s+/u)).toEqual(
            expect.arrayContaining(['w-full', 'min-h-11']),
        );
    });

    // R9 (`docs/design/rowEditorOpenDecisions.md`): Done is the footer's only action, so it is the house primary, with
    // the icon every design-system button carries.
    it('makes Done the primary design-system button, with a decorative icon', async () => {
        await renderBarInSheet({ facets });

        const done = screen.getByRole('button', { name: 'Done' });
        const tokens = done.className.split(/\s+/u);

        expect(tokens).toEqual(expect.arrayContaining(buttonSurfaceClass('primary').split(' ')));
        expect(tokens).not.toContain('bg-charcoal');
        expect(done.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    });

    it.each([
        [
            'Done',
            async (user: ReturnType<typeof userEvent.setup>) =>
                user.click(screen.getByRole('button', { name: 'Done' })),
        ],
        [
            'Close',
            async (user: ReturnType<typeof userEvent.setup>) =>
                user.click(screen.getByRole('button', { name: 'Close filters' })),
        ],
        ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ])('closes through %s and returns focus to the trigger (SC 2.4.3)', async (_route, close) => {
        const user = await renderBarInSheet({ facets });

        await close(user);

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filters' }));
    });
});

/**
 * Every state the ingredient slot has, inside the Sheet. The inline suites above cover the same states on a laptop;
 * these prove the Sheet hosts each one rather than only the happy path.
 */
describe('RecipeFilterBar (web) — the ingredient states, in the Sheet', () => {
    const search = (viewState: RecipeIngredientSearchState['viewState']): RecipeIngredientSearchState => ({
        query: 'chi',
        onQueryChange: noop,
        viewState,
    });

    it('shows the searching state', async () => {
        await renderBarInSheet({ ingredientSearch: search({ kind: 'searching' }) });

        expect(
            within(screen.getByRole('dialog')).getByRole('status', { name: 'Searching ingredients…' }).textContent,
        ).toBe('Searching ingredients…');
    });

    it('shows the empty state', async () => {
        await renderBarInSheet({ ingredientSearch: search({ kind: 'results', results: [], isError: false }) });

        expect(within(screen.getByRole('dialog')).getByText('No matching ingredients')).toBeTruthy();
    });

    it('shows the error state', async () => {
        await renderBarInSheet({ ingredientSearch: search({ kind: 'results', results: [], isError: true }) });

        expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe(
            'We couldn’t search ingredients. Try again.',
        );
    });

    it('shows the results and the selected chips', async () => {
        await renderBarInSheet({
            filters: { ...EMPTY_RECIPE_FILTERS, ingredients: [{ foodId: 'ing_1', name: 'Chicken' }] },
            ingredientSearch: search({ kind: 'results', results: [NEW_FOOD], isError: false }),
        });

        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getByRole('button', { name: 'Filter by Newfood' })).toBeTruthy();
        expect(dialog.getByRole('button', { name: 'Remove Chicken' })).toBeTruthy();
    });

    it('shows the note in place of the search at the six-ingredient cap, with the chips kept', async () => {
        await renderBarInSheet({
            filters: { ...EMPTY_RECIPE_FILTERS, ingredients: foods(MAX_SEARCH_FOOD_FILTERS) },
            ingredientSearch: search({ kind: 'full', max: MAX_SEARCH_FOOD_FILTERS }),
        });

        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getByText(FULL_NOTE)).toBeTruthy();
        expect(dialog.queryByLabelText('Search ingredients')).toBeNull();
        expect(dialog.getAllByRole('button', { name: /^Remove Food/u })).toHaveLength(MAX_SEARCH_FOOD_FILTERS);
    });
});

/** Spec §S8.1a, the last web row: the window leaves the Sheet's layout while it is open. A two-way door. */
describe('RecipeFilterBar (web) — the window crosses the breakpoint', () => {
    it('closes an open Sheet when the window widens, and moves focus to the inline bar’s first control', async () => {
        await renderBarInSheet({ facets });

        resizeWindow(LAPTOP);

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        const inline = screen.getByRole('group', { name: 'Filter recipes' });
        expect(document.activeElement).toBe(within(inline).getAllByRole('button')[0]);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'vegan, 4 recipes' }));
    });

    it('comes back closed when the window narrows again', async () => {
        await renderBarInSheet({ facets });

        resizeWindow(LAPTOP);
        resizeWindow(PHONE);

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    });

    it('moves no focus when the window widens with the Sheet closed', async () => {
        windowSize = PHONE;
        renderBar({ facets });
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();

        resizeWindow(LAPTOP);

        expect(screen.getByRole('group', { name: 'Filter recipes' })).toBeTruthy();
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });

    it('replaces the inline bar with the trigger when the window narrows, opening nothing', () => {
        renderBar({ facets });

        resizeWindow(PHONE);

        expect(screen.queryByRole('group', { name: 'Filter recipes' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('moves focus from the inline bar to the trigger when the window narrows', async () => {
        const user = userEvent.setup();
        renderBar({ facets });
        await user.click(screen.getByRole('button', { name: 'vegan, 4 recipes' }));

        resizeWindow(PHONE);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filters' }));
    });

    it('keeps the Sheet open when a phone turns sideways, which is still the Sheet layout', async () => {
        await renderBarInSheet({ facets });

        resizeWindow(PHONE_SIDEWAYS);

        expect(screen.getByRole('dialog', { name: 'Filter recipes' })).toBeTruthy();
    });
});
