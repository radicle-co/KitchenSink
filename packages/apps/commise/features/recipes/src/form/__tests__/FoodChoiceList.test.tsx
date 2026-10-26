// @vitest-environment jsdom
/**
 * Component tests for the web `FoodChoiceList`, the list an open pasted line shows
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25; staff-ux ruling
 * 2026-10-25 that each option is a button, never a radio): Search for a food first (ruling I1), then the options in the
 * server's order with the default tagged and never chosen, then "Keep … as written" last. Offline, search says it needs
 * the network and the loaded options can still be chosen. A reopened line marks the food it holds, in its name too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FoodChoiceList } from '../FoodChoiceList.js';
import { recipeMessages } from '../../messages.js';
import { recipeFormMessages } from '../messages.js';
import type { FoodChoice, OpenLine } from '../pasteMatchLine.js';
import { pasteMatchOpenViewOf } from '../pasteMatchView.js';

const m = recipeFormMessages.en;
const copy = { ...m, details: recipeMessages.en.ingredientDetails };

afterEach(cleanup);

const MILKS: readonly FoodChoice[] = [
    { id: 'skim', name: 'Skim milk', isDefault: false },
    { id: 'whole', name: 'Whole milk', isDefault: true },
    { id: 'oat', name: 'Oat milk', isDefault: false, detailParts: ['unsweetened'] },
];

const milk = (chosenId: string | undefined = undefined): OpenLine => ({
    key: 'l1',
    line: { measure: '2 cups', words: 'milk' },
    need: { kind: 'default', noun: 'milk', options: MILKS, chosenId },
});

function renderList(line: OpenLine, options: { online?: boolean; searchFocusRequested?: boolean } = {}) {
    const handlers = {
        onSearch: vi.fn(),
        onChoose: vi.fn(),
        onKeepAsWritten: vi.fn(),
        onSearchFocusRequestHandled: vi.fn(),
    };

    render(
        <FoodChoiceList
            view={pasteMatchOpenViewOf(line, options.online ?? true, copy)}
            searchFocusRequested={options.searchFocusRequested ?? false}
            {...handlers}
        />,
    );

    return handlers;
}

describe('FoodChoiceList (web)', () => {
    it('Search for a food comes first, named for its line, and asks for search', async () => {
        const user = userEvent.setup();
        const { onSearch, onChoose } = renderList(milk());

        const first = screen.getAllByRole('button')[0];
        expect(first).toBe(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }));

        await user.click(first!);
        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onChoose).not.toHaveBeenCalled();
    });

    it('then the options in the server’s order, then Keep as written last', () => {
        renderList(milk());

        const options = within(screen.getByRole('list', { name: 'Food for 2 cups milk' })).getAllByRole('button');

        expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
            'Skim milk',
            'Whole milk, Default',
            'Oat milk, unsweetened',
            'Keep “2 cups milk” as written',
        ]);
    });

    it('the default shows its Default tag, and no other food does', () => {
        renderList(milk());

        expect(within(screen.getByRole('button', { name: 'Whole milk, Default' })).getByText('Default')).toBeTruthy();
        expect(within(screen.getByRole('button', { name: 'Skim milk' })).queryByText('Default')).toBeNull();
    });

    it('⛔ nothing is marked chosen while the line holds no pick, the default included', () => {
        renderList(milk());

        expect(screen.getAllByRole('button').some((button) => button.hasAttribute('aria-current'))).toBe(false);
    });

    it('a food’s parts are drawn under its name', () => {
        renderList(milk());

        expect(
            within(screen.getByRole('button', { name: 'Oat milk, unsweetened' })).getByText('unsweetened'),
        ).toBeTruthy();
    });

    it('Keep as written shows its hint', () => {
        renderList(milk());

        expect(
            within(screen.getByRole('button', { name: 'Keep “2 cups milk” as written' })).getByText(
                'No nutrition for this line',
            ),
        ).toBeTruthy();
    });

    it('pressing a food chooses it by its id', async () => {
        const user = userEvent.setup();
        const { onChoose, onKeepAsWritten } = renderList(milk());

        await user.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        expect(onChoose).toHaveBeenCalledExactlyOnceWith('whole');
        expect(onKeepAsWritten).not.toHaveBeenCalled();
    });

    it('pressing Keep as written keeps the line, and chooses no food', async () => {
        const user = userEvent.setup();
        const { onChoose, onKeepAsWritten } = renderList(milk());

        await user.click(screen.getByRole('button', { name: 'Keep “2 cups milk” as written' }));

        expect(onKeepAsWritten).toHaveBeenCalledTimes(1);
        expect(onChoose).not.toHaveBeenCalled();
    });

    it('the options are buttons the keyboard reaches with Tab, and Enter chooses', async () => {
        const user = userEvent.setup();
        const { onChoose } = renderList(milk());

        await user.tab();
        await user.tab();
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Whole milk, Default' }));

        await user.keyboard('{Enter}');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('whole');
    });

    it('a reopened line marks the food it holds as current, says so in its name, and draws a check', () => {
        renderList(milk('skim'));

        const held = screen.getByRole('button', { name: 'Skim milk, chosen' });

        expect(held.getAttribute('aria-current')).toBe('true');
        expect(held.querySelector('svg.lucide-check')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Whole milk, Default' }).hasAttribute('aria-current')).toBe(false);
    });

    it('offline: no search control, the words say search needs the network, and the options still choose', async () => {
        const user = userEvent.setup();
        const { onChoose } = renderList(milk(), { online: false });

        expect(screen.queryByRole('button', { name: /^Search for a food/ })).toBeNull();
        expect(screen.getByText('Search needs the network')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Skim milk' }));
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('skim');
    });

    it('no match: search, then Keep as written, and no food', () => {
        renderList({ key: 'n', line: { measure: '1 tsp', words: 'Grandma’s spice mix' }, need: { kind: 'noMatch' } });

        expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
            'Search for a food for 1 tsp Grandma’s spice mix',
            'Keep “1 tsp Grandma’s spice mix” as written',
        ]);
    });

    it('a focus request moves focus to Search, and is acknowledged', () => {
        const { onSearchFocusRequestHandled } = renderList(milk(), { searchFocusRequested: true });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }));
        expect(onSearchFocusRequestHandled).toHaveBeenCalledTimes(1);
    });
});
