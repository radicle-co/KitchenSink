/**
 * The native pieces around the filter groups (`docs/design/uiOverhaul/buildSpec.md` §4.4): the sticky panel with Clear all
 * at its top, the sheet with Clear all and the live "Show {count} recipes", the Filters button with its count, and the
 * applied-filter chips with Clear all from two. Queries are by role and name; presses are asserted by the action or the
 * callback they trigger.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { AppliedFilters } from '../AppliedFilters.native.js';
import { FilterPanel } from '../FilterPanel.native.js';
import { FilterSheet } from '../FilterSheet.native.js';
import { FilterTrigger } from '../FilterTrigger.js';
import { filterBarViewOf } from '../filterBarView.js';
import { filterMessages } from '../messages.js';
import type { RecipeFacets, RecipeFilterState, RecipeIngredientSearchState } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;
const idle: RecipeIngredientSearchState = { query: '', onQueryChange: noop, viewState: { kind: 'idle' } };
const facets: RecipeFacets = { dietaryFlags: [{ value: 'vegan', count: 4 }] };

const viewOf = (filters: RecipeFilterState = {}) =>
    filterBarViewOf({ facets, filters, viewState: idle.viewState }, filterMessages.en);

const inLocale = (ui: React.ReactElement) => <LocaleProvider locale="en">{ui}</LocaleProvider>;

describe('FilterPanel (native)', () => {
    it('is a complementary region named Filters, holding the groups', () => {
        render(inLocale(<FilterPanel view={viewOf()} ingredientSearch={idle} onFilterAction={noop} />));
        const panel = screen.getByRole('complementary', { name: 'Filters' });

        expect(within(panel).getByRole('group', { name: 'Dietary' })).toBeTruthy();
    });

    it('offers Clear all at the top only while a filter is in force, and asks to clear every filter', async () => {
        const onFilterAction = vi.fn();
        const { rerender } = render(
            inLocale(<FilterPanel view={viewOf()} ingredientSearch={idle} onFilterAction={onFilterAction} />),
        );

        expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();

        rerender(
            inLocale(
                <FilterPanel
                    view={viewOf({ dietaryFlags: ['vegan'] })}
                    ingredientSearch={idle}
                    onFilterAction={onFilterAction}
                />,
            ),
        );
        const clear = screen.getByRole('button', { name: 'Clear all' });

        // At the TOP: it comes before every group in the document.
        expect(clear.compareDocumentPosition(screen.getByRole('group', { name: 'Dietary' }))).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );

        fireEvent.click(clear);

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'clearAll' });
    });
});

describe('FilterTrigger (native)', () => {
    it('reads “Filters” with nothing applied', () => {
        render(inLocale(<FilterTrigger view={viewOf()} onPress={noop} />));

        expect(screen.getByRole('button', { name: 'Filters' }).textContent).toBe('Filters');
    });

    it('reads “Filters · 2” while two are applied, and is named “Filters, 2 active”', async () => {
        const onPress = vi.fn();
        render(inLocale(<FilterTrigger view={viewOf({ cuisine: 'Thai', tags: ['quick'] })} onPress={onPress} />));
        const button = screen.getByRole('button', { name: 'Filters, 2 active' });

        expect(button.textContent).toBe('Filters · 2');

        fireEvent.click(button);

        expect(onPress).toHaveBeenCalledOnce();
    });
});

describe('AppliedFilters (native)', () => {
    it('draws nothing while nothing is applied', () => {
        const { container } = render(
            inLocale(<AppliedFilters view={viewOf()} chipOverflow="scroll" onFilterAction={noop} />),
        );

        expect(container.textContent).toBe('');
    });

    it('draws each applied filter as a chip named “Remove {filter} filter”, removing it with its own action', async () => {
        const onFilterAction = vi.fn();
        render(
            inLocale(
                <AppliedFilters
                    view={viewOf({ cuisine: 'Thai' })}
                    chipOverflow="scroll"
                    onFilterAction={onFilterAction}
                />,
            ),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Remove Thai filter' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'setCuisine', cuisine: undefined });
        expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
    });

    it('offers Clear all from two applied filters', async () => {
        const onFilterAction = vi.fn();
        render(
            inLocale(
                <AppliedFilters
                    view={viewOf({ cuisine: 'Thai', tags: ['quick'] })}
                    chipOverflow="scroll"
                    onFilterAction={onFilterAction}
                />,
            ),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'clearAll' });
    });
});

describe('FilterSheet (native)', () => {
    const sheet = (overrides: Partial<React.ComponentProps<typeof FilterSheet>> = {}) =>
        inLocale(
            <FilterSheet
                open
                onOpenChange={noop}
                view={viewOf()}
                chipOverflow="wrap"
                ingredientSearch={idle}
                onFilterAction={noop}
                resultCount={12}
                {...overrides}
            />,
        );

    it('is a sheet titled Filters, holding the groups', () => {
        render(sheet());
        // A native sheet is not a `dialog` to react-native-web: it is named by its title header.
        expect(screen.getByRole('heading', { name: 'Filters' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Dietary' })).toBeTruthy();
    });

    it('draws nothing while shut', () => {
        render(sheet({ open: false }));

        expect(screen.queryByRole('heading', { name: 'Filters' })).toBeNull();
    });

    it('states the live count in its primary, singular and plural, and an honest label while it is unknown', () => {
        const { rerender } = render(sheet({ resultCount: 12 }));

        expect(screen.getByRole('button', { name: 'Show 12 recipes' })).toBeTruthy();

        rerender(sheet({ resultCount: 1 }));

        expect(screen.getByRole('button', { name: 'Show 1 recipe' })).toBeTruthy();

        rerender(sheet({ resultCount: undefined }));

        expect(screen.getByRole('button', { name: 'Show recipes' })).toBeTruthy();
    });

    it('closes on the primary and applies nothing: filters apply live underneath', async () => {
        const onOpenChange = vi.fn();
        const onFilterAction = vi.fn();
        render(sheet({ onOpenChange, onFilterAction }));

        fireEvent.click(screen.getByRole('button', { name: 'Show 12 recipes' }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(onFilterAction).not.toHaveBeenCalled();
    });

    it('offers Clear all in the footer while a filter is in force, and it clears without closing', async () => {
        const onOpenChange = vi.fn();
        const onFilterAction = vi.fn();
        render(sheet({ view: viewOf({ cuisine: 'Thai' }), onOpenChange, onFilterAction }));

        fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

        expect(onFilterAction).toHaveBeenCalledWith({ kind: 'clearAll' });
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('closes from its × as well', async () => {
        const onOpenChange = vi.fn();
        render(sheet({ onOpenChange }));

        fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
