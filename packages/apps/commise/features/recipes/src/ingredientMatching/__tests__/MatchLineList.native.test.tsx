/**
 * Component tests for the native `MatchLineList` (through react-native-web): a recipe's matched lines in either flow, one row per line through
 * `lineRowOf`, the host's expanded line open and every other open line collapsed
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`).
 *
 * The focus case is review finding M4: a pick used to re-render the list and destroy focus. Now the host raises a
 * `ControlFocus` request for the next open line's Search (`pickFocusOf`), and after the re-render with that line
 * expanded, focus IS that Search.
 *
 * The UI fix pass (2026-10-25) adds, seen red first: `pending` is a map, so two lines can be sending at once (M1); a
 * failed pick shows on its line (M6); ONE polite live region per list (U9); a rule above every line, no bare gap (U3);
 * and, offline, focus moves to the next line's first option and not again when the network returns (H1).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC } from 'react';

const focus = vi.hoisted(() => ({ moved: vi.fn() }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focus.moved } };
});

import {
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
} from '../__fixtures__/matchLines.js';
import { pickFocusOf, type LinePick, type MatchLine, type PendingSend } from '../matchLine.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { MatchLineList } from '../MatchLineList.native.js';
import type { MatchLineListProps } from '../matchLineListProps.js';

afterEach(cleanup);

const LINES: readonly MatchLine[] = [
    makeConfidentLine(),
    makeDefaultLine(),
    makeCheckingLine(),
    makeNeedsChoiceLine(),
    makeNoMatchLine(),
];

const handlers = () => ({
    onOpen: vi.fn(),
    onPick: vi.fn(),
    onSearch: vi.fn(),
    onUseProposal: vi.fn(),
    onRetry: vi.fn(),
    onRetryPick: vi.fn(),
    onSeeWhy: vi.fn(),
});

const NOTHING_SENT: ReadonlyMap<string, PendingSend> = new Map();
const NONE_FAILED: ReadonlySet<string> = new Set();
const SILENT = { text: '', occurrence: 0 };

function renderList(props: Partial<MatchLineListProps> = {}) {
    const on = handlers();

    render(
        <MatchLineList
            lines={LINES}
            expandedKey="milk"
            currentKey={undefined}
            online
            pending={NOTHING_SENT}
            failed={NONE_FAILED}
            announcement={SILENT}
            focus={{ requested: false, onHandled: vi.fn() }}
            {...on}
            {...props}
        />,
    );

    return on;
}

/** A host that does what the wiring phase will: bind the pick, expand the next open line, and ask its Search for focus. */
const PickingHost: FC<{ readonly online: boolean }> = ({ online }) => {
    const [lines, setLines] = useState<readonly MatchLine[]>(LINES);
    const [expandedKey, setExpandedKey] = useState<string | undefined>('milk');
    const [focusRequested, setFocusRequested] = useState(false);

    const pick = (key: string, chosen: LinePick): void => {
        const next = lines.map((line) =>
            line.key === key && line.state !== 'confident' && line.state !== 'optionsFailed'
                ? { ...line, binding: { boundBy: 'cook' as const, pick: chosen, reviewNote: undefined } }
                : line,
        );
        const focus = pickFocusOf(next, key, NOTHING_SENT);

        setLines(next);
        setExpandedKey(focus.kind === 'line' ? focus.key : undefined);
        setFocusRequested(focus.kind === 'line');
    };

    return (
        <MatchLineList
            lines={lines}
            expandedKey={expandedKey}
            currentKey={undefined}
            online={online}
            pending={NOTHING_SENT}
            failed={NONE_FAILED}
            announcement={SILENT}
            focus={{ requested: focusRequested, onHandled: () => setFocusRequested(false) }}
            {...handlers()}
            onPick={pick}
        />
    );
};

