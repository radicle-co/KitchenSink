// @vitest-environment jsdom
/**
 * Branch tests for the web account-state gate (U3 touches its localized loading copy + the notice surface).
 * Drives every rendered branch through the REAL shared `deriveAuthState` by feeding it mocked Clerk session
 * facts: loading (localized status), blocked/suspended (the error-toned notice), and authenticated
 * (children pass through). Copy resolves via the real LocaleProvider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

const clerk = vi.hoisted(() => ({
    auth: {
        isLoaded: true,
        isSignedIn: true as boolean,
        userId: 'u' as string | null,
        sessionClaims: null as Record<string, unknown> | null,
    },
    user: { user: { publicMetadata: {} as Record<string, unknown> } },
}));
vi.mock('@clerk/nextjs', () => ({
    useAuth: () => clerk.auth,
    useUser: () => clerk.user,
}));

const { AccountStateGate } = await import('../AccountStateGate');

beforeEach(() => {
    clerk.auth = { isLoaded: true, isSignedIn: true, userId: 'u', sessionClaims: null };
    clerk.user = { user: { publicMetadata: {} } };
});

afterEach(cleanup);

describe('AccountStateGate (U3)', () => {
    it('shows a localized loading status while the session resolves', () => {
        clerk.auth = { isLoaded: false, isSignedIn: false, userId: null, sessionClaims: null };

        renderWithProviders(
            <AccountStateGate>
                <p>protected</p>
            </AccountStateGate>,
        );

        expect(screen.getByRole('status').textContent).toBe('Loading your account…');
        expect(screen.queryByText('protected')).toBeNull();
    });

    it('renders the blocked notice (not the content) for a suspended session', () => {
        clerk.user = { user: { publicMetadata: { status: 'suspended' } } };

        renderWithProviders(
            <AccountStateGate>
                <p>protected</p>
            </AccountStateGate>,
        );

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByText('protected')).toBeNull();
    });

    it('renders the protected content for an ordinary authenticated session', () => {
        renderWithProviders(
            <AccountStateGate>
                <p>protected</p>
            </AccountStateGate>,
        );

        expect(screen.getByText('protected')).toBeTruthy();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
