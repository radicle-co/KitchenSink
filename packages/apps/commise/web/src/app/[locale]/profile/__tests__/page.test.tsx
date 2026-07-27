// @vitest-environment jsdom
/**
 * Tests for the `/profile` route content (U3): its SSR identity-fetch resilience (degrade, never crash) AND
 * the U3 shell — it renders inside the shared {@link AppShell} (nav on desktop AND narrow) with localized
 * copy. The AppShell avatar hook is mocked; the state gate + logout are stubbed to keep the focus on the
 * profile content and its degrade path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { renderWithProviders } from '@commise/test-utils';

const get = vi.fn();

vi.mock('@/lib/apiClient', () => ({
    buildApiClient: () => ({ get }),
}));
vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { user: { displayName: 'Ada' } } }),
}));
vi.mock('@/components/auth/AccountStateGate', () => ({
    AccountStateGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/auth/LogoutButton', () => ({
    LogoutButton: () => <button type="button">Log out</button>,
}));

import { ProfileContent } from '../ProfileContent.js';

describe('ProfileContent — SSR identity fetch resilience + U3 shell', () => {
    beforeEach(() => {
        get.mockReset();
    });

    afterEach(cleanup);

    it('renders the profile inside the nav chrome when the identity service responds', async () => {
        get.mockResolvedValue({
            user: { displayName: 'Ada', email: 'ada@example.com', status: 'active' },
            account: { subscriptionTier: 'free' },
        });

        renderWithProviders(await ProfileContent({ accessToken: 'tok', locale: 'en' }));

        expect(screen.getByText('ada@example.com')).toBeInTheDocument();
        // The U3 change: the surface now renders inside the shared navigation chrome (was a bare <main>).
        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('degrades to a recoverable state (no throw) when the identity fetch rejects (ECONNREFUSED)', async () => {
        get.mockRejectedValue(new Error('fetch failed'));

        renderWithProviders(await ProfileContent({ accessToken: 'tok', locale: 'en' }));

        expect(screen.getByRole('status')).toHaveTextContent(/couldn’t load your profile/i);
        // The page still renders its heading + a way out, inside the nav chrome, rather than crashing SSR.
        expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    });

    /**
     * `/profile` is the sharpest case for the two defects being fixed together: the top bar's title used to be
     * the hard-coded 'Home', and the page's own `<h1>` is 'Profile'. Now the bar says 'Profile' too — so if it
     * were still a heading, `getByRole('heading', { name: 'Profile' })` would be ambiguous AND the page would
     * carry two `h1`s. It is plain banner text, so exactly one level-1 heading survives.
     */
    it('names ITSELF in the top bar and leaves the page content as the only h1', async () => {
        get.mockResolvedValue({
            user: { displayName: 'Ada', email: 'ada@example.com', status: 'active' },
            account: { subscriptionTier: 'free' },
        });

        renderWithProviders(await ProfileContent({ accessToken: 'tok', locale: 'en' }));

        expect(within(screen.getByRole('banner')).getByText('Profile')).toBeInTheDocument();
        expect(within(screen.getByRole('banner')).queryByText('Home')).not.toBeInTheDocument();
        const level1 = screen.getAllByRole('heading', { level: 1 });
        expect(level1).toHaveLength(1);
        expect(level1[0]?.textContent).toBe('Profile');
    });
});
