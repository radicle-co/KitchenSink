// @vitest-environment jsdom
/**
 * Composition tests for the `/account` route content (U3). The leaf forms have their own suites; here we
 * verify the SHELL: the account surface renders inside the shared {@link AppShell} (so it gets nav on desktop
 * AND narrow), its headings are localized (no hard-coded English), and it composes the edit + danger-zone
 * controls. The viewer-profile hook is mocked (AppShell's avatar source); the leaf forms are stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { renderWithProviders } from '@commise/test-utils';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ buildApiClient: () => ({ get }) }));

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { user: { displayName: 'Ada' } } }),
}));

// The state gate's own branches are covered in AccountStateGate.test; here it is a passthrough so this
// suite stays focused on the shell composition (and needs no ClerkProvider).
vi.mock('@/components/auth/AccountStateGate', () => ({
    AccountStateGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/auth/AccountEditForm', () => ({
    AccountEditForm: () => <div>edit-form-stub</div>,
}));
vi.mock('@/components/auth/AccountCloseForm', () => ({
    AccountCloseForm: () => <button type="button">Close account</button>,
}));
vi.mock('@/components/auth/AccountEraseForm', () => ({
    AccountEraseForm: () => <button type="button">Erase my data</button>,
}));

const { AccountContent } = await import('../AccountContent');

afterEach(cleanup);

const renderContent = async (): Promise<void> => {
    get.mockResolvedValue({
        user: { displayName: 'Ada', email: 'ada@example.com', status: 'active', avatarUrl: null },
        account: { subscriptionTier: 'free' },
    });

    renderWithProviders(await AccountContent({ accessToken: 'tok', locale: 'en' }));
};

describe('AccountContent (U3) — shell + composition', () => {
    it('renders the account surface inside the shared navigation chrome', async () => {
        await renderContent();

        // AppShell contributes the nav landmarks (desktop sidebar + narrow tab bar) — the bare route had none.
        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    });

    it('renders localized headings for the account, edit, and danger sections', async () => {
        await renderContent();

        expect(screen.getByRole('heading', { name: 'Account Settings' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Edit Profile' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Danger Zone' })).toBeTruthy();
    });

    it('composes the edit form and the two distinct danger-zone controls', async () => {
        await renderContent();

        expect(screen.getByText('edit-form-stub')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Close account' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Erase my data' })).toBeTruthy();
    });

    it('names ITSELF in the top bar (not the hard-coded "Home") and owns the page’s only h1', async () => {
        await renderContent();

        expect(within(screen.getByRole('banner')).getByText('Account')).toBeTruthy();
        expect(within(screen.getByRole('banner')).queryByText('Home')).toBeNull();
        const level1 = screen.getAllByRole('heading', { level: 1 });
        expect(level1).toHaveLength(1);
        expect(level1[0]?.textContent).toBe('Account Settings');
    });
});

describe('AccountContent — SSR identity-fetch resilience', () => {
    it('degrades to a recoverable state (no throw) when the identity fetch rejects (ECONNREFUSED)', async () => {
        get.mockRejectedValue(new Error('fetch failed'));

        renderWithProviders(await AccountContent({ accessToken: 'tok', locale: 'en' }));

        // The page still renders, inside the nav chrome, rather than throwing the whole route into the error
        // boundary — matching the `/profile` route's shipped degradation contract (and B19's for /recipes).
        expect(screen.getByRole('heading', { name: 'Account Settings' })).toBeTruthy();
        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
        expect(screen.getByRole('status')).toHaveTextContent(/couldn’t load your profile/i);
        // The edit form needs the profile it could not load, so it is absent…
        expect(screen.queryByText('edit-form-stub')).toBeNull();
        // …but the danger zone needs NO profile: a user must still be able to close or erase their account
        // when the identity read hiccups. Losing that is the failure mode a bare throw caused.
        expect(screen.getByRole('heading', { name: 'Danger Zone' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Close account' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Erase my data' })).toBeTruthy();
    });
});
