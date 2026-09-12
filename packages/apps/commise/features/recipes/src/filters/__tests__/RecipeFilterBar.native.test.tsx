/**
 * Native component tests for the recipe filter bar (FR-006), rendered via react-native-web under jsdom.
 * Mirrors the web leaf across EVERY branch — no facets, one/both dimensions, the time ladder, selected vs
 * unselected chips, a selected-but-unfaceted value, the active-count summary, and clear-all — and reads the
 * real `aria-pressed` semantics react-native-web surfaces for a selected `Pressable`, so a chip that dropped
 * its pressed state, its dimension/value, or its handler argument fails the test. The two platform renders
 * therefore cannot drift on behavior or accessibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { AccessibilityInfo } from 'react-native';

import { computedContrast, dialogTitled, headedGroup, queryDialogTitled, queryHeadedGroup } from '@commise/test-utils';
import { palette } from '@commise/ui';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { MAX_SEARCH_FOOD_FILTERS } from '@kitchensink/schema-recipe';

import { RecipeFilterBar } from '../RecipeFilterBar.native.js';
import { EMPTY_RECIPE_FILTERS, applyFilterAction } from '../model.js';
import type { FoodIngredient, RecipeFilterBarProps, RecipeFilterState, RecipeIngredientSearchState } from '../model.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus-return case reads the calls.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

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

/** `count` foods already in the filter. */
const foods = (count: number): { foodId: string; name: string }[] =>
    Array.from({ length: count }, (_, index) => ({ foodId: `ing_${String(index)}`, name: `Food ${String(index)}` }));

/**
 * The bar under a parent that holds the filter, as the containers do, so the parent's update and the bar's own
 * focus signal land in the same render. The search offers one food until the filter is full.
 */
