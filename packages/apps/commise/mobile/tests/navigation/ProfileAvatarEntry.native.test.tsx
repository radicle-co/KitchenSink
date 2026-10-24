/**
 * The tab root's profile entry (`buildSpec.md` §3.1, §3.3): a button named "Profile, {name}" (or "Profile") showing the
 * cook's initials, a blank disc while the profile loads, the glyph and no error when it failed, and a press handed to
 * the navigator. The mirror of web's `ProfileAvatarEntry.test.tsx`; the two entries share
 * `profileAvatarPropsOf`, which has its own suite in `@commise/features-core`.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@commise/test-utils';

const state = vi.hoisted(() => ({
    read: { isPending: false, isError: false, data: { user: { displayName: 'Eliza Mendes' } } } as {
        isPending: boolean;
        isError: boolean;
        data?: { user: { displayName: string } };
    },
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({ useUserProfile: () => state.read }));

const { ProfileAvatarEntry } = await import('../../src/navigation/ProfileAvatarEntry.js');

afterEach(() => {
    cleanup();
    state.read = { isPending: false, isError: false, data: { user: { displayName: 'Eliza Mendes' } } };
});

describe('ProfileAvatarEntry (mobile)', () => {
    it('is named with the cook’s name and shows the initials', () => {
        renderWithProviders(<ProfileAvatarEntry onPress={() => undefined} />);

        expect(screen.getByRole('button', { name: 'Profile, Eliza Mendes' }).textContent).toBe('EM');
    });

    it('hands a press to the navigator', () => {
        const onPress = vi.fn();
        renderWithProviders(<ProfileAvatarEntry onPress={onPress} />);

        fireEvent.click(screen.getByRole('button', { name: 'Profile, Eliza Mendes' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('is named "Profile" and blank while the profile loads', () => {
        state.read = { isPending: true, isError: false };
        renderWithProviders(<ProfileAvatarEntry onPress={() => undefined} />);

        expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('');
    });

    it('is named plainly "Profile", never as an error, when the profile failed', () => {
        state.read = { isPending: false, isError: true };
        renderWithProviders(<ProfileAvatarEntry onPress={() => undefined} />);

        expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('treats a blank display name as no name', () => {
        state.read = { isPending: false, isError: false, data: { user: { displayName: '   ' } } };
        renderWithProviders(<ProfileAvatarEntry onPress={() => undefined} />);

        expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('');
    });
});
