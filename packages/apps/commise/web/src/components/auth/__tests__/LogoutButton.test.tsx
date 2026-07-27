// @vitest-environment jsdom
/**
 * State tests for the sign-out control (U3): it renders the localized label as a design-system Button, an
 * explicit child overrides the label, and activating it signs the viewer out and LEAVES the app with a
 * full-document navigation — the same ordering the account close/erase flows were fixed to (a router-level
 * `signOut({ redirectUrl })` re-renders the authenticated shell from a payload resolved for the session that
 * was just destroyed, stranding the viewer on a surface they can no longer use). Also covers the failure path:
 * a rejected sign-out must surface an alert and release the busy state, never spin forever (B17). And the two
 * B23 states: a sign-out that RESOLVES without ending the session (the premount no-op) must surface that same
 * alert rather than march the viewer to the public page, and a Clerk that failed to load must not hang the
 * control.
 *
 * Clerk, basePath, and the navigation seam are mocked at the module boundary; copy resolves via the real
 * LocaleProvider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@commise/test-utils';

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
vi.mock('@/lib/basePath', () => ({ withBasePath: (p: string) => p }));

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/lib/navigation', () => ({ navigateTo }));

const { LogoutButton } = await import('../LogoutButton');

beforeEach(() => {
    signOut.mockReset().mockImplementation(async () => {
        clerkState.loaded = true;
        clerkState.session = null;
    });
    navigateTo.mockReset();
    clerkState.loaded = true;
    clerkState.status = 'ready';
    clerkState.session = { id: 'sess_live' };
});

afterEach(cleanup);

describe('LogoutButton (U3)', () => {
    it('renders the localized default label as a button', () => {
        renderWithProviders(<LogoutButton />);

        expect(screen.getByRole('button', { name: 'Sign out of your account' })).toBeTruthy();
    });

    it('lets a consumer override the label', () => {
        renderWithProviders(<LogoutButton>Log out</LogoutButton>);

        expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    });

    it('shows the localized busy label while the sign-out is in flight', async () => {
        const user = userEvent.setup();
        let resolveSignOut: (() => void) | undefined;
        signOut.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveSignOut = resolve;
            }),
        );
        renderWithProviders(<LogoutButton />);

        await user.click(screen.getByRole('button', { name: 'Sign out of your account' }));

        const busy = await screen.findByRole('button', { name: 'Signing out…' });
        expect(busy).toHaveProperty('disabled', true);
        expect(busy.getAttribute('aria-busy')).toBe('true');

        resolveSignOut?.();
    });

    it('AWAITS the sign-out and THEN leaves with a full-document navigation to the basePath-prefixed home', async () => {
        const user = userEvent.setup();
        renderWithProviders(<LogoutButton />);

        await user.click(screen.getByRole('button', { name: 'Sign out of your account' }));

        // No router-level `redirectUrl`: Clerk's own redirect goes through the Next router, which re-renders
        // the AUTHENTICATED shell from a payload resolved for the destroyed session. Same defect the
        // close/erase flows were fixed for.
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
        expect(signOut).toHaveBeenCalledWith();
        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
        // Ordering is the whole point: session cookies gone BEFORE the document is replaced.
        expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(navigateTo.mock.invocationCallOrder[0] ?? 0);
    });

    it('surfaces an alert and releases the busy state when the sign-out fails (B17 — never spin forever)', async () => {
        const user = userEvent.setup();
        signOut.mockRejectedValueOnce(new Error('clerk unreachable'));
        renderWithProviders(<LogoutButton />);

        await user.click(screen.getByRole('button', { name: 'Sign out of your account' }));

        expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t sign you out. Please try again.',
        );
        // The control is usable again — a permanently-busy button is a dead end.
        expect(screen.getByRole('button', { name: 'Sign out of your account' })).toHaveProperty('disabled', false);
        // And the viewer was NOT navigated away on a session that may still be live.
        expect(navigateTo).not.toHaveBeenCalled();
    });

    describe('when the sign-out RESOLVES without ending the session (B23 — the fake sign-out)', () => {
        it('surfaces the alert and does NOT navigate, so the viewer is never told they left', async () => {
            const user = userEvent.setup();
            // Exactly the premount no-op: resolved, nothing revoked, session still live.
            signOut.mockResolvedValueOnce(undefined);
            renderWithProviders(<LogoutButton />);

            await user.click(screen.getByRole('button', { name: 'Sign out of your account' }));

            expect(await screen.findByRole('alert')).toHaveProperty(
                'textContent',
                'We couldn’t sign you out. Please try again.',
            );
            expect(navigateTo).not.toHaveBeenCalled();
            // Retryable, not a dead end.
            expect(screen.getByRole('button', { name: 'Sign out of your account' })).toHaveProperty('disabled', false);
        });
    });

    describe('when clerk-js failed to load (status "error")', () => {
        beforeEach(() => {
            clerkState.loaded = false;
            clerkState.status = 'error';
        });

        it('stays ACTIONABLE — a permanently disabled sign-out is a dead end', () => {
            renderWithProviders(<LogoutButton />);

            expect(screen.getByRole('button', { name: 'Sign out of your account' })).toHaveProperty('disabled', false);
        });

        it('surfaces the alert instead of hanging on a load that will never finish', async () => {
            const user = userEvent.setup();
            renderWithProviders(<LogoutButton />);

            await user.click(screen.getByRole('button', { name: 'Sign out of your account' }));

            expect(await screen.findByRole('alert')).toHaveProperty(
                'textContent',
                'We couldn’t sign you out. Please try again.',
            );
            expect(signOut).not.toHaveBeenCalled();
            expect(navigateTo).not.toHaveBeenCalled();
        });
    });
});
