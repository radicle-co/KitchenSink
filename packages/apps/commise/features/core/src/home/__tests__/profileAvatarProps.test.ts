/**
 * What the header's avatar shows from the profile read, once for both apps: the web and mobile `ProfileAvatarEntry`
 * each made the same three helper calls (`profileEntryOf`, `initialsFor`, `profileLabelOf`) by hand.
 */
import { describe, expect, it } from 'vitest';

import { profileAvatarPropsOf } from '../profileAvatarProps.js';

const COPY = { profileButton: 'Profile, {name}', profileButtonNoName: 'Profile' };

describe('profileAvatarPropsOf', () => {
    it('shows the cook’s initials and names the entry with the cook’s name once the profile is ready', () => {
        const read = { isError: false, data: { user: { displayName: ' Eliza Mendes ' } } };

        expect(profileAvatarPropsOf(read, COPY)).toStrictEqual({
            status: 'ready',
            initials: 'EM',
            label: 'Profile, Eliza Mendes',
        });
    });

    it('is a blank disc with the plain name while the profile loads', () => {
        expect(profileAvatarPropsOf({ isError: false }, COPY)).toStrictEqual({
            status: 'loading',
            initials: '',
            label: 'Profile',
        });
    });

    it('is the failed glyph, and still the plain name, when the read failed (Profile reports the error)', () => {
        expect(profileAvatarPropsOf({ isError: true }, COPY)).toStrictEqual({
            status: 'failed',
            initials: '',
            label: 'Profile',
        });
    });

    it('treats a blank display name as none: ready, no initials, the plain name', () => {
        const read = { isError: false, data: { user: { displayName: '   ' } } };

        expect(profileAvatarPropsOf(read, COPY)).toStrictEqual({ status: 'ready', initials: '', label: 'Profile' });
    });
});
