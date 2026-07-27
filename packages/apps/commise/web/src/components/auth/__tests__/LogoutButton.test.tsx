// @vitest-environment jsdom
/**
 * State tests for the sign-out control (U3): it renders the localized label as a design-system Button, an
 * explicit child overrides the label, and activating it signs the viewer out and LEAVES the app with a
 * full-document navigation — the same ordering the account close/erase flows were fixed to (a router-level
 * `signOut({ redirectUrl })` re-renders the authenticated shell from a payload resolved for the session that
 * was just destroyed, stranding the viewer on a surface they can no longer use). Also covers the failure path:
 * a rejected sign-out must surface an alert and release the busy state, never spin forever (B17).
 *
 * Clerk, basePath, and the navigation seam are mocked at the module boundary; copy resolves via the real
 * LocaleProvider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@commise/test-utils';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut }) }));
vi.mock('@/lib/basePath', () => ({ withBasePath: (p: string) => p }));

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/lib/navigation', () => ({ navigateTo }));

const { LogoutButton } = await import('../LogoutButton');

beforeEach(() => {
    signOut.mockReset().mockResolvedValue(undefined);
    navigateTo.mockReset();
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
});
