/**
 * The native dialogs of a collection's detail (`docs/design/uiOverhaul/buildSpec.md` §5.2).
 *
 * Delete keeps a dialog because it cannot be undone: "Delete {name}?", "The {n} recipes stay in your library.", **Delete
 * collection** (filled error) and **Keep collection**, with focus opening on Keep. The Premium sheet is what a free-tier
 * cook gets for "Make private": "Private collections are part of Premium.", **See Premium** and **Not now**, equal in
 * size and weight, side by side, nothing pre-selected — true, and not a distortion of the choice (DSA Art. 25).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { CollectionDeleteDialog } from '../CollectionDeleteDialog.native.js';
import { CollectionUpsellSheet } from '../CollectionUpsellSheet.native.js';
import type { CollectionDeleteDialogProps, CollectionUpsellSheetProps } from '../detailModel.js';

afterEach(cleanup);

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

describe('CollectionDeleteDialog (native)', () => {
    it('names the collection and says the recipes stay', () => {
        deleteDialog();

        expect(screen.getByText('Delete Weeknight Dinners?')).toBeTruthy();
        expect(screen.getByText('The 6 recipes stay in your library.')).toBeTruthy();
    });

    it('says “recipe” for one', () => {
        deleteDialog({ recipeCount: 1 });

        expect(screen.getByText('The 1 recipe stays in your library.')).toBeTruthy();
    });

    it('deletes from Delete collection and keeps from Keep collection', () => {
        const props = deleteDialog();

        fireEvent.click(screen.getByRole('button', { name: 'Delete collection' }));
        expect(props.onConfirm).toHaveBeenCalledOnce();
        expect(props.onKeep).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Keep collection' }));
        expect(props.onKeep).toHaveBeenCalledOnce();
    });

    it('says a failed delete, and stays open', () => {
        deleteDialog({ failed: true });

        expect(screen.getByText('We couldn’t delete this collection. Try again.')).toBeTruthy();
        expect(screen.getByText('Delete Weeknight Dinners?')).toBeTruthy();
    });

    it('draws nothing while shut', () => {
        deleteDialog({ open: false });

        expect(screen.queryByText('Delete Weeknight Dinners?')).toBeNull();
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

describe('CollectionUpsellSheet (native)', () => {
    it('is titled with the plain fact', () => {
        upsell();

        expect(screen.getByRole('heading', { name: 'Private collections are part of Premium.' })).toBeTruthy();
    });

    it('offers See Premium and Not now as equals: the same tier, side by side, neither the primary', () => {
        upsell();
        const see = screen.getByRole('button', { name: 'See Premium' });
        const notNow = screen.getByRole('button', { name: 'Not now' });

        expect(see.className).toBe(notNow.className);
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
