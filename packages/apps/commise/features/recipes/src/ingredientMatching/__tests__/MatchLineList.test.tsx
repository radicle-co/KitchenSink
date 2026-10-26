// @vitest-environment jsdom
/**
 * Component tests for the web `MatchLineList`: a recipe's matched lines in either flow, one row per line through
 * `lineRowOf`, the host's expanded line open and every other open line collapsed
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`).
 *
 * The focus case is review finding M4: a pick used to re-render the list and destroy focus. Now the host raises a
 * `ControlFocus` request for the next open line's Search (`pickFocusOf`), and after the re-render with that line
 * expanded, focus IS that Search.
 *
 * The UI fix pass (2026-10-25) adds, seen red first: `pending` is a map, so two lines can be sending at once and each
 * reads busy on its own (M1); a failed pick shows on its line (M6); the list has ONE polite live region (U9); and,
 * offline, focus lands on the next line's first option and stays there when the network returns (H1).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import type { PendingSend } from '../matchLine.js';

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

/** A host that does what the wiring phase will: bind the pick, expand the next open line, and ask its list for focus. */
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
            pending: new Map([['milk', { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } }]]),
        });

        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-busy')).toBe('true');
    });

    it('⛔ M1: two lines sending at once each read busy on their own line', () => {
        renderList({
            pending: new Map<string, PendingSend>([
                ['milk', { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } }],
                ['cream', { kind: 'useProposal' }],
            ]),
        });

        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-busy')).toBe('true');
        expect(
            screen
                .getByRole('button', { name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream' })
                .getAttribute('aria-busy'),
        ).toBe('true');
    });

    it('⛔ M1: a line that is sending cannot take a second pick, nor be opened or changed', async () => {
        const user = userEvent.setup();
        const on = renderList({
            expandedKey: 'milk',
            pending: new Map<string, PendingSend>([
                ['milk', { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } }],
                ['bread', { kind: 'searchPick' }],
                ['eggs', { kind: 'pick', pick: { kind: 'asWritten' } }],
            ]),
        });

        await user.click(screen.getByRole('button', { name: 'Whole milk, Default' }));
        await user.click(screen.getByRole('button', { name: /6 slices day-old bread/ }));
        await user.click(screen.getByRole('button', { name: 'Change the food for eggs' }));

        expect(on.onPick).not.toHaveBeenCalled();
        expect(on.onOpen).not.toHaveBeenCalled();
    });

    it('M6: a failed pick shows on its line', () => {
        renderList({ failed: new Set(['milk']) });

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();
    });

    it('⛔ U9: the list has ONE polite live region, saying what the host announces, and the rows have none', () => {
        renderList({ announcement: { text: 'Check finished for 1/2 cup heavy cream: choose a food.', occurrence: 1 } });

        const regions = screen.getAllByRole('status');

        expect(regions.map((region) => region.textContent).filter((text) => text !== '')).toEqual([
            'Check finished for 1/2 cup heavy cream: choose a food.',
        ]);
        expect(regions.every((region) => region.closest('li') === null)).toBe(true);
    });

    it('U3: lines are divided by rules, not a bare gap', () => {
        renderList();

        const [recipe] = screen.getAllByRole('list');

        expect(recipe?.className.split(' ')).not.toContain('gap-1');
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
                .filter((button) => button.getAttribute('aria-current') === 'true')
                .map((button) => button.textContent),
        ).toEqual([expect.stringContaining('day-old bread')]);
    });

    it('⛔ after a pick, focus moves to the next open line’s Search, not to the top of the page', async () => {
        const user = userEvent.setup();

        render(<PickingHost online />);
        await user.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' }),
        );
    });

    it('⛔ H1: offline, focus lands on the next line’s first option, and stays there when the network returns', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<PickingHost online={false} />);

        await user.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        const firstBread = screen.getByRole('button', { name: 'White bread, sliced' });

        expect(document.activeElement).toBe(firstBread);

        rerender(<PickingHost online />);

        expect(document.activeElement).toBe(firstBread);
    });
});

/**
 * WCAG 2.2 SC 2.4.3 (Focus Order): Try again unmounts while its retry is in flight, so the press that started the retry
 * must not drop focus to the page. Focus lands on the control the retry made busy (refused, never natively disabled),
 * returns to the new Try again if the retry fails again, and after a success follows the host's `pickFocusOf` exactly as
 * after a first pick. A host moves between these states by new props, so each test re-renders; a harness button would
 * steal the focus under test.
 */
