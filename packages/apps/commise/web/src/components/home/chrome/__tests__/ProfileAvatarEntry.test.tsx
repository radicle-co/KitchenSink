// @vitest-environment jsdom
/**
 * The page header's profile entry (`buildSpec.md` §3.3, §3.8): a link to Profile named "Profile, {name}" (or "Profile"),
 * a blank disc while the profile loads, the glyph and no error when it failed, and a plain click handed to the router.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { ProfileAvatarEntry } from '../ProfileAvatarEntry';

const state = vi.hoisted(() => ({
    read: { isPending: false, isError: false, data: { user: { displayName: 'Eliza Mendes' } } } as {
        isPending: boolean;
        isError: boolean;
        data?: { user: { displayName: string } };
    },
    push: vi.fn(),
}));

vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => state.read }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));

afterEach(() => {
    cleanup();
    state.push.mockReset();
});

describe('ProfileAvatarEntry (web)', () => {
    it('links to Profile, named with the cook’s name, showing the initials', () => {
        renderWithProviders(<ProfileAvatarEntry />);

        const link = screen.getByRole('link', { name: 'Profile, Eliza Mendes' });

        expect(link.getAttribute('href')).toBe('/en/profile');
        expect(link.textContent).toBe('EM');
    });

    it('hands a plain click to the router', () => {
        renderWithProviders(<ProfileAvatarEntry />);

        fireEvent.click(screen.getByRole('link', { name: 'Profile, Eliza Mendes' }));

        expect(state.push).toHaveBeenCalledWith('/en/profile');
    });

    it('is named "Profile" and blank while the profile loads', () => {
        state.read = { isPending: true, isError: false };
        renderWithProviders(<ProfileAvatarEntry />);

        const link = screen.getByRole('link', { name: 'Profile' });

        expect(link.textContent).toBe('');
        expect(link.querySelector('svg')).toBeNull();
    });

    it('shows the glyph, never an error, when the profile failed', () => {
        state.read = { isPending: false, isError: true };
        renderWithProviders(<ProfileAvatarEntry />);

        expect(screen.getByRole('link', { name: 'Profile' }).querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('treats a blank display name as no name', () => {
        state.read = { isPending: false, isError: false, data: { user: { displayName: '   ' } } };
        renderWithProviders(<ProfileAvatarEntry />);

        expect(screen.getByRole('link', { name: 'Profile' }).querySelector('svg')).not.toBeNull();
    });
});
