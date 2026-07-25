// @vitest-environment jsdom
/**
 * Component tests for the account-deletion confirmation control (web), converted to Radix `Dialog` per
 * B6/CR-003. The "Delete Account" control is a genuinely OWNED `Dialog.Trigger` here (it stays mounted the
 * whole time — Radix toggles the modal `Content` over it, not the trigger's own presence), so — unlike
 * `PullUpdatesDialog`/`RecipeDeleteDialog`/`SubscriptionNudge`, whose openers are siblings elsewhere in the
 * tree — Radix's OWN default `onCloseAutoFocus` already restores focus correctly with no manual
 * capture/restore needed. Covers: closed (no dialog), open (accessible, named, alertdialog-strength
 * confirmation), confirm → delete + sign-out, cancel, Escape (both close AND return focus to the trigger),
 * the pending/busy confirm state, and a failed delete surfacing an alert without silently dropping the user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut }) }));

const { deleteMe } = vi.hoisted(() => ({ deleteMe: vi.fn() }));
vi.mock('@/lib/identityServiceClient', () => ({
    createProfileServiceClient: () => ({ deleteMe }),
}));

beforeEach(() => {
    signOut.mockReset().mockResolvedValue(undefined);
    deleteMe.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

const { AccountDeleteForm } = await import('../AccountDeleteForm');

const renderForm = (): void => {
    render(<AccountDeleteForm accessToken="test-token" userId="user_1" />);
};

describe('AccountDeleteForm (web) — closed', () => {
    it('renders only the trigger, no dialog', () => {
        renderForm();

        expect(screen.getByRole('button', { name: 'Delete your account' })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('AccountDeleteForm (web) — open', () => {
    it('opens an accessible, named confirmation dialog when the trigger is activated', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Delete your account' }));

        const dialog = screen.getByRole('dialog', { name: 'Confirm Account Deletion' });
        expect(dialog).toBeTruthy();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(
            screen.getByText('This action cannot be undone. All your data will be permanently deleted.'),
        ).toBeTruthy();
    });
});

describe('AccountDeleteForm (web) — confirm', () => {
    it('confirming deletes the account and signs the viewer out', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Delete your account' }));
        await user.click(screen.getByRole('button', { name: 'Confirm Deletion' }));

        expect(deleteMe).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/' }));
    });

    it('disables and marks the confirm action busy while the delete is in flight', async () => {
        const user = userEvent.setup();
        let resolveDelete: () => void = () => undefined;
        deleteMe.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveDelete = resolve;
                }),
        );
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Delete your account' }));
        await user.click(screen.getByRole('button', { name: 'Confirm Deletion' }));

        const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Deleting...' });
        expect(confirm.disabled).toBe(true);
        expect(confirm.getAttribute('aria-busy')).toBe('true');

        resolveDelete();
        await vi.waitFor(() => expect(signOut).toHaveBeenCalled());
    });

    it('surfaces an alert (does not fail silently) when the delete rejects', async () => {
        const user = userEvent.setup();
        deleteMe.mockRejectedValueOnce(new Error('boom'));
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Delete your account' }));
        await user.click(screen.getByRole('button', { name: 'Confirm Deletion' }));

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'boom');
        expect(signOut).not.toHaveBeenCalled();
    });
});

describe('AccountDeleteForm (web) — dismissal', () => {
    it('the explicit Cancel control closes the dialog and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        renderForm();

        const trigger = screen.getByRole('button', { name: 'Delete your account' });
        await user.click(trigger);
        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(trigger);
    });

    it('Escape closes the dialog and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        renderForm();

        const trigger = screen.getByRole('button', { name: 'Delete your account' });
        await user.click(trigger);
        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).toBeNull();
        // Radix's FocusScope restores focus via an unmount-cleanup `setTimeout(0)` — a real macrotask.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(trigger);
    });
});
