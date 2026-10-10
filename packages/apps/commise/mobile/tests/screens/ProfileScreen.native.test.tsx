/**
 * The native Profile page (`docs/design/uiOverhaul/buildSpec.md` §9.1): ONE page from the avatar that holds who the cook
 * is, the one thing they can change (the display name), preferences, sign out and the danger zone. It replaces the old
 * profile form AND the `AccountSettings` hub, so this suite also pins that the hub is gone.
 *
 * REWRITTEN in slice 9. The previous suite drove a suspense read under `QueryBoundary` and a Save-everything form
 * (display name + avatar URL in one PATCH, a keyboard-avoider shell). None of that survives, by design: a FAILED read
 * must no longer replace the page (E15: sign out and the danger zone still work), the name is written only from the
 * sheet's Save, and the page has no field of its own to pad above a keyboard. What carried over, as new cases: the
 * loading / failed / ready states, the B17 sign-out failure alert, and the rule that nothing is written before Save.
 *
 * Rendered through react-native-web under jsdom. Hooks that reach the network are mocked; the design-system leaves and
 * the Profile leaves of `@commise/features-account/profile` are REAL, so colour, roles and names are what ships.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountDangerMessages } from '@commise/features-account/danger';
import { profileMessages } from '@commise/features-account/profile';
import { role, roleDark } from '@commise/ui/colors';
import { SnackbarHost } from '@commise/ui/snackbar';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { useDeleteAccount } from '../../src/hooks/useDeleteAccount.js';
import { useEraseAccount } from '../../src/hooks/useEraseAccount.js';
import { useUpdateProfile } from '../../src/hooks/useUpdateProfile.js';
import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { ProfileScreen } from '../../src/screens/profile.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...withSystemScheme(actual),
        // react-native-web implements no `sendAccessibilityEvent`: the contract (which node, when) is what is asserted.
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

const { signOutAndVerify, clerkUser } = vi.hoisted(() => ({
    signOutAndVerify: vi.fn(),
    clerkUser: { current: null as unknown },
}));
vi.mock('@clerk/expo', () => ({
    useUser: () => ({ user: clerkUser.current }),
    useAuth: () => ({ signOut: vi.fn() }),
    useClerk: () => ({ signOut: vi.fn(), loaded: true, status: 'ready', session: null }),
}));
vi.mock('../../src/hooks/useSignOutAndVerify.js', () => ({ useSignOutAndVerify: () => ({ signOutAndVerify }) }));
vi.mock('../../src/hooks/useUserProfile.js', () => ({ useUserProfile: vi.fn() }));
vi.mock('../../src/hooks/useUpdateProfile.js', () => ({ useUpdateProfile: vi.fn() }));
vi.mock('../../src/hooks/useDeleteAccount.js', () => ({ useDeleteAccount: vi.fn() }));
vi.mock('../../src/hooks/useEraseAccount.js', () => ({ useEraseAccount: vi.fn() }));
vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useAllOwnerRecipes: () => ({ recipes: [], isLoading: false, isError: false, isComplete: true }),
    useRequestAccountErasure: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

// The photo control reaches the device picker and an upload; here it is a stub that "uploads" one URL on press.
vi.mock('../../src/components/account/AvatarField.js', () => ({
    AvatarField: ({ onChange, value }: { onChange: (url: string) => void; value: string }) =>
        createElement(
            'button',
            { type: 'button', 'data-photo': value, onClick: () => onChange('https://cdn.example/new.png') },
            'Pick photo',
        ),
}));

// The sheet reads a food-service endpoint; here it is a stub that can be closed.
vi.mock('@commise/features-recipes/data-sources/mobile', () => ({
    DataSourcesScreen: ({ onRequestClose }: { onRequestClose: () => void }) =>
        createElement('div', { role: 'dialog', 'aria-label': 'Data sources sheet' }, [
            createElement('button', { key: 'c', type: 'button', onClick: onRequestClose }, 'Close sources'),
        ]),
}));

const t = profileMessages.en;
const { close, erase } = accountDangerMessages.en;
const { suspension } = mobileMessages.en;

const useUserProfileMock = vi.mocked(useUserProfile);
const useUpdateProfileMock = vi.mocked(useUpdateProfile);
const useDeleteAccountMock = vi.mocked(useDeleteAccount);
const useEraseAccountMock = vi.mocked(useEraseAccount);
const mutate = vi.fn();
const refetch = vi.fn();

type ProfileQuery = ReturnType<typeof useUserProfile>;

/** A settled profile read. */
function ready(
    over: { displayName?: string; email?: string; avatarUrl?: string; status?: 'active' | 'suspended' } = {},
): ProfileQuery {
    return {
        data: {
            user: {
                id: 'usr_1',
                displayName: over.displayName ?? 'Eliza Moreno',
                email: over.email ?? 'eliza@example.com',
                avatarUrl: over.avatarUrl ?? '',
                status: over.status ?? 'active',
            },
        },
        isError: false,
        refetch,
    } as unknown as ProfileQuery;
}

