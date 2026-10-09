// @vitest-environment jsdom
/**
 * The Profile page (`docs/design/uiOverhaul/buildSpec.md` §9.1) — every state it owns, by role and name: loading (the
 * header is a skeleton, the groups still render), read failed (Try again; sign out and the danger zone still work),
 * ready, the display-name sheet (prefilled from Clerk only when nothing is saved, never written until Save), a failed
 * save, and the keyboard-shortcuts switch (on by default, persisted per device).
 *
 * The three account controls are stubbed: their own suites own their flows, this one owns the page around them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SnackbarHost } from '@commise/ui/snackbar';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@commise/test-utils';

import { readSearchShortcutEnabled } from '@/lib/searchShortcutPreference';

const { patchMe, refetch, push, profileQuery, clerkUser } = vi.hoisted(() => ({
    patchMe: vi.fn(),
    refetch: vi.fn(),
    push: vi.fn(),
    profileQuery: {
        current: {} as { data?: { user: { displayName: string; email: string } }; isError: boolean },
    },
    clerkUser: { current: null as null | { firstName?: string | null; externalAccounts?: unknown[] } },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@clerk/nextjs', () => ({
    useUser: () => ({ user: clerkUser.current }),
    useAuth: () => ({ getToken: async () => 'tok' }),
}));
vi.mock('@/lib/basePath', () => ({ withBasePath: (path: string) => path }));
vi.mock('@/lib/identityServiceClient', () => ({ createProfileServiceClient: () => ({ patchMe }) }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ ...profileQuery.current, refetch }) }));
vi.mock('@/components/auth/LogoutButton', () => ({ LogoutButton: () => <button type="button">Sign out</button> }));
vi.mock('@/components/auth/AccountCloseForm', () => ({
    AccountCloseForm: () => <button type="button">Close account</button>,
}));
vi.mock('@/components/auth/AccountEraseForm', () => ({
    AccountEraseForm: () => <button type="button">Erase my data</button>,
}));

const { ProfileSurface } = await import('../ProfileSurface');

const ready = (displayName: string) => ({
    isError: false,
    data: { user: { displayName, email: 'eliza@example.com' } },
});

const mount = (): void => {
    const ui: ReactElement = (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
            <SnackbarHost>
                <ProfileSurface />
            </SnackbarHost>
        </QueryClientProvider>
    );

    renderWithProviders(ui);
};

beforeEach(() => {
    patchMe.mockReset().mockResolvedValue({});
    refetch.mockReset();
    push.mockReset();
    profileQuery.current = ready('Eliza Moreno');
    clerkUser.current = null;
    window.localStorage.clear();
});

afterEach(cleanup);

describe('ProfileSurface — the page', () => {
    it('has one H1, “Profile”, and a way back to Home', () => {
        mount();

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeTruthy();
        expect(screen.getAllByText(/Back to Home|Home/).length).toBeGreaterThan(0);
    });

    it('shows the name and the email in the header and the rows once the profile is ready', () => {
        mount();

        expect(screen.getAllByText('Eliza Moreno').length).toBeGreaterThan(0);
        expect(screen.getAllByText('eliza@example.com')).toHaveLength(2);
        expect(screen.getByRole('button', { name: /Display name/ })).toBeTruthy();
    });

    it('offers Food data sources as a link to the sources page', async () => {
        mount();

        const link = screen.getByRole('link', { name: /Food data sources/ });

        expect(link.getAttribute('href')).toBe('/en/legal/sources');

        await userEvent.click(link);

        expect(push).toHaveBeenCalledWith('/en/legal/sources');
    });

    it('lays the groups out in order: account, preferences, sign out, danger zone', () => {
        mount();

        const names = screen
            .getAllByRole('region')
            .map((region) => region.getAttribute('aria-label') ?? region.querySelector('h2')?.textContent);

        expect(names).toEqual(['Account', 'Preferences', 'Sign out', 'Danger zone']);
    });

    it('keeps the danger zone and sign out in the page', () => {
        mount();

        expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Close account' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Erase my data' })).toBeTruthy();
    });
});

describe('ProfileSurface — loading and failure', () => {
    it('shows a skeleton while loading, and every other group still renders', () => {
        profileQuery.current = { isError: false };
        mount();

        expect(screen.getByRole('status', { name: 'Loading your profile' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Display name/ })).toBeNull();
        expect(screen.getByRole('link', { name: /Food data sources/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Erase my data' })).toBeTruthy();
    });

    it('reports a failed read with Try again, and sign out and the danger zone still work', async () => {
        profileQuery.current = { isError: true };
        mount();

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your profile.');
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Close account' })).toBeTruthy();

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetch).toHaveBeenCalledOnce();
    });
});

describe('ProfileSurface — the display name', () => {
    it('shows “Not set” until a name is saved', () => {
        profileQuery.current = ready('');
        mount();

        expect(screen.getByRole('button', { name: /Display name/ }).textContent).toContain('Not set');
    });

    it('opens the sheet with the saved name', async () => {
        mount();

        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));

        expect((screen.getByRole('textbox', { name: 'What should we call you?' }) as HTMLInputElement).value).toBe(
            'Eliza Moreno',
        );
    });

    it('prefills the Google given name when nothing is saved — and writes nothing until Save', async () => {
        profileQuery.current = ready('');
        clerkUser.current = { firstName: 'Fallback', externalAccounts: [{ provider: 'google', firstName: 'Eliza' }] };
        mount();

        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));

        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Eliza');
        expect(patchMe).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(patchMe).not.toHaveBeenCalled();
    });

    it('never lets the prefill replace a saved name', async () => {
        clerkUser.current = { firstName: 'Other', externalAccounts: [{ provider: 'google', firstName: 'Eliza' }] };
        mount();

        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));

        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Eliza Moreno');
    });

    it('starts empty, with Save off, when Clerk holds no name either', async () => {
        profileQuery.current = ready('');
        mount();

        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));

        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('saves the trimmed name on Save, closes the sheet and says “Saved.”', async () => {
        mount();

        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));
        const field = screen.getByRole('textbox');

        await userEvent.clear(field);
        await userEvent.type(field, '  Chef Eliza ');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(patchMe).toHaveBeenCalledWith({ displayName: 'Chef Eliza' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByRole('status').textContent).toContain('Saved.');
    });

    it('keeps the sheet open and says so when the save fails', async () => {
        patchMe.mockRejectedValue(new Error('boom'));
        mount();

        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));
        await userEvent.type(screen.getByRole('textbox'), 'X');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t save your name. Please try again.');
        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('starts each opening from the saved name, not from an abandoned edit', async () => {
        mount();

        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));
        await userEvent.type(screen.getByRole('textbox'), ' extra');
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));

        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Eliza Moreno');
    });
});

describe('ProfileSurface — keyboard shortcuts', () => {
    it('is a switch, on by default', () => {
        mount();

        expect(screen.getByRole('switch', { name: 'Keyboard shortcuts' }).getAttribute('aria-checked')).toBe('true');
    });

    it('turns the shortcut off and on, per device', async () => {
        mount();
        const toggle = screen.getByRole('switch', { name: 'Keyboard shortcuts' });

        await userEvent.click(toggle);

        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(readSearchShortcutEnabled()).toBe(false);

        await userEvent.click(toggle);

        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(readSearchShortcutEnabled()).toBe(true);
    });

    it('reads the stored “off” on mount', () => {
        window.localStorage.setItem('prefs.v1.searchShortcut', 'off');
        mount();

        expect(screen.getByRole('switch', { name: 'Keyboard shortcuts' }).getAttribute('aria-checked')).toBe('false');
    });
});
