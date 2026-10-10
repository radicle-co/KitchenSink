/**
 * The profile entry, once for both apps (`buildSpec.md` §3.3, §3.8): loading → blank, failed → the glyph and no error,
 * ready → the name (a blank name is none), and its accessible name.
 */
import { describe, expect, it } from 'vitest';

import { profileEntryOf, profileLabelOf } from '../profileEntry.js';

const COPY = { profileButton: 'Profile, {name}', profileButtonNoName: 'Profile' };

describe('profileEntryOf', () => {
    it.each([
        ['still loading', { isError: false }, { status: 'loading', name: undefined }],
        ['failed', { isError: true }, { status: 'failed', name: undefined }],
        [
            'ready with a name',
            { isError: false, data: { user: { displayName: ' Eliza ' } } },
            { status: 'ready', name: 'Eliza' },
        ],
        [
            'ready with a blank name',
            { isError: false, data: { user: { displayName: '  ' } } },
            { status: 'ready', name: undefined },
        ],
        // A refetch that failed over cached data keeps showing the cook.
        [
            'failed over cached data',
            { isError: true, data: { user: { displayName: 'Eliza' } } },
            { status: 'ready', name: 'Eliza' },
        ],
    ] as const)('%s', (_name, read, expected) => {
        expect(profileEntryOf(read)).toStrictEqual(expected);
    });
});

describe('profileLabelOf', () => {
    it('names the entry with the cook’s name, or plainly without one', () => {
        expect(profileLabelOf(COPY, 'Eliza')).toBe('Profile, Eliza');
        expect(profileLabelOf(COPY, undefined)).toBe('Profile');
    });
});