function StatefulBar({ initial }: { readonly initial: number }) {
    const [filters, setFilters] = useState<RecipeFilterState>({ ...EMPTY_RECIPE_FILTERS, ingredients: foods(initial) });
    const full = (filters.ingredients?.length ?? 0) >= MAX_SEARCH_FOOD_FILTERS;

    return (
        <RecipeFilterBar
            facets={{}}
            filters={filters}
            onFilterAction={(action) => setFilters((current) => applyFilterAction(current, action))}
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

/**
 * Render the bar and (by default) OPEN its bottom sheet, so the existing facet/chip/time/ingredient/clear
 * assertions run against the sheet's contents. Pass `{ open: false }` to inspect the collapsed trigger.
 */
function renderBar(overrides: Partial<RecipeFilterBarProps> = {}, { open = true }: { open?: boolean } = {}) {
    const props: RecipeFilterBarProps = {
        facets: {},
        filters: EMPTY_RECIPE_FILTERS,
        onFilterAction: noop,
        ingredientSearch: idleIngredientSearch,
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

/** Every facet group the open sheet draws for {@link facets}, by the header that names it. */
const FACET_GROUPS = ['Dietary', 'Tags', 'Prep time', 'Cook time', 'Total time', 'Ingredients'];

/** A ladder's buckets, in order. */
const BUCKETS = ['Under 15 min', 'Under 30 min', 'Under 60 min'];

/**
 * The accessible names of the buttons inside the group whose header says `name`. On native a group is named by its
 * header, not by a label of its own (`docs/design/nativeContainerNames.md` N1 rule 2), so it is found through it.
 */
const buttonNamesIn = (name: string): (string | null)[] =>
    within(headedGroup(name))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'));

/** The bucket named `bucket` in the time ladder whose header says `ladder`. */
const ladderBucket = (ladder: string, bucket: string): HTMLElement =>
    within(headedGroup(ladder)).getByRole('button', { name: bucket });

/** Whether `element` sits in a scroll region react-native-web made scrollable. */
function isInScrollRegion(element: Element): boolean {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const overflowY = appliedStyle(node, 'overflow-y');

        if (overflowY === 'auto' || overflowY === 'scroll') {
            return true;
        }
    }

    return false;
}

describe('RecipeFilterBar (native) — bottom sheet (U7)', () => {
    it('renders a "Filters" trigger button', () => {
        renderBar({}, { open: false });

        expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    });

    it('keeps the facet groups collapsed until the sheet is opened', () => {
        renderBar({ facets }, { open: false });

        expect(queryHeadedGroup('Total time')).toBeNull();
        expect(queryHeadedGroup('Dietary')).toBeNull();
    });

    it('reveals the facet groups when the trigger is pressed', () => {
        renderBar({ facets }, { open: false });
        expect(queryDialogTitled('Filter recipes')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

        const sheet = dialogTitled('Filter recipes');

        for (const name of FACET_GROUPS) {
            expect(sheet.contains(headedGroup(name)), name).toBe(true);
        }
    });

    it('shows the active-filter count on the trigger badge', () => {
        renderBar({ facets, filters: { dietaryFlags: ['vegan'], tags: ['quick'], maxTotalTime: 30 } }, { open: false });

        // The badge count is visible on the collapsed trigger, and the accessible name conveys it too.
        expect(screen.getByRole('button', { name: 'Filters, 3 active' })).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
    });

    /**
     * E2 I10 — the count badge grows with the font. A fixed `height: 22` around an 11 pt digit let the digit outgrow
     * the circle at a large font scale, and outside it the white digit sat white on white. jsdom has no font scale,
     * so this pins the contract: a 22 dp FLOOR, no fixed height, and vertical padding that gives a scaled digit room.
     */
    it('lets the count badge grow with the font: a 22dp floor, no fixed height', () => {
        renderBar({ facets, filters: { dietaryFlags: ['vegan'] } }, { open: false });

        const badge = screen.getByText('1').parentElement;

        expect(badge).not.toBeNull();
        expect(appliedStyle(badge as HTMLElement, 'min-height')).toBe('22px');
        expect(appliedStyle(badge as HTMLElement, 'height')).toBeUndefined();
        expect(Number.parseFloat(appliedStyle(badge as HTMLElement, 'padding-top') ?? '0')).toBeGreaterThan(0);
        expect(Number.parseFloat(appliedStyle(badge as HTMLElement, 'padding-bottom') ?? '0')).toBeGreaterThan(0);
    });

    it('shows no active-count badge when nothing is filtered', () => {
        renderBar({ facets }, { open: false });

        expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /active/ })).toBeNull();
    });

    it('closes the sheet from the Done action', () => {
        renderBar({ facets });
        expect(dialogTitled('Filter recipes').contains(headedGroup('Dietary'))).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(queryDialogTitled('Filter recipes')).toBeNull();
        expect(queryHeadedGroup('Dietary')).toBeNull();
        expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    });
});

describe('RecipeFilterBar (native) — structure', () => {
    // Bounds, not value lists: a ladder has its buckets whatever the search returned.
    it('renders the time ladders even with no facets', () => {
        renderBar({ facets: {} });

        for (const ladder of ['Prep time', 'Cook time', 'Total time']) {
            expect(buttonNamesIn(ladder), ladder).toEqual(BUCKETS);
        }
    });

    it('omits a facet dimension when the server returns none and none is selected', () => {
        renderBar({ facets: {} });

        expect(queryHeadedGroup('Dietary')).toBeNull();
        expect(queryHeadedGroup('Tags')).toBeNull();
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
        const onFilterAction = vi.fn();
        renderBar({ facets, onFilterAction });

        fireEvent.click(screen.getByRole('button', { name: 'quick, 3 recipes' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'toggleFacet', dimension: 'tags', value: 'quick' });
    });

    // react-native-web draws an `accessibilityRole="button"` Pressable as a `<button>`, in the tab order.
    it('renders chips as real buttons', () => {
        renderBar({ facets });

        expect(buttonNamesIn('Dietary')).toEqual(['vegan, 4 recipes', 'gluten-free, 2 recipes']);
        expect(buttonNamesIn('Tags')).toEqual(['quick, 3 recipes']);

        for (const group of ['Dietary', 'Tags']) {
            for (const chip of within(headedGroup(group)).getAllByRole('button')) {
                expect(chip.tagName).toBe('BUTTON');
                expect(chip.getAttribute('tabindex')).toBe('0');
            }
        }
    });
});

describe('RecipeFilterBar (native) — time ladder', () => {
    it('presses only the active bound', () => {
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, maxTotalTime: 30 } });

        expect(BUCKETS.map((bucket) => ladderBucket('Total time', bucket).getAttribute('aria-pressed'))).toEqual([
            'false',
            'true',
            'false',
        ]);
        // The bound is the total time's: the same bucket on the other ladders stays unpressed.
        expect(ladderBucket('Prep time', 'Under 30 min').getAttribute('aria-pressed')).toBe('false');
        expect(ladderBucket('Cook time', 'Under 30 min').getAttribute('aria-pressed')).toBe('false');
    });

    it('sets the bound when an inactive bucket is pressed', () => {
        const onFilterAction = vi.fn();
        renderBar({ onFilterAction });

        fireEvent.click(ladderBucket('Total time', 'Under 30 min'));

        expect(onFilterAction).toHaveBeenCalledTimes(1);
        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxTotalTime', minutes: 30 });
    });

    it('clears the bound when the active bucket is pressed again', () => {
        const onFilterAction = vi.fn();
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, maxTotalTime: 30 }, onFilterAction });
        expect(ladderBucket('Total time', 'Under 30 min').getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(ladderBucket('Total time', 'Under 30 min'));

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'setTimeBound',
            field: 'maxTotalTime',
            minutes: undefined,
        });
    });

    it('sets a prep bound from the Prep time ladder (S2)', () => {
        const onFilterAction = vi.fn();
        renderBar({ onFilterAction });

        fireEvent.click(ladderBucket('Prep time', 'Under 15 min'));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxPrepTime', minutes: 15 });
    });

    // Single-select: the search API filters by ONE cuisine, so pressing another replaces it.
    it('renders the single-select Cuisine group and reports a selection (S2)', () => {
        const onFilterAction = vi.fn();
        renderBar({
            facets: {
                cuisine: [
                    { value: 'Thai', count: 5 },
                    { value: 'Italian', count: 3 },
                ],
            },
            filters: { cuisine: 'Thai' },
            onFilterAction,
        });

        const cuisine = within(headedGroup('Cuisine'));

        expect(cuisine.getByRole('button', { name: 'Thai, 5 recipes' }).getAttribute('aria-pressed')).toBe('true');
        expect(cuisine.getByRole('button', { name: 'Italian, 3 recipes' }).getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(cuisine.getByRole('button', { name: 'Italian, 3 recipes' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setCuisine', cuisine: 'Italian' });
    });
});

describe('RecipeFilterBar (native) — cook-time bound (REQ-030f)', () => {
    it('renders the Cook time ladder even with no facets', () => {
        renderBar({ facets: {} });

        expect(buttonNamesIn('Cook time')).toEqual(BUCKETS);
    });

    it('sets a cook bound from the Cook time ladder', () => {
        const onFilterAction = vi.fn();
        renderBar({ onFilterAction });

        fireEvent.click(ladderBucket('Cook time', 'Under 30 min'));

        expect(onFilterAction).toHaveBeenCalledTimes(1);
        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxCookTime', minutes: 30 });
    });

    it('presses only the active cook bound', () => {
        renderBar({ filters: { maxCookTime: 30 } });

        expect(BUCKETS.map((bucket) => ladderBucket('Cook time', bucket).getAttribute('aria-pressed'))).toEqual([
            'false',
            'true',
            'false',
        ]);
        expect(ladderBucket('Total time', 'Under 30 min').getAttribute('aria-pressed')).toBe('false');
    });

    it('clears the cook bound when the active bucket is pressed again', () => {
        const onFilterAction = vi.fn();
        renderBar({ filters: { maxCookTime: 30 }, onFilterAction });
        expect(ladderBucket('Cook time', 'Under 30 min').getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(ladderBucket('Cook time', 'Under 30 min'));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxCookTime', minutes: undefined });
    });
});

describe('RecipeFilterBar (native) — clear all', () => {
    it('hides clear-all when no filter is active', () => {
        renderBar({ facets });

        expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
    });

    it('shows clear-all with the active count and invokes it when pressed', () => {
        const onFilterAction = vi.fn();
        renderBar({ facets, filters: { dietaryFlags: ['vegan'], tags: ['quick'], maxTotalTime: 30 }, onFilterAction });

        const clear = screen.getByRole('button', { name: 'Clear 3 filters' });
        fireEvent.click(clear);

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'clearAll' });
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

    it('lists matching ingredients as buttons and reports a pick', () => {
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

        fireEvent.click(screen.getByRole('button', { name: 'Filter by Chicken' }));

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'addIngredient',
            ingredient: { foodId: 'ing_1', name: 'Chicken' },
        });
    });

    /** Curated U15 — see the web leaf's same test: a variant-carrying result shows its root name alone, and adds the root. */
    it('shows a variant-carrying result by its root name alone, and adds the root', () => {
        const onFilterAction = vi.fn();
        renderBar({
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
            onFilterAction,
        });

        const option = screen.getByRole('button', { name: 'Filter by beef brisket' });
        expect(option.textContent).toBe('beef brisket');
        expect(screen.queryByText(/flat half/u)).toBeNull();

        fireEvent.click(option);

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'addIngredient',
            ingredient: { foodId: 'food_brisket', name: 'beef brisket' },
        });
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

        const option = screen.getByRole('button', { name: 'Filter by Chicken' });

        expect(appliedStyle(option, 'min-height')).toBe('44px');
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
                    { foodId: 'ing_1', name: 'Chicken' },
                    { foodId: 'ing_2', name: 'Garlic' },
                ],
            },
        });

        expect(screen.getByRole('button', { name: 'Remove Chicken' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove Garlic' })).toBeTruthy();
    });

    it('shows each ingredient chip’s remove mark to the eye only, at the 48 dp touch floor (spec §S8.1a)', () => {
        renderBar({ filters: { ...EMPTY_RECIPE_FILTERS, ingredients: [{ foodId: 'ing_1', name: 'Chicken' }] } });

        const chip = screen.getByRole('button', { name: 'Remove Chicken' });
        const mark = within(chip).getByText('×');

        expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(appliedStyle(chip, 'min-height')).toBe('48px');
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

    it('removes an ingredient chip by food id when pressed', () => {
        const onFilterAction = vi.fn();
        renderBar({
            filters: { ...EMPTY_RECIPE_FILTERS, ingredients: [{ foodId: 'ing_1', name: 'Chicken' }] },
            onFilterAction,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove Chicken' }));

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

// The inset rules moved into the `@commise/ui/sheet` primitive with the sheet itself, and so did their three tests
// (`packages/apps/commise/ui/src/sheet/__tests__/Sheet.native.test.tsx`, "insets"). What stays here is what the bar
// owns: Done is the Sheet's FOOTER, which the Sheet pads clear of the navigation bar.
describe('RecipeFilterBar (native) — on the Sheet (§S8.1a)', () => {
    it('puts Done in the sheet footer, the last slot, not in the scrolling facets', () => {
        renderBar({ facets, filters: { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] } });

        const sheet = dialogTitled('Filter recipes');
        const buttons = within(sheet).getAllByRole('button');
        const done = within(sheet).getByRole('button', { name: 'Done' });

        expect(sheet.lastElementChild?.contains(done)).toBe(true);
        expect(buttons[buttons.length - 1]).toBe(done);
        expect(isInScrollRegion(within(sheet).getByRole('button', { name: 'Clear 1 filter' }))).toBe(true);

        for (const name of FACET_GROUPS) {
            expect(isInScrollRegion(headedGroup(name)), name).toBe(true);
            expect(headedGroup(name).contains(done), name).toBe(false);
        }

        expect(isInScrollRegion(done)).toBe(false);
    });

    // R9 (`docs/design/rowEditorOpenDecisions.md`): Done is the footer's only action, so it is the house primary (the
    // brand gradient only that tier paints), and it fills the footer.
    it('makes Done the primary design-system button, stretched across the footer', () => {
        renderBar({ facets });

        const done = screen.getByRole('button', { name: 'Done' });

        expect(done.querySelector('[data-commise-stub="linear-gradient"]')).not.toBeNull();
        expect(done.style.alignSelf).toBe('stretch');
    });

    it('shows the title and a Close control that closes the sheet', () => {
        renderBar({ facets });

        expect(screen.getByRole('heading', { name: 'Filter recipes' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));

        expect(queryHeadedGroup('Dietary')).toBeNull();
    });

    it('closes on the platform back route (Escape under react-native-web)', () => {
        renderBar({ facets });

        fireEvent.keyUp(document, { key: 'Escape' });

        expect(queryHeadedGroup('Dietary')).toBeNull();
    });

    it.each([
        ['Done', () => fireEvent.click(screen.getByRole('button', { name: 'Done' }))],
        ['Close', () => fireEvent.click(screen.getByRole('button', { name: 'Close filters' }))],
        ['back', () => fireEvent.keyUp(document, { key: 'Escape' })],
    ])('returns screen-reader focus to the Filters trigger after closing through %s', (_route, close) => {
        renderBar({ facets });
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        close();

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(
            screen.getByRole('button', { name: 'Filters' }),
            'focus',
        );
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

/**
 * Curated U9, EVALUATE 2026-10-01 (spec §S8.1a "Focus at the cap"): the control the cook pressed unmounts on every add
 * and every chip removal. The screen-reader cursor goes to whatever holds the search slot, and no keyboard rises.
 */
describe('RecipeFilterBar (native) — screen-reader focus after an ingredient add or removal', () => {
    const lastFocused = (): unknown => vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.lastCall?.[0];

    const openSheet = (): void => {
        fireEvent.click(screen.getByRole('button', { name: /^Filters/u }));
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    };

    it('moves the cursor to the note when the add fills the filter', () => {
        render(<StatefulBar initial={MAX_SEARCH_FOOD_FILTERS - 1} />);
        openSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Filter by Newfood' }));

        expect(lastFocused()).toBe(screen.getByText(FULL_NOTE));
    });

    it('moves the cursor to the search box after any other add', () => {
        render(<StatefulBar initial={0} />);
        openSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Filter by Newfood' }));

        expect(lastFocused()).toBe(screen.getByLabelText('Search ingredients'));
    });

    it('moves the cursor to the search box after a chip removal frees a place', () => {
        render(<StatefulBar initial={MAX_SEARCH_FOOD_FILTERS} />);
        openSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Remove Food 0' }));

        expect(lastFocused()).toBe(screen.getByLabelText('Search ingredients'));
    });

    it('moves nothing when the sheet opens on a full filter', () => {
        render(<StatefulBar initial={MAX_SEARCH_FOOD_FILTERS} />);
        openSheet();

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 and N2 (filter sheet). The sheet's title header names the sheet (rule 2).
 * Each facet group's visible label names the group, so the label is a header and the group is no named group (rules 2
 * and 4). The searching status keeps its role (rule 4) and says its text as content, with no name of its own (rule 1).
 * Each name is said by one node (N4).
 */
describe('RecipeFilterBar (native) — N1: each name is said once', () => {
    it('says the sheet’s name "Filter recipes" through its title header alone, inside the dialog', () => {
        renderBar({ facets });

        const headings = screen.getAllByRole('heading', { name: 'Filter recipes' });
        expect(headings).toHaveLength(1);
        expect(headings[0]?.closest('[role="dialog"]')).not.toBeNull();
        expect(screen.queryAllByLabelText('Filter recipes')).toEqual([]);
    });

    it.each(['Dietary', 'Tags', 'Cuisine', 'Prep time', 'Cook time', 'Total time', 'Ingredients'])(
        'says the facet group "%s" through its header alone, and draws it as no named group',
        (name) => {
            renderBar({ facets: { ...facets, cuisine: [{ value: 'Thai', count: 5 }] } });

            expect(screen.getAllByRole('heading', { name })).toHaveLength(1);
            expect(screen.queryAllByRole('group', { name })).toEqual([]);
            expect(screen.queryAllByLabelText(name)).toEqual([]);
        },
    );

    it('keeps the searching status, whose text says "Searching ingredients…", and labels no node with it', () => {
        renderBar({ ingredientSearch: { query: 'chi', onQueryChange: noop, viewState: { kind: 'searching' } } });

        const status = screen.getByRole('status');
        expect(status.textContent).toBe('Searching ingredients…');
        expect(screen.queryAllByLabelText('Searching ingredients…')).toEqual([]);
    });
});
