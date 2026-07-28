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

import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { FILTER_SHEET_PADDING, RecipeFilterBar } from '../RecipeFilterBar.native.js';
import { EMPTY_RECIPE_FILTERS } from '../model.js';
import type { RecipeFilterBarProps, RecipeIngredientSearchState } from '../model.js';

// A DISTINCT value per edge, so an assertion cannot pass on a leaf that adds the wrong inset to the wrong
// side. Restated inside the factory because `vi.mock` is hoisted above every module-level binding.
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 8, bottom: 16, left: 4 }),
}));

const INSETS = { top: 24, right: 8, bottom: 16, left: 4 } as const;

afterEach(cleanup);

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property. `StyleSheet.create` styles compile
 * to atomic `r-*` classes (walked back to their rules here, since `getComputedStyle` does not resolve them),
 * while per-render styles — such as this sheet's inset-derived padding — land in the inline `style`
 * attribute; checking only one source would read `undefined` for exactly the geometry under test. Same
 * helper as `FullScreenSheet.native.test.tsx`, which established the idiom.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const inline = (element as HTMLElement).style.getPropertyValue(property);

    if (inline !== '') {
        return inline;
    }

    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return resolved;
}

const noop = () => undefined;

const idleIngredientSearch: RecipeIngredientSearchState = {
    query: '',
    onQueryChange: noop,
    viewState: { kind: 'idle' },
};

/**
 * Render the bar and (by default) OPEN its bottom sheet, so the existing facet/chip/time/ingredient/clear
 * assertions run against the sheet's contents. Pass `{ open: false }` to inspect the collapsed trigger.
 */
function renderBar(overrides: Partial<RecipeFilterBarProps> = {}, { open = true }: { open?: boolean } = {}) {
    const props: RecipeFilterBarProps = {
        facets: {},
        filters: EMPTY_RECIPE_FILTERS,
        onToggleFacet: noop,
        onSetCuisine: noop,
        onSetMaxPrepTime: noop,
        onSetMaxCookTime: noop,
        onSetMaxTotalTime: noop,
        ingredientSearch: idleIngredientSearch,
        onAddIngredientFilter: noop,
        onRemoveIngredientFilter: noop,
        onClearAll: noop,
        ...overrides,
    };
    render(<RecipeFilterBar {...props} />);

    if (open) {
        // The facets now live behind a "Filters" bottom sheet (U7); open it so the groups are in the tree.
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    }

    return props;
}

const facets = {
    dietaryFlags: [
        { value: 'vegan', count: 4 },
        { value: 'gluten-free', count: 2 },
    ],
    tags: [{ value: 'quick', count: 3 }],
};

