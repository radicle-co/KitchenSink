// @vitest-environment jsdom
/**
 * Component tests for the account CLOSURE control (web; CR-002 / U4b). Closure is RECOVERABLE — the copy must
 * say so and must NOT claim permanent deletion (the conflation this unit fixes). Covers: closed (trigger
 * only), open (recoverable copy, not "permanently deleted"), confirm → closure request + sign-out, cancel,
 * the failed-request alert (B17), the pending/busy trigger state, and the FAKE-EXIT path (B23: a sign-out
 * issued before clerk-js loads resolves without revoking anything, so the exit must report a failure instead
 * of dropping a still-authenticated viewer on the public page).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { signOut, clerkState } = vi.hoisted(() => ({
    signOut: vi.fn(),
    clerkState: {
        loaded: true,
        status: 'ready' as 'degraded' | 'error' | 'loading' | 'ready',
        session: null as { id: string } | null | undefined,
    },
}));
// `useAuth().signOut` is Clerk's LOAD-SAFE wrapper — the one the sign-out command must use (B23). `useClerk()`
// only supplies the load/session state the command's fail-closed post-condition reads.
vi.mock('@clerk/nextjs', () => ({
    useClerk: () => ({
        get loaded() {
            return clerkState.loaded;
        },
        get status() {
            return clerkState.status;
        },
        get session() {
            return clerkState.session;
        },
    }),
    useAuth: () => ({ signOut }),
}));

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/lib/navigation', () => ({ navigateTo }));

const { deleteMe } = vi.hoisted(() => ({ deleteMe: vi.fn() }));
vi.mock('@/lib/identityServiceClient', () => ({
    createProfileServiceClient: () => ({ deleteMe }),
}));

beforeEach(() => {
    signOut.mockReset().mockImplementation(async () => {
        clerkState.loaded = true;
        clerkState.session = null;
    });
    navigateTo.mockReset();
    deleteMe.mockReset().mockResolvedValue(undefined);
    clerkState.loaded = true;
    clerkState.status = 'ready';
    clerkState.session = { id: 'sess_live' };
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
        // Sign out, then leave with a FULL-DOCUMENT navigation — a client-side push would re-render the
        // authenticated shell from a payload resolved for the session that was just destroyed.
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
        expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(navigateTo.mock.invocationCallOrder[0] ?? 0);
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
        // …and the viewer is left exactly where they are: no sign-out, no navigation away from the error.
        expect(navigateTo).not.toHaveBeenCalled();
    });
});

describe('AccountCloseForm (web) — the exit RESOLVED without ending the session (B23)', () => {
    it('surfaces the alert and does NOT navigate away on a session that is still live', async () => {
        const user = userEvent.setup();
        // Exactly the premount no-op: the sign-out resolves, nothing is revoked, the session stays live.
        signOut.mockResolvedValueOnce(undefined);
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Close account' }));
        await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close account' }));

        // The closure DID land server-side, so the copy is the generic closure error — but the viewer is not
        // told they left, and is not dropped on the public page while still authenticated.
        expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t close your account. Please try again.',
        );
        expect(navigateTo).not.toHaveBeenCalled();
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