describe('MatchLineList (native)', () => {
    it('draws one row per line, in the recipe’s order, as a list', () => {
        renderList();

        // The open line's own box of foods nests inside; the recipe's list is the outer one.
        const [recipe] = screen.getAllByRole('list');

        expect(recipe?.children).toHaveLength(5);
    });

    it('U3: a rule above every line, and no bare gap between them', () => {
        renderList();

        const [recipe] = screen.getAllByRole('list');
        const items = Array.from(recipe?.children ?? []);

        expect(items.every((item) => getComputedStyle(item).borderTopWidth !== '0px')).toBe(true);
        expect(recipe === undefined ? undefined : getComputedStyle(recipe).rowGap).not.toBe('4px');
    });

    it('⛔ M1: two lines sending at once each read busy, and a sending line cannot be opened', () => {
        const on = renderList({
            pending: new Map<string, PendingSend>([
                ['milk', { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } }],
                ['cream', { kind: 'useProposal' }],
                ['bread', { kind: 'searchPick' }],
            ]),
        });

        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-busy')).toBe('true');
        expect(
            screen
                .getByRole('button', { name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream' })
                .getAttribute('aria-busy'),
        ).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));
        fireEvent.click(screen.getByText('6 slices', { exact: false }));

        expect(on.onPick).not.toHaveBeenCalled();
        expect(on.onOpen).not.toHaveBeenCalled();
    });

    it('M6: a failed pick shows on its line', () => {
        renderList({ failed: new Set(['milk']) });

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();
    });

    it('⛔ U9: ONE polite live region for the list, saying what the host announces', () => {
        renderList({ announcement: { text: 'Check finished for 1/2 cup heavy cream: choose a food.', occurrence: 1 } });

        const regions = Array.from(document.querySelectorAll('[aria-live]'));

        expect(regions.map((region) => region.getAttribute('aria-live'))).toEqual(['polite', 'polite']);
        expect(regions.map((region) => region.textContent).filter((text) => text !== '')).toEqual([
            'Check finished for 1/2 cup heavy cream: choose a food.',
        ]);
    });

    it('the expanded line is open; every other open line is a collapsed row naming its need', () => {
        renderList();

        expect(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' })).toBeTruthy();
        expect(
            screen.getByText('Choose a food · 2 options', { exact: false, normalizer: (text) => text }),
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Search for a food for 6 slices day-old bread' })).toBeNull();
    });

    it('a pick in flight on the expanded line reads busy there', () => {
        renderList({
            pending: new Map([['milk', { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } }]]),
        });

        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-busy')).toBe('true');
    });

    it('⛔ a send in flight belongs to ITS line: Use this on the checking line reads busy, and no other line refuses', () => {
        renderList({ pending: new Map([['cream', { kind: 'useProposal' }]]) });

        expect(
            screen
                .getByRole('button', { name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream' })
                .getAttribute('aria-busy'),
        ).toBe('true');
        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('the line the side pane shows is marked current', () => {
        renderList({ expandedKey: undefined, currentKey: 'bread' });

        expect(
            screen
                .getAllByRole('button')
                .filter((button) => button.getAttribute('aria-selected') === 'true')
                .map((button) => button.textContent),
        ).toEqual([expect.stringContaining('day-old bread')]);
    });

    it('⛔ after a pick, the screen reader moves to the next open line’s Search', () => {
        render(<PickingHost online />);
        focus.moved.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        expect(focus.moved).toHaveBeenCalledExactlyOnceWith(
            screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' }),
            'focus',
        );
    });

    it('⛔ H1: offline, the screen reader moves to the next line’s first option, and not again when back online', () => {
        const { rerender } = render(<PickingHost online={false} />);
        focus.moved.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        expect(focus.moved).toHaveBeenCalledExactlyOnceWith(
            screen.getByRole('button', { name: 'White bread, sliced' }),
            'focus',
        );

        rerender(<PickingHost online />);

        expect(focus.moved).toHaveBeenCalledTimes(1);
    });
});
