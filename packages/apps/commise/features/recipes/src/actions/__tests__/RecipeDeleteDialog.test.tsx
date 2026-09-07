// @vitest-environment jsdom
/**
 * Component tests for the web recipe delete-confirmation dialog (T068, converted to Radix `AlertDialog` per
 * B6/CR-003 — mirrors `PullUpdatesDialog`'s sibling-trigger focus-capture/restore, adapted to `alertdialog`).
 * Covers EVERY branch the mandate requires — closed (renders nothing), open (accessible alertdialog that
 * names the recipe), confirm/cancel interaction contracts, the deleting state (confirm disabled + busy, so a
 * second confirm can't fire), and the a11y machinery Radix now supplies for free: Escape-dismiss and
 * focus-return to the sibling trigger that opened it (the "Delete" control lives in the composing container,
 * NOT an owned `AlertDialog.Trigger`, so this pins the same explicit capture/restore contract as
 * `PullUpdatesDialog`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { buttonSurfaceClass } from '@commise/ui/button';

import { RecipeDeleteDialog } from '../RecipeDeleteDialog.js';
import type { RecipeDeleteDialogProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderDialog(overrides: Partial<RecipeDeleteDialogProps> = {}) {
    const props: RecipeDeleteDialogProps = {
        recipeTitle: 'Mediterranean Grilled Lamb',
        open: true,
        onConfirm: noop,
        onCancel: noop,
        ...overrides,
    };
    render(<RecipeDeleteDialog {...props} />);

    return props;
}

describe('RecipeDeleteDialog (web)', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('renders an accessible alertdialog when open', () => {
        renderDialog();

        const dialog = screen.getByRole('alertdialog', { name: 'Delete recipe' });
        expect(dialog).toBeTruthy();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
    });

    it('names the recipe being deleted', () => {
        renderDialog({ recipeTitle: 'Asparagus with Green Sauce' });

        expect(screen.getByText(/Asparagus with Green Sauce/)).toBeTruthy();
    });

    it('keeps a screen-edge gutter at base, restoring the original max width at md (U5)', () => {
        renderDialog();

        // A `w-full` centered dialog touches both screen edges at 360px; capping the base width at
        // `calc(100% - 2rem)` leaves a 1rem gutter each side, and `md:max-w-md` restores the original desktop
        // width — so the 1280px surface is byte-identical.
        const dialog = screen.getByRole('alertdialog', { name: 'Delete recipe' });
        expect(dialog.className).toContain('max-w-[calc(100%-2rem)]');
        expect(dialog.className).toContain('md:max-w-md');
    });

    it('reports confirm requests upward', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        await user.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('reports cancel requests upward', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        renderDialog({ onCancel });

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('disables the confirm action while deleting and does not fire again', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ deleting: true, onConfirm });

        const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' });
        expect(confirm.disabled).toBe(true);
        expect(confirm.getAttribute('aria-busy')).toBe('true');

        await user.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('surfaces a busy status while deleting', () => {
        renderDialog({ deleting: true });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.getByText('Deleting…')).toBeTruthy();
    });
});

describe('RecipeDeleteDialog (web) — delete error (B17: no silent stop)', () => {
    it('surfaces the failed-delete copy inside the dialog when error is set', () => {
        renderDialog({ error: true });

        expect(screen.getByRole('alert').textContent).toBe('We couldn\u2019t delete this recipe. Please try again.');
    });

    it('does not show the error while a delete is still in flight', () => {
        renderDialog({ error: true, deleting: true });

        expect(screen.queryByText(/couldn\u2019t delete/)).toBeNull();
    });

    it('shows no error when the last delete did not fail', () => {
        renderDialog({ error: false });

        expect(screen.queryByText(/couldn\u2019t delete/)).toBeNull();
    });
});

describe('RecipeDeleteDialog (web) \u2014 design-system controls', () => {
    it('renders the confirm as the DS destructive Button (idle: caller icon, no spinner)', () => {
        renderDialog({ deleting: false });
        const confirm = screen.getByRole('button', { name: 'Delete' });

        // Error-toned DS surface (not a hand-rolled `bg-error` pill) with the touch floor.
        expect(confirm.className).toContain('min-h-11');
        expect(confirm.className).toContain('error');
        // Idle \u21d2 no in-flight spinner.
        expect(screen.getByRole('alertdialog').querySelector('.animate-spin')).toBeNull();
    });

    it('swaps the confirm icon for the DS busy spinner while deleting (in place, label unchanged)', () => {
        renderDialog({ deleting: true });

        expect(screen.getByRole('alertdialog').querySelector('.animate-spin')).not.toBeNull();
        // The label \u2014 and therefore the accessible name \u2014 is unchanged, so name-based selection is stable.
        expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    it('drops the busy spinner again once the delete is no longer in flight', () => {
        renderDialog({ deleting: false, error: true });

        expect(screen.getByRole('alertdialog').querySelector('.animate-spin')).toBeNull();
    });

    it('gives the cancel control the DS secondary surface and the 44px touch floor', () => {
        renderDialog();
        const cancel = screen.getByRole('button', { name: 'Cancel' });

        // `AlertDialog.Cancel` owns its own element (Radix slot), so it applies the shared surface recipe.
        expect(cancel.className).toBe(buttonSurfaceClass('secondary'));
    });
});

describe('RecipeDeleteDialog (web) \u2014 Radix a11y machinery (B6/CR-003)', () => {
    it('Escape fires onCancel and returns focus to the sibling trigger that opened it', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();

        function Harness() {
            const [open, setOpen] = useState(false);

            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Delete
                    </button>
                    <RecipeDeleteDialog
                        recipeTitle="Mediterranean Grilled Lamb"
                        open={open}
                        onConfirm={() => undefined}
                        onCancel={() => {
                            onCancel();
                            setOpen(false);
                        }}
                    />
                </>
            );
        }

        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Delete' }));

        expect(screen.getByRole('alertdialog')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alertdialog')).toBeNull();

        // Radix's FocusScope restores focus via an unmount-cleanup `setTimeout(0)`
        // (`@radix-ui/react-focus-scope`) \u2014 a real macrotask, so this needs one real tick to elapse.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    });

    it('traps focus inside the dialog while open (Tab cannot reach a sibling control)', async () => {
        const user = userEvent.setup();

        function Harness() {
            const [open, setOpen] = useState(true);

            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Delete
                    </button>
                    <RecipeDeleteDialog
                        recipeTitle="Mediterranean Grilled Lamb"
                        open={open}
                        onConfirm={() => undefined}
                        onCancel={() => setOpen(false)}
                    />
                    <button type="button">Outside sibling</button>
                </>
            );
        }

        render(<Harness />);
        // Radix marks everything outside the dialog `aria-hidden` while trapped (via `hideOthers`), so the
        // sibling is intentionally unreachable through `getByRole` \u2014 look it up by text instead.
        const outside = screen.getByText('Outside sibling');

        // Cycle Tab a generous number of times \u2014 focus must never land on the outside sibling while trapped.
        for (let index = 0; index < 6; index += 1) {
            await user.tab();
            expect(document.activeElement).not.toBe(outside);
        }
    });
});
