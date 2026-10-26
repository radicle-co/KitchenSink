// @vitest-environment jsdom
/**
 * Component tests for the web `ImportLineOptionsSheet` and `ImportLineOptionsPane` (board FlaggedLine): a flagged line's
 * options — the same list in a sheet below the wide class and in a pane beside the list at it — titled with the line and
 * its recipe, "Search for a food" first, the default tagged and never chosen.
 *
 * REWRITTEN when the paste and import builds were reconciled: the import builder's radio list (`ImportLineOptions` over
 * `RadioList`) was a duplicate of the editor's food-choice list, and radios pick on arrow keys, which the design
 * authority ruled out. Both surfaces now draw the ONE shared `FoodChoiceList`: options are buttons, a press sends the
 * pick, nothing is chosen until the cook presses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makeDefaultLine, makeFoodChoice } from '../../ingredientMatching/__fixtures__/matchLines.js';
import { ImportLineOptionsPane } from '../ImportLineOptionsPane.js';
import { ImportLineOptionsSheet } from '../ImportLineOptionsSheet.js';

const LINE = '1 1/4 cups milk';
const MILK_LINE = makeDefaultLine({
    line: { measure: '1 1/4 cups', words: 'milk' },
    candidates: [
        makeFoodChoice({ id: 'f-whole', name: 'Whole milk', isDefault: true }),
        makeFoodChoice({ id: 'f-2', name: 'Milk, 2% fat' }),
        makeFoodChoice({ id: 'f-crackers', name: 'Milk crackers' }),
    ],
});
const NO_FOCUS = { requested: false, onHandled: vi.fn() };

afterEach(cleanup);

function renderSheet(open = true) {
    const handlers = { onOpenChange: vi.fn(), onPick: vi.fn(), onSearch: vi.fn() };

    render(
        <ImportLineOptionsSheet
            open={open}
            title="1 1/4 cups milk · Pancakes"
            line={MILK_LINE}
            online
            pending={undefined}
            focus={NO_FOCUS}
            {...handlers}
        />,
    );

    return handlers;
}

describe('ImportLineOptionsSheet (web)', () => {
    it('renders nothing while closed', () => {
        renderSheet(false);

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is a dialog titled with the line and its recipe: Search first, then the options as buttons, nothing chosen', async () => {
        const user = userEvent.setup();
        const { onSearch, onPick } = renderSheet();

        const dialog = screen.getByRole('dialog', { name: '1 1/4 cups milk · Pancakes' });
        const search = within(dialog).getByRole('button', { name: `Search for a food for ${LINE}` });
        const list = within(dialog).getByRole('list', { name: `Food for ${LINE}` });

        expect(search.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(list).getAllByRole('button')).toHaveLength(4);
        expect(within(dialog).queryByRole('radio')).toBeNull();
        expect(within(list).queryByRole('button', { name: /, chosen$/ })).toBeNull();

        await user.click(search);
        await user.click(within(list).getByRole('button', { name: 'Whole milk, Default' }));

        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'f-whole', name: 'Whole milk' });
    });

    it('closes through its close control', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = renderSheet();

        await user.click(screen.getByRole('button', { name: `Close options for ${LINE}` }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

describe('ImportLineOptionsPane (web)', () => {
    it('is a region headed by the line and its recipe, with the same list: Search first, nothing chosen', () => {
        render(
            <ImportLineOptionsPane
                title="1 1/4 cups milk · Pancakes"
                line={MILK_LINE}
                online
                pending={undefined}
                focus={NO_FOCUS}
                onPick={vi.fn()}
                onSearch={vi.fn()}
            />,
        );

        const pane = screen.getByRole('region', { name: '1 1/4 cups milk · Pancakes' });

        expect(within(pane).getByRole('heading', { name: '1 1/4 cups milk · Pancakes' })).toBeTruthy();
        expect(within(pane).getByRole('button', { name: `Search for a food for ${LINE}` })).toBeTruthy();
        expect(within(pane).queryByRole('button', { name: /, chosen$/ })).toBeNull();
        expect(within(within(pane).getByRole('list')).getAllByRole('button')).toHaveLength(4);
    });
});
