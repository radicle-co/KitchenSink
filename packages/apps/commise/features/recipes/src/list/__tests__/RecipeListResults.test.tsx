// @vitest-environment jsdom
/**
 * The web My recipes RESULTS (`docs/design/uiOverhaul/buildSpec.md` §4.3): the facet chips with counts, the result bar
 * (count, sort, list/grid switch), every state's body, the cards in the decided variant, "Load more" past 500, the
 * refresh notice, the deferred calorie slot, and the create dial's one-affordance rule.
 *
 * ⚠️ REWRITTEN for slice 4 of the UI overhaul. The leaf used to take `narrowed` and draw one generic no-match body over
 * one grid; it now takes the `LibraryState` the host decides (`library.ts`), with a distinct body and "Clear" action
 * for a search, for chips and for both, the design-system `ChipRow`/`Chip` with counts, the result bar, and the card
 * variant. The dial assertions are kept: exactly one create affordance on screen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@commise/i18n/react';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { RecipeListResults } from '../RecipeListResults.js';
import type { RecipeListResultsProps } from '../model.js';

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

const noop = () => undefined;

const threeRecipes = [
    makeRecipeListItem({ id: 'rec_1', title: 'Mediterranean Grilled Lamb' }),
    makeRecipeListItem({ id: 'rec_2', title: 'Asparagus with Green Sauce' }),
    makeRecipeListItem({ id: 'rec_3', title: 'Gourmet Garden Salad' }),
];

function results(overrides: Partial<RecipeListResultsProps> = {}) {
    return (
        <LocaleProvider locale="en">
            <RecipeListResults
                recipes={threeRecipes}
                state="results"
                searchValue=""
                onClearSearch={noop}
                onClearFilters={noop}
                onSelectRecipe={noop}
                onCreateRecipe={noop}
                variant="row"
                chipOverflow="scroll"
                facets={{
                    facets: [
                        { value: 'quick', label: 'Under 30 min', count: 2, selected: false },
                        { value: 'Moroccan', label: 'Moroccan', count: 1, selected: true },
                    ],
                    onToggle: noop,
                    onClear: noop,
                }}
                view={{ mode: 'list', onChange: noop }}
                sort={{ value: 'updatedAt', onChange: noop }}
                {...overrides}
            />
        </LocaleProvider>
    );
}

describe('RecipeListResults (web) — populated', () => {
    it('says how many recipes are on screen', () => {
        render(results());

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('draws one card per recipe, in the variant the host decided', () => {
        render(results({ variant: 'grid' }));
        const list = screen.getByRole('list', { name: '3 recipes' });

        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(
            within(list)
                .getAllByRole('article')
                .map((card) => card.getAttribute('data-card-variant')),
        ).toEqual(['grid', 'grid', 'grid']);
    });

    it('makes each card a link to its recipe when the host gives an href, and reports a plain click', async () => {
        const onSelectRecipe = vi.fn();
        render(results({ hrefOf: (id) => `/en/recipes/${id}`, onSelectRecipe }));

        const link = screen.getByRole('link', { name: 'Asparagus with Green Sauce' });
        expect(link.getAttribute('href')).toBe('/en/recipes/rec_2');

        await userEvent.click(link);

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('asks the host for each card’s calorie figure, and renders what it returns', () => {
        render(results({ renderNutrition: (id) => <span>{`cal ${id}`}</span> }));

        expect(screen.getByText('cal rec_1')).toBeTruthy();
        expect(screen.getByText('cal rec_3')).toBeTruthy();
    });
});

describe('RecipeListResults (web) — the facet chips', () => {
    it('leads with All, pressed only when nothing is selected, then each facet with its count', () => {
        render(results());
        const group = screen.getByRole('group', { name: 'Quick filters' });
        const chips = within(group).getAllByRole('button');

        expect(chips.map((chip) => chip.textContent)).toEqual(['All', 'Under 30 min 2', 'Moroccan 1']);
        expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    });

    it('reports a toggle with the facet value, and All clears', async () => {
        const onToggle = vi.fn();
        const onClear = vi.fn();
        render(
            results({
                facets: {
                    facets: [{ value: 'quick', label: 'Under 30 min', count: 2, selected: false }],
                    onToggle,
                    onClear,
                },
            }),
        );

        await userEvent.click(screen.getByRole('button', { name: 'Under 30 min 2' }));
        await userEvent.click(screen.getByRole('button', { name: 'All' }));

        expect(onToggle).toHaveBeenCalledWith('quick');
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('draws no chip row when the library offers no facet', () => {
        render(results({ facets: { facets: [], onToggle: noop, onClear: noop } }));

        expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
    });
});

describe('RecipeListResults (web) — the result bar', () => {
    it('switches between list and grid as one radio group', async () => {
        const onChange = vi.fn();
        render(results({ view: { mode: 'list', onChange } }));
        const group = screen.getByRole('radiogroup', { name: 'View' });

        expect(within(group).getByRole('radio', { name: 'List view' }).getAttribute('aria-checked')).toBe('true');

        await userEvent.click(within(group).getByRole('radio', { name: 'Grid view' }));

        expect(onChange).toHaveBeenCalledWith('grid');
    });

    it('says the sort in use, and offers the three server sorts', async () => {
        const onChange = vi.fn();
        render(results({ sort: { value: 'createdAt', onChange } }));

        const user = userEvent.setup();
        screen.getByRole('button', { name: 'Sort: Newest' }).focus();
        await user.keyboard('{Enter}');
        // Radix names the menu by its trigger, so it is announced with the sort in use.
        const menu = await screen.findByRole('menu', { name: 'Sort: Newest' });
        const items = within(menu).getAllByRole('menuitemradio');

        expect(items.map((item) => item.textContent)).toEqual(['Recently edited', 'Newest', 'A–Z']);
        expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);

        await user.click(within(menu).getByRole('menuitemradio', { name: 'A–Z' }));

        expect(onChange).toHaveBeenCalledWith('title');
    });
});

describe('RecipeListResults (web) — the first run', () => {
    it('hides the chips and the result bar, and offers the two ways to start', async () => {
        const onCreateRecipe = vi.fn();
        const onPasteIngredients = vi.fn();
        render(results({ recipes: [], state: 'firstRun', onCreateRecipe, onPasteIngredients }));

        expect(screen.getByRole('heading', { level: 2, name: 'Your recipe box is empty' })).toBeTruthy();
        expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
        expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Add your first recipe' }));
        await userEvent.click(screen.getByRole('button', { name: 'Paste ingredients' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('offers exactly one create affordance: the block, never the floating dial too', () => {
        render(results({ recipes: [], state: 'firstRun' }));

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('drops Paste ingredients when the host has nowhere to paste', () => {
        render(results({ recipes: [], state: 'firstRun' }));

        expect(screen.queryByRole('button', { name: 'Paste ingredients' })).toBeNull();
    });
});

describe('RecipeListResults (web) — no match', () => {
    it('for a search, quotes it and offers Clear search', async () => {
        const onClearSearch = vi.fn();
        render(results({ recipes: [], state: 'noMatchQuery', searchValue: 'zzz', onClearSearch }));
        const status = screen.getByRole('status');

        expect(within(status).getByRole('heading', { level: 2, name: 'No recipes match' })).toBeTruthy();
        expect(within(status).getByText('Nothing matches “zzz”.')).toBeTruthy();
        expect(within(status).queryByRole('button', { name: 'Clear filters' })).toBeNull();

        await userEvent.click(within(status).getByRole('button', { name: 'Clear search' }));

        expect(onClearSearch).toHaveBeenCalledTimes(1);
    });

    it('for chips, says so and offers Clear filters, keeping the chips on screen', async () => {
        const onClearFilters = vi.fn();
        render(results({ recipes: [], state: 'noMatchFilters', onClearFilters }));
        const status = screen.getByRole('status');

        expect(within(status).getByText('No recipes match these filters.')).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Quick filters' })).toBeTruthy();

        await userEvent.click(within(status).getByRole('button', { name: 'Clear filters' }));

        expect(onClearFilters).toHaveBeenCalledTimes(1);
    });

    it('for both, offers both Clear actions', () => {
        render(results({ recipes: [], state: 'noMatchBoth', searchValue: 'z' }));
        const status = screen.getByRole('status');

        expect(within(status).getByRole('button', { name: 'Clear search' })).toBeTruthy();
        expect(within(status).getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    });

    it('keeps the create dial: a no-match body has no create action of its own', () => {
        render(results({ recipes: [], state: 'noMatchQuery', searchValue: 'z' }));

        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });
});

describe('RecipeListResults (web) — past 500 recipes, and a failed refresh', () => {
    it('offers Load more while more remain, and reports the press', async () => {
        const onLoadMore = vi.fn();
        render(results({ loadMore: { hasMore: true, loading: false, failed: false, onLoadMore } }));

        await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('keeps the rows and says the refresh failed, with a Try again that retries', async () => {
        const onRetry = vi.fn();
        render(results({ refreshNotice: { failed: true, refreshing: false, onRetry, recoveries: 0 } }));

        expect(screen.getAllByText('We couldn’t refresh your recipes.').length).toBeGreaterThan(0);
        expect(screen.getByText('Mediterranean Grilled Lamb')).toBeTruthy();

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
