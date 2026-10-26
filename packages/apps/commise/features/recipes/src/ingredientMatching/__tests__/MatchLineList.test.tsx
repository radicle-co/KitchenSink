// @vitest-environment jsdom
/**
 * Component tests for the web `MatchLineList`: a recipe's matched lines in either flow, one row per line through
 * `lineRowOf`, the host's expanded line open and every other open line collapsed
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`).
 *
 * The focus case is review finding M4: a pick used to re-render the list and destroy focus. Now the host raises a
 * `ControlFocus` request for the next open line's Search (`pickFocusOf`), and after the re-render with that line
 * expanded, focus IS that Search.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import {
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
} from '../__fixtures__/matchLines.js';
import { pickFocusOf, type LinePick, type MatchLine } from '../matchLine.js';
import { MatchLineList } from '../MatchLineList.js';
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

        // The open line's own list of foods nests inside; the recipe's list is the outer one.
        const [recipe] = screen.getAllByRole('list');

        expect(recipe?.children).toHaveLength(5);
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
            pending: { key: 'milk', send: { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } } },
        });

        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-busy')).toBe('true');
    });

    it('⛔ a send in flight belongs to ITS line: Use this on the checking line reads busy, and no other line refuses', () => {
        renderList({ pending: { key: 'cream', send: { kind: 'useProposal' } } });

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
                .filter((button) => button.getAttribute('aria-current') === 'true')
                .map((button) => button.textContent),
        ).toEqual([expect.stringContaining('day-old bread')]);
    });

    it('⛔ after a pick, focus moves to the next open line’s Search, not to the top of the page', async () => {
        const user = userEvent.setup();

        render(<PickingHost />);
        await user.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' }),
        );
    });
});
