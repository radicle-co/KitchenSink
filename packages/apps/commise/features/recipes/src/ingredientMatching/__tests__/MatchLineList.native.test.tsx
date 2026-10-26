/**
 * Component tests for the native `MatchLineList` (through react-native-web): a recipe's matched lines in either flow, one row per line through
 * `lineRowOf`, the host's expanded line open and every other open line collapsed
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`).
 *
 * The focus case is review finding M4: a pick used to re-render the list and destroy focus. Now the host raises a
 * `ControlFocus` request for the next open line's Search (`pickFocusOf`), and after the re-render with that line
 * expanded, focus IS that Search.
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
import { pickFocusOf, type LinePick, type MatchLine } from '../matchLine.js';
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
    onSeeWhy: vi.fn(),
});

function renderList(props: Partial<MatchLineListProps> = {}) {
    const on = handlers();

    render(
        <MatchLineList
            lines={LINES}
            expandedKey="milk"
            currentKey={undefined}
            online
            pending={undefined}
            searchFocus={{ requested: false, onHandled: vi.fn() }}
            {...on}
            {...props}
        />,
    );

    return on;
}

/** A host that does what the wiring phase will: bind the pick, expand the next open line, and ask its Search for focus. */
const PickingHost: FC = () => {
    const [lines, setLines] = useState<readonly MatchLine[]>(LINES);
    const [expandedKey, setExpandedKey] = useState<string | undefined>('milk');
    const [focusRequested, setFocusRequested] = useState(false);

    const pick = (key: string, chosen: LinePick): void => {
        const next = lines.map((line) =>
            line.key === key && line.state !== 'confident' && line.state !== 'optionsFailed'
                ? { ...line, binding: { boundBy: 'cook' as const, pick: chosen, reviewNote: undefined } }
                : line,
        );
        const focus = pickFocusOf(next, key);

        setLines(next);
        setExpandedKey(focus.kind === 'search' ? focus.key : undefined);
        setFocusRequested(focus.kind === 'search');
    };

    return (
        <MatchLineList
            lines={lines}
            expandedKey={expandedKey}
            currentKey={undefined}
            online
            pending={undefined}
            searchFocus={{ requested: focusRequested, onHandled: () => setFocusRequested(false) }}
            {...handlers()}
            onPick={pick}
        />
    );
};

describe('MatchLineList (web)', () => {
    it('draws one row per line, in the recipe’s order, as a list', () => {
        renderList();

        expect(screen.getAllByRole('listitem')).toHaveLength(5);
    });

    it('the expanded line is open; every other open line is a collapsed row naming its need', () => {
        renderList();

        expect(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' })).toBeTruthy();
        expect(
            screen.getByText('Choose a food · 2 options', { exact: false, normalizer: (text) => text }),
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Search for a food for 6 slices day-old bread' })).toBeNull();
    });

    it('a pick in flight applies to the expanded line only', () => {
        renderList({ pending: { kind: 'food', foodId: 'skim', name: 'Skim milk' } });

        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-busy')).toBe('true');
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
        render(<PickingHost />);
        focus.moved.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        expect(screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' })).toBeTruthy();
        expect(focus.moved).toHaveBeenCalledTimes(1);
    });
});
