/**
 * The native filter groups, the twin of `FilterGroups.test.tsx` (`docs/design/uiOverhaul/buildSpec.md` §4.4), rendered
 * through react-native-web. The same contract: one named group per facet, chips that toggle (a native filter chip is a
 * `checkbox`), a total-time choice with an "Any", prep and cook time behind a disclosure, the chip cap that never hides a
 * chosen chip, and the ingredient typeahead's states.
 *
 * Where the leaves differ is observable and asserted: the disclosure is a button with `aria-expanded` (there is no
 * `<details>`), and an ingredient add moves the SCREEN-READER cursor, not DOM focus, so that move is covered by the
 * design system's `moveScreenReaderFocus` tests and by the Maestro flow, not here.
 */
import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import { MAX_SEARCH_FOOD_FILTERS } from '@kitchensink/schema-recipe';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { FilterGroups } from '../FilterGroups.native.js';
import { FACET_CHIP_LIMIT, filterBarViewOf } from '../filterBarView.js';
import { filterMessages } from '../messages.js';
import {
    EMPTY_RECIPE_FILTERS,
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
}

function renderGroups({ facets = {}, filters = EMPTY_RECIPE_FILTERS, ingredientSearch = idleSearch }: Props = {}) {
    const onFilterAction = vi.fn();
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

const food = (id: string, name: string): FoodIngredient => ({ ...makeIngredient({ id, name }), foodId: id });

describe('FilterGroups (native) — structure', () => {
    it('names one group per facet, each once, with Total time a radiogroup and prep and cook behind the disclosure', () => {
        renderGroups({ facets });

        expect(screen.getAllByRole('radiogroup').map((group) => group.getAttribute('aria-label'))).toEqual([
            'Total time',
        ]);
        expect(
            screen
                .getAllByRole('group')
                .map((group) => group.getAttribute('aria-label'))
                .filter((name): name is string => name !== null),
        ).toEqual(['Dietary', 'Cuisine', 'Tags', 'Has ingredient']);
    });

    it('omits a chip group with nothing to offer', () => {
        renderGroups({ facets: { tags: [{ value: 'quick', count: 3 }] } });

        expect(screen.queryByRole('group', { name: 'Dietary' })).toBeNull();
        expect(screen.getByRole('group', { name: 'Tags' })).toBeTruthy();
    });
});

describe('FilterGroups (native) — chips', () => {
    it('presses a chip as a toggle, reporting the action it asks for', () => {
        const { onFilterAction } = renderGroups({ facets });

        fireEvent.click(screen.getByRole('checkbox', { name: 'vegan 4' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'vegan' });
    });

    it('marks a chosen chip checked and leaves the others unchecked', () => {
        renderGroups({ facets, filters: { dietaryFlags: ['vegan'] } });

        expect(screen.getByRole('checkbox', { name: 'vegan 4' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('checkbox', { name: 'gluten-free 2' }).getAttribute('aria-checked')).toBe('false');
    });

    it('sets the cuisine pressed', () => {
        const { onFilterAction } = renderGroups({ facets });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Thai 3' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setCuisine', cuisine: 'Thai' });
    });

    it('caps a long group, says how many are behind “Show all”, opens it, and folds it back', () => {
        const tags = Array.from({ length: FACET_CHIP_LIMIT + 4 }, (_, index) => ({
            value: `tag-${String(index).padStart(2, '0')}`,
            count: 100 - index,
        }));
        renderGroups({ facets: { tags } });
        const group = screen.getByRole('group', { name: 'Tags' });

        expect(within(group).getAllByRole('checkbox')).toHaveLength(FACET_CHIP_LIMIT);

        fireEvent.click(screen.getByRole('button', { name: `Show all (${String(FACET_CHIP_LIMIT + 4)})` }));

        expect(within(group).getAllByRole('checkbox')).toHaveLength(FACET_CHIP_LIMIT + 4);

        fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));

        expect(within(group).getAllByRole('checkbox')).toHaveLength(FACET_CHIP_LIMIT);
    });

    it('offers no “Show all” for a group within the cap', () => {
        renderGroups({ facets });

        expect(screen.queryByRole('button', { name: /^Show all/u })).toBeNull();
    });
});

