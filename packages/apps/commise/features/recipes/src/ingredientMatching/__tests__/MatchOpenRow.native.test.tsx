/**
 * Component tests for the native `MatchOpenRow` (through react-native-web), the React Native leaf of the web one: the one expanded line on phone and 834, in either flow
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): the line, its muted prompt, then its
 * `FoodChoiceList` — Search for a food first, the options with the default tagged and never chosen, Keep as written last.
 *
 * REWRITTEN from the editor builder's `PasteMatchOpenRow` test when the two builds were reconciled: the row reads the
 * one line model through `lineRowOf`, a press sends a pick, and the focus request is the house `ControlFocus`. New: a
 * line opened by Change that needs no choice draws no prompt.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { recipeMessages } from '../../messages.js';
import {
    makeConfidentLine,
    makeDefaultLine,
    makeFoodChoice,
    makeNeedsChoiceLine,
    makeNoMatchLine,
    MILKS,
} from '../__fixtures__/matchLines.js';
import type { MatchLine } from '../matchLine.js';
import { lineRowOf } from '../matchLineView.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { MatchOpenRow } from '../MatchOpenRow.native.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const FIVE_BREADS = [
    makeFoodChoice({ id: 'white', name: 'White bread, sliced', detailParts: ['Commercially prepared'] }),
    makeFoodChoice({ id: 'wheat', name: 'Whole-wheat bread' }),
    makeFoodChoice({ id: 'sour', name: 'Sourdough bread' }),
    makeFoodChoice({ id: 'brioche', name: 'Brioche' }),
    makeFoodChoice({ id: 'challah', name: 'Challah, egg bread' }),
];

afterEach(cleanup);

function renderRow(line: MatchLine, online = true) {
    const handlers = { onSearch: vi.fn(), onPick: vi.fn(), onHandled: vi.fn() };
    const row = lineRowOf(line, { expanded: true, current: false, online, pending: undefined }, copy, 'en');

    if (row.kind !== 'open') {
        throw new Error(`expected an open row, got ${row.kind}`);
    }

    const { container } = render(
        <MatchOpenRow
            line={row.line}
            view={row.view}
            onSearch={handlers.onSearch}
            onPick={handlers.onPick}
            searchFocus={{ requested: false, onHandled: handlers.onHandled }}
        />,
    );

    return { ...handlers, container };
}

const names = (): (string | null)[] => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

describe('MatchOpenRow (native)', () => {
    it('draws the line and its prompt', () => {
        renderRow(makeDefaultLine());

        expect(screen.getByText((_, element) => element?.textContent === '2 cups milk')).toBeTruthy();
        expect(screen.getByText('Choose the milk you use')).toBeTruthy();
    });

    it('then Search first, the options, and Keep as written last', () => {
        renderRow(makeDefaultLine({ candidates: MILKS.slice(0, 2) }));

        expect(names()).toEqual([
            'Search for a food for 2 cups milk',
            'Skim milk',
            'Whole milk, Default',
            'Keep “2 cups milk” as written',
        ]);
    });

    it('a choice of five: the prompt says nothing is chosen, and all five are offered', () => {
        renderRow(makeNeedsChoiceLine({ candidates: FIVE_BREADS }));

        expect(screen.getByText('More than one food fits. Nothing is chosen for you.')).toBeTruthy();
        expect(names()).toHaveLength(7);
    });

    it('pressing a food sends its pick', () => {
        const { onPick } = renderRow(makeNeedsChoiceLine({ candidates: FIVE_BREADS }));

        fireEvent.click(screen.getByRole('button', { name: 'Sourdough bread' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'sour', name: 'Sourdough bread' });
    });

    it('no match: the prompt says so, and offers search and Keep as written', () => {
        const { onSearch } = renderRow(makeNoMatchLine({ line: { measure: '1 tsp', words: 'Grandma’s spice mix' } }));

        expect(screen.getByText('No food found for this')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 1 tsp Grandma’s spice mix' }));
        expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('a matched line opened by Change draws no prompt: nothing about it needs a choice', () => {
        renderRow(makeConfidentLine({ candidates: MILKS }));

        expect(screen.queryByText(/Choose the|More than one|No food found/)).toBeNull();
    });

    it('is set apart by an edge, never by the fill its options use when pressed, so a press still shows', () => {
        const { container } = renderRow(makeDefaultLine());
        const row = container.firstElementChild;
        const style = row === null ? undefined : getComputedStyle(row);

        // No fill: unset, or the transparent black react-native-web resolves an unset colour to.
        expect(['', 'rgba(0, 0, 0, 0)']).toContain(style?.backgroundColor);
        expect(style?.borderTopWidth).toBe('1px');
    });

    it('offline: search needs the network, and the options still show', () => {
        renderRow(makeDefaultLine({ candidates: MILKS.slice(0, 2) }), false);

        expect(screen.getByText('Search needs the network')).toBeTruthy();
        expect(names()).toEqual(['Skim milk', 'Whole milk, Default', 'Keep “2 cups milk” as written']);
    });
});
