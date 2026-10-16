/**
 * The avatar object key scheme, and how a profile's avatar URL is composed from it (ADR-0064).
 *
 * A profile stores the object KEY of an uploaded avatar, never a URL: the CDN host is configuration and can change
 * without touching a row. The response field `avatarUrl` is composed at READ time from the key and the CDN base URL.
 *
 * The key scheme is `avatars/{userId}/{timestamp}.{ext}` — write-once, because the timestamp moves, which is what makes
 * a year-long CDN cache safe. {@link isOwnAvatarKey} is the authorization rule for pointing a profile at a key: a
 * caller may name only an object under their own prefix, so `PATCH` cannot display another user's photo, or a recipe
 * photo, as one's own.
 *
 * @pattern Policy — pure functions over the key scheme and the profile's two avatar columns
 * @module
 */

/** The image types an avatar may be, mapped to the extension the key carries. */
export type AvatarExtension = 'jpg' | 'png' | 'webp';

/**
 * The key prefix that holds every avatar object of one user. Erasure and replacement delete by this prefix and
 * invalidate `/{prefix}*`, so the scheme has exactly one spelling.
 *
 * @param userId - The app-user ULID.
 * @returns `avatars/{userId}/`. Pure.
 */
export function avatarKeyPrefix(userId: string): string {
    return `avatars/${userId}/`;
}

/**
 * The key for a new upload.
 *
 * @param userId - The app-user ULID.
 * @param nowMs - Epoch milliseconds, supplied by the caller so this stays pure.
 * @param extension - The file extension of the admitted image type.
 * @returns `avatars/{userId}/{nowMs}.{extension}`. Pure.
 */
export function newAvatarKey(userId: string, nowMs: number, extension: AvatarExtension): string {
    return `${avatarKeyPrefix(userId)}${nowMs}.${extension}`;
}

/** The part of a key after the prefix: digits, one dot, a supported extension. No slash, so no nesting or traversal. */
const OWN_KEY_TAIL = /^\d+\.(?:jpg|png|webp)$/;

/**
 * Whether `key` is an avatar object this user may point their profile at.
 *
 * @param userId - The app-user ULID taken from the verified token.
 * @param key - The key the client sent.
 * @returns `true` only for `avatars/{userId}/{digits}.{jpg|png|webp}`. Pure.
 */
export function isOwnAvatarKey(userId: string, key: string): boolean {
    if (userId.length === 0) {
        return false;
    }

    const prefix = avatarKeyPrefix(userId);

    return key.startsWith(prefix) && OWN_KEY_TAIL.test(key.slice(prefix.length));
}

/**
 * The URL a profile's avatar is shown from: the CDN URL of a stored key, else the Clerk picture URL, else nothing.
 *
 * @param profile - The profile's two avatar columns.
 * @param cdnUrl - The media CDN base URL (`https://media.commise.app`), with or without a trailing slash.
 * @returns The composed URL, or `null`. Pure.
 */
export function composeAvatarUrl(
    profile: { readonly avatarKey: string | null; readonly avatarUrl: string | null },
    cdnUrl: string,
): string | null {
    if (profile.avatarKey !== null) {
        return `${cdnUrl.replace(/\/+$/, '')}/${profile.avatarKey}`;
    }

    return profile.avatarUrl;
}
