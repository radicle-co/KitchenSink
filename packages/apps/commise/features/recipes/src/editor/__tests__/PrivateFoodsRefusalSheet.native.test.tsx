//
/**
 * Component tests for the native `PrivateFoodsRefusalSheet` (private foods spec section 7, states 15 and 16): the count and
 * the lines, "Open food" named for the line and for the new tab, the ways forward per cook (Pro or a free slot; none left)
 * and no upsell for a cook who cannot go private. Every close route means "back to editor"; only the primary action of a
 * cook who can go private sends again as private.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '@commise/ui/testing/tamagui';

import { PrivateFoodsRefusalSheet } from '../PrivateFoodsRefusalSheet.native.js';
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

describe('PrivateFoodsRefusalSheet (native)', () => {
    it('is titled for the refusal, with the plural why and every refused line', () => {
        renderSheet();
        expect(screen.getByText('This recipe can’t be public yet')).toBeTruthy();
        const dialog = document.body;

        expect(within(dialog).getByText(/^2 ingredients use foods only you can see\./u)).toBeTruthy();
        expect(within(dialog).getByText('Oat milk', { exact: false })).toBeTruthy();
        expect(within(dialog).getByText('My spice mix', { exact: false })).toBeTruthy();
    });

    it('says "ingredient uses" for one line', () => {
        renderSheet({ lines: [LINES[0]!] });

        expect(screen.getByText(/^1 ingredient uses a food only you can see\./u)).toBeTruthy();
    });

    it('each line has its own Open food button, named for that line, calling with that food', () => {
        const { onOpenFood } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Open 2 tbsp My spice mix' }));
        expect(onOpenFood).toHaveBeenCalledExactlyOnceWith('f2');
        expect(screen.queryByText(/new tab/u)).toBeNull();
    });

    it('a cook who can go private at Publish: three ways, Publish as private (primary) and Back to editor', () => {
        const { onSendAsPrivate, onClose } = renderSheet();

        expect(screen.getByText('Or publish this recipe as private.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Publish as private' }));
        expect(onSendAsPrivate).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('at Save changes the action says both halves: Make private and save', () => {
        renderSheet({ door: 'save' });

        expect(screen.getByRole('button', { name: 'Make private and save' })).toBeTruthy();
        expect(screen.getByText(/Or make this recipe private\./u)).toBeTruthy();
    });

    it('⛔ a cook with no private slot sees the ways that work, one slots line, the draft note and no upsell', () => {
        const { onClose, onSendAsPrivate } = renderSheet({ canGoPrivate: false });

        expect(screen.queryByText(/Or publish this recipe as private/u)).toBeNull();
        expect(screen.queryByRole('button', { name: /private/iu })).toBeNull();
        expect(screen.getByText(/Your private recipes are full/u)).toBeTruthy();
        expect(screen.getByText('Your recipe is saved as a draft.')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/Pro\b|upgrade|subscribe|premium/iu);
        fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
        expect(onClose).toHaveBeenCalledOnce();
        expect(onSendAsPrivate).not.toHaveBeenCalled();
    });

    it('at Make public or Restore the only action is Close, and no private way is listed', () => {
        renderSheet({ door: 'makePublic' });

        expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Back to editor' })).toBeNull();
        expect(screen.queryByText(/as private|make this recipe private/iu)).toBeNull();
    });

    it('draws the amount as its own strong run before the words, as the editor row does', () => {
        renderSheet();

        expect(screen.getByText('1 cup')).toBeTruthy();
        expect(screen.getByText('1 cup').parentElement?.textContent?.replaceAll('\u00a0', ' ')).toBe('1 cup Oat milk');
    });
});
