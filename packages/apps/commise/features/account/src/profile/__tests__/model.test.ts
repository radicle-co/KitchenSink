/**
 * The Profile page's pure rules (`docs/design/uiOverhaul/buildSpec.md` §9.1; blueprint A17).
 *
 * The display name is the one thing the page writes, and it can show publicly as an author handle, so the rules that
 * decide what the field holds and when Save may fire are pinned here: a Google given name PREFILLS an empty field and
 * never overwrites a saved name, and nothing is written until the cook presses Save.
 */
import { describe, expect, it } from 'vitest';

import {
    DISPLAY_NAME_MAX_LENGTH,
    canSaveDisplayName,
    displayNameDraftOf,
    givenNameOf,
    profileReadOf,
} from '../model.js';

describe('givenNameOf (A17)', () => {
    it('prefers the Google account’s given name over the user’s own first name', () => {
        expect(
            givenNameOf({
                firstName: 'Fallback',
                externalAccounts: [
                    { provider: 'github', firstName: 'Hub' },
                    { provider: 'google', firstName: 'Eliza' },
                ],
            }),
        ).toBe('Eliza');
    });

    it('reads the older oauth_ provider spelling too', () => {
        expect(
            givenNameOf({ firstName: null, externalAccounts: [{ provider: 'oauth_google', firstName: 'Eliza' }] }),
        ).toBe('Eliza');
    });

    it('falls back to the user’s first name when the Google entry has none', () => {
        expect(givenNameOf({ firstName: 'Ana', externalAccounts: [{ provider: 'google', firstName: '  ' }] })).toBe(
            'Ana',
        );
        expect(givenNameOf({ firstName: 'Ana' })).toBe('Ana');
    });

    it('answers nothing when Clerk holds no name (the dashboard’s name fields are off)', () => {
        expect(givenNameOf({ firstName: null, externalAccounts: [] })).toBeUndefined();
        expect(givenNameOf({})).toBeUndefined();
        expect(givenNameOf(null)).toBeUndefined();
        expect(givenNameOf(undefined)).toBeUndefined();
    });

    it('trims what it returns', () => {
        expect(givenNameOf({ firstName: '  Ana ' })).toBe('Ana');
    });
});

describe('displayNameDraftOf', () => {
    it('starts from the saved name', () => {
        expect(displayNameDraftOf({ saved: 'Eliza Moreno', givenName: 'Eliza' })).toBe('Eliza Moreno');
    });

    it('never lets the prefill replace a saved name', () => {
        expect(displayNameDraftOf({ saved: 'Chef E', givenName: 'Eliza' })).toBe('Chef E');
    });

    it('prefills the given name only when nothing is saved', () => {
        expect(displayNameDraftOf({ saved: '', givenName: 'Eliza' })).toBe('Eliza');
        expect(displayNameDraftOf({ saved: '   ', givenName: 'Eliza' })).toBe('Eliza');
    });

    it('is empty when there is neither', () => {
        expect(displayNameDraftOf({ saved: '', givenName: undefined })).toBe('');
    });
});

describe('canSaveDisplayName', () => {
    it('allows a new, non-blank name', () => {
        expect(canSaveDisplayName({ draft: 'Eliza', saved: '' })).toBe(true);
        expect(canSaveDisplayName({ draft: 'Eliza M', saved: 'Eliza' })).toBe(true);
    });

    it('allows saving the prefill, which differs from the empty saved name', () => {
        expect(canSaveDisplayName({ draft: displayNameDraftOf({ saved: '', givenName: 'Eliza' }), saved: '' })).toBe(
            true,
        );
    });

    it('refuses a blank name, because the server would store an empty handle', () => {
        expect(canSaveDisplayName({ draft: '   ', saved: 'Eliza' })).toBe(false);
        expect(canSaveDisplayName({ draft: '', saved: '' })).toBe(false);
    });

    it('refuses an unchanged name (trimming first)', () => {
        expect(canSaveDisplayName({ draft: ' Eliza ', saved: 'Eliza' })).toBe(false);
    });

    it('refuses a name over the limit and accepts one at it', () => {
        expect(canSaveDisplayName({ draft: 'a'.repeat(DISPLAY_NAME_MAX_LENGTH), saved: '' })).toBe(true);
        expect(canSaveDisplayName({ draft: 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1), saved: '' })).toBe(false);
    });
});

describe('profileReadOf', () => {
    it('is loading until the read settles', () => {
        expect(profileReadOf({ isError: false, data: undefined })).toEqual({ status: 'loading' });
    });

    it('is failed when the read failed and nothing is cached', () => {
        expect(profileReadOf({ isError: true, data: undefined })).toEqual({ status: 'failed' });
    });

    it('is ready with the name and email, trimmed, once there is data', () => {
        expect(
            profileReadOf({ isError: false, data: { user: { displayName: ' Eliza ', email: 'e@example.com' } } }),
        ).toEqual({ status: 'ready', displayName: 'Eliza', email: 'e@example.com' });
    });

    it('stays ready when a background refetch fails but the cached profile is still there', () => {
        expect(profileReadOf({ isError: true, data: { user: { displayName: '', email: 'e@example.com' } } })).toEqual({
            status: 'ready',
            displayName: '',
            email: 'e@example.com',
        });
    });
});
