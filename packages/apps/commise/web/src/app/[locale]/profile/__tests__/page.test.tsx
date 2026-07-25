import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const get = vi.fn();

vi.mock('@/lib/apiClient', () => ({
    buildApiClient: () => ({ get }),
}));
vi.mock('@/components/auth/AccountStateGate', () => ({
    AccountStateGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/auth/LogoutButton', () => ({
    LogoutButton: () => <button type="button">Log out</button>,
}));

import { ProfileContent } from '../page.js';

describe('ProfileContent — SSR identity fetch resilience', () => {
    beforeEach(() => {
        get.mockReset();
    });

    it('renders the profile when the identity service responds', async () => {
        get.mockResolvedValue({
            user: { displayName: 'Ada', email: 'ada@example.com', status: 'active' },
            account: { subscriptionTier: 'free' },
        });

        render(await ProfileContent({ accessToken: 'tok' }));

        expect(screen.getByText('Ada')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('degrades to a recoverable state (no throw) when the identity fetch rejects (ECONNREFUSED)', async () => {
        get.mockRejectedValue(new Error('fetch failed'));

        render(await ProfileContent({ accessToken: 'tok' }));

        expect(screen.getByRole('status')).toHaveTextContent(/couldn’t load your profile/i);
        // The page still renders its heading + a way out, rather than crashing the server render.
        expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    });
});
