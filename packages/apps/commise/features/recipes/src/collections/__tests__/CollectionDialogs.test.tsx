// @vitest-environment jsdom
/**
 * The two dialogs of a collection's detail (`docs/design/uiOverhaul/buildSpec.md` §5.2).
 *
 * Delete keeps a dialog because it cannot be undone: "Delete {name}?", "The {n} recipes stay in your library.", **Delete
 * collection** (filled error) and **Keep collection**, with focus opening on Keep. The Pro sheet is what a free-tier
 * cook gets for "Make private": "Private collections are part of Pro.", **See Pro** and **Not now**, equal in
 * size and weight, side by side, nothing pre-selected — true, and not a distortion of the choice (DSA Art. 25).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { CollectionDeleteDialog } from '../CollectionDeleteDialog.js';
import { CollectionUpsellSheet } from '../CollectionUpsellSheet.js';
import type { CollectionDeleteDialogProps, CollectionUpsellSheetProps } from '../detailModel.js';

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

function deleteDialog(over: Partial<CollectionDeleteDialogProps> = {}) {
    const props: CollectionDeleteDialogProps = {
        open: true,
        name: 'Weeknight Dinners',
        recipeCount: 6,
        busy: false,
        failed: false,
        onConfirm: vi.fn(),
        onKeep: vi.fn(),
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <CollectionDeleteDialog {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('CollectionDeleteDialog (web)', () => {
    it('names the collection and says the recipes stay', () => {
        deleteDialog();
        const dialog = screen.getByRole('alertdialog', { name: 'Delete Weeknight Dinners?' });

        expect(within(dialog).getByText('The 6 recipes stay in your library.')).toBeTruthy();
    });

    it('says “recipe” for one', () => {
        deleteDialog({ recipeCount: 1 });

        expect(screen.getByText('The 1 recipe stays in your library.')).toBeTruthy();
    });

    it('opens on Keep collection, so the safe choice is under the cook’s thumb', () => {
        deleteDialog();

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep collection' }));
    });

    it('deletes from Delete collection and keeps from Keep collection', async () => {
        const user = userEvent.setup();
        const props = deleteDialog();

        await user.click(screen.getByRole('button', { name: 'Delete collection' }));
        expect(props.onConfirm).toHaveBeenCalledOnce();
        expect(props.onKeep).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Keep collection' }));
        expect(props.onKeep).toHaveBeenCalledOnce();
    });

    it('keeps the collection on Escape', async () => {
        const user = userEvent.setup();
        const props = deleteDialog();

        await user.keyboard('{Escape}');

        expect(props.onKeep).toHaveBeenCalledOnce();
        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it('says a failed delete, and stays open', () => {
        deleteDialog({ failed: true });

        expect(screen.getByText('We couldn’t delete this collection. Try again.')).toBeTruthy();
        expect(screen.getByRole('alertdialog')).toBeTruthy();
    });

    it('draws nothing while shut', () => {
        deleteDialog({ open: false });

        expect(screen.queryByRole('alertdialog')).toBeNull();
    });
});

function upsell(over: Partial<CollectionUpsellSheetProps> = {}) {
    const props: CollectionUpsellSheetProps = { open: true, onOpenChange: vi.fn(), onSeePremium: vi.fn(), ...over };

    render(
        <LocaleProvider locale="en">
            <CollectionUpsellSheet {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('CollectionUpsellSheet (web)', () => {
    it('is titled with the plain fact', () => {
        upsell();

        expect(screen.getByRole('dialog', { name: 'Private collections are part of Pro.' })).toBeTruthy();
    });

    it('offers See Pro and Not now as equals: the same tier, side by side, neither the primary', () => {
        entryPoints.on = true;
        upsell();
        const see = screen.getByRole('button', { name: 'See Pro' });
        const notNow = screen.getByRole('button', { name: 'Not now' });

        expect(see.className).toBe(notNow.className);
        // One row: both sit in the same footer, as siblings of equal share.
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
