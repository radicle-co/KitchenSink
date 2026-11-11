/**
 * @module @commise/features-recipes/__fixtures__ — `makeRowLineEditorView`: the row editor's view as the web tests draw
 * it (one resolved "Flour" line, a range shown, every handler a spy). Pass the fields a test is about.
 */
import { vi } from 'vitest';

import type { RowLineEditorView } from '../form/ingredientRowView.js';

/**
 * A row editor view.
 *
 * @param overrides - The fields to change.
 * @returns The view.
 */
export function makeRowLineEditorView(overrides: Partial<RowLineEditorView> = {}): RowLineEditorView {
    return {
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
        ...overrides,
    };
}
