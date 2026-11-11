// @vitest-environment jsdom
/**
 * The Profile page (`docs/design/uiOverhaul/buildSpec.md` §9.1) — every state it owns, by role and name: loading (the
 * header is a skeleton, the groups still render), read failed (Try again; sign out and the danger zone still work),
 * ready, the display-name sheet (prefilled from Clerk only when nothing is saved, never written until Save), a failed
 * save, and the keyboard-shortcuts switch (on by default, persisted per device).
 *
 * The three account controls are stubbed: their own suites own their flows, this one owns the page around them.
 *
 * A ROOT, not a pushed page (owner ruling 2026-11-11, N3): Profile is the You tab's root, so in EVERY state it has NO
 * Back control, neither the pinned bar nor the header eyebrow. This REWRITES the pinned-back-bar suite
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6) that asserted one "Back to Home" in each; the page left the
 * `PushedPageFrame` with it. The pages Profile pushes (Your foods, the data sources) keep their own Back.
 */
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import type { FoodServiceClient } from '@kitchensink/food-service-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SnackbarHost } from '@commise/ui/snackbar';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@commise/test-utils';

const { patchMe, getSettings, patchSettings, refetch, push, profileQuery, clerkUser } = vi.hoisted(() => ({
    patchMe: vi.fn(),
    getSettings: vi.fn(),
    patchSettings: vi.fn(),
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
    useAuth: () => ({ getToken: async () => 'tok', isSignedIn: true }),
}));
vi.mock('@/lib/basePath', () => ({ withBasePath: (path: string) => path }));
vi.mock('@/lib/identityServiceClient', () => ({
    createProfileServiceClient: () => ({ patchMe, getSettings, patchSettings }),
}));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ ...profileQuery.current, refetch }) }));
vi.mock('@/components/auth/LogoutButton', () => ({ LogoutButton: () => <button type="button">Sign out</button> }));
vi.mock('@/components/auth/AccountCloseForm', () => ({
    AccountCloseForm: () => <button type="button">Close account</button>,
}));
vi.mock('@/components/auth/AccountEraseForm', () => ({
    AccountEraseForm: () => <button type="button">Erase my data</button>,
}));

const { ProfileSurface } = await import('../ProfileSurface');

const ready = (displayName: string, username: string | null = 'braise') => ({
    isError: false,
    data: { user: { displayName, email: 'eliza@example.com', username } },
});

/** How many staff decisions the cook has not opened, as food-service's own-food list answers it. */
const unseenDecisions = { current: 0 };

const mount = (): void => {
    const foodClient = {
        listOwnFoods: async () => ({ items: [], unseenDecisions: unseenDecisions.current }),
    } as unknown as FoodServiceClient;
    const ui: ReactElement = (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
            <FoodServiceProvider client={foodClient} subject="user_a">
                <SnackbarHost>
                    <ProfileSurface />
                </SnackbarHost>
            </FoodServiceProvider>
        </QueryClientProvider>
    );

    renderWithProviders(ui);
};

beforeEach(() => {
    unseenDecisions.current = 0;
    patchMe.mockReset().mockResolvedValue({});
    getSettings.mockReset().mockResolvedValue({ searchShortcut: true });
    patchSettings.mockReset().mockImplementation(async (body: { searchShortcut: boolean }) => body);
    refetch.mockReset();
    push.mockReset();
    profileQuery.current = ready('Eliza Moreno');
    clerkUser.current = null;
});

afterEach(cleanup);

describe('ProfileSurface — a tab root has no back control', () => {
    const states: readonly [string, () => void][] = [
        ['loading', () => (profileQuery.current = { isError: false })],
        ['read failed', () => (profileQuery.current = { isError: true })],
        ['ready', () => (profileQuery.current = ready('Eliza Moreno'))],
    ];

    it.each(states)('%s: no Back in the bar and none in the header', (_state, arrange) => {
        arrange();
        mount();

        expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeTruthy();
        expect(screen.queryByRole('link', { name: /^Back/u, hidden: true })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Back/u, hidden: true })).toBeNull();
        expect(document.querySelector('[data-pushed-page]')).toBeNull();
    });
});