describe('MatchLineList (web): Try again keeps focus (WCAG 2.4.3)', () => {
    const MILK_RETRY = 'Try again to save the choice for 2 cups milk';
    const CREAM_RETRY = 'Try again to save the choice for 1/2 cup heavy cream';
    const SKIM_PENDING: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };
    const FAILED_MILK: ReadonlySet<string> = new Set(['milk']);
    const SENDING = (key: string, send: PendingSend): ReadonlyMap<string, PendingSend> => new Map([[key, send]]);

    const listWith = (props: Partial<MatchLineListProps>) => (
        <>
            <button type="button">Elsewhere</button>
            <MatchLineList
                lines={LINES}
                expandedKey="milk"
                currentKey={undefined}
                online
                pending={NOTHING_SENT}
                failed={NONE_FAILED}
                announcement={SILENT}
                focus={{ requested: false, onHandled: vi.fn() }}
                {...handlers()}
                {...props}
            />
        </>
    );

    it('⛔ pressing Try again on the open line lands focus on the option being retried, busy and not natively disabled', async () => {
        const user = userEvent.setup();
        const { rerender } = render(listWith({ failed: FAILED_MILK }));

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed: FAILED_MILK, pending: SENDING('milk', SKIM_PENDING) }));

        const skim = screen.getByRole('button', { name: 'Skim milk' });

        expect(screen.queryByRole('button', { name: MILK_RETRY })).toBeNull();
        expect(document.activeElement).toBe(skim);
        expect(skim.getAttribute('aria-busy')).toBe('true');
        expect(skim.hasAttribute('disabled')).toBe(false);
    });

    it('⛔ a retry that fails again returns focus to the new Try again', async () => {
        const user = userEvent.setup();
        const { rerender } = render(listWith({ failed: FAILED_MILK }));

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed: FAILED_MILK, pending: SENDING('milk', SKIM_PENDING) }));
        rerender(listWith({ failed: FAILED_MILK }));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: MILK_RETRY }));
    });

    it('⛔ a retry that succeeds leaves focus where a successful first pick leaves it: on the next open line’s Search', async () => {
        const user = userEvent.setup();
        const { rerender } = render(listWith({ failed: FAILED_MILK }));

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed: FAILED_MILK, pending: SENDING('milk', SKIM_PENDING) }));

        const next = LINES.map((line) =>
            line.key === 'milk' && line.state === 'default'
                ? { ...line, binding: { boundBy: 'cook' as const, pick: SKIM_PENDING.pick, reviewNote: undefined } }
                : line,
        );
        const focus = pickFocusOf(next, 'milk', NOTHING_SENT);

        rerender(
            listWith({
                lines: next,
                expandedKey: focus.kind === 'line' ? focus.key : undefined,
                focus: { requested: focus.kind === 'line', onHandled: vi.fn() },
            }),
        );

        expect(screen.queryByRole('button', { name: MILK_RETRY })).toBeNull();
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' }),
        );
    });

    it('a first failure does not pull focus from where the cook has gone', () => {
        const { rerender } = render(listWith({ pending: SENDING('milk', SKIM_PENDING) }));
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });

        elsewhere.focus();
        rerender(listWith({ failed: FAILED_MILK }));

        expect(document.activeElement).toBe(elsewhere);
    });

    it('an unrelated render during the retry does not take focus back from the cook', async () => {
        const user = userEvent.setup();
        const { rerender } = render(listWith({ failed: FAILED_MILK }));

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed: FAILED_MILK, pending: SENDING('milk', SKIM_PENDING) }));

        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });

        elsewhere.focus();
        rerender(
            listWith({
                failed: FAILED_MILK,
                pending: SENDING('milk', SKIM_PENDING),
                announcement: { text: 'Check finished.', occurrence: 1 },
            }),
        );

        expect(document.activeElement).toBe(elsewhere);
    });

    it('⛔ a settled line lands on the Use this that its retry made busy, and returns to Try again if it fails again', async () => {
        const user = userEvent.setup();
        const failed: ReadonlySet<string> = new Set(['cream']);
        const useThis = { kind: 'useProposal' } as const;
        const { rerender } = render(listWith({ expandedKey: undefined, failed }));

        await user.click(screen.getByRole('button', { name: CREAM_RETRY }));
        rerender(listWith({ expandedKey: undefined, failed, pending: SENDING('cream', useThis) }));

        const use = screen.getByRole('button', { name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream' });

        expect(document.activeElement).toBe(use);
        expect(use.getAttribute('aria-busy')).toBe('true');
        expect(use.hasAttribute('disabled')).toBe(false);

        rerender(listWith({ expandedKey: undefined, failed }));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: CREAM_RETRY }));
    });

    it('a bound settled line, with no busy control of its own, lands on its Change: refused, not natively disabled', async () => {
        const user = userEvent.setup();
        const eggs = makeConfidentLine();
        const failed: ReadonlySet<string> = new Set(['eggs']);
        const { rerender } = render(listWith({ lines: [eggs], expandedKey: undefined, failed }));

        await user.click(screen.getByRole('button', { name: 'Try again to save the choice for eggs' }));
        rerender(listWith({ lines: [eggs], expandedKey: undefined, failed, pending: SENDING('eggs', SKIM_PENDING) }));

        const change = screen.getByRole('button', { name: 'Change the food for eggs' });

        expect(document.activeElement).toBe(change);
        expect(change.getAttribute('aria-disabled')).toBe('true');
        expect(change.hasAttribute('disabled')).toBe(false);
    });

    it('⛔ a retry on one line leaves another line’s first send alone', async () => {
        const user = userEvent.setup();
        const { rerender } = render(listWith({ failed: FAILED_MILK }));
        const both = new Map<string, PendingSend>([
            ['milk', SKIM_PENDING],
            ['cream', { kind: 'useProposal' }],
        ]);

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed: FAILED_MILK, pending: both }));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skim milk' }));
        expect(
            screen
                .getByRole('button', { name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream' })
                .matches(':focus'),
        ).toBe(false);
    });
});