describe('FilterGroups (native) — time', () => {
    it('chooses Any when no bound is set, and sets the bound that is chosen', () => {
        const { onFilterAction } = renderGroups();
        const total = screen.getByRole('radiogroup', { name: 'Total time' });

        expect(within(total).getByRole('radio', { name: 'Any' }).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(within(total).getByRole('radio', { name: 'Under 30 min' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxTotalTime', minutes: 30 });
    });

    it('shows Any clearing a bound in force', () => {
        const { onFilterAction } = renderGroups({ filters: { maxTotalTime: 30 } });
        const total = screen.getByRole('radiogroup', { name: 'Total time' });

        expect(within(total).getByRole('radio', { name: 'Under 30 min' }).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(within(total).getByRole('radio', { name: 'Any' }));

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'setTimeBound',
            field: 'maxTotalTime',
            minutes: undefined,
        });
    });

    it('keeps prep and cook time behind a shut disclosure until pressed', () => {
        const { onFilterAction } = renderGroups();
        const disclosure = screen.getByRole('button', { name: 'More time filters' });

        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('radiogroup', { name: 'Prep time' })).toBeNull();

        fireEvent.click(disclosure);

        expect(disclosure.getAttribute('aria-expanded')).toBe('true');

        fireEvent.click(
            within(screen.getByRole('radiogroup', { name: 'Prep time' })).getByRole('radio', { name: 'Under 15 min' }),
        );

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setTimeBound', field: 'maxPrepTime', minutes: 15 });
    });

    it('opens the disclosure when a prep or cook bound is already in force, so the filter is not hidden', () => {
        renderGroups({ filters: { maxCookTime: 30 } });

        expect(screen.getByRole('button', { name: 'More time filters' }).getAttribute('aria-expanded')).toBe('true');
        expect(
            within(screen.getByRole('radiogroup', { name: 'Cook time' }))
                .getByRole('radio', { name: 'Under 30 min' })
                .getAttribute('aria-checked'),
        ).toBe('true');
    });
});

describe('FilterGroups (native) — the ingredient typeahead', () => {
    const field = () => screen.getByRole('textbox', { name: 'Has ingredient' });

    it('names the field “Has ingredient”, with an example placeholder', () => {
        renderGroups();

        expect(field().getAttribute('placeholder')).toBe('chicken');
    });

    it('reports what is typed', () => {
        const onQueryChange = vi.fn();
        renderGroups({ ingredientSearch: { ...idleSearch, onQueryChange } });

        fireEvent.change(field(), { target: { value: 'c' } });

        expect(onQueryChange).toHaveBeenCalledWith('c');
    });

    it('shows a loading status, a no-match line, an error, and the minimum — each in its own state', () => {
        renderGroups({ ingredientSearch: { query: 'chi', onQueryChange: noop, viewState: { kind: 'searching' } } });
        expect(screen.getByRole('status', { name: 'Searching ingredients…' })).toBeTruthy();
        cleanup();

        renderGroups({
            ingredientSearch: {
                query: 'z',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [], isError: false },
            },
        });
        expect(screen.getByText('No matching ingredients')).toBeTruthy();
        cleanup();

        renderGroups({
            ingredientSearch: {
                query: 'z',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [], isError: true },
            },
        });
        expect(screen.getByRole('alert').textContent).toBe('We couldn’t search ingredients. Try again.');
        cleanup();

        renderGroups({
            ingredientSearch: {
                query: 'c',
                onQueryChange: noop,
                viewState: { kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH },
            },
        });
        expect(screen.getByText(/Keep typing/u)).toBeTruthy();
        expect(screen.queryByText('No matching ingredients')).toBeNull();
    });

    it('lists results as buttons named by their ACTION, and reports a pick', () => {
        const { onFilterAction } = renderGroups({
            ingredientSearch: {
                query: 'Chicken',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [food('ing_1', 'Chicken')], isError: false },
            },
        });

        expect(screen.queryByRole('button', { name: 'Chicken' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Filter by Chicken' }));

        expect(onFilterAction).toHaveBeenCalledWith({
            kind: 'addIngredient',
            ingredient: { foodId: 'ing_1', name: 'Chicken' },
        });
    });

    it('leaves a chosen ingredient out of the suggestions, and shows it as a removable chip', () => {
        const { onFilterAction } = renderGroups({
            filters: { ingredients: [{ foodId: 'ing_1', name: 'Chicken' }] },
            ingredientSearch: {
                query: 'chi',
                onQueryChange: noop,
                viewState: { kind: 'results', results: [food('ing_1', 'Chicken')], isError: false },
            },
        });

        expect(screen.queryByRole('button', { name: 'Filter by Chicken' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Remove Chicken' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'removeIngredient', foodId: 'ing_1' });
    });

    it('replaces the search with a note once the filter holds as many ingredients as search allows', () => {
        renderGroups({
            filters: {
                ingredients: Array.from({ length: MAX_SEARCH_FOOD_FILTERS }, (_, index) => ({
                    foodId: `ing_${String(index)}`,
                    name: `Food ${String(index)}`,
                })),
            },
            ingredientSearch: {
                query: '',
                onQueryChange: noop,
                viewState: { kind: 'full', max: MAX_SEARCH_FOOD_FILTERS },
            },
        });

        expect(screen.queryByRole('textbox', { name: 'Has ingredient' })).toBeNull();
        expect(screen.getByText(/You can filter by up to/u)).toBeTruthy();
    });
});
