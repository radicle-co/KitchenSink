/**
 * The row editor's amount fields and the field reveal (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): a focused
 * amount asks the reveal host to hold it in view, and lets go on blur. The editor draws in the page's own scroller on a
 * tablet and in the ingredients section on a phone, where the keyboard covered the amount (qa-ios, 2026-11-03).
 */
import { FieldRevealContext, type FieldRevealer } from '@commise/ui/field-reveal';
import { render } from '@commise/ui/testing/tamagui';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IngredientLineEditor } from '../IngredientLineEditor.native.js';
import { recipeFormMessages } from '../messages.js';
import type { RowLineEditorView } from '../ingredientRowView.js';

afterEach(cleanup);

const m = recipeFormMessages.en;

const view: RowLineEditorView = {
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
};

describe.each([[m.rowAmountLabel], [m.rowAmountHighLabel]])(
    'IngredientLineEditor (native) — the "%s" field and the reveal',
    (name) => {
        const hosted = () => {
            const release = vi.fn();
            const revealer = vi.fn<FieldRevealer>(() => release);

            render(
                <FieldRevealContext.Provider value={revealer}>
                    <IngredientLineEditor view={view} index={0} m={m} details={null} />
                </FieldRevealContext.Provider>,
            );

            return { release, revealer };
        };

        const field = (): HTMLElement => screen.getByRole('textbox', { name });

        it('sends a focus request carrying its own node when it gains focus, and none before', () => {
            const { revealer } = hosted();

            expect(revealer).not.toHaveBeenCalled();

            act(() => {
                fireEvent.focus(field());
            });

            expect(revealer.mock.calls[0]?.[0]).toMatchObject({ kind: 'focus' });
            expect(revealer.mock.calls[0]?.[0].field).toBe(field());
        });

        it('lets the request go when it loses focus', () => {
            const { release } = hosted();

            act(() => {
                fireEvent.focus(field());
            });
            act(() => {
                fireEvent.blur(field());
            });

            expect(release).toHaveBeenCalledTimes(1);
        });
    },
);
