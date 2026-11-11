/**
 * The row editor's field layout on a phone and a tablet (spec 5.5.2, designer round 4): "Name on the recipe" and "Note" stack
 * full width on a phone, Name then Note, because side by side at the Android 2.0 text cap the name box showed "ouse crust" and
 * its label wrapped. Amount and Unit stay side by side. From 600 dp the pair shares a row again.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IngredientLineEditor } from '../IngredientLineEditor.native.js';
import { recipeFormMessages } from '../messages.js';
import type { RowLineEditorView } from '../ingredientRowView.js';

const windowWidth = vi.hoisted(() => ({ current: 390 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: windowWidth.current }) };
});

afterEach(() => {
    cleanup();
    windowWidth.current = 390;
});

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
    onCancel: vi.fn(),
};

/** The element that holds a field's label: the field's own box. */
const fieldBox = (label: string): HTMLElement =>
    screen.getByText(label).parentElement?.parentElement?.parentElement as HTMLElement;
const direction = (node: HTMLElement | null): string => getComputedStyle(node as HTMLElement).flexDirection;

describe('IngredientLineEditor (native) — the field layout', () => {
    it('on a phone Name and Note stack full width, Name then Note', () => {
        render(<IngredientLineEditor view={view} index={0} m={m} details={null} />);
        const name = fieldBox(m.rowDisplayTextLabel);
        const note = fieldBox(m.rowNoteLabel);

        expect(name.parentElement).toBe(note.parentElement);
        expect(direction(name.parentElement)).toBe('column');
        expect(Boolean(name.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    });

    // A column that also WRAPS shrink-wraps each field to its content on a device (the boxes drew a third wide).
    it('on a phone the Name and Note stack does not wrap, so each box fills the width', () => {
        render(<IngredientLineEditor view={view} index={0} m={m} details={null} />);
        const stack = fieldBox(m.rowDisplayTextLabel).parentElement;

        expect(getComputedStyle(stack as HTMLElement).flexWrap).not.toBe('wrap');
    });

    it('on a phone Amount and Unit keep their content sizes (they still wrap as a row)', () => {
        render(<IngredientLineEditor view={view} index={0} m={m} details={null} />);

        expect(getComputedStyle(fieldBox(m.rowAmountLabel).parentElement as HTMLElement).flexWrap).toBe('wrap');
    });

    it('on a phone Amount and Unit still share a row', () => {
        render(<IngredientLineEditor view={view} index={0} m={m} details={null} />);
        const amount = fieldBox(m.rowAmountLabel);

        expect(direction(amount.parentElement)).toBe('row');
    });

    // Designer ruling 2026-11-11: a long food wraps to two lines beside Change; Change keeps its own size on that line and
    // its label never wraps.
    it('keeps Change at its own size beside the food, which wraps instead', () => {
        render(
            <IngredientLineEditor
                view={{ ...view, food: 'Smoked Paprika, sweet, from Spain', onChangeFood: vi.fn() }}
                index={0}
                m={m}
                details={null}
            />,
        );
        const change = screen.getByRole('button', { name: m.rowChange });
        const row = screen.getByText('Smoked Paprika, sweet, from Spain').parentElement as HTMLElement;
        // Change's box on the row: the row's child that holds the button.
        const slot = Array.from(row.children).find((child) => child.contains(change)) as HTMLElement;

        expect(getComputedStyle(row).flexDirection).toBe('row');
        expect(getComputedStyle(row).flexWrap).not.toBe('wrap');
        expect(getComputedStyle(slot).flexShrink).toBe('0');
    });

    it('from 600 dp Name and Note share a row', () => {
        windowWidth.current = 800;
        render(<IngredientLineEditor view={view} index={0} m={m} details={null} />);

        expect(direction(fieldBox(m.rowDisplayTextLabel).parentElement)).toBe('row');
        expect(getComputedStyle(fieldBox(m.rowDisplayTextLabel).parentElement as HTMLElement).flexWrap).toBe('wrap');
    });
});