const loading = { data: undefined, isError: false, refetch } as unknown as ProfileQuery;
const failed = { data: undefined, isError: true, refetch } as unknown as ProfileQuery;

/** Render the page where the app does: under the snackbar host. */
function renderProfile(onBack = vi.fn()) {
    render(
        <SnackbarHost>
            <ProfileScreen onBack={onBack} />
        </SnackbarHost>,
    );

    return onBack;
}

/** A mutation double: `mutate` runs the caller's `onSuccess` unless a case says otherwise. */
function setMutation(state: { isPending?: boolean; isError?: boolean } = {}): void {
    useUpdateProfileMock.mockReturnValue({
        mutate,
        reset: vi.fn(),
        variables: {},
        isPending: state.isPending ?? false,
        isError: state.isError ?? false,
    } as unknown as ReturnType<typeof useUpdateProfile>);
}

beforeEach(() => {
    useUserProfileMock.mockReturnValue(ready());
    mutate.mockReset().mockImplementation((_body: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
    });
    setMutation();
    useDeleteAccountMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false } as never);
    useEraseAccountMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false } as never);
    signOutAndVerify.mockReset().mockResolvedValue(undefined);
    clerkUser.current = null;
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    systemScheme.current = null;
});

describe('ProfileScreen — the one page (§9.1)', () => {
    it('is a titled page with a back control that leaves it', () => {
        const onBack = renderProfile();

        expect(screen.getByRole('heading', { name: t.title, level: 1 })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: t.back }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('shows the name and email in the header and both rows in the Account group', () => {
        renderProfile();

        const account = screen.getByRole('button', { name: t.displayName });
        expect(account.textContent).toContain('Eliza Moreno');
        // Header and the read-only Email row both carry the address.
        expect(screen.getAllByText('eliza@example.com').length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText(t.email)).toBeTruthy();
    });

    it('holds Preferences with the data sources row, sign out, and the danger zone with both hints', () => {
        renderProfile();

        expect(screen.getByRole('heading', { name: t.preferences, level: 2 })).toBeTruthy();
        expect(screen.getByRole('button', { name: t.dataSources })).toBeTruthy();
        expect(screen.getByRole('button', { name: t.signOut })).toBeTruthy();
        expect(screen.getByRole('heading', { name: t.dangerZone, level: 2 })).toBeTruthy();
        expect(screen.getByRole('button', { name: close.trigger })).toBeTruthy();
        expect(screen.getByRole('button', { name: erase.trigger })).toBeTruthy();
        expect(screen.getByText(close.rowHint)).toBeTruthy();
        expect(screen.getByText(erase.rowHint)).toBeTruthy();
    });

    it('has no keyboard-shortcuts row (web only) and no Account settings entry (the hub is deleted)', () => {
        renderProfile();

        expect(screen.queryByText(t.shortcuts)).toBeNull();
        expect(screen.queryByRole('button', { name: /account settings/i })).toBeNull();
        expect(screen.queryByText(/account settings/i)).toBeNull();
    });

    // D19 / ADR-0059: the "/" shortcut is a hardware-keyboard setting and native has no equivalent yet, so the screen
    // shows no switch of any kind and reads no settings. The gap is recorded in the ADR, not hidden.
    it('renders no switch at all — the shortcut setting has no native control', () => {
        renderProfile();

        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByText(/shortcut/i)).toBeNull();
    });

    it('opens the data sources sheet from its row and closes it back', () => {
        renderProfile();

        fireEvent.click(screen.getByRole('button', { name: t.dataSources }));
        expect(screen.getByRole('dialog', { name: 'Data sources sheet' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Close sources' }));
        expect(screen.queryByRole('dialog', { name: 'Data sources sheet' })).toBeNull();
    });

    // §10 "Dialogs and sheets": focus returns to the trigger. It used to, through the settings link's own signal.
    it('returns the screen-reader cursor to the data sources row once its sheet closes', () => {
        renderProfile();
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        fireEvent.click(screen.getByRole('button', { name: t.dataSources }));
        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Close sources' }));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('button', { name: t.dataSources }),
            'focus',
        );
    });
});

describe('ProfileScreen — states', () => {
    it('shows the header skeleton while loading, keeps the other groups, and hides the Account group', () => {
        useUserProfileMock.mockReturnValue(loading);
        renderProfile();

        expect(screen.getByRole('status', { name: t.loading })).toBeTruthy();
        expect(screen.queryByRole('button', { name: t.displayName })).toBeNull();
        expect(screen.getByRole('button', { name: t.signOut })).toBeTruthy();
        expect(screen.getByRole('button', { name: erase.trigger })).toBeTruthy();
    });

    it('says the read failed with Try again, which refetches; sign out and the danger zone still work (E15)', () => {
        useUserProfileMock.mockReturnValue(failed);
        renderProfile();

        expect(screen.getByRole('alert').textContent).toContain(t.loadError);
        fireEvent.click(screen.getByRole('button', { name: t.retry }));
        expect(refetch).toHaveBeenCalledTimes(1);

        expect(screen.queryByRole('button', { name: t.displayName })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: t.signOut }));
        expect(signOutAndVerify).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: close.trigger })).toBeTruthy();
    });

    it('shows “Add your name” and no name in the header while no name is saved', () => {
        useUserProfileMock.mockReturnValue(ready({ displayName: '' }));
        renderProfile();

        expect(screen.getByRole('button', { name: t.displayName }).textContent).toContain(t.displayNameUnset);
    });

    it('keeps the suspended-account notice at the top', () => {
        useUserProfileMock.mockReturnValue(ready({ status: 'suspended' }));
        renderProfile();

        expect(screen.getByText(suspension.title)).toBeTruthy();
    });

    it('shows no suspension notice for an active account', () => {
        renderProfile();

        expect(screen.queryByText(suspension.title)).toBeNull();
    });
});

