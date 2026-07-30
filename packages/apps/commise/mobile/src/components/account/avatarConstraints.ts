/**
 * @module components/account/avatarConstraints — the client-side avatar image constraints (U2).
 *
 * The single source of the size + type limits the profile avatar picker pre-checks BEFORE uploading, kept
 * in lockstep with what the identity presign endpoint (`AvatarUploadController`) enforces server-side. Pure
 * data + a pure predicate (no React, no network, no `@clerk/expo`) so it is trivially testable and can be
 * consumed by the picker component without dragging the token/network graph into its tests.
 */

/** The 5 MB ceiling the identity presign enforces (mirrored here for a fast pre-upload check). */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** The image types the identity presign accepts (mirrored here for a fast pre-upload check). */
export const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** True when `contentType` is one the avatar presign will accept. */
export function isAllowedAvatarType(contentType: string): boolean {
    return (AVATAR_ALLOWED_TYPES as readonly string[]).includes(contentType);
}
