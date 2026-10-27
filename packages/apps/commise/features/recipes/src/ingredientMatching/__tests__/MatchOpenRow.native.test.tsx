/**
 * Component tests for the native `MatchOpenRow` (through react-native-web), the React Native leaf of the web one: the one expanded line on phone and 834, in either flow
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): the line, its muted prompt, then its
 * `FoodChoiceList` — Search for a food first, the options with the default tagged and never chosen, Keep as written last.
 *
 * REWRITTEN from the editor builder's `PasteMatchOpenRow` test when the two builds were reconciled: the row reads the
 * one line model through `lineRowOf`, a press sends a pick, and the focus request is the house `ControlFocus`. New: a
 * line opened by Change that needs no choice draws no prompt.
 *
 * The UI fix pass (2026-10-25) adds, seen red first: no card of its own (U2/U3), the 14 px prompt (U1), a failed pick
 * with Try again (M6); the focus request is `focus`, and Keep is one string with "no nutrition" (U6).
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

function renderRow(line: MatchLine, online = true, failed = false) {
    const handlers = {
        onSearch: vi.fn(),
        onPick: vi.fn(),
        onHandled: vi.fn(),
        onRetryPick: vi.fn(),
        onSeeWhy: vi.fn(),
    };
    const row = lineRowOf(line, { expanded: true, current: false, online, pending: undefined, failed }, copy, 'en');

    if (row.kind !== 'open') {
        throw new Error(`expected an open row, got ${row.kind}`);
    }

    const { container } = render(
        <MatchOpenRow
            line={row.line}
            view={row.view}
            onSearch={handlers.onSearch}
            onPick={handlers.onPick}
            focus={{ requested: false, onHandled: handlers.onHandled }}
            onRetryPick={handlers.onRetryPick}
            onSeeWhy={handlers.onSeeWhy}
            retry={{
                landing: { requested: false, onHandled: vi.fn() },
                tryAgain: { requested: false, onHandled: vi.fn() },
            }}
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
            'Keep “2 cups milk” as written\u00A0· no nutrition',
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

    // REWRITTEN for U2/U3: the open line is no longer a bordered card (the list draws the rule above every line), and the
    // options' box carries the only border.
    it('U2: no card of its own and no fill; the options’ box is the one border', () => {
        const { container } = renderRow(makeDefaultLine());
        const row = container.firstElementChild;
        const style = row === null ? undefined : getComputedStyle(row);

        // No fill: unset, or the transparent black react-native-web resolves an unset colour to.
        expect(['', 'rgba(0, 0, 0, 0)']).toContain(style?.backgroundColor);
        expect(['', '0px']).toContain(style?.borderTopWidth);
        expect(getComputedStyle(screen.getByRole('list', { name: 'Food for 2 cups milk' })).borderTopWidth).toBe('1px');
    });

    it('⛔ M6: a pick that failed says so with the warning glyph, and Try again sends it again', () => {
        const { onRetryPick } = renderRow(makeDefaultLine(), true, true);

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();
        expect(document.querySelector('[data-icon-name="triangle-alert"]')).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Try again to save the choice for 2 cups milk' }));
        expect(onRetryPick).toHaveBeenCalledTimes(1);
    });

    it('offline: search needs the network, and the options still show', () => {
        renderRow(makeDefaultLine({ candidates: MILKS.slice(0, 2) }), false);

        expect(screen.getByText('Search needs the network')).toBeTruthy();
        expect(names()).toEqual([
            'Skim milk',
            'Whole milk, Default',
            'Keep “2 cups milk” as written\u00A0· no nutrition',
        ]);
    });
});

/**
 * ADDED for the AI budget spent (owner ruling 2026-10-26): a line the spent budget left for the cook offers See why under
 * its prompt; the reason opens in place and is announced once. A line the check ran for offers no such control.
 */
describe('MatchOpenRow — See why on a line matched without the AI check', () => {
    const spent = () => makeNeedsChoiceLine({ budgetSpent: { resetsAt: '2026-11-01T00:00:00.000Z' } });
    const REASON = 'Our check did not run this month, so this is our best guess. Choose the food you use.';

    it('opens the reason in place and announces it once', () => {
        const { onSeeWhy } = renderRow(spent());

        expect(screen.queryByText(REASON)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'See why' }));

        expect(screen.getByText(REASON)).toBeTruthy();
        expect(onSeeWhy).toHaveBeenCalledExactlyOnceWith(REASON);
    });

    it('offers no See why on a line the check ran for', () => {
        renderRow(makeNeedsChoiceLine());

        expect(screen.queryByRole('button', { name: 'See why' })).toBeNull();
    });
});
