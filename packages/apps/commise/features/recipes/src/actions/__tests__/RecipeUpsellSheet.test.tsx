// @vitest-environment jsdom
/**
 * The Premium sheet a free-tier cook gets for "Private" in the editor (E1; build spec §7.7 item 2, §6.4): "Private
 * recipes are part of Premium.", **See Premium** and **Not now**, equal in size and weight, side by side, nothing
 * pre-selected — true, and not a distortion of the choice (DSA Art. 25). The twin of `CollectionUpsellSheet`.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecipeUpsellSheetProps } from '../model.js';
import { RecipeUpsellSheet } from '../RecipeUpsellSheet.js';

afterEach(cleanup);

function upsell(over: Partial<RecipeUpsellSheetProps> = {}) {
    const props: RecipeUpsellSheetProps = { open: true, onOpenChange: vi.fn(), onSeePremium: vi.fn(), ...over };

    render(
        <LocaleProvider locale="en">
            <RecipeUpsellSheet {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('RecipeUpsellSheet (web)', () => {
    it('is titled with the plain fact', () => {
        upsell();

        expect(screen.getByRole('dialog', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
    });

    it('says what stays free', () => {
        upsell();

        expect(screen.getByText(/Public recipes are free/u)).toBeTruthy();
    });

    it('offers See Premium and Not now as equals: the same tier, side by side, neither the primary', () => {
        upsell();
        const see = screen.getByRole('button', { name: 'See Premium' });
        const notNow = screen.getByRole('button', { name: 'Not now' });

        expect(see.className).toBe(notNow.className);
        expect(see.closest('.gap-3')).toBe(notNow.closest('.gap-3'));
    });

    it('reports See Premium, and closes from Not now', async () => {
        const user = userEvent.setup();
        const props = upsell();

        await user.click(screen.getByRole('button', { name: 'See Premium' }));
        expect(props.onSeePremium).toHaveBeenCalledOnce();

        await user.click(screen.getByRole('button', { name: 'Not now' }));
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('draws nothing while shut', () => {
        upsell({ open: false });

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