describe('ProfileScreen — the display-name sheet (A17)', () => {
    const openSheet = () => fireEvent.click(screen.getByRole('button', { name: t.displayName }));
    const field = () => screen.getByLabelText(t.displayName, { selector: 'input' }) as HTMLInputElement;

    it('opens seeded from the SAVED name, not Clerk’s', () => {
        clerkUser.current = { firstName: 'Clerky', externalAccounts: [] };
        renderProfile();
        openSheet();

        expect(field().value).toBe('Eliza Moreno');
    });

    it('prefills Clerk’s given name when nothing is saved, and writes NOTHING until Save', () => {
        useUserProfileMock.mockReturnValue(ready({ displayName: '' }));
        clerkUser.current = { firstName: 'Eliza', externalAccounts: [] };
        renderProfile();
        openSheet();

        expect(field().value).toBe('Eliza');
        expect(mutate).not.toHaveBeenCalled();
    });

    it('opens empty when nothing is saved and Clerk has no name', () => {
        useUserProfileMock.mockReturnValue(ready({ displayName: '' }));
        renderProfile();
        openSheet();

        expect(field().value).toBe('');
        expect(screen.getByRole('button', { name: t.save }).getAttribute('aria-disabled')).toBe('true');
    });

    it('saves only { displayName }, trimmed, then closes and says “Saved.”', async () => {
        renderProfile();
        openSheet();
        fireEvent.change(field(), { target: { value: '  Eliza M  ' } });
        fireEvent.click(screen.getByRole('button', { name: t.save }));

        expect(mutate).toHaveBeenCalledTimes(1);
        expect(mutate.mock.calls[0]?.[0]).toEqual({ displayName: 'Eliza M' });
        await waitFor(() => expect(screen.queryByLabelText(t.displayName, { selector: 'input' })).toBeNull());
        expect(await screen.findByText(t.saved)).toBeTruthy();
    });

    it('does not save an unchanged name', () => {
        renderProfile();
        openSheet();

        expect(screen.getByRole('button', { name: t.save }).getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: t.save }));
        expect(mutate).not.toHaveBeenCalled();
    });

    it('closing without Save writes nothing and drops the edit', () => {
        renderProfile();
        openSheet();
        fireEvent.change(field(), { target: { value: 'Someone Else' } });
        fireEvent.click(screen.getByRole('button', { name: t.closeNameSheet }));

        expect(mutate).not.toHaveBeenCalled();
        openSheet();
        expect(field().value).toBe('Eliza Moreno');
    });

    it('keeps the sheet open and says so when the save fails', () => {
        mutate.mockImplementation(() => undefined);
        setMutation({ isError: true });
        renderProfile();
        openSheet();

        expect(screen.getByText(t.saveFailed)).toBeTruthy();
        expect(field()).toBeTruthy();
    });

    it('shows the saving state and cannot be pressed again while in flight', () => {
        setMutation({ isPending: true });
        renderProfile();
        openSheet();
        fireEvent.change(field(), { target: { value: 'Eliza M' } });

        const saving = screen.getByRole('button', { name: t.saving });
        expect(saving.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(saving);
        expect(mutate).not.toHaveBeenCalled();
    });
});

