// @vitest-environment jsdom
/**
 * Tests for the `/profile` route content: it renders the one Profile page inside the shared `AppShell` (the nav chrome
 * on desktop AND narrow), names itself in the document title, and leaves the page as the only level-1 heading. The
 * page's own states (loading, failed, ready, the sheet, the switch) are `ProfileSurface`'s suite; the shell's reads are
 * stood in for so this one asks only how the route is composed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@commise/test-utils';

// The shell's sidebar opens the editor through the router and its tab bar reads the route (slice 3).
vi.mock('next/navigation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/navigation')>()),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/en',
}));
vi.mock('@clerk/nextjs', () => ({
    useUser: () => ({ user: null }),
    useAuth: () => ({ getToken: async () => 'tok' }),
}));
vi.mock('@/lib/identityServiceClient', () => ({
    IDENTITY_SERVICE_BASE_URL: 'http://identity.test',
    createProfileServiceClient: () => ({ patchMe: vi.fn() }),
}));
vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({
        isError: false,
        data: { user: { displayName: 'Ada', email: 'ada@example.com' } },
        refetch: vi.fn(),
    }),
}));
vi.mock('@/components/auth/AccountStateGate', () => ({
    AccountStateGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/auth/LogoutButton', () => ({
    LogoutButton: () => <button type="button">Sign out</button>,
}));
vi.mock('@/components/auth/AccountCloseForm', () => ({
    AccountCloseForm: () => <button type="button">Close account</button>,
}));
vi.mock('@/components/auth/AccountEraseForm', () => ({
    AccountEraseForm: () => <button type="button">Erase my data</button>,
}));

import { ProfileContent } from '../ProfileContent.js';

const mount = (): void => {
    renderWithProviders(
        <QueryClientProvider client={new QueryClient()}>
            <ProfileContent />
        </QueryClientProvider>,
    );
};

afterEach(cleanup);

describe('ProfileContent — the route', () => {
    it('renders the Profile page inside the nav chrome', () => {
        mount();

        expect(screen.getByText('ada@example.com', { selector: 'p' })).toBeInTheDocument();
        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    });

    it('names ITSELF in the document title and leaves the page as the only h1', () => {
        mount();

        expect(document.title).toBe('Profile · Commise');

        const level1 = screen.getAllByRole('heading', { level: 1 });

        expect(level1).toHaveLength(1);
        expect(level1[0]?.textContent).toBe('Profile');
    });

    it('fetches nothing on the server: it is a plain component, not an async one', () => {
        expect(ProfileContent.constructor.name).not.toBe('AsyncFunction');
    });
});
