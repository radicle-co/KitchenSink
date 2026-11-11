// @vitest-environment jsdom
/**
 * The row editor's phone sheet (web), below a 600 container (build spec 5.7.5.2): Done is the primary action and draws
 * FULL WIDTH, as the phone app's does (issue #176). `PressScale`'s `fill` box is `flex self-stretch`, which stretches
 * across its parent's CROSS axis, so a `flex justify-end` footer (a row) left Done small and at the end. jsdom has no
 * layout, so the contract is the footer's box: it must be a block (or a column), never a row.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRowLineEditorView } from '../../__fixtures__/rowLineEditorView.js';
import { IngredientLineEditorSheet } from '../IngredientLineEditorSheet.js';
import { recipeFormMessages } from '../messages.js';

afterEach(cleanup);

const m = recipeFormMessages.en;

describe('IngredientLineEditorSheet (web): Done', () => {
    it('draws Done full width in a footer that is not a flex row', () => {
        render(
            <IngredientLineEditorSheet
                open
                row={{ index: 0, lineEditor: makeRowLineEditorView() }}
                m={m}
                details={null}
            />,
        );
        const done = screen.getByRole('button', { name: m.rowDone });
        const footer = done.parentElement?.parentElement as HTMLElement;

        expect(done.className).toContain('w-full');
        expect(footer.className).not.toMatch(/(^|\s)(inline-)?flex(\s|$)/u);
        expect(footer.className).not.toContain('justify-end');
    });

    it('Done closes the editor', async () => {
        const onDone = vi.fn();
        render(
            <IngredientLineEditorSheet
                open
                row={{ index: 0, lineEditor: makeRowLineEditorView({ onDone }) }}
                m={m}
                details={null}
            />,
        );

        await userEvent.click(screen.getByRole('button', { name: m.rowDone }));
        expect(onDone).toHaveBeenCalledOnce();
    });
});
