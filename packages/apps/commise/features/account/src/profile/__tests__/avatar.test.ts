/**
 * The avatar's client-side limits and the words that name them, once for both apps (the limits were mobile's alone, in
 * `components/account/avatarConstraints.ts`, and the "5 MB" appeared as a literal inside a message).
 *
 * The limits mirror what the identity presign (`AvatarUploadController`) enforces, so an obviously-invalid pick fails
 * before any request. They are NOT the recipe-photo limits: the two are enforced by different services and change for
 * different reasons, so they are not merged even though the numbers match today.
 */
import { describe, expect, it } from 'vitest';

import { AVATAR_ALLOWED_TYPES, AVATAR_MAX_BYTES, AVATAR_MAX_MB, isAllowedAvatarType } from '../avatarConstraints.js';
import { avatarCopyOf } from '../avatarCopy.js';
import { profileMessages } from '../messages.js';

describe('avatar constraints', () => {
    it('allow 5 MB and JPEG, PNG and WebP, as the identity presign does', () => {
        expect(AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024);
        expect(AVATAR_MAX_MB).toBe(5);
        expect([...AVATAR_ALLOWED_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    });

    it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
        expect(isAllowedAvatarType(type)).toBe(true);
    });

    it.each(['image/gif', 'image/svg+xml', 'application/pdf', '', 'IMAGE/PNG'])('rejects %j', (type) => {
        expect(isAllowedAvatarType(type)).toBe(false);
    });
});

describe('avatarCopyOf', () => {
    const copy = avatarCopyOf(profileMessages.en);

    it('names the limit from the constant, never from a second literal', () => {
        expect(copy.tooLargeError).toBe(`That photo is larger than ${AVATAR_MAX_MB} MB. Choose a smaller file.`);
        expect(copy.tooLargeError).not.toContain('{');
    });

    it('carries the control name and both failure messages', () => {
        expect(copy.changeAction).toBe('Change photo');
        expect(copy.uploadError).toBe('We couldn’t update your photo. Please try again.');
        expect(copy.unsupportedTypeError).toBe('That file type isn’t supported. Use a JPEG, PNG, or WebP photo.');
    });
});
