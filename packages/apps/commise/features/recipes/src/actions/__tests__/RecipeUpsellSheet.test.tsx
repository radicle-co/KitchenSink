// @vitest-environment jsdom
/**
 * The Pro sheet a free-tier cook gets for "Private" in the editor (E1; build spec §7.7 item 2, §6.4): **See Pro** and **Not now**, equal in size and weight, side by side, nothing
 * pre-selected — true, and not a distortion of the choice (DSA Art. 25). The twin of `CollectionUpsellSheet`.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecipeUpsellSheetProps } from '../model.js';
import { RecipeUpsellSheet } from '../RecipeUpsellSheet.js';

/** The one subscription-entry-point switch (spec 010 T-035), flipped per test: it ships OFF. */
const entryPoints = vi.hoisted(() => ({ on: false }));

vi.mock('@commise/features-account/subscriptionEntryPoints', () => ({
    get SUBSCRIPTION_ENTRY_POINTS_ON() {
        return entryPoints.on;
    },
}));

afterEach(() => {
    cleanup();
    entryPoints.on = false;
});

function upsell(over: Partial<RecipeUpsellSheetProps> = {}) {
    const props: RecipeUpsellSheetProps = {
        open: true,
        variant: { kind: 'noSlot', total: 50 },
        onOpenChange: vi.fn(),
        onSeePremium: vi.fn(),
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <RecipeUpsellSheet {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('RecipeUpsellSheet (web)', () => {
    it('noSlot: is titled for a full set of slots and says how to free one', () => {
        upsell();

        expect(screen.getByRole('dialog', { name: 'Keep more recipes private' })).toBeTruthy();
        expect(
            screen.getByText(
                'All 50 of your private slots are in use. Pro has no limit. To free a slot, make a private recipe public or delete one.',
            ),
        ).toBeTruthy();
    });

    it('noSlot: states the limit the server gave, never a number of its own', () => {
        upsell({ variant: { kind: 'noSlot', total: 75 } });

        expect(screen.getByText(/^All 75 of your private slots are in use\./u)).toBeTruthy();
    });

    it('webImport: is titled for a recipe from a public web page', () => {
        upsell({ variant: { kind: 'webImport' } });

        expect(screen.getByRole('dialog', { name: 'Private needs Pro for this recipe' })).toBeTruthy();
        expect(
            screen.getByText(
                'This recipe is from a public web page. To keep it private, you need Pro and a change of your own to the recipe.',
            ),
        ).toBeTruthy();
    });

    it.each([{ kind: 'noSlot', total: 50 } as const, { kind: 'webImport' } as const])(
        '⛔ %o never uses the retired Pro lines',
        (variant) => {
            upsell({ variant });

            expect(screen.queryByText(/part of Pro/u)).toBeNull();
            expect(screen.queryByText(/keep a recipe to yourself/u)).toBeNull();
            expect(screen.queryByText(/Public recipes are free/u)).toBeNull();
        },
    );

    it('offers See Pro and Not now as equals: the same tier, side by side, neither the primary', () => {
        entryPoints.on = true;
        upsell();
        const see = screen.getByRole('button', { name: 'See Pro' });
        const notNow = screen.getByRole('button', { name: 'Not now' });

        expect(see.className).toBe(notNow.className);
        expect(see.closest('.gap-3')).toBe(notNow.closest('.gap-3'));
    });

    it('reports See Pro, and closes from Not now', async () => {
        entryPoints.on = true;
        const user = userEvent.setup();
        const props = upsell();

        await user.click(screen.getByRole('button', { name: 'See Pro' }));
        expect(props.onSeePremium).toHaveBeenCalledOnce();

        await user.click(screen.getByRole('button', { name: 'Not now' }));
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('⛔ switch off: states the fact and offers only a close control - no See Pro, no Pro link', () => {
        const props = upsell();

        expect(screen.queryByRole('button', { name: 'See Pro' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Not now' })).toHaveLength(1);
        expect(props.onSeePremium).not.toHaveBeenCalled();
    });

    it('draws nothing while shut', () => {
        upsell({ open: false });

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
