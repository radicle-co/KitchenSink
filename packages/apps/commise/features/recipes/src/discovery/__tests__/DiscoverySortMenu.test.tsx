// @vitest-environment jsdom
/**
 * Discover's sort control (`docs/design/uiOverhaul/buildSpec.md` §4.5): a ghost button "Sort: {choice}" that opens a
 * menu of four radio items — Relevance, Newest, Most saved, Quickest — with a check on the one in use. Choosing one
 * reports it and closes the menu. "Most cloned" is retired by the glossary.
 */
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { DiscoverySortMenu } from '../DiscoverySortMenu.js';

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

describe('DiscoverySortMenu (web)', () => {
    it('says the sort in use on its button', () => {
        renderMenu(RecipeSearchSortBy.QUICKEST);

        expect(screen.getByRole('button', { name: 'Sort: Quickest' })).toBeTruthy();
    });

    it('offers the four sorts as radio items with the one in use checked, and says “Most saved”', async () => {
        const user = userEvent.setup();
        renderMenu(RecipeSearchSortBy.RECENT);

        await user.click(screen.getByRole('button', { name: 'Sort: Newest' }));
        const items = within(await screen.findByRole('menu')).getAllByRole('menuitemradio');

        expect(items.map((item) => item.textContent)).toEqual(['Relevance', 'Newest', 'Most saved', 'Quickest']);
        expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    });

    it('reports a choice', async () => {
        const user = userEvent.setup();
        const { onChange } = renderMenu();

        await user.click(screen.getByRole('button', { name: 'Sort: Relevance' }));
        await user.click(await screen.findByRole('menuitemradio', { name: 'Most saved' }));

        expect(onChange).toHaveBeenCalledExactlyOnceWith(RecipeSearchSortBy.MOST_CLONED);
    });

    it('opens from the keyboard', async () => {
        const user = userEvent.setup();
        renderMenu();

        screen.getByRole('button', { name: 'Sort: Relevance' }).focus();
        await user.keyboard('{Enter}');

        expect(await screen.findByRole('menu')).toBeTruthy();
    });
});
