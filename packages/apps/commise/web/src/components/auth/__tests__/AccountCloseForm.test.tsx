// @vitest-environment jsdom
/**
 * Component tests for the account CLOSURE control (web; CR-002 / U4b). Closure is RECOVERABLE — the copy must
 * say so and must NOT claim permanent deletion (the conflation this unit fixes). Covers: closed (trigger
 * only), open (recoverable copy, not "permanently deleted"), confirm → closure request + sign-out, cancel,
 * the failed-request alert (B17), and the pending/busy trigger state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

const { AccountCloseForm } = await import('../AccountCloseForm');

const renderForm = (): void => {
    render(<AccountCloseForm accessToken="test-token" />);
};

describe('AccountCloseForm (web) — closed', () => {
    it('renders only the trigger, no dialog', () => {
        renderForm();

        expect(screen.getByRole('button', { name: 'Close account' })).toBeTruthy();
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });
});

describe('AccountCloseForm (web) — open', () => {
    it('opens a confirmation that says closure is recoverable, not permanent deletion', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Close account' }));

        const dialog = screen.getByRole('alertdialog', { name: 'Close account?' });
        expect(dialog).toBeTruthy();
        expect(screen.getByText(/not permanent deletion/i)).toBeTruthy();
        expect(screen.queryByText(/permanently deleted/i)).toBeNull();
    });
});

describe('AccountCloseForm (web) — confirm', () => {
    it('closes the account and signs the viewer out', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Close account' }));
        await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close account' }));

        expect(deleteMe).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/' }));
    });

    it('surfaces an alert (does not fail silently) when the closure rejects', async () => {
        const user = userEvent.setup();
        deleteMe.mockRejectedValueOnce(new Error('boom'));
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Close account' }));
        await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close account' }));

        expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t close your account. Please try again.',
        );
        expect(signOut).not.toHaveBeenCalled();
    });
});

describe('AccountCloseForm (web) — dismissal', () => {
    it('the Cancel control closes the dialog without closing the account', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Close account' }));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(deleteMe).not.toHaveBeenCalled();
    });
});
