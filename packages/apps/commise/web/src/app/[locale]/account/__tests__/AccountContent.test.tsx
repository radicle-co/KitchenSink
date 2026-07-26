// @vitest-environment jsdom
/**
 * Composition tests for the `/account` route content (U3). The leaf forms have their own suites; here we
 * verify the SHELL: the account surface renders inside the shared {@link AppShell} (so it gets nav on desktop
 * AND narrow), its headings are localized (no hard-coded English), and it composes the edit + danger-zone
 * controls. The viewer-profile hook is mocked (AppShell's avatar source); the leaf forms are stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
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
});
