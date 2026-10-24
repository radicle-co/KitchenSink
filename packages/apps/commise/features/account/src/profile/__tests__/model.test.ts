/**
 * The Profile page's pure rules (`docs/design/uiOverhaul/buildSpec.md` §9.1; blueprint A17).
 *
 * The display name is the one thing the page writes, and it can show publicly as an author handle, so the rules that
 * decide what the field holds and when Save may fire are pinned here: a Google given name PREFILLS an empty field and
 * never overwrites a saved name, and nothing is written until the cook presses Save.
 */
import { describe, expect, it } from 'vitest';
import { patchUserMeRequestSchema } from '@kitchensink/schema-identity';

import {
    DISPLAY_NAME_MAX_LENGTH,
    canSaveDisplayName,
    displayNameDraftOf,
    formatNameCounter,
    givenNameOf,
    nameCounterOf,
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
            profileReadOf({
                isError: false,
                data: { user: { displayName: ' Eliza ', email: 'e@example.com', username: null } },
            }),
        ).toEqual({ status: 'ready', displayName: 'Eliza', email: 'e@example.com', username: null });
    });

    // Plan 2026-10-15-010 D12: the Clerk username shows read-only beside the name; Clerk owns it, so no rename.
    it('carries the Clerk username when the cook has one', () => {
        expect(
            profileReadOf({
                isError: false,
                data: { user: { displayName: 'Eliza', email: 'e@example.com', username: 'braise' } },
            }),
        ).toEqual({ status: 'ready', displayName: 'Eliza', email: 'e@example.com', username: 'braise' });
    });

    it('stays ready when a background refetch fails but the cached profile is still there', () => {
        expect(
            profileReadOf({
                isError: true,
                data: { user: { displayName: '', email: 'e@example.com', username: null } },
            }),
        ).toEqual({
            status: 'ready',
            displayName: '',
            email: 'e@example.com',
            username: null,
        });
    });
});

/**
 * The limit is the identity service's, read from its contract (`patchUserMeRequestSchema`), so a change to the
 * service's limit moves the field and the Save gate with it. Pinned on the BEHAVIOUR of the contract, not on a number:
 * the longest name the gate allows is one the service accepts, and one more character is one it refuses.
 */
describe('DISPLAY_NAME_MAX_LENGTH — the identity contract’s limit', () => {
    it('is the longest display name the PATCH accepts', () => {
        expect(patchUserMeRequestSchema.safeParse({ displayName: 'a'.repeat(DISPLAY_NAME_MAX_LENGTH) }).success).toBe(
            true,
        );
        expect(
            patchUserMeRequestSchema.safeParse({ displayName: 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1) }).success,
        ).toBe(false);
    });
});

/**
 * W-26: the display-name field has a hard `maxLength`, so a paste past it was cut with nothing saying so. A counter says
 * how close the cook is, from 80 % of the limit (build spec §5.1 pattern for bounded fields), and the limit itself.
 */
describe('nameCounterOf (W-26)', () => {
    it('says nothing below 80 characters', () => {
        expect(nameCounterOf('')).toBeUndefined();
        expect(nameCounterOf('x'.repeat(79))).toBeUndefined();
    });

    it('counts from 80 characters up to the limit', () => {
        expect(nameCounterOf('x'.repeat(80))).toEqual({ count: 80, max: DISPLAY_NAME_MAX_LENGTH, atLimit: false });
        expect(nameCounterOf('x'.repeat(99))).toEqual({ count: 99, max: DISPLAY_NAME_MAX_LENGTH, atLimit: false });
    });

    it('flags the limit at the maximum length', () => {
        expect(nameCounterOf('x'.repeat(DISPLAY_NAME_MAX_LENGTH))).toEqual({
            count: DISPLAY_NAME_MAX_LENGTH,
            max: DISPLAY_NAME_MAX_LENGTH,
            atLimit: true,
        });
    });

    it('counts the text as typed, spaces included, because that is what the field’s limit counts', () => {
        expect(nameCounterOf(`${' '.repeat(40)}${'x'.repeat(40)}`)?.count).toBe(80);
    });
});

describe('formatNameCounter (W-26)', () => {
    it('fills the template’s {count} and {max}', () => {
        expect(formatNameCounter('{count}/{max}', { count: 85, max: 100, atLimit: false })).toBe('85/100');
    });
});
