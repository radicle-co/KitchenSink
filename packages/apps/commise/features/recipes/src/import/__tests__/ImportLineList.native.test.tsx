/**
 * Component tests for the native `ImportLineList` (through react-native-web) (board WizardStep): one imported recipe's lines in the review wizard.
 *
 * REWRITTEN when the paste and import builds were reconciled. The import builder's list re-derived every line state in
 * its own `LineRow` (an `if` chain behind a false `@pattern Visitor`, review finding M1) beside a radio-list copy of the
 * editor's food-choice list. It now composes the ONE shared `MatchLineList`, so the per-state cases it carried — the
 * expanded line, the checking line, "your choice", the late review note, Change on a matched line — are the shared
 * module's and are tested there (`ingredientMatching/__tests__/matchLineView.test.ts`, `MatchRow.test.tsx`,
 * `MatchSettledRow.test.tsx`, `FoodChoiceList.test.tsx`). What stays here is the wizard's own: the recipe with nothing to
 * fix, and focus after a pick.
 *
 * The focus case is review finding M4: a pick used to re-render the step and destroy focus. After a pick and a
 * re-render with the next open line expanded, focus IS that line's "Search for a food".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { render } from '@commise/ui/testing/tamagui';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC } from 'react';

const focus = vi.hoisted(() => ({ moved: vi.fn() }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focus.moved } };
});

import {
    cookPicked,
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
    MILKS,
} from '../../ingredientMatching/__fixtures__/matchLines.js';
import { pickFocusOf, type LinePick, type MatchLine } from '../../ingredientMatching/matchLine.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportLineList } from '../ImportLineList.native.js';
import type { ImportLineListProps } from '../props.js';

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

function renderList(props: Partial<ImportLineListProps> = {}) {
    render(
        <ImportLineList
            lines={LINES}
            expandedKey="milk"
            currentKey={undefined}
            online
            pending={new Map()}
            failed={new Set()}
            announcement={{ text: '', occurrence: 0 }}
            focus={{ requested: false, onHandled: vi.fn() }}
            {...handlers()}
            {...props}
        />,
    );
}

/** The wiring phase's host in miniature: bind the pick, expand the next open line, and ask its Search for focus. */
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
        const focus = pickFocusOf(next, key, new Set());

        setLines(next);
        setExpandedKey(focus.kind === 'line' ? focus.key : undefined);
        setFocusRequested(focus.kind === 'line');
    };

    return (
        <ImportLineList
            lines={lines}
            expandedKey={expandedKey}
            currentKey={undefined}
            online
            pending={new Map()}
            failed={new Set()}
            announcement={{ text: '', occurrence: 0 }}
            focus={{ requested: focusRequested, onHandled: () => setFocusRequested(false) }}
            {...handlers()}
            onPick={pick}
        />
    );
};

describe('ImportLineList (native)', () => {
    it('draws the shared list: the expanded line open with Search first and nothing chosen, as buttons', () => {
        renderList();

        expect(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Whole milk, Default' })).toBeTruthy();
        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByRole('button', { name: /, chosen$/ })).toBeNull();
    });

    it('a recipe whose every line is matched says there is nothing to fix', () => {
        renderList({ lines: [makeConfidentLine(), makeConfidentLine({ key: 'sugar' })], expandedKey: undefined });

        expect(screen.getByText('All 2 ingredients are matched. You can change any of them.')).toBeTruthy();
    });

    it('one matched ingredient is said in the singular', () => {
        renderList({ lines: [makeConfidentLine()], expandedKey: undefined });

        expect(screen.getByText('The ingredient is matched. You can change it.')).toBeTruthy();
    });

    it('says nothing of the kind while a line is still open, or once the cook picked the open lines', () => {
        renderList();

        expect(screen.queryByText(/are matched/)).toBeNull();

        cleanup();
        renderList({ lines: [makeDefaultLine({ binding: cookPicked(MILKS[1] ?? MILKS[0]) })], expandedKey: undefined });

        expect(screen.queryByText(/is matched|are matched/)).toBeNull();
    });

    it('⛔ after a pick, the screen reader moves to the next open line’s Search', () => {
        render(<PickingHost />);
        focus.moved.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        expect(screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' })).toBeTruthy();
        expect(focus.moved).toHaveBeenCalledTimes(1);
    });
});
