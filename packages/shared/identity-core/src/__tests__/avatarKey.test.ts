/**
 * The avatar object key scheme and how a profile's avatar URL is composed from it (ADR-0064).
 *
 * A profile stores the KEY, not a URL, so the CDN host can change without a migration. Two rules therefore carry
 * security weight and are tested as tables over shapes the tree has never held:
 *  - a caller may only point their avatar at an object under THEIR OWN prefix (`isOwnAvatarKey`), or the PATCH becomes
 *    a way to display another user's photo, or a recipe photo, as one's own;
 *  - the composed URL is the CDN URL for a stored key, else the Clerk picture, else nothing (`composeAvatarUrl`).
 */
import { describe, expect, it } from 'vitest';

import { avatarKeyPrefix, composeAvatarUrl, isOwnAvatarKey, newAvatarKey } from '../avatarKey.js';

const USER = '01J8ZQ4Y0V3W6X7A8B9C0D1E2F';
const OTHER = '01J8ZQ4Y0V3W6X7A8B9C0D1E2G';

describe('avatarKeyPrefix / newAvatarKey', () => {
    it('keeps every avatar under avatars/{userId}/', () => {
        expect(avatarKeyPrefix(USER)).toBe(`avatars/${USER}/`);
    });

    it('builds avatars/{userId}/{timestamp}.{ext}, write-once because the timestamp moves', () => {
        expect(newAvatarKey(USER, 1_760_000_000_000, 'png')).toBe(`avatars/${USER}/1760000000000.png`);
    });

    it('produces keys its own validator accepts', () => {
        for (const extension of ['jpg', 'png', 'webp'] as const) {
            expect(isOwnAvatarKey(USER, newAvatarKey(USER, 1, extension))).toBe(true);
        }
    });
});

describe('isOwnAvatarKey', () => {
    it.each([
        ['an own key', `avatars/${USER}/1760000000000.png`, true],
        ['an own jpg', `avatars/${USER}/1.jpg`, true],
        ['an own webp', `avatars/${USER}/99.webp`, true],
        ['another user’s key', `avatars/${OTHER}/1760000000000.png`, false],
        ['a recipe photo', `recipes/${USER}/photo.png`, false],
        ['a recipe photo under an avatars-looking path', `recipes/avatars/${USER}/1.png`, false],
        ['the bare prefix', `avatars/${USER}/`, false],
        ['a nested path', `avatars/${USER}/nested/1.png`, false],
        ['a traversal', `avatars/${USER}/../${OTHER}/1.png`, false],
        ['a prefix of the user id', `avatars/${USER.slice(0, 10)}/1.png`, false],
        ['the user id as a longer id prefix', `avatars/${USER}X/1.png`, false],
        ['an unsupported extension', `avatars/${USER}/1.gif`, false],
        ['no extension', `avatars/${USER}/1`, false],
        ['a non-numeric name', `avatars/${USER}/abc.png`, false],
        ['a leading slash', `/avatars/${USER}/1.png`, false],
        ['an absolute URL', `https://media.commise.app/avatars/${USER}/1.png`, false],
        ['a query string', `avatars/${USER}/1.png?x=1`, false],
        ['an empty key', '', false],
    ])('%s', (_name, key, expected) => {
        expect(isOwnAvatarKey(USER, key)).toBe(expected);
    });

    it('is false for a blank user id, whatever the key', () => {
        expect(isOwnAvatarKey('', 'avatars//1.png')).toBe(false);
    });
});

describe('composeAvatarUrl', () => {
    const cdn = 'https://media.commise.app';

    it.each([
        [
            'a stored key wins and is served from the CDN',
            { avatarKey: `avatars/${USER}/1.png`, avatarUrl: null },
            `${cdn}/avatars/${USER}/1.png`,
        ],
        [
            'no key falls back to the Clerk picture',
            { avatarKey: null, avatarUrl: 'https://img.clerk.com/a.png' },
            'https://img.clerk.com/a.png',
        ],
        ['neither is null', { avatarKey: null, avatarUrl: null }, null],
    ])('%s', (_name, profile, expected) => {
        expect(composeAvatarUrl(profile, cdn)).toBe(expected);
    });

    it('does not double the slash when the CDN url carries a trailing one', () => {
        expect(composeAvatarUrl({ avatarKey: `avatars/${USER}/1.png`, avatarUrl: null }, `${cdn}/`)).toBe(
            `${cdn}/avatars/${USER}/1.png`,
        );
    });

    it('never composes a URL from a key when the profile also names a Clerk URL: the key wins deterministically', () => {
        // The database forbids both being set; if it ever happens the stored key is the user's explicit choice.
        expect(
            composeAvatarUrl({ avatarKey: `avatars/${USER}/1.png`, avatarUrl: 'https://img.clerk.com/a.png' }, cdn),
        ).toBe(`${cdn}/avatars/${USER}/1.png`);
    });
});
