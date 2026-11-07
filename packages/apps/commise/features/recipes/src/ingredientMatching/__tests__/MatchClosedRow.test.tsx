// @vitest-environment jsdom
/**
 * Component tests for the web `MatchClosedRow`: an open line drawn collapsed, in either flow — on phone and 834 while
 * another line is open, and in the 1194 / web list beside the side pane
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). The whole row is one control that opens the
 * line, says what the line needs in muted words, and the line the pane shows is marked current.
 *
 * REWRITTEN from the editor builder's `PasteMatchClosedRow` test when the two builds were reconciled: the row reads the
 * one line model through `lineRowOf`, and its need keeps a no-break space before its dot.
 *
 * The UI fix pass (2026-10-25) adds, seen red first: the current line's ring (U10), the rule above it and the 14 px
 * need (U3, U1), the refusal while its pick is sent (M1) and a failed pick in place of its need (M6).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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
import { MatchClosedRow } from '../MatchClosedRow.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const FIVE = Array.from({ length: 5 }, (_, index) =>
    makeFoodChoice({ id: String(index), name: `Bread ${String(index)}` }),
);

afterEach(cleanup);

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
        <ul>
            <MatchClosedRow
                line={row.line}
                need={row.need}
                current={row.current}
                refusing={row.refusing}
                failure={row.failure}
                onOpen={onOpen}
            />
        </ul>,
    );

    return { onOpen };
}

describe('MatchClosedRow (web)', () => {
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

    it('its need is muted words, never amber: a choice is not a failure', () => {
        renderRow(makeNoMatchLine());

        const need = screen.getByText(
            (_, element) => element?.textContent === 'No food found · search or keep as written',
        );

        expect(need.className).toContain('text-ink-muted');
        expect(need.className).not.toContain('attention');
    });

    it('is not marked current unless the pane shows it', () => {
        renderRow(makeNeedsChoiceLine());

        expect(screen.getByRole('button').getAttribute('aria-current')).not.toBe('true');
    });

    it('the line the pane shows is marked current', () => {
        renderRow(makeNeedsChoiceLine(), true);

        expect(screen.getByRole('button').getAttribute('aria-current')).toBe('true');
    });

    it('is a 48 px target', () => {
        renderRow(makeNeedsChoiceLine());

        expect(screen.getByRole('button').className).toContain('min-h-12');
    });

    it('U10: the current line pairs the selected fill with the selected-edge ring, so it never rests on a 1.2:1 fill', () => {
        renderRow(makeNeedsChoiceLine(), true);

        const classes = screen.getByRole('button').className.split(' ');

        expect(classes).toEqual(
            expect.arrayContaining([
                'aria-[current=true]:bg-selected-fill',
                'aria-[current=true]:ring-2',
                'aria-[current=true]:ring-inset',
                'aria-[current=true]:ring-selected-edge',
            ]),
        );
    });

    // The current ring and the focus indicator are two channels: both as rings, the `aria-[current]` variant wins the
    // ring colour, so a focused current row would look exactly like an unfocused one (2.4.7). Focus is an outline.
    it('draws focus as an outline inside the current ring, never as a second ring colour', () => {
        renderRow(makeNeedsChoiceLine(), true);

        const classes = screen.getByRole('button').className.split(' ');

        expect(classes).toEqual(
            expect.arrayContaining(['focus-visible:outline-2', 'focus-visible:outline-focus-ring']),
        );
        expect(classes.filter((token) => token.startsWith('focus-visible:ring'))).toEqual([]);
    });

    it('U3: a rule above it, in the divider tone; U1: its need is the 14 px list role', () => {
        renderRow(makeNoMatchLine());

        expect(screen.getByRole('listitem').className.split(' ')).toEqual(
            expect.arrayContaining(['border-t', 'border-line-divider']),
        );
        expect(
            screen.getByText((_, element) => element?.textContent === 'No food found\u00A0· search or keep as written')
                .className,
        ).toContain('text-list');
    });

    it('⛔ M1: a line whose pick is being sent refuses to open, and keeps focus', () => {
        const { onOpen } = renderRow(makeNeedsChoiceLine(), false, { pending: { kind: 'searchPick' } });

        const row = screen.getByRole('button');

        row.focus();
        fireEvent.click(row);

        expect(row.getAttribute('aria-disabled')).toBe('true');
        expect(row.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(row);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('M6: a line whose pick failed says so in attention, with a warning glyph, in place of its need', () => {
        renderRow(makeNeedsChoiceLine(), false, { failed: true });

        const failure = screen.getByText('We couldn’t save that choice.');

        expect(failure.className).toContain('text-attention');
        expect(screen.getByRole('button').querySelector('svg.lucide-triangle-alert')).not.toBeNull();
        expect(screen.queryByText(/Choose a food/)).toBeNull();
    });
});
