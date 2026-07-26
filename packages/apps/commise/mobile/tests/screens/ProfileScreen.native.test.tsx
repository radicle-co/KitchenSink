/**
 * Component tests for the mobile ProfileScreen (react-native-web under jsdom). The load-bearing case is B1:
 * an unsaved edit MUST survive a background refetch / post-save invalidation of the same profile — which
 * holds only because the form seeds once via the `useState` initializer and remounts on `key={user.id}`,
 * not via a query-keyed `useEffect` that would clobber the edit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useUpdateProfile, useUserProfile } from '../../src/hooks/useUserProfile';
import { ProfileScreen } from '../../src/screens/profile';

// ProfileScreen now composes the shared AccountDangerZone (CR-002 / U4b), which pulls `@clerk/expo` and
// `useDeleteAccount`. Mock the Clerk native module (its ESM graph is the CI-only local-fail source) and stub
// the closure hook so the danger-zone controls render without a live session or provider.
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));

vi.mock('../../src/hooks/useUserProfile', () => ({
    useUserProfile: vi.fn(),
    useUpdateProfile: vi.fn(),
    useDeleteAccount: () => ({ mutate: vi.fn(), isPending: false }),
}));

const useUserProfileMock = vi.mocked(useUserProfile);
const useUpdateProfileMock = vi.mocked(useUpdateProfile);

/** A loaded profile-query result carrying a user with the given display name. */
function profileResult(displayName: string): ReturnType<typeof useUserProfile> {
    return {
        isLoading: false,
        error: null,
        data: { user: { id: 'usr_1', displayName, avatarUrl: '', status: 'active' } },
    } as unknown as ReturnType<typeof useUserProfile>;
}

const mutateMock = vi.fn();

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ProfileScreen — B1 (unsaved edits survive a refetch)', () => {
    it('does not clobber an unsaved display-name edit when the profile refetches', () => {
        useUpdateProfileMock.mockReturnValue({ mutate: mutateMock, isPending: false } as never);
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        const { rerender } = render(<ProfileScreen />);
        const field = screen.getByDisplayValue('Ada');

        // The user edits the field but has NOT saved yet.
        fireEvent.change(field, { target: { value: 'Ada Edited' } });
        expect(screen.getByDisplayValue('Ada Edited')).toBeTruthy();

        // A background refetch returns a DIFFERENT server value for the SAME profile (same user id).
        useUserProfileMock.mockReturnValue(profileResult('Ada Server'));
        rerender(<ProfileScreen />);

        // The unsaved edit is preserved — the refetch did not overwrite it.
        expect(screen.getByDisplayValue('Ada Edited')).toBeTruthy();
        expect(screen.queryByDisplayValue('Ada Server')).toBeNull();
    });

    it('saves the current edited value', () => {
        useUpdateProfileMock.mockReturnValue({ mutate: mutateMock, isPending: false } as never);
        useUserProfileMock.mockReturnValue(profileResult('Ada'));

        render(<ProfileScreen />);
        fireEvent.change(screen.getByDisplayValue('Ada'), { target: { value: 'Ada Edited' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mutateMock).toHaveBeenCalledWith({ displayName: 'Ada Edited', avatarUrl: '' });
    });
});
