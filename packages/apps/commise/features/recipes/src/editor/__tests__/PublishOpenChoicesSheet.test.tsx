// @vitest-environment jsdom
/**
 * Component tests for the web `PublishOpenChoicesSheet`: publishing with lines that have no food yet is allowed (R23),
 * and the sheet says what happens (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): the open
 * lines are saved as written and do not count toward nutrition, a line still being checked is saved as written too, and
 * nutrition then reads "4 of 9 counted". Choose now and Publish anyway are the two ways on; closing does neither.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type FC } from 'react';

import { PublishOpenChoicesSheet } from '../PublishOpenChoicesSheet.js';

afterEach(cleanup);

const FACTS = {
    openNames: ['Milk', 'day-old bread', 'salt', 'Grandma’s spice mix'],
    checkingNames: ['Heavy cream'],
    counted: 4,
    total: 9,
} as const;

function renderSheet(facts: Parameters<typeof PublishOpenChoicesSheet>[0]['facts'] = FACTS, open = true) {
    const handlers = { onChooseNow: vi.fn(), onPublishAnyway: vi.fn(), onOpenChange: vi.fn() };

    render(<PublishOpenChoicesSheet open={open} facts={facts} {...handlers} />);

    return handlers;
}

describe('PublishOpenChoicesSheet (web)', () => {
    it('is titled with how many ingredients have no food yet', () => {
        renderSheet();

        expect(screen.getByRole('heading', { name: '4 ingredients have no food yet' })).toBeTruthy();
    });

    it('names the open lines, says they are saved as written, and that they do not count toward nutrition', () => {
        renderSheet();

        expect(
            screen.getByText(
                /We’ll save Milk, day-old bread, salt, and Grandma’s spice mix as written\. They don’t count toward nutrition/,
            ),
        ).toBeTruthy();
    });

    it('names a line still being checked', () => {
        renderSheet();

        expect(
            screen.getByText('We’re still checking Heavy cream. If you publish now, it is saved as written too.'),
        ).toBeTruthy();
    });

    it('with nothing being checked, says nothing about checking', () => {
        renderSheet({ ...FACTS, checkingNames: [] });

        expect(screen.queryByText(/being checked/)).toBeNull();
    });

    it('says how many lines count toward nutrition', () => {
        renderSheet();

        expect(
            screen.getByText('You can choose later from each ingredient’s menu. Nutrition reads “4 of 9 counted”.'),
        ).toBeTruthy();
    });

    /**
     * REWRITTEN (browser finding, `pastePublishOpenChoices.spec.ts`): Choose now used to call `onChooseNow` on the press,
     * while the sheet was still on screen. The host opened the first open line and asked it for focus, and then the sheet's
     * close handed focus back to its opener (Publish), so the cook was dropped on Publish instead of on the line. The
     * hand-off now waits for `onDismissed`, when the sheet is gone and focus is back on the opener, so the line's focus
     * request is the last word. Mutation lens: call `onChooseNow` from the press again and the order assertion fails.
     */
    it('Choose now closes the sheet first, then goes back to choose once it is gone, and does not publish', async () => {
        const seen: { dialog: HTMLElement | null }[] = [];
        const onChooseNow = vi.fn(() => seen.push({ dialog: screen.queryByRole('dialog') }));
        const onPublishAnyway = vi.fn();

        const Host: FC = () => {
            const [open, setOpen] = useState(true);

            return (
                <PublishOpenChoicesSheet
                    open={open}
                    facts={FACTS}
                    onChooseNow={onChooseNow}
                    onPublishAnyway={onPublishAnyway}
                    onOpenChange={setOpen}
                />
            );
        };

        render(<Host />);
        fireEvent.click(screen.getByRole('button', { name: 'Choose now' }));

        await waitFor(() => expect(onChooseNow).toHaveBeenCalledTimes(1));
        expect(seen).toEqual([{ dialog: null }]);
        expect(onPublishAnyway).not.toHaveBeenCalled();
    });

    it('closing another way does not go back to choose', async () => {
        const onChooseNow = vi.fn();

        const Host: FC = () => {
            const [open, setOpen] = useState(true);

            return (
                <PublishOpenChoicesSheet
                    open={open}
                    facts={FACTS}
                    onChooseNow={onChooseNow}
                    onPublishAnyway={vi.fn()}
                    onOpenChange={setOpen}
                />
            );
        };

        render(<Host />);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(onChooseNow).not.toHaveBeenCalled();
    });

    it('Publish anyway publishes', () => {
        const { onChooseNow, onPublishAnyway } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Publish anyway' }));

        expect(onPublishAnyway).toHaveBeenCalledTimes(1);
        expect(onChooseNow).not.toHaveBeenCalled();
    });

    it('Close only closes', () => {
        const { onOpenChange, onPublishAnyway, onChooseNow } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(onPublishAnyway).not.toHaveBeenCalled();
        expect(onChooseNow).not.toHaveBeenCalled();
    });

    it('closed, it shows nothing', () => {
        renderSheet(FACTS, false);

        expect(screen.queryByRole('heading', { name: '4 ingredients have no food yet' })).toBeNull();
    });

    // U11: at narrow the two stack with the PRIMARY LAST, nearest the thumb, in visual and Tab order alike; from the
    // `nav` width they share a row. They were a fixed two-column grid.
    it('stacks Choose now then Publish anyway at narrow, the primary last, and shares a row from the nav width', () => {
        renderSheet();

        const chooseNow = screen.getByRole('button', { name: 'Choose now' });
        const publish = screen.getByRole('button', { name: 'Publish anyway' });
        const footer = chooseNow.closest('div.flex');

        expect(chooseNow.compareDocumentPosition(publish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(footer?.className.split(' ')).toEqual(expect.arrayContaining(['flex-col', 'nav:flex-row']));
        expect(footer?.className).not.toContain('reverse');
    });
});
