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

import { useUpdateProfile } from '../../src/hooks/useUpdateProfile.js';
import { useSuspenseUserProfile } from '../../src/hooks/useSuspenseUserProfile.js';
import { ProfileScreen } from '../../src/screens/profile.js';
import { mobileMessages } from '../../src/i18n/messages.js';

vi.mock('../../src/hooks/useSuspenseUserProfile.js', () => ({ useSuspenseUserProfile: vi.fn() }));
vi.mock('../../src/hooks/useUpdateProfile.js', () => ({ useUpdateProfile: vi.fn() }));

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
const useUserProfileMock = vi.mocked(useSuspenseUserProfile);
const useUpdateProfileMock = vi.mocked(useUpdateProfile);
const mutateMock = vi.fn();

/**
 * A SETTLED profile read carrying a user with the given display name.
 *
 * ⚠️ No `isLoading` / `isLoadingError` any more, and their absence is the conversion: a suspense read only
 * ever returns settled data to its leaf, because Suspense owns pending and `QueryBoundary` owns failed
 * (§11.0). A fixture still carrying those flags would be describing a shape this screen can no longer see.
 */
function profileResult(displayName: string): ReturnType<typeof useSuspenseUserProfile> {
    return {
        data: { user: { id: 'usr_1', displayName, avatarUrl: '', status: 'active' } },
    } as unknown as ReturnType<typeof useSuspenseUserProfile>;
}

beforeEach(() => {
    useUpdateProfileMock.mockReturnValue({ mutate: mutateMock, isPending: false } as never);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ProfileScreen — query states are owned by the boundary (§11.0)', () => {
    /**
     * ⛔ THESE TWO TESTS PROVE A DIFFERENT THING THAN THEY USED TO, and that is the point of the change.
     * Before, the screen read `toDetailQueryView(useUserProfile())` and rendered the pending and failed
     * states ITSELF, so these drove the hook's status flags. Now the read suspends: React owns pending and
     * `QueryBoundary` owns failed, and the screen supplies only the NODES. So the mock no longer returns a
     * status — it SUSPENDS (throws a promise) or THROWS, which is what a real suspense read does.
     *
     * The observable outcome is deliberately unchanged — same copy, same roles — because a viewer should not
     * be able to tell that ownership moved. What changed is who is responsible, and these assertions now fail
     * if the boundary is removed rather than if a status ladder is.
     */
    it('shows a labelled loading indicator while the profile suspends', () => {
        // A never-settling promise is exactly what a pending suspense read throws.
        useUserProfileMock.mockImplementation(() => {
            throw new Promise<void>(() => undefined);
        });

        render(<ProfileScreen />);

        expect(screen.getByRole('progressbar', { name: t.loading })).toBeTruthy();
        // …and the same context is VISIBLE, so a sighted viewer can also tell what is happening.
        expect(screen.getByText(t.loading)).toBeTruthy();
    });

    it('shows the localized load error when the suspense read throws', () => {
        useUserProfileMock.mockImplementation(() => {
            throw new Error('boom');
        });

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

    it('⛔ keeps the form AND an unsaved edit when a background refetch of the profile fails', () => {
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        const { rerender } = render(<ProfileScreen />);
        fireEvent.change(screen.getByDisplayValue('Ada'), { target: { value: 'Ada Edited' } });

        // TanStack keeps the cached profile when a refetch fails, and ALSO sets `error`. Under a SUSPENSE read
        // that combination is still reachable and is still the case this test exists for: the data stays
        // settled, so the leaf keeps rendering and the boundary is never entered — only a read that NEVER
        // loaded throws. That is why the failure below must stay silent.
        useUserProfileMock.mockReturnValue({
            ...profileResult('Ada'),
            error: new Error('network down'),
        } as unknown as ReturnType<typeof useSuspenseUserProfile>);
        rerender(<ProfileScreen />);

        // A retry would change nothing on this form (it is seeded once), so the failure stays silent.
        expect(screen.getByDisplayValue('Ada Edited')).toBeTruthy();
        expect(screen.queryByText(mobileMessages.en.profile.loadError)).toBeNull();
    });

    it('exposes the account-settings entry when a handler is provided', () => {
        const onOpenAccountSettings = vi.fn();
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        render(<ProfileScreen onOpenAccountSettings={onOpenAccountSettings} />);
        fireEvent.click(screen.getByRole('button', { name: mobileMessages.en.account.settingsAction }));

        expect(onOpenAccountSettings).toHaveBeenCalledTimes(1);
    });
});