describe('ProfileSurface — the page', () => {
    // Every page ends 48 below its last block (`pb-12`), one end padding for every page (designer ruling 2026-11-01,
    // `nativeBoards/designAnswers.md`). It was `pb-10`, 40, which is off the spacing scale.
    it('ends 48 below its last block, like every page', () => {
        mount();
        const classes = (document.querySelector('.max-w-reading') as HTMLElement).className.split(' ');

        expect(classes).toContain('pb-12');
        expect(classes.filter((name) => /(^|:)(pb|py|p)-/u.test(name) && name !== 'pb-12')).toEqual([]);
    });

    it('has one H1, “Profile”, and no way back: it is the You tab’s root', () => {
        mount();

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeTruthy();
        expect(screen.queryByText(/Back to Home/u)).toBeNull();
    });

    // Owner ruling S2 (2026-10-27), replacing 2026-10-16's "header only": the header is the avatar and the name; the
    // read-only email is a row in the Account group, so it shows once.
    it('shows the name in the header and the email once, as a read-only Account row', () => {
        mount();

        expect(screen.getAllByText('Eliza Moreno').length).toBeGreaterThan(0);
        expect(screen.getAllByText('eliza@example.com')).toHaveLength(1);
        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Email/u })).toBeNull();
        expect(screen.getByRole('button', { name: /Display name/ })).toBeTruthy();
    });

    // Plan 2026-10-15-010 D12 (amended by S2): the username is read-only (Clerk owns it) and shows once, as a row.
    it('shows the username once, as a read-only Account row with no way to edit it', () => {
        mount();

        expect(screen.getAllByText('@braise')).toHaveLength(1);
        expect(screen.getByText('Username')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Username/u })).toBeNull();
    });

    it('shows no username anywhere for a cook without one', () => {
        profileQuery.current = ready('Eliza Moreno', null);
        mount();

        expect(screen.queryByText('Username')).toBeNull();
        expect(screen.queryByText(/^@/u)).toBeNull();
    });

    it('offers Food data sources as a link to the sources page', async () => {
        mount();

        const link = screen.getByRole('link', { name: /Food data sources/ });

        expect(link.getAttribute('href')).toBe('/en/legal/sources');

        await userEvent.click(link);

        expect(push).toHaveBeenCalledWith('/en/legal/sources');
    });

    it('lays the groups out in order: account, preferences, your foods (its own group, after preferences), sign out, danger zone', () => {
        mount();

        const names = screen
            .getAllByRole('region')
            .map((region) => region.getAttribute('aria-label') ?? region.querySelector('h2')?.textContent);

        expect(names).toEqual(['Account', 'Preferences', 'Your foods', 'Sign out', 'Danger zone']);
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
    it('shows “Add your name” until a name is saved', () => {
        profileQuery.current = ready('');
        mount();

        expect(screen.getByRole('button', { name: /Display name/ }).textContent).toContain('Add your name');
    });

    it('opens the sheet with the saved name', async () => {
        mount();

        await userEvent.click(screen.getByRole('button', { name: /Display name/ }));

        expect((screen.getByRole('textbox', { name: 'Display name' }) as HTMLInputElement).value).toBe('Eliza Moreno');
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

        expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t save your name. Try again.');
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

describe('ProfileSurface — keyboard shortcuts (a setting on the server, D19 / ADR-0059)', () => {
    const toggle = () => screen.getByRole('switch', { name: 'Keyboard shortcuts' });

    it('is a switch, on by default — the published default shows while the first read is in flight', () => {
        mount();

        expect(toggle().getAttribute('aria-checked')).toBe('true');
    });

    it('shows the stored choice once the read answers', async () => {
        getSettings.mockResolvedValue({ searchShortcut: false });
        mount();

        await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));
    });

    it('turns the setting off and on by saving it, and answers the tap before the server does', async () => {
        let release: (value: { searchShortcut: boolean }) => void = () => undefined;
        mount();
        await waitFor(() => expect(getSettings).toHaveBeenCalled());
        patchSettings.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

        await userEvent.click(toggle());

        // Optimistic: the switch is already off while the PATCH is still in flight.
        expect(toggle().getAttribute('aria-checked')).toBe('false');
        expect(patchSettings).toHaveBeenCalledWith({ searchShortcut: false });

        getSettings.mockResolvedValue({ searchShortcut: false });
        release({ searchShortcut: false });
        await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));

        await userEvent.click(toggle());

        await waitFor(() => expect(patchSettings).toHaveBeenLastCalledWith({ searchShortcut: true }));
    });

    it('keeps NOTHING in browser storage', async () => {
        mount();

        await userEvent.click(toggle());

        expect(window.localStorage.length).toBe(0);
    });

    it('puts the switch back and says so when the save fails', async () => {
        patchSettings.mockRejectedValue(new Error('503'));
        mount();
        await waitFor(() => expect(getSettings).toHaveBeenCalled());

        await userEvent.click(toggle());

        await waitFor(() =>
            expect(screen.getByRole('alert').textContent).toBe('We couldn’t save that setting. Try again.'),
        );
        expect(toggle().getAttribute('aria-checked')).toBe('true');
    });

    it('shows no failure line when nothing failed, and clears it on the next try', async () => {
        patchSettings.mockRejectedValueOnce(new Error('503'));
        mount();
        expect(screen.queryByRole('alert')).toBeNull();

        await userEvent.click(toggle());
        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

        await userEvent.click(toggle());

        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    it('has a Your foods row in its own group that opens the cook’s foods', async () => {
        mount();

        await userEvent.click(await screen.findByRole('link', { name: 'Your foods' }));

        expect(push).toHaveBeenCalledWith('/en/foods');
    });

    it('⛔ names the row for the new decisions and draws the dot only when there are some', async () => {
        unseenDecisions.current = 1;
        mount();

        expect(await screen.findByRole('link', { name: 'Your foods, 1 new decision' })).toBeTruthy();
    });
});
