/**
 * Component tests for the rebuilt mobile ProfileScreen (U2). react-native-web under jsdom. The rebuild moves
 * the profile-editing surface onto the design system: a tokenized `Input` for the display name (label
 * associated), the `AvatarField` image-picker (replacing the raw avatar-URL text box), a DS `Button` with a
 * real `busy` state for Save, all copy from `mobileMessages`, and a `SafeAreaView` + `KeyboardAvoidingView`
 * shell. The load-bearing B1 case still holds: an unsaved edit MUST survive a background refetch of the same
 * profile (the form seeds once via `useState` + remounts on `key={user.id}`, never via a clobbering effect).
 *
 * `useAvatarUpload` (the picker's upload seam) is stubbed so the field renders without `@clerk/expo`; the
 * profile hooks are mocked to drive each query state.
 */
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { useUpdateProfile, useUserProfile } from '../../src/hooks/useUserProfile.js';
import { ProfileScreen } from '../../src/screens/profile.js';
import { mobileMessages } from '../../src/i18n/messages.js';

vi.mock('../../src/hooks/useUserProfile', () => ({
    useUserProfile: vi.fn(),
    useUpdateProfile: vi.fn(),
}));

vi.mock('../../src/hooks/useAvatarUpload.js', () => ({ useAvatarUpload: () => ({ upload: vi.fn() }) }));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
    SafeAreaView: ({ children }: { readonly children?: unknown }) =>
        createElement('div', { 'aria-label': 'safe-area-root' }, children as never),
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        KeyboardAvoidingView: ({ children }: { readonly children?: unknown }) =>
            createElement('div', { 'aria-label': 'keyboard-avoiding' }, children as never),
    };
});

const { profile: t } = mobileMessages.en;
const useUserProfileMock = vi.mocked(useUserProfile);
const useUpdateProfileMock = vi.mocked(useUpdateProfile);
const mutateMock = vi.fn();

/** A loaded profile-query result carrying a user with the given display name. */
function profileResult(displayName: string): ReturnType<typeof useUserProfile> {
    return {
        isLoading: false,
        error: null,
        data: { user: { id: 'usr_1', displayName, avatarUrl: '', status: 'active' } },
    } as unknown as ReturnType<typeof useUserProfile>;
}

beforeEach(() => {
    useUpdateProfileMock.mockReturnValue({ mutate: mutateMock, isPending: false } as never);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ProfileScreen — query states', () => {
    it('shows a labelled loading indicator while the profile loads', () => {
        useUserProfileMock.mockReturnValue({ isLoading: true, error: null, data: undefined } as never);

        render(<ProfileScreen />);

        expect(screen.getByRole('progressbar', { name: t.loading })).toBeTruthy();
    });

    it('shows the localized load error when the query fails', () => {
        useUserProfileMock.mockReturnValue({ isLoading: false, error: new Error('boom'), data: undefined } as never);

        render(<ProfileScreen />);

        expect(screen.getByText(t.loadError)).toBeTruthy();
    });
});

describe('ProfileScreen — editing surface', () => {
    it('renders the DS field, avatar picker, save button and the safe-area + keyboard-avoiding wrappers', () => {
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        render(<ProfileScreen />);

        expect(screen.getByLabelText(t.displayName)).toBeTruthy();
        expect(screen.getByText(t.avatarLabel)).toBeTruthy();
        expect(screen.getByRole('button', { name: t.avatarChangeAction })).toBeTruthy();
        expect(screen.getByRole('button', { name: t.save })).toBeTruthy();
        expect(screen.getByLabelText('safe-area-root')).toBeTruthy();
        expect(screen.getByLabelText('keyboard-avoiding')).toBeTruthy();
    });

    it('disables the save button and shows its busy state while a save is in flight', () => {
        useUpdateProfileMock.mockReturnValue({ mutate: mutateMock, isPending: true } as never);
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        render(<ProfileScreen />);

        const button = screen.getByRole('button', { name: t.save });
        // Busy spinner lives in the DS Button's decorative (aria-hidden) icon slot; include hidden nodes.
        expect(within(button).getByRole('progressbar', { hidden: true })).toBeTruthy();
        expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it('saves the current edited value', () => {
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        render(<ProfileScreen />);
        fireEvent.change(screen.getByDisplayValue('Ada'), { target: { value: 'Ada Edited' } });
        fireEvent.click(screen.getByRole('button', { name: t.save }));

        expect(mutateMock).toHaveBeenCalledWith({ displayName: 'Ada Edited', avatarUrl: '' });
    });

    it('does not clobber an unsaved display-name edit when the profile refetches (B1)', () => {
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        const { rerender } = render(<ProfileScreen />);
        fireEvent.change(screen.getByDisplayValue('Ada'), { target: { value: 'Ada Edited' } });

        // A background refetch returns a DIFFERENT server value for the SAME profile (same user id).
        useUserProfileMock.mockReturnValue(profileResult('Ada Server'));
        rerender(<ProfileScreen />);

        expect(screen.getByDisplayValue('Ada Edited')).toBeTruthy();
        expect(screen.queryByDisplayValue('Ada Server')).toBeNull();
    });

    it('exposes the account-settings entry when a handler is provided', () => {
        const onOpenAccountSettings = vi.fn();
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        render(<ProfileScreen onOpenAccountSettings={onOpenAccountSettings} />);
        fireEvent.click(screen.getByRole('button', { name: mobileMessages.en.account.settingsAction }));

        expect(onOpenAccountSettings).toHaveBeenCalledTimes(1);
    });
});
