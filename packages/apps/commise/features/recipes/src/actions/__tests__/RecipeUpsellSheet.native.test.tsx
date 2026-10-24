/**
 * The native Premium sheet a free-tier cook gets for "Private" in the editor (E1; build spec §7.7 item 2, §6.4): the
 * twin of `RecipeUpsellSheet.tsx` and of `CollectionUpsellSheet.native.tsx`. The plain fact, then **See Premium** and
 * **Not now** of equal weight, nothing pre-selected (DSA Art. 25).
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecipeUpsellSheetProps } from '../model.js';
import { RecipeUpsellSheet } from '../RecipeUpsellSheet.native.js';

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

describe('RecipeUpsellSheet (native)', () => {
    it('is titled with the plain fact', () => {
        upsell();

        expect(screen.getByRole('heading', { name: 'Private recipes are part of Premium.' })).toBeTruthy();
    });

    it('says what stays free', () => {
        upsell();

        expect(screen.getByText(/Public recipes are free/u)).toBeTruthy();
    });

    it('offers See Premium and Not now as equals: the same tier, neither the primary', () => {
        upsell();

        expect(screen.getByRole('button', { name: 'See Premium' }).className).toBe(
            screen.getByRole('button', { name: 'Not now' }).className,
        );
    });

    it('reports See Premium, and closes from Not now', () => {
        const props = upsell();

        fireEvent.click(screen.getByRole('button', { name: 'See Premium' }));
        expect(props.onSeePremium).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('draws nothing while shut', () => {
        upsell({ open: false });

        expect(screen.queryByText('Not now')).toBeNull();
    });
});
