/**
 * The refusal a cook meets when a copy would be private and every private slot is in use (redesign canvas v44, board
 * `RecipeSaveCopyNoSlot`): the title, the plain fact with the server's limit, and either Not now + See Premium (paid
 * features shown) or one OK (paid features hidden, with no Premium sentence at all - DSA Art. 25).
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecipeSaveCopyNoSlotProps } from '../model.js';
import { RecipeSaveCopyNoSlot } from '../RecipeSaveCopyNoSlot.native.js';

afterEach(cleanup);

const WITH_PREMIUM =
    'This copy would be private, and all 50 of your private slots are in use. To free a slot, make a private recipe public or delete one. Premium has no limit.';
const WITHOUT_PREMIUM =
    'This copy would be private, and all 50 of your private slots are in use. To free a slot, make a private recipe public or delete one.';

function mount(over: Partial<RecipeSaveCopyNoSlotProps> = {}) {
    const onSeePremium = vi.fn();
    const props: RecipeSaveCopyNoSlotProps = {
        open: true,
        total: 50,
        offer: { kind: 'premium', onSeePremium },
        onClose: vi.fn(),
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <RecipeSaveCopyNoSlot {...props} />
        </LocaleProvider>,
    );

    return { props, onSeePremium };
}

describe('RecipeSaveCopyNoSlot (native) - paid features shown', () => {
    it('is titled for the case and states the fact with the server`s limit and the Premium sentence', () => {
        mount();

        expect(screen.getByRole('heading', { name: 'No private slot for this copy' })).toBeTruthy();
        expect(screen.getByText(WITH_PREMIUM)).toBeTruthy();
    });

    it('states the limit it was given, never a number of its own', () => {
        mount({ total: 75 });

        expect(screen.getByText(/all 75 of your private slots/u)).toBeTruthy();
    });

    it('offers Not now and See Premium, and no way to make the copy public', () => {
        mount();

        expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(
            expect.arrayContaining(['Not now', 'See Premium']),
        );
        expect(screen.queryByRole('button', { name: /public/iu })).toBeNull();
        expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    });

    it('reports See Premium, and closes from Not now', () => {
        const { props, onSeePremium } = mount();

        fireEvent.click(screen.getByRole('button', { name: 'See Premium' }));
        expect(onSeePremium).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(props.onClose).toHaveBeenCalledOnce();
    });
});

describe('RecipeSaveCopyNoSlot (native) - paid features hidden', () => {
    it('⛔ drops the Premium sentence and offers a single OK, with no Premium anywhere', () => {
        mount({ offer: { kind: 'none' } });

        expect(screen.getByText(WITHOUT_PREMIUM)).toBeTruthy();
        expect(screen.queryByText(/Premium/u)).toBeNull();
        expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    });

    it('OK closes it', () => {
        const { props } = mount({ offer: { kind: 'none' } });

        fireEvent.click(screen.getByRole('button', { name: 'OK' }));

        expect(props.onClose).toHaveBeenCalledOnce();
    });
});

describe('RecipeSaveCopyNoSlot (native) - shut', () => {
    it('draws nothing', () => {
        mount({ open: false });

        expect(screen.queryByText('No private slot for this copy')).toBeNull();
    });
});