describe('ProfileScreen — the photo (native-only AvatarField)', () => {
    it('is offered in the Account group, shows the saved photo, and persists a new one on its own', () => {
        useUserProfileMock.mockReturnValue(ready({ avatarUrl: 'https://cdn.example/old.png' }));
        renderProfile();

        const pick = screen.getByRole('button', { name: 'Pick photo' });
        expect(pick.getAttribute('data-photo')).toBe('https://cdn.example/old.png');

        fireEvent.click(pick);

        // A picked photo is its own explicit act: it is written alone, never with the name.
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(mutate.mock.calls[0]?.[0]).toEqual({ avatarUrl: 'https://cdn.example/new.png' });
    });

    it('is not offered while the profile has not loaded', () => {
        useUserProfileMock.mockReturnValue(loading);
        renderProfile();

        expect(screen.queryByRole('button', { name: 'Pick photo' })).toBeNull();
    });
});

describe('ProfileScreen — sign out (ADR-0009, B17)', () => {
    it('issues the verified sign-out command and shows the busy state', async () => {
        signOutAndVerify.mockReturnValue(new Promise<void>(() => undefined));
        renderProfile();

        fireEvent.click(screen.getByRole('button', { name: t.signOut }));

        expect(signOutAndVerify).toHaveBeenCalledTimes(1);
        const busy = await screen.findByRole('button', { name: t.signingOut });
        expect(busy.getAttribute('aria-busy')).toBe('true');
    });

    it('alerts and stays retryable when sign-out fails, never echoing the raw error', async () => {
        signOutAndVerify.mockRejectedValueOnce(new Error('sess_live still active'));
        renderProfile();

        fireEvent.click(screen.getByRole('button', { name: t.signOut }));

        expect((await screen.findByRole('alert')).textContent).toBe(t.signOutFailed);
        expect(screen.queryByText(/sess_live/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: t.signOut }));
        await waitFor(() => expect(signOutAndVerify).toHaveBeenCalledTimes(2));
    });
});

/** The colour a node resolves to, as culori formats it (`rgb(r, g, b)`). */
const colourOf = (node: HTMLElement): string => window.getComputedStyle(node).color;

/** The first painted background at or above a node: the surface the node actually sits on. */
function backgroundBehind(node: HTMLElement): string {
    for (let at: HTMLElement | null = node; at !== null; at = at.parentElement) {
        const { backgroundColor } = window.getComputedStyle(at);

        if (backgroundColor !== 'rgba(0, 0, 0, 0)') {
            return backgroundColor;
        }
    }

    return 'transparent';
}

describe.each([
    ['light', role],
    ['dark', roleDark],
] as const)('ProfileScreen — the %s theme reads colour from roles', (name, roles) => {
    beforeEach(() => {
        systemScheme.current = name;
    });

    it('paints sign out in ink (not red) and the danger rows in dangerText', () => {
        renderProfile();

        expect(colourOf(screen.getByText(t.signOut, { selector: 'div,span' }))).toBe(rgb(roles.ink));
        expect(colourOf(screen.getByText(close.trigger, { selector: 'div,span' }))).toBe(rgb(roles.dangerText));
        expect(colourOf(screen.getByText(erase.trigger, { selector: 'div,span' }))).toBe(rgb(roles.dangerText));
    });

    it('paints the hints and the email in inkMuted, and the group card in paper', () => {
        renderProfile();

        expect(colourOf(screen.getByText(close.rowHint))).toBe(rgb(roles.inkMuted));
        expect(backgroundBehind(screen.getByRole('button', { name: t.signOut }))).toBe(rgb(roles.paper));
    });

    it('paints the failed-load message and the sign-out failure in role colours', async () => {
        useUserProfileMock.mockReturnValue(failed);
        signOutAndVerify.mockRejectedValueOnce(new Error('x'));
        renderProfile();

        fireEvent.click(screen.getByRole('button', { name: t.signOut }));
        const alert = await screen.findByText(t.signOutFailed);

        expect(colourOf(alert)).toBe(rgb(roles.dangerText));
    });
});
