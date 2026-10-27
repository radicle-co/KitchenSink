/**
 * The native Pro sheet a free-tier cook gets for "Private" in the editor (E1; build spec §7.7 item 2, §6.4): the
 * twin of `RecipeUpsellSheet.tsx` and of `CollectionUpsellSheet.native.tsx`. The plain fact, then **See Pro** and
 * **Not now** of equal weight, nothing pre-selected (DSA Art. 25).
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecipeUpsellSheetProps } from '../model.js';
import { RecipeUpsellSheet } from '../RecipeUpsellSheet.native.js';

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

describe('RecipeUpsellSheet (native)', () => {
    it('noSlot: is titled for a full set of slots and says how to free one', () => {
        upsell();

        expect(screen.getByRole('heading', { name: 'Keep more recipes private' })).toBeTruthy();
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

        expect(screen.getByRole('heading', { name: 'Private needs Pro for this recipe' })).toBeTruthy();
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

    it('offers See Pro and Not now as equals: the same tier, neither the primary', () => {
        entryPoints.on = true;
        upsell();

        expect(screen.getByRole('button', { name: 'See Pro' }).className).toBe(
            screen.getByRole('button', { name: 'Not now' }).className,
        );
    });

    it('reports See Pro, and closes from Not now', () => {
        entryPoints.on = true;
        const props = upsell();

        fireEvent.click(screen.getByRole('button', { name: 'See Pro' }));
        expect(props.onSeePremium).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
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

        expect(screen.queryByText('Not now')).toBeNull();
    });
});
