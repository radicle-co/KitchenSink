// @vitest-environment jsdom
/**
 * The web filter groups (`docs/design/uiOverhaul/buildSpec.md` §4.4): the one facet tree the Discover panel and the
 * filter sheet both draw. Every query is by role and accessible name; every press is asserted by the action it asks for.
 *
 * ⚠️ REWRITTEN for slice 5, replacing `RecipeFilterBar.test.tsx`. The bar chose its own layout from a media query
 * (`useFilterBarLayout`), drew toggle buttons for the time ladders and had no "Any"; the layout is now decided by the
 * container (`filterPresentationOf`) and these groups are drawn in the panel or the sheet. The ingredient typeahead's
 * states, its focus at the cap and its names are carried over; the layout, the media query and the contrast-by-class
 * assertions (now held by the `colourRoles` guard) are deleted with the code they tested.
 */
import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import { MAX_SEARCH_FOOD_FILTERS } from '@kitchensink/schema-recipe';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { startTransition, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { FilterGroups } from '../FilterGroups.js';
import { FACET_CHIP_LIMIT, filterBarViewOf } from '../filterBarView.js';
import { filterMessages } from '../messages.js';
import {
    EMPTY_RECIPE_FILTERS,
    applyFilterAction,
    type FoodIngredient,
    type RecipeFacets,
    type RecipeFilterState,
    type RecipeIngredientSearchState,
} from '../model.js';

afterEach(cleanup);

const noop = () => undefined;
const copy = filterMessages.en;
const idleSearch: RecipeIngredientSearchState = { query: '', onQueryChange: noop, viewState: { kind: 'idle' } };

interface Props {
    readonly facets?: RecipeFacets;
    readonly filters?: RecipeFilterState;
    readonly ingredientSearch?: RecipeIngredientSearchState;
    readonly onFilterAction?: (action: Parameters<typeof applyFilterAction>[1]) => void;
}

function renderGroups({
    facets = {},
    filters = EMPTY_RECIPE_FILTERS,
    ingredientSearch = idleSearch,
    ...rest
}: Props = {}) {
    const onFilterAction = rest.onFilterAction ?? vi.fn();
    const view = filterBarViewOf({ facets, filters, viewState: ingredientSearch.viewState }, copy);

    render(
        <LocaleProvider locale="en">
            <FilterGroups
                view={view}
                chipOverflow="wrap"
                ingredientSearch={ingredientSearch}
                onFilterAction={onFilterAction}
            />
        </LocaleProvider>,
    );

    return { onFilterAction };
}

const facets: RecipeFacets = {
    dietaryFlags: [
        { value: 'vegan', count: 4 },
        { value: 'gluten-free', count: 2 },
    ],
    cuisine: [{ value: 'Thai', count: 3 }],
    tags: [{ value: 'quick', count: 3 }],
};

describe('FilterGroups (web) — structure', () => {
    it('names one group per facet, in the spec’s order, each once', () => {
        renderGroups({ facets });

        const names = screen
            .getAllByRole('group')
            .map((group) => group.getAttribute('aria-label'))
            .filter((name): name is string => name !== null);
        const radios = screen.getAllByRole('radiogroup').map((group) => group.getAttribute('aria-label'));

        expect(radios).toEqual(['Total time', 'Prep time', 'Cook time']);
        expect(names).toEqual(['Dietary', 'Cuisine', 'Tags', 'Has ingredient']);
    });

    it('omits a chip group with nothing to offer', () => {
        renderGroups({ facets: { tags: [{ value: 'quick', count: 3 }] } });

        expect(screen.queryByRole('group', { name: 'Dietary' })).toBeNull();
        expect(screen.queryByRole('group', { name: 'Cuisine' })).toBeNull();
        expect(screen.getByRole('group', { name: 'Tags' })).toBeTruthy();
    });

    it('shows each group’s name as visible text too, not only as an accessible name', () => {
        renderGroups({ facets });

        for (const label of ['Total time', 'Dietary', 'Cuisine', 'Tags', 'Has ingredient']) {
            expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        }
    });
});

describe('FilterGroups (web) — chips', () => {
    it('presses a chip as a toggle, reporting the action it asks for', async () => {
        const user = userEvent.setup();
        const { onFilterAction } = renderGroups({ facets });

        await user.click(screen.getByRole('button', { name: 'vegan 4' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'vegan' });
    });

    it('marks a chosen chip pressed and leaves the others unpressed', () => {
        renderGroups({ facets, filters: { dietaryFlags: ['vegan'] } });

        expect(screen.getByRole('button', { name: 'vegan 4' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'gluten-free 2' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('sets the cuisine pressed', async () => {
        const user = userEvent.setup();
        const { onFilterAction } = renderGroups({ facets });

        await user.click(screen.getByRole('button', { name: 'Thai 3' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setCuisine', cuisine: 'Thai' });
    });

    it('caps a long group, says how many are behind “Show all”, opens it, and folds it back', async () => {
        const user = userEvent.setup();
        const tags = Array.from({ length: FACET_CHIP_LIMIT + 4 }, (_, index) => ({
            value: `tag-${String(index).padStart(2, '0')}`,
            count: 100 - index,
        }));
        renderGroups({ facets: { tags } });
        const group = screen.getByRole('group', { name: 'Tags' });

        expect(
            within(group)
                .getAllByRole('button')
                .filter((button) => button.hasAttribute('aria-pressed')),
        ).toHaveLength(FACET_CHIP_LIMIT);

        await user.click(screen.getByRole('button', { name: `Show all (${String(FACET_CHIP_LIMIT + 4)})` }));

        expect(within(group).getAllByRole('button', { name: /^tag-/u })).toHaveLength(FACET_CHIP_LIMIT + 4);

        await user.click(screen.getByRole('button', { name: 'Show fewer' }));

        expect(within(group).getAllByRole('button', { name: /^tag-/u })).toHaveLength(FACET_CHIP_LIMIT);
    });

    it('offers no “Show all” for a group within the cap', () => {
        renderGroups({ facets });

        expect(screen.queryByRole('button', { name: /^Show all/u })).toBeNull();
    });
});

describe('FilterGroups (web) — time', () => {
    it('chooses Any when no bound is set, and exposes the ladder as radios', () => {
        renderGroups();
        const total = screen.getByRole('radiogroup', { name: 'Total time' });

        expect(within(total).getByRole('radio', { name: 'Any' }).getAttribute('aria-checked')).toBe('true');
        expect(
            within(total)
                .getAllByRole('radio')
                .map((radio) => radio.getAttribute('aria-label')),
        ).toEqual(['Any', 'Under 15 min', 'Under 30 min', 'Under 60 min']);
    });

    it('sets the bound that is chosen, and Any clears it', async () => {
        const user = userEvent.setup();
        const { onFilterAction } = renderGroups({ filters: { maxTotalTime: 30 } });
        const total = screen.getByRole('radiogroup', { name: 'Total time' });

        expect(within(total).getByRole('radio', { name: 'Under 30 min' }).getAttribute('aria-checked')).toBe('true');

        await user.click(within(total).getByRole('radio', { name: 'Under 15 min' }));

        expect(onFilterAction).toHaveBeenLastCalledWith({ kind: 'setTimeBound', field: 'maxTotalTime', minutes: 15 });

        await user.click(within(total).getByRole('radio', { name: 'Any' }));

        expect(onFilterAction).toHaveBeenLastCalledWith({
            kind: 'setTimeBound',
            field: 'maxTotalTime',
            minutes: undefined,
        });
    });

    it('keeps prep and cook time behind a shut disclosure until one is in force', () => {
        renderGroups();

        expect(screen.getByText('More time filters').closest('details')?.open).toBe(false);

        cleanup();
        renderGroups({ filters: { maxCookTime: 30 } });

        expect(screen.getByText('More time filters').closest('details')?.open).toBe(true);
    });
});

/** `count` foods already in the filter. */
const foods = (count: number): { foodId: string; name: string }[] =>
    Array.from({ length: count }, (_, index) => ({ foodId: `ing_${String(index)}`, name: `Food ${String(index)}` }));

const food = (id: string, name: string): FoodIngredient => ({ ...makeIngredient({ id, name }), foodId: id });

describe('FilterGroups (web) — the ingredient typeahead', () => {
    it('names the field “Has ingredient”, with an example placeholder', () => {
        renderGroups();

        const field = screen.getByRole('searchbox', { name: 'Has ingredient' });

        expect(field.getAttribute('placeholder')).toBe('chicken');
    });

    it('reports what is typed', async () => {
        const user = userEvent.setup();
        const onQueryChange = vi.fn();
        renderGroups({ ingredientSearch: { ...idleSearch, onQueryChange } });

        await user.type(screen.getByRole('searchbox', { name: 'Has ingredient' }), 'c');

        expect(onQueryChange).toHaveBeenCalledWith('c');
    });

    it('shows a loading status with its label as visible text', () => {
        renderGroups({ ingredientSearch: { query: 'chi', onQueryChange: noop, viewState: { kind: 'searching' } } });

        expect(screen.getByRole('status', { name: 'Searching ingredients…' }).textContent).toBe(
            'Searching ingredients…',
        );
    });

    it('says there is no match for a settled empty result, and an error for a failed search', () => {
        renderGroups({
            ingredientSearch: {
                query: 'zzz',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [], isError: false },
            },
        });

        expect(screen.getByText('No matching ingredients')).toBeTruthy();

        cleanup();
        renderGroups({
            ingredientSearch: {
                query: 'zzz',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [], isError: true },
            },
        });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t search ingredients. Try again.');
    });

    it('explains the minimum, and does NOT say there is no match (nothing was searched)', () => {
        renderGroups({
            ingredientSearch: {
                query: 'c',
                onQueryChange: noop,
                viewState: { kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH },
            },
        });

        expect(screen.getByText(new RegExp(`Keep typing.*${String(MIN_SEARCH_QUERY_LENGTH)}`, 'u'))).toBeTruthy();
        expect(screen.queryByText('No matching ingredients')).toBeNull();
    });

    it('lists results as buttons named by their ACTION, and reports a pick', async () => {
        const user = userEvent.setup();
        const { onFilterAction } = renderGroups({
            ingredientSearch: {
                query: 'Chicken',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [food('ing_1', 'Chicken')], isError: false },
            },
        });

        // The field already holds "Chicken": the option is named by what it does, so the two cannot be confused.
        expect(screen.queryByRole('button', { name: 'Chicken' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Filter by Chicken' }));

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'addIngredient',
            ingredient: { foodId: 'ing_1', name: 'Chicken' },
        });
    });

    it('leaves an ingredient already filtered on out of the suggestions, and shows it as a removable chip', async () => {
        const user = userEvent.setup();
        const { onFilterAction } = renderGroups({
            filters: { ingredients: [{ foodId: 'ing_1', name: 'Chicken' }] },
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [food('ing_1', 'Chicken')], isError: false },
            },
        });

        expect(screen.queryByRole('button', { name: 'Filter by Chicken' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Remove Chicken' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'removeIngredient', foodId: 'ing_1' });
    });

    it('replaces the search with a note once the filter holds as many ingredients as search allows', () => {
        renderGroups({
            filters: { ingredients: foods(MAX_SEARCH_FOOD_FILTERS) },
            ingredientSearch: {
                query: '',
                onQueryChange: noop,
                viewState: { kind: 'full', max: MAX_SEARCH_FOOD_FILTERS },
            },
        });

        expect(screen.queryByRole('searchbox', { name: 'Has ingredient' })).toBeNull();
        expect(screen.getByText(/You can filter by up to/u)).toBeTruthy();
    });
});

/** The groups under a parent that holds the filter, as the containers do, so the parent's update lands with the press. */
function StatefulGroups({ initial, late = false }: { readonly initial: number; readonly late?: boolean }) {
    const [filters, setFilters] = useState<RecipeFilterState>({ ...EMPTY_RECIPE_FILTERS, ingredients: foods(initial) });
    const full = (filters.ingredients?.length ?? 0) >= MAX_SEARCH_FOOD_FILTERS;
    const ingredientSearch: RecipeIngredientSearchState = {
        query: 'new',
        onQueryChange: noop,
        viewState: full
            ? { kind: 'full', max: MAX_SEARCH_FOOD_FILTERS }
            : { kind: 'results', results: [food('food_new', 'Newfood')], isError: false },
    };
    const view = filterBarViewOf({ facets: {}, filters, viewState: ingredientSearch.viewState }, copy);

    return (
        <LocaleProvider locale="en">
            <FilterGroups
                view={view}
                chipOverflow="wrap"
                ingredientSearch={ingredientSearch}
                onFilterAction={(action) => {
                    const apply = (): void => setFilters((current) => applyFilterAction(current, action));

                    // `late`: the web container writes the filter to the URL, which Next applies in a transition, so it
                    // lands a render after the press.
                    if (late) {
                        startTransition(apply);
                    } else {
                        apply();
                    }
                }}
            />
        </LocaleProvider>
    );
}

describe('FilterGroups (web) — focus after an ingredient add or removal (SC 2.4.3)', () => {
    it('moves focus to the note when the add fills the filter', async () => {
        const user = userEvent.setup();
        render(<StatefulGroups initial={MAX_SEARCH_FOOD_FILTERS - 1} />);

        await user.click(screen.getByRole('button', { name: 'Filter by Newfood' }));

        expect(document.activeElement).toBe(screen.getByText(/You can filter by up to/u));
    });

    it('moves focus to the note when the filling add lands a render after the press', async () => {
        const user = userEvent.setup();
        render(<StatefulGroups initial={MAX_SEARCH_FOOD_FILTERS - 1} late />);

        await user.click(screen.getByRole('button', { name: 'Filter by Newfood' }));

        await waitFor(() => expect(document.activeElement).toBe(screen.getByText(/You can filter by up to/u)));
    });

    it('moves focus to the search box after any other add', async () => {
        const user = userEvent.setup();
        render(<StatefulGroups initial={0} />);

        await user.click(screen.getByRole('button', { name: 'Filter by Newfood' }));

        expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Has ingredient' }));
    });

    it('moves focus to the search box after a removal frees a place', async () => {
        const user = userEvent.setup();
        render(<StatefulGroups initial={MAX_SEARCH_FOOD_FILTERS} />);

        await user.click(screen.getByRole('button', { name: 'Remove Food 0' }));

        expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Has ingredient' }));
    });

    it('moves nothing on mount, even when the filter starts full (a shared URL)', () => {
        render(<StatefulGroups initial={MAX_SEARCH_FOOD_FILTERS} />);

        expect(document.activeElement).toBe(document.body);
    });
});
