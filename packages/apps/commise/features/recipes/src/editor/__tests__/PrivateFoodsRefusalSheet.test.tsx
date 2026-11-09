// @vitest-environment jsdom
/**
 * Component tests for the web `PrivateFoodsRefusalSheet` (private foods spec section 7, states 15 and 16): the count and
 * the lines, "Open food" named for the line and for the new tab, the ways forward per cook (Pro or a free slot; none left)
 * and no upsell for a cook who cannot go private. Every close route means "back to editor"; only the primary action of a
 * cook who can go private sends again as private.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrivateFoodsRefusalSheet } from '../PrivateFoodsRefusalSheet.js';
import type { PrivateFoodsRefusalSheetProps } from '../privateFoodsRefusalSheetProps.js';

afterEach(cleanup);

const LINES = [
    { rowId: 'a', foodId: 'f1', amount: '1 cup', words: 'Oat milk' },
    { rowId: 'b', foodId: 'f2', amount: '2 tbsp', words: 'My spice mix' },
];

function renderSheet(props: Partial<PrivateFoodsRefusalSheetProps> = {}) {
    const handlers = { onOpenFood: vi.fn(), onSendAsPrivate: vi.fn(), onClose: vi.fn() };

    render(<PrivateFoodsRefusalSheet open door="publish" canGoPrivate lines={LINES} {...handlers} {...props} />);

    return handlers;
}

describe('PrivateFoodsRefusalSheet (web)', () => {
    it('is a dialog titled for the refusal, with the plural why and every refused line', () => {
        renderSheet();
        const dialog = screen.getByRole('dialog', { name: 'This recipe can’t be public yet' });

        expect(within(dialog).getByText(/^2 ingredients use foods only you can see\./u)).toBeTruthy();
        expect(within(dialog).getByText('Oat milk')).toBeTruthy();
        expect(within(dialog).getByText('My spice mix')).toBeTruthy();
    });

    it('says "ingredient uses" for one line', () => {
        renderSheet({ lines: [LINES[0]!] });

        expect(screen.getByText(/^1 ingredient uses a food only you can see\./u)).toBeTruthy();
    });

    it('each line has its own Open food button, named for that line and for the new tab, calling with that food', async () => {
        const { onOpenFood } = renderSheet();

        await userEvent.click(screen.getByRole('button', { name: 'Open 2 tbsp My spice mix in a new tab' }));
        expect(onOpenFood).toHaveBeenCalledExactlyOnceWith('f2');
        expect(screen.getByText('Each food opens in a new tab, so your recipe stays here.')).toBeTruthy();
    });

    it('a cook who can go private at Publish: three ways, Publish as private (primary) and Back to editor', async () => {
        const { onSendAsPrivate, onClose } = renderSheet();

        expect(screen.getByText('Or publish this recipe as private.')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Publish as private' }));
        expect(onSendAsPrivate).toHaveBeenCalledOnce();
        await userEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('at Save changes the action says both halves: Make private and save', () => {
        renderSheet({ door: 'save' });

        expect(screen.getByRole('button', { name: 'Make private and save' })).toBeTruthy();
        expect(screen.getByText(/Or make this recipe private\./u)).toBeTruthy();
    });

    it('⛔ a cook with no private slot sees the ways that work, one slots line, the draft note and no upsell', async () => {
        const { onClose, onSendAsPrivate } = renderSheet({ canGoPrivate: false });

        expect(screen.queryByText(/Or publish this recipe as private/u)).toBeNull();
        expect(screen.queryByRole('button', { name: /private/iu })).toBeNull();
        expect(screen.getByText(/Your private recipes are full/u)).toBeTruthy();
        expect(screen.getByText('Your recipe is saved as a draft.')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/Pro\b|upgrade|subscribe|premium/iu);
        await userEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
        expect(onClose).toHaveBeenCalledOnce();
        expect(onSendAsPrivate).not.toHaveBeenCalled();
    });

    it('at Make public or Restore the only action is Close, and no private way is listed', () => {
        renderSheet({ door: 'makePublic' });

        expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Back to editor' })).toBeNull();
        expect(screen.queryByText(/as private|make this recipe private/iu)).toBeNull();
    });

    it('Escape closes the sheet as Back to editor, and never sends', async () => {
        const { onClose, onSendAsPrivate } = renderSheet();

        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledOnce();
        expect(onSendAsPrivate).not.toHaveBeenCalled();
    });

    it('draws a line exactly as the editor row reads: the amount strong, an ordinary space, then the words', () => {
        renderSheet();
        const amount = screen.getByText('1 cup');

        expect(amount.className).toContain('font-semibold');
        expect(amount.parentElement?.textContent?.replaceAll('\u00a0', ' ')).toBe('1 cup Oat milk');
        // The words are not strong, and no amount draws no empty strong span (never an invented "1").
        expect(screen.getByText('My spice mix').className).not.toContain('font-semibold');
    });

    it('a line with no amount draws only its words', () => {
        renderSheet({ lines: [{ rowId: 'c', foodId: 'f3', amount: '', words: 'Pinch of salt' }] });

        expect(screen.getByText('Pinch of salt').querySelector('.font-semibold')).toBeNull();
    });
});
