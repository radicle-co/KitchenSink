// @vitest-environment jsdom
/**
 * Composition tests for the `/settings` route content (U3): it renders inside the shared {@link AppShell}
 * (nav on desktop AND narrow — the bare route had none), its headings are localized, and it composes the
 * sign-out control. The viewer-profile hook is mocked (AppShell's avatar source); LogoutButton is stubbed
 * (its own state matrix is covered in LogoutButton.test).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { user: { displayName: 'Ada' } } }),
}));

vi.mock('@/components/auth/LogoutButton', () => ({
    LogoutButton: () => <button type="button">Sign out of your account</button>,
}));

const { SettingsContent } = await import('../SettingsContent');

afterEach(cleanup);

describe('SettingsContent (U3) — shell + composition', () => {
    it('renders the settings surface inside the shared navigation chrome', () => {
        renderWithProviders(<SettingsContent locale="en" />);

        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    });

    it('renders localized headings and the sign-out control', () => {
        renderWithProviders(<SettingsContent locale="en" />);

        expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Session' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sign out of your account' })).toBeTruthy();
    });

    it('names ITSELF in the top bar (not the hard-coded "Home") and owns the page’s only h1', () => {
        renderWithProviders(<SettingsContent locale="en" />);

        expect(within(screen.getByRole('banner')).getByText('Settings')).toBeTruthy();
        expect(within(screen.getByRole('banner')).queryByText('Home')).toBeNull();
        // The chrome title is plain text, so the page's own <h1> is the document's only level-1 heading.
        const level1 = screen.getAllByRole('heading', { level: 1 });
        expect(level1).toHaveLength(1);
        expect(level1[0]?.textContent).toBe('Settings');
    });
});
