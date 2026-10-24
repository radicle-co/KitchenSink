/**
 * @module @commise/features-account/profile/avatarCopy — the words an avatar picker needs, from the shared Profile copy.
 *
 * The photo control is a platform-bound picker (mobile's `expo-image-picker`; web's is not built yet), but what it SAYS is
 * the same on both. The size limit is filled from {@link AVATAR_MAX_MB}, so the message cannot name a different limit than
 * the one the picker enforces.
 */
import { AVATAR_MAX_MB } from './avatarConstraints.js';
import type { ProfileMessages } from './messages.js';

/** The copy an avatar picker renders. */
export interface AvatarCopy {
    /** The control's accessible name: what pressing the avatar does. */
    readonly changeAction: string;
    /** Reported when picking or uploading fails. */
    readonly uploadError: string;
    /** Reported when the picked image is over the limit. */
    readonly tooLargeError: string;
    /** Reported when the picked image's type is outside the allowlist. */
    readonly unsupportedTypeError: string;
}

/**
 * @param t - The Profile page's localized copy.
 * @returns The avatar picker's copy, with the size limit filled in. Pure.
 */
export function avatarCopyOf(t: ProfileMessages): AvatarCopy {
    return {
        changeAction: t.avatarChangeAction,
        uploadError: t.avatarUploadError,
        tooLargeError: t.avatarTooLargeError.replace('{maxMb}', String(AVATAR_MAX_MB)),
        unsupportedTypeError: t.avatarUnsupportedTypeError,
    };
}
