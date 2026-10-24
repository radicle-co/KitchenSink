/**
 * @module @commise/features-account/profile/avatarConstraints — the client-side avatar image limits, once for both apps.
 *
 * The single source of the size and type limits the avatar picker pre-checks BEFORE uploading, kept in lockstep with what
 * the identity presign endpoint (`AvatarUploadController`) enforces server-side. Pure data and a pure predicate: no React,
 * no network, so the picker can use them without dragging the token or network graph into its tests.
 *
 * ⚠️ These are the AVATAR limits, not the recipe-photo ones (`@kitchensink/recipe-core`). Identity enforces these and the
 * recipe service enforces those; they change for different reasons, so they are deliberately two constants even while the
 * numbers match.
 */

/** The ceiling the identity presign enforces (mirrored here for a fast pre-upload check): 5 MB. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** {@link AVATAR_MAX_BYTES} in whole megabytes, for the message that names the limit. */
export const AVATAR_MAX_MB = AVATAR_MAX_BYTES / (1024 * 1024);

/** The image types the identity presign accepts (mirrored here for a fast pre-upload check). */
export const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * @param contentType - The picked image's MIME type.
 * @returns True when the avatar presign will accept `contentType`. Pure.
 */
export function isAllowedAvatarType(contentType: string): boolean {
    return (AVATAR_ALLOWED_TYPES as readonly string[]).includes(contentType);
}
