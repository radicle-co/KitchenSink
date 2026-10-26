/**
 * Component tests for the native `MatchClosedRow` (through react-native-web), the React Native leaf of the web one: an open line drawn collapsed, in either flow — on phone and 834 while
 * another line is open, and in the 1194 / web list beside the side pane
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). The whole row is one control that opens the
 * line, says what the line needs in muted words, and the line the pane shows is marked current.
 *
 * REWRITTEN from the editor builder's `PasteMatchClosedRow` test when the two builds were reconciled: the row reads the
 * one line model through `lineRowOf`, and its need keeps a no-break space before its dot.
 *
 * The UI fix pass (2026-10-25) adds, seen red first: the current line's ring (U10), the 14 px need (U1), the refusal
 * while its pick is sent (M1) and a failed pick in place of its need (M6).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { nativeTokens } from '@commise/ui/native';
import { themeFor } from '@commise/ui/theme';

import { recipeMessages } from '../../messages.js';
import {
    makeDefaultLine,
    makeFoodChoice,
    makeNeedsChoiceLine,
    makeNoMatchLine,
    MILKS,
} from '../__fixtures__/matchLines.js';
import type { MatchLine } from '../matchLine.js';
import { lineRowOf, type LinePlace } from '../matchLineView.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { MatchClosedRow } from '../MatchClosedRow.native.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const FIVE = Array.from({ length: 5 }, (_, index) =>
    makeFoodChoice({ id: String(index), name: `Bread ${String(index)}` }),
);

afterEach(cleanup);

/** A `#rrggbb` colour as the `rgb(r, g, b)` a computed style reports. */
const hexToRgb = (hex: string): string => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
};

function renderRow(line: MatchLine, current = false, place: Partial<Pick<LinePlace, 'pending' | 'failed'>> = {}) {
    const onOpen = vi.fn();
    const row = lineRowOf(
        line,
        { expanded: false, current, online: true, pending: undefined, failed: false, ...place },
        copy,
        'en',
    );

    if (row.kind !== 'closed') {
        throw new Error(`expected a closed row, got ${row.kind}`);
    }

    render(
        <MatchClosedRow
            line={row.line}
            need={row.need}
            current={row.current}
            refusing={row.refusing}
            failure={row.failure}
            onOpen={onOpen}
        />,
    );

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

    it('U10: the current line pairs the selected fill with a 2 pt selected-edge ring; at rest the ring is clear, so the row never shifts', () => {
        const { colors } = themeFor('light');

        renderRow(makeNeedsChoiceLine(), true);
        const current = getComputedStyle(screen.getByRole('button'));

        expect(current.borderTopWidth).toBe('2px');
        expect(current.borderTopColor).toBe(hexToRgb(colors.selectedEdge));
        cleanup();

        renderRow(makeNeedsChoiceLine());
        const rest = getComputedStyle(screen.getByRole('button'));

        expect(rest.borderTopWidth).toBe('2px');
        expect(rest.borderTopColor).toBe('rgba(0, 0, 0, 0)');
    });

    it('U1: its need is the 14 px list role', () => {
        renderRow(makeNoMatchLine());

        expect(
            getComputedStyle(screen.getByText('No food found · search or keep as written', { exact: false })).fontSize,
        ).toBe(`${String(nativeTokens.type.list.fontSize)}px`);
    });

    it('⛔ M1: a line whose pick is being sent refuses to open', () => {
        const { onOpen } = renderRow(makeNeedsChoiceLine(), false, { pending: { kind: 'searchPick' } });

        fireEvent.click(screen.getByRole('button'));

        expect(screen.getByRole('button').getAttribute('aria-disabled')).toBe('true');
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('M6: a line whose pick failed says so in place of its need, with a warning glyph', () => {
        renderRow(makeNeedsChoiceLine(), false, { failed: true });

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();
        expect(screen.getByRole('button').querySelector('[data-icon-name="triangle-alert"]')).not.toBeNull();
        expect(screen.queryByText(/Choose a food/)).toBeNull();
    });

    it('keeps the native touch floor', () => {
        renderRow(makeNeedsChoiceLine());

        expect(getComputedStyle(screen.getByRole('button')).minHeight).toBe(`${String(nativeTokens.touchTarget)}px`);
    });
});
