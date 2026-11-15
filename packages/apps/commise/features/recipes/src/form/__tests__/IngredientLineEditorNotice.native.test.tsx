/**
 * The Needs review notice takes the screen-reader cursor when the jump opens the editor (designer, 2026-11-14): the web
 * focuses the notice group, and native must move VoiceOver and TalkBack onto the notice as one unit, and onto nothing else,
 * so a cook hears what is wrong first and no text field takes the keyboard. The request is the view's `noticeFocus`; the
 * notice answers it once and says it was handled.
 *
 * `AccessibilityInfo.sendAccessibilityEvent` is spied, and the house wrapper (`moveScreenReaderFocus`) runs for real.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IngredientLineEditor } from '../IngredientLineEditor.native.js';
import { recipeFormMessages } from '../messages.js';
import type { RowLineEditorView } from '../ingredientRowView.js';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

const m = recipeFormMessages.en;
const sendEvent = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);

beforeEach(() => {
    sendEvent.mockClear();
});
afterEach(cleanup);

const base: RowLineEditorView = {
    title: 'Flour',
    closeLabel: 'Close',
    food: 'Flour',
    ids: {
        amount: 'amount-1',
        amountHigh: 'amountHigh-1',
        unit: 'unit-1',
        displayText: 'displayText-1',
        note: 'note-1',
        prep: 'prep-1',
    },
    amountLow: '2',
    amountHigh: '3',
    rangeShown: true,
    amountInvalid: false,
    amountNote: undefined,
    unit: 'cup',
    unitSuggestions: ['cup'],
    unitNote: undefined,
    displayText: '',
    displayTextPlaceholder: 'Flour',
    note: '',
    prep: '',
    describedBy: { quantity: undefined, quantityHigh: undefined, unit: undefined },
    detailsOffered: false,
    detailsOpen: false,
    onAmountLow: vi.fn(),
    onAmountHigh: vi.fn(),
    onAddRange: vi.fn(),
    onRemoveRange: vi.fn(),
    onUnit: vi.fn(),
    onPrep: vi.fn(),
    onDisplayText: vi.fn(),
    onNote: vi.fn(),
    onChangeFood: undefined,
    onToggleDetails: vi.fn(),
    onDone: vi.fn(),
    onCancel: vi.fn(),
};

/** The view of a line under review, with the jump's request to focus the notice. */
const reviewed = (noticeFocus: { requested: boolean; onHandled: () => void }): RowLineEditorView => ({
    ...base,
    reviewNotice: { originalLine: '2 cups flour, or so' },
    noticeFocus,
});

/** Every cursor move, as the node it went to. */
const focusedNodes = (): unknown[] =>
    sendEvent.mock.calls.filter(([, event]) => event === 'focus').map(([node]) => node);

describe('IngredientLineEditor (native) — the Needs review notice and the screen-reader cursor', () => {
    it('moves the cursor onto the notice, as ONE element holding its words and none of the fields, and says it handled it', () => {
        const onHandled = vi.fn();

        render(<IngredientLineEditor view={reviewed({ requested: true, onHandled })} index={0} m={m} details={null} />);

        const [node, ...others] = focusedNodes();

        expect(others).toEqual([]);
        expect(node).toBeInstanceOf(HTMLElement);

        const notice = node as HTMLElement;

        expect(notice.contains(screen.getByText(m.statusNeedsReview))).toBe(true);
        expect(notice.contains(screen.getByText(m.statusExplainNeedsReview))).toBe(true);
        expect(notice.contains(screen.getByText('2 cups flour, or so'))).toBe(true);
        expect(notice.contains(screen.getByRole('textbox', { name: m.rowAmountLabel }))).toBe(false);
        expect(onHandled).toHaveBeenCalledOnce();
    });

    it('moves nothing while no request is raised, and a line that needs no review has no notice to move to', () => {
        const onHandled = vi.fn();

        render(
            <IngredientLineEditor view={reviewed({ requested: false, onHandled })} index={0} m={m} details={null} />,
        );
        render(<IngredientLineEditor view={base} index={1} m={m} details={null} />);

        expect(focusedNodes()).toEqual([]);
        expect(onHandled).not.toHaveBeenCalled();
    });
});
