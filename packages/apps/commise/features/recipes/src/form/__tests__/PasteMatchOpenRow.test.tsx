// @vitest-environment jsdom
/**
 * Component tests for the web `PasteMatchOpenRow`: the one open line on phone and 834
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): the line, its muted prompt, then its list —
 * Search for a food first, the options with the default tagged and never chosen, Keep as written last.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeMessages } from '../../messages.js';
import { recipeFormMessages } from '../messages.js';
import type { FoodChoice, OpenLine } from '../pasteMatchLine.js';
import { pasteMatchOpenViewOf } from '../pasteMatchView.js';
import { PasteMatchOpenRow } from '../PasteMatchOpenRow.js';

const m = recipeFormMessages.en;
const copy = { ...m, details: recipeMessages.en.ingredientDetails };
const MILKS: readonly FoodChoice[] = [
    { id: 'skim', name: 'Skim milk', isDefault: false },
    { id: 'whole', name: 'Whole milk', isDefault: true },
];
const MILK_LINE: OpenLine = {
    key: 'l1',
    line: { measure: '2 cups', words: 'milk' },
    need: { kind: 'default', noun: 'milk', options: MILKS, chosenId: undefined },
};
const BREAD_LINE: OpenLine = {
    key: 'l3',
    line: { measure: '6 slices', words: 'day-old bread' },
    need: {
        kind: 'needsChoice',
        options: [
            { id: 'white', name: 'White bread, sliced', isDefault: false, detailParts: ['Commercially prepared'] },
            { id: 'wheat', name: 'Whole-wheat bread', isDefault: false },
            { id: 'sour', name: 'Sourdough bread', isDefault: false },
            { id: 'brioche', name: 'Brioche', isDefault: false },
            { id: 'challah', name: 'Challah, egg bread', isDefault: false },
        ],
        chosenId: undefined,
    },
};
const SPICE_LINE: OpenLine = {
    key: 'l9',
    line: { measure: '1 tsp', words: 'Grandma’s spice mix' },
    need: { kind: 'noMatch' },
};

const listHandlers = () => ({
    onSearch: vi.fn(),
    onChoose: vi.fn(),
    onKeepAsWritten: vi.fn(),
    onSearchFocusRequestHandled: vi.fn(),
});

afterEach(cleanup);

function renderRow(line: OpenLine, online = true) {
    const handlers = listHandlers();

    render(
        <ul>
            <PasteMatchOpenRow
                line={line.line}
                view={pasteMatchOpenViewOf(line, online, copy)}
                searchFocusRequested={false}
                {...handlers}
            />
        </ul>,
    );

    return handlers;
}

const names = (): (string | null)[] => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

describe('PasteMatchOpenRow (web)', () => {
    it('draws the line and its prompt', () => {
        renderRow(MILK_LINE);

        expect(screen.getByText((_, element) => element?.textContent === '2 cups milk')).toBeTruthy();
        expect(screen.getByText('Choose the milk you use')).toBeTruthy();
    });

    it('then Search first, the options, and Keep as written last', () => {
        renderRow(MILK_LINE);

        expect(names()).toEqual([
            'Search for a food for 2 cups milk',
            'Skim milk',
            'Whole milk, Default',
            'Keep “2 cups milk” as written',
        ]);
    });

    it('a choice of five: the prompt says nothing is chosen, and all five are offered', () => {
        renderRow(BREAD_LINE);

        expect(screen.getByText('More than one food fits. Nothing is chosen for you.')).toBeTruthy();
        expect(names()).toHaveLength(7);
    });

    it('pressing a food chooses it', () => {
        const { onChoose } = renderRow(BREAD_LINE);

        fireEvent.click(screen.getByRole('button', { name: 'Sourdough bread' }));

        expect(onChoose).toHaveBeenCalledExactlyOnceWith('sour');
    });

    it('no match: the prompt says so, and offers search and Keep as written', () => {
        const { onSearch } = renderRow(SPICE_LINE);

        expect(screen.getByText('No food found for this')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 1 tsp Grandma’s spice mix' }));
        expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('is set apart by an edge, never by the fill its options use for hover, so a hover still shows', () => {
        renderRow(MILK_LINE);

        const row = screen.getAllByRole('listitem')[0]!;
        expect(row.className).toContain('border-line-divider');
        expect(row.className).not.toContain('bg-surface-muted');
        expect(screen.getByRole('button', { name: 'Skim milk' }).className).toContain('hover:bg-surface-muted');
    });

    it('offline: search needs the network, and the options still show', () => {
        renderRow(MILK_LINE, false);

        expect(screen.getByText('Search needs the network')).toBeTruthy();
        expect(names()).toEqual(['Skim milk', 'Whole milk, Default', 'Keep “2 cups milk” as written']);
    });
});
