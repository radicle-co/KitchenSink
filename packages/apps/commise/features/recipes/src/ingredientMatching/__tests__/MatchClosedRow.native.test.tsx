/**
 * Component tests for the native `MatchClosedRow` (through react-native-web), the React Native leaf of the web one: an open line drawn collapsed, in either flow — on phone and 834 while
 * another line is open, and in the 1194 / web list beside the side pane
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). The whole row is one control that opens the
 * line, says what the line needs in muted words, and the line the pane shows is marked current.
 *
 * REWRITTEN from the editor builder's `PasteMatchClosedRow` test when the two builds were reconciled: the row reads the
 * one line model through `lineRowOf`, and its need keeps a no-break space before its dot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { nativeTokens } from '@commise/ui/native';

import { recipeMessages } from '../../messages.js';
import {
    makeDefaultLine,
    makeFoodChoice,
    makeNeedsChoiceLine,
    makeNoMatchLine,
    MILKS,
} from '../__fixtures__/matchLines.js';
import type { MatchLine } from '../matchLine.js';
import { lineRowOf } from '../matchLineView.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { MatchClosedRow } from '../MatchClosedRow.native.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const FIVE = Array.from({ length: 5 }, (_, index) =>
    makeFoodChoice({ id: String(index), name: `Bread ${String(index)}` }),
);

afterEach(cleanup);

function renderRow(line: MatchLine, current = false) {
    const onOpen = vi.fn();
    const row = lineRowOf(line, { expanded: false, current, online: true, pending: undefined }, copy, 'en');

    if (row.kind !== 'closed') {
        throw new Error(`expected a closed row, got ${row.kind}`);
    }

    render(<MatchClosedRow line={row.line} need={row.need} current={row.current} onOpen={onOpen} />);

    return { onOpen };
}

describe('MatchClosedRow (native)', () => {
    it('is one control that names the line and what it needs, and opens the line', () => {
        const { onOpen } = renderRow(makeNeedsChoiceLine({ candidates: FIVE }));

        const row = screen.getByRole('button');

        expect(row.textContent).toContain('6 slices day-old bread');
        expect(row.textContent).toContain('Choose a food · 5 options');

        fireEvent.click(row);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('a default line names its noun and counts its options', () => {
        renderRow(makeDefaultLine({ candidates: MILKS.slice(0, 2) }));

        expect(screen.getByRole('button').textContent).toContain('Choose the milk you use · 2 options');
    });

    it('a line with no match says to search or keep it as written', () => {
        renderRow(makeNoMatchLine());

        expect(screen.getByRole('button').textContent).toContain('No food found · search or keep as written');
    });

    it('is not marked current unless the pane shows it', () => {
        renderRow(makeNeedsChoiceLine());

        expect(screen.getByRole('button').getAttribute('aria-selected')).not.toBe('true');
    });

    it('the line the pane shows is marked current', () => {
        renderRow(makeNeedsChoiceLine(), true);

        expect(screen.getByRole('button').getAttribute('aria-selected')).toBe('true');
    });

    it('keeps the native touch floor', () => {
        renderRow(makeNeedsChoiceLine());

        expect(getComputedStyle(screen.getByRole('button')).minHeight).toBe(`${String(nativeTokens.touchTarget)}px`);
    });
});
