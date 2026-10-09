/**
 * The native Discover sort control, the twin of `DiscoverySortMenu.test.tsx` (`docs/design/uiOverhaul/buildSpec.md`
 * §4.5): "Sort: {choice}" opens a content-height sheet of four radio rows with a check on the one in use; choosing one
 * reports it and closes the sheet.
 */
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { DiscoverySortMenu } from '../DiscoverySortMenu.native.js';

afterEach(cleanup);

function renderMenu(active: RecipeSearchSortBy = RecipeSearchSortBy.RELEVANCE) {
    const onChange = vi.fn();

    render(
        <LocaleProvider locale="en">
            <DiscoverySortMenu active={active} onChange={onChange} />
        </LocaleProvider>,
    );

    return { onChange };
}

describe('DiscoverySortMenu (native)', () => {
    it('says the sort in use on its button', () => {
        renderMenu(RecipeSearchSortBy.QUICKEST);

        expect(screen.getByRole('button', { name: 'Sort: Quickest' })).toBeTruthy();
    });

    it('opens a sheet of the four sorts with the one in use checked', () => {
        renderMenu(RecipeSearchSortBy.RECENT);

        fireEvent.click(screen.getByRole('button', { name: 'Sort: Newest' }));
        const radios = screen.getAllByRole('radio');

        expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
            'Relevance',
            'Newest',
            'Most saved',
            'Quickest',
        ]);
        expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    });

    it('reports a choice and closes the sheet', () => {
        const { onChange } = renderMenu();

        fireEvent.click(screen.getByRole('button', { name: 'Sort: Relevance' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Most saved' }));

        expect(onChange).toHaveBeenCalledExactlyOnceWith(RecipeSearchSortBy.MOST_CLONED);
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
    });
});
