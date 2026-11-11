/**
 * The row editor's field layout on the web (spec 5.5.2): below 600 "Name on the recipe" and "Note" stack, each full
 * width, in lock step with the native leaf. The pair used to share a row from about 344 px of content, so on a 390 px
 * phone the two boxes sat side by side. jsdom has no media queries, so the contract is the classes: the house container variant (`@regular/main:`, 600 on the
 * width the content gets), never the viewport's `sm:` (640). The phone sheet is portalled outside `<main>`, so it stays
 * stacked, and the inline panel on a tablet sits inside it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { makeRowLineEditorView } from '../../__fixtures__/rowLineEditorView.js';
import { IngredientLineEditor } from '../IngredientLineEditor.js';
import { recipeFormMessages } from '../messages.js';

afterEach(cleanup);

const m = recipeFormMessages.en;

const view = makeRowLineEditorView();

const pairOf = (label: string): HTMLElement => screen.getByLabelText(label).parentElement?.parentElement as HTMLElement;

describe('IngredientLineEditor (web): the Name and Note layout', () => {
    it('stacks Name and Note below 600 and shares a row from 600', () => {
        render(<IngredientLineEditor view={view} index={0} m={m} details={null} />);
        const pair = pairOf(m.rowDisplayTextLabel);

        expect(pairOf(m.rowNoteLabel)).toBe(pair);
        expect(pair.className).toContain('flex-col');
        expect(pair.className).toContain('@regular/main:flex-row');
        expect(pair.className).not.toMatch(/(^|\s)sm:/u);
        expect(pair.className).not.toMatch(/(^|\s)flex-wrap/u);
    });

    it('keeps Amount and Unit as a wrapping row', () => {
        render(<IngredientLineEditor view={view} index={0} m={m} details={null} />);

        expect((screen.getByLabelText(m.rowAmountLabel).closest('div.flex-wrap') as HTMLElement).className).toContain(
            'flex-wrap',
        );
    });
});