describe('RecipeFilterBar (native) — bottom sheet (U7)', () => {
    it('renders a "Filters" trigger button', () => {
        renderBar({}, { open: false });

        expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    });

    it('keeps the facet groups collapsed until the sheet is opened', () => {
        renderBar({ facets }, { open: false });

        expect(screen.queryByRole('group', { name: 'Total time' })).toBeNull();
        expect(screen.queryByRole('group', { name: 'Dietary' })).toBeNull();
    });

    it('reveals the facet groups when the trigger is pressed', () => {
        renderBar({ facets }, { open: false });

        fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

        expect(screen.getByRole('group', { name: 'Total time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Dietary' })).toBeTruthy();
    });

    it('shows the active-filter count on the trigger badge', () => {
        renderBar({ facets, filters: { dietaryFlags: ['vegan'], tags: ['quick'], maxTotalTime: 30 } }, { open: false });

        // The badge count is visible on the collapsed trigger, and the accessible name conveys it too.
        expect(screen.getByRole('button', { name: 'Filters, 3 active' })).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
    });

    it('shows no active-count badge when nothing is filtered', () => {
        renderBar({ facets }, { open: false });

        expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /active/ })).toBeNull();
    });

    it('closes the sheet from the Done action', () => {
        renderBar({ facets });

        expect(screen.getByRole('group', { name: 'Total time' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(screen.queryByRole('group', { name: 'Total time' })).toBeNull();
    });
});

describe('RecipeFilterBar (native) — structure', () => {
    it('exposes the bar and each dimension as a named group', () => {
        renderBar({ facets });

        expect(screen.getByRole('group', { name: 'Filter recipes' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Dietary' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Tags' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Prep time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Cook time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Total time' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Ingredients' })).toBeTruthy();
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

describe('RecipeFilterBar (native) — ingredient filter typeahead (FR-006 gap #3)', () => {
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

        // Same doctrine as the web leaf and the mobile `LoadingState`: the contextual label doubles as the
        // visible caption. An empty live region is both invisible and silent.
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

    it('lists matching ingredients as buttons and reports a pick', () => {
        const onAddIngredientFilter = vi.fn();
        renderBar({
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: {
                    kind: 'results',
                    results: [
                        { id: 'ing_1', name: 'Chicken', isUserEntered: false, createdAt: '2026-01-01T00:00:00Z' },
                    ],
                    isError: false,
                },
            },
            onAddIngredientFilter,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Filter by Chicken' }));

        expect(onAddIngredientFilter).toHaveBeenCalledWith({ id: 'ing_1', name: 'Chicken' });
    });

    // The defect (round 5): the option's accessible name was the BARE ingredient name — the very string the
    // user just typed into the sibling search field, which carries it as its own value. Any name-addressed
    // activation (Maestro `tapOn: 'Flour'`, voice control, a switch-access menu) therefore resolves to the
    // FIELD, which is earlier in the tree, and the pick is silently dropped: the sheet closes with no chip, no
    // count badge, and `hasActiveFilters` still false. Naming the option by its ACTION makes it addressable.
    it('names each option by its ACTION, so it cannot collide with the query the field already holds', () => {
        renderBar({
            ingredientSearch: {
                // The worst case, and the one the Maestro flow hits: the typed query IS the match's full name.
                query: 'Chicken',
                onQueryChange: noop,
                viewState: {
                    kind: 'results',
                    results: [
                        { id: 'ing_1', name: 'Chicken', isUserEntered: false, createdAt: '2026-01-01T00:00:00Z' },
                    ],
                    isError: false,
                },
            },
        });

        // The collision is REAL in this test, not hypothetical: the field really does hold "Chicken".
        expect((screen.getByLabelText('Search ingredients') as HTMLInputElement).value).toBe('Chicken');
        // …and the option is still uniquely addressable, because its name describes what activating it does.
        expect(screen.getByRole('button', { name: 'Filter by Chicken' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Chicken' })).toBeNull();
    });

    // The option row carried NO style at all — its hit area was the intrinsic height of one line of text
    // (~19dp), well under the 44pt floor every other control on this leaf (and its web peer's `py-2`) has.
    it('gives each option the 44pt minimum tap target', () => {
        renderBar({
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: {
                    kind: 'results',
                    results: [
                        { id: 'ing_1', name: 'Chicken', isUserEntered: false, createdAt: '2026-01-01T00:00:00Z' },
                    ],
                    isError: false,
                },
            },
        });

        const option = screen.getByRole('button', { name: 'Filter by Chicken' });

        expect(appliedStyle(option, 'min-height')).toBe('44px');
    });

    it('excludes an already-selected ingredient from the suggestion list', () => {
        renderBar({
            filters: { ...EMPTY_RECIPE_FILTERS, ingredients: [{ id: 'ing_1', name: 'Chicken' }] },
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: {
                    kind: 'results',
                    results: [
                        { id: 'ing_1', name: 'Chicken', isUserEntered: false, createdAt: '2026-01-01T00:00:00Z' },
                    ],
                    isError: false,
                },
            },
        });

        expect(screen.queryByRole('button', { name: 'Filter by Chicken' })).toBeNull();
    });

    it('updates the search box via onQueryChange', () => {
        const onQueryChange = vi.fn();
        renderBar({ ingredientSearch: { ...idleIngredientSearch, onQueryChange } });

        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'chi' } });

        expect(onQueryChange).toHaveBeenCalledWith('chi');
    });

    it('renders selected ingredients as removable chips', () => {
        renderBar({
            filters: {
                ...EMPTY_RECIPE_FILTERS,
                ingredients: [
                    { id: 'ing_1', name: 'Chicken' },
                    { id: 'ing_2', name: 'Garlic' },
                ],
            },
        });

        expect(screen.getByRole('button', { name: 'Remove Chicken' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove Garlic' })).toBeTruthy();
    });

    it('removes an ingredient chip by id when pressed', () => {
        const onRemoveIngredientFilter = vi.fn();
        renderBar({
            filters: { ...EMPTY_RECIPE_FILTERS, ingredients: [{ id: 'ing_1', name: 'Chicken' }] },
            onRemoveIngredientFilter,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove Chicken' }));

        expect(onRemoveIngredientFilter).toHaveBeenCalledWith('ing_1');
    });

    it('counts each selected ingredient in the clear-all summary', () => {
        renderBar({
            filters: {
                ...EMPTY_RECIPE_FILTERS,
                ingredients: [
                    { id: 'ing_1', name: 'Chicken' },
                    { id: 'ing_2', name: 'Garlic' },
                ],
            },
        });

        expect(screen.getByRole('button', { name: 'Clear 2 filters' })).toBeTruthy();
    });
});

describe('RecipeFilterBar (native) — bottom sheet safe-area insets', () => {
    /** The sheet's own padded surface — the labelled group the leaf renders inside the modal window. */
    const sheet = (): HTMLElement => screen.getByLabelText('Filter recipes');

    // The defect: an Android `Modal` window spans the WHOLE display (the app is edge-to-edge), and this
    // sheet is bottom-anchored (`justifyContent: 'flex-end'`), so a flat pad puts its footer "Done" INSIDE
    // the navigation bar's own tap region. On-device the button drew at y 2272–2329 on a 1080×2400 device
    // whose navigation bar starts at y=2274: every tap on it was swallowed by the system bar, the sheet
    // never closed, and the two Maestro discovery flows failed on the steps AFTER it (round 3).
    it('adds the device bottom inset to the sheet padding, so Done clears the navigation bar', () => {
        renderBar();

        expect(appliedStyle(sheet(), 'padding-bottom')).toBe(`${FILTER_SHEET_PADDING + INSETS.bottom}px`);
    });

    it('adds the device left/right insets so no facet sits under a landscape cutout', () => {
        renderBar();

        expect(appliedStyle(sheet(), 'padding-left')).toBe(`${FILTER_SHEET_PADDING + INSETS.left}px`);
        expect(appliedStyle(sheet(), 'padding-right')).toBe(`${FILTER_SHEET_PADDING + INSETS.right}px`);
    });

    it('leaves the top padding at the base value — the sheet is bottom-anchored, never under the status bar', () => {
        renderBar();

        expect(appliedStyle(sheet(), 'padding-top')).toBe(`${FILTER_SHEET_PADDING}px`);
    });
});

describe('RecipeFilterBar (native) — text contrast (WCAG 2.1 AA)', () => {
    it('keeps the clear-all summary legible on the filter sheet', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        // Mirrors the web leaf: the clear-all summary is TEXT, so it owes the 4.5:1 SC 1.4.3 floor, and
        // `seafoam` is only 4.02:1 on the sheet — whose own `backgroundColor` is `palette.white`, so that is
        // the surface (the translucent scrim sits BEHIND the opaque sheet and never shows through). See the
        // palette JSDoc in `@commise/ui`'s `tokens/colors.ts`. A ratio is asserted rather than a token
        // spelling, so re-theming the token cannot satisfy it by accident.
        const label = within(screen.getByRole('button', { name: 'Clear 1 filter' })).getByText('Clear 1 filter');
        expect(
            computedContrast(label, { surface: palette.white }),
            'clear-all label on the white filter sheet',
        ).toBeGreaterThanOrEqual(4.5);
    });
});
