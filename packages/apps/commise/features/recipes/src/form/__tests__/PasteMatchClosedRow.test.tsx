// @vitest-environment jsdom
/**
 * Component tests for the web `PasteMatchClosedRow`: an open line drawn collapsed, on phone and 834 while another
 * line is open and in the 1194 / web list beside the side pane
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). The whole row is one control that opens the
 * line, and it says what the line needs; the line the pane shows is marked current.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeFormMessages } from '../messages.js';
import type { FoodChoice, OpenLine } from '../pasteMatchLine.js';
import { pasteMatchClosedViewOf } from '../pasteMatchView.js';
import { PasteMatchClosedRow } from '../PasteMatchClosedRow.js';

const m = recipeFormMessages.en;
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

afterEach(cleanup);

function renderRow(line: OpenLine, current = false) {
    const onOpen = vi.fn();

    render(
        <ul>
            <PasteMatchClosedRow
                line={line.line}
                view={pasteMatchClosedViewOf(line, m, 'en')}
                current={current}
                onOpen={onOpen}
            />
        </ul>,
    );

    return { onOpen };
}

describe('PasteMatchClosedRow (web)', () => {
    it('is one control that names the line and what it needs, and opens the line', () => {
        const { onOpen } = renderRow(BREAD_LINE);

        const row = screen.getByRole('button');
        expect(row.textContent).toContain('6 slices day-old bread');
        expect(row.textContent).toContain('Choose a food · 5 options');

        fireEvent.click(row);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('a default line names its noun and counts its options', () => {
        renderRow(MILK_LINE);

        expect(screen.getByRole('button').textContent).toContain('Choose the milk you use · 2 options');
    });

    it('a line with no match says to search or keep it as written', () => {
        renderRow(SPICE_LINE);

        expect(screen.getByRole('button').textContent).toContain('No food found · search or keep as written');
    });

    it('is not marked current unless the pane shows it', () => {
        renderRow(BREAD_LINE);

        expect(screen.getByRole('button').getAttribute('aria-current')).not.toBe('true');
    });

    it('the line the pane shows is marked current', () => {
        renderRow(BREAD_LINE, true);

        expect(screen.getByRole('button').getAttribute('aria-current')).toBe('true');
    });
});
