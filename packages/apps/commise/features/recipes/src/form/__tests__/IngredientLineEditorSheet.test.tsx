// @vitest-environment jsdom
/**
 * The row editor's phone sheet (web), below a 600 container (build spec 5.7.5.2).
 *
 * REWRITTEN (needs-review jump). It used to prove that Done alone drew full width in a block footer (issue #176: a
 * `fill` button in a flex row hugged its label). The footer is now a Cancel + Done PAIR in the design system's
 * `DialogActions`, which owns that layout. What this now proves: the pair is one row (a shared parent), Cancel first and
 * Done last, both `fill`; each button calls only its own handler; and every other close route (here the sheet's own
 * close control) is Done, never Cancel.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRowLineEditorView } from '../../__fixtures__/rowLineEditorView.js';
import { IngredientLineEditorSheet } from '../IngredientLineEditorSheet.js';
import { recipeFormMessages } from '../messages.js';

afterEach(cleanup);

const m = recipeFormMessages.en;

const renderSheet = (lineEditor = makeRowLineEditorView()) =>
    render(<IngredientLineEditorSheet open row={{ index: 0, lineEditor }} m={m} details={null} />);

describe('IngredientLineEditorSheet (web): Cancel and Done', () => {
    it('draws Cancel then Done in one row, both filling their slot', () => {
        renderSheet();
        const cancel = screen.getByRole('button', { name: m.rowCancel });
        const done = screen.getByRole('button', { name: m.rowDone });

        expect(cancel.className).toContain('w-full');
        expect(done.className).toContain('w-full');
        expect(cancel.parentElement?.parentElement).toBe(done.parentElement?.parentElement);
        expect(cancel.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('Done closes keeping the edits, and Cancel discards: each calls only its own handler', async () => {
        const onDone = vi.fn();
        const onCancel = vi.fn();

        renderSheet(makeRowLineEditorView({ onDone, onCancel }));

        await userEvent.click(screen.getByRole('button', { name: m.rowDone }));
        expect(onDone).toHaveBeenCalledOnce();
        expect(onCancel).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: m.rowCancel }));
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onDone).toHaveBeenCalledOnce();
    });

    it('the sheet’s close control is Done, never Cancel', async () => {
        const onDone = vi.fn();
        const onCancel = vi.fn();

        renderSheet(makeRowLineEditorView({ onDone, onCancel, closeLabel: 'Close Flour' }));
        await userEvent.click(screen.getByRole('button', { name: 'Close Flour' }));

        expect(onDone).toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });
});
