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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { signOut, getToken, clerkState } = vi.hoisted(() => ({
    signOut: vi.fn(),
    getToken: vi.fn(),
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
    useAuth: () => ({ signOut, getToken }),
}));

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/lib/navigation', () => ({ navigateTo }));

const { deleteMe, tokenSources } = vi.hoisted(() => ({ deleteMe: vi.fn(), tokenSources: [] as unknown[] }));
vi.mock('@/lib/identityServiceClient', () => ({
    createProfileServiceClient: (token: unknown) => {
        tokenSources.push(token);

        return { deleteMe };
    },
}));

beforeEach(() => {
    signOut.mockReset().mockImplementation(async () => {
        clerkState.loaded = true;
        clerkState.session = null;
    });
    navigateTo.mockReset();
    deleteMe.mockReset().mockResolvedValue(undefined);
    getToken.mockReset().mockResolvedValue('fresh-token');
    tokenSources.length = 0;
    clerkState.loaded = true;
    clerkState.status = 'ready';
    clerkState.session = { id: 'sess_live' };
});

afterEach(cleanup);

const { AccountCloseForm } = await import('../AccountCloseForm');

/** The closure is a TanStack mutation (`useClosureSequence`), so the form needs the app's query client above it. */
const renderForm = () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

    return render(
        <QueryClientProvider client={queryClient}>
            <AccountCloseForm />
        </QueryClientProvider>,
    );
};

describe('AccountCloseForm (web) — closed', () => {
    it('renders only the trigger, no dialog', () => {
        renderForm();

        expect(screen.getByRole('button', { name: 'Close account' })).toBeTruthy();
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });
});

describe('AccountCloseForm (web) — the Profile row', () => {
    it('is a danger-toned row that names the action and describes what it does', () => {
        renderForm();

        const row = screen.getByRole('button', { name: 'Close account' });
        const described = (row.getAttribute('aria-describedby') ?? '').split(' ');

        expect(row.className).toContain('text-danger-text');
        expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
            'Signs you out and deactivates your account. Support can restore it.',
        ]);
    });
});

describe('AccountCloseForm (web) — the bearer token', () => {
    it('mints it at the moment of closing, never from a copy captured at render (a session token lives about a minute)', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(screen.getByRole('button', { name: 'Close account' }));
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close account' }));

        const source = tokenSources.at(-1);

        expect(typeof source).toBe('function');
        await expect((source as () => Promise<string>)()).resolves.toBe('fresh-token');
        expect(getToken).toHaveBeenCalled();
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

const CLOSED_ALERT = 'Your account is closed, but we couldn’t sign you out. Sign out to finish leaving this account.';

/** Press the row and confirm the dialog. */
async function closeAccount(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: 'Close account' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close account' }));
}

describe('AccountCloseForm (web) — closing', () => {
    it('reads "Closing…" and is busy until the sign-out has finished, not only the close request', async () => {
        const user = userEvent.setup();
        let finishSignOut!: () => void;
        signOut.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSignOut = () => {
                        clerkState.session = null;
                        resolve();
                    };
                }),
        );
        renderForm();

        await closeAccount(user);

        const busy = await screen.findByRole('button', { name: 'Closing…' });
        await vi.waitFor(() => expect(signOut).toHaveBeenCalled());
        expect(busy.getAttribute('aria-busy')).toBe('true');
        finishSignOut();
        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
    });

    it('finishes the sign-out when the control UNMOUNTS while the close request is in flight', async () => {
        const user = userEvent.setup();
        let finishClose!: () => void;
        deleteMe.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishClose = resolve;
                }),
        );
        const { unmount } = renderForm();

        await closeAccount(user);
        await vi.waitFor(() => expect(deleteMe).toHaveBeenCalled());
        unmount();
        finishClose();

        await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
    });

    it('returns to the idle row after a failed close, and pressing it retries the close', async () => {
        const user = userEvent.setup();
        deleteMe.mockRejectedValueOnce(new Error('boom'));
        renderForm();

        await closeAccount(user);
        await screen.findByRole('alert');
        await closeAccount(user);

        await vi.waitFor(() => expect(deleteMe).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
    });
});

describe('AccountCloseForm (web) — the account IS closed but the sign-out failed (buildSpec §9.1)', () => {
    /** Exactly the premount no-op: the sign-out resolves, nothing is revoked, the session stays live (B23). */
    async function arriveAtExitFailure(): Promise<ReturnType<typeof userEvent.setup>> {
        const user = userEvent.setup();
        signOut.mockResolvedValueOnce(undefined);
        renderForm();

        await closeAccount(user);
        await screen.findByText(CLOSED_ALERT);

        return user;
    }

    it('says the account is closed, never "we couldn’t close your account", and does not navigate away', async () => {
        await arriveAtExitFailure();

        expect(screen.getByRole('alert').textContent).toBe(CLOSED_ALERT);
        expect(screen.queryByText('We couldn’t close your account. Please try again.')).toBeNull();
        expect(navigateTo).not.toHaveBeenCalled();
    });

    it('turns the row into an inert "Account closed" fact that cannot call close again', async () => {
        const user = await arriveAtExitFailure();

        const row = screen.getByRole('button', { name: 'Account closed' });

        expect(row.getAttribute('aria-disabled')).toBe('true');
        expect(row.hasAttribute('aria-busy')).toBe(false);
        expect(row.querySelector('svg')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Close account' })).toBeNull();

        await user.click(row);

        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(deleteMe).toHaveBeenCalledTimes(1);
    });

    it('offers the sign-out control, and a retry that succeeds leaves the app', async () => {
        const user = await arriveAtExitFailure();

        await user.click(screen.getByRole('button', { name: 'Sign out' }));

        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
        expect(deleteMe).toHaveBeenCalledTimes(1);
    });

    it('keeps the closed alert and adds the sign-out failure when the retry fails too', async () => {
        const user = await arriveAtExitFailure();
        signOut.mockResolvedValueOnce(undefined);

        await user.click(screen.getByRole('button', { name: 'Sign out' }));

        expect(await screen.findByText('We couldn’t sign you out. Try again.')).toBeTruthy();
        expect(screen.getByText(CLOSED_ALERT)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Account closed' })).toBeTruthy();
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
