/**
 * `useAvatarUpload` — the native avatar upload orchestration behind the profile screen's image-picker flow
 * (U2). It mirrors the recipe-photo model rather than reinventing it: the identity service exposes a
 * presigned-PUT contract (`POST /api/v1/users/me/avatar/presign`), so the client never streams image bytes
 * through the API — it asks for a short-lived S3 URL scoped to the exact type + size, PUTs the blob straight
 * to S3, and persists only the durable public URL (via the profile PATCH the caller already owns).
 *
 * @module
 */

/**
 * @requirements
 * 1. Presign against the identity service with the blob's REAL content-type and byte size (the presign
 *    endpoint re-validates both, and the signature binds the content-type), using the native Clerk token
 *    template so the azp-less native token is admitted.
 * 2. PUT the exact blob to the returned presigned URL WITHOUT the Authorization header (the presigned URL is
 *    the credential) and with a matching `Content-Type`.
 * 3. Resolve the durable public URL on success; reject (never silently succeed) if either the presign or the
 *    S3 PUT fails, so the caller can surface a localized error and leave the stored avatar unchanged.
 */
import { avatarPresignQuerySchema, avatarPresignResponseSchema } from '@kitchensink/schema-identity';
import { useAuth } from '@clerk/expo';
import { useCallback } from 'react';

import { NATIVE_JWT_TEMPLATE } from '../auth/nativeToken.js';
import { apiRequest, type GetToken } from '../services/api.js';

/** The bytes + type of a picked avatar image, ready to upload. */
export interface AvatarUploadInput {
    /** The exact image bytes to upload (its `size` drives the presign + the size guard). */
    readonly blob: Blob;
    /** The image MIME type; must match the presigned PUT's signed `Content-Type`. */
    readonly contentType: string;
}

/** The avatar upload seam consumed by the profile screen's {@link import('../components/account/AvatarField.js')}. */
export interface UseAvatarUpload {
    /**
     * Presign, PUT the bytes to S3, and resolve the durable public URL.
     *
     * @sideEffect Two network requests: the identity presign (authenticated) and the S3 PUT (presigned).
     */
    readonly upload: (input: AvatarUploadInput) => Promise<string>;
}

/** Build the avatar upload seam bound to the current native session's token. */
export function useAvatarUpload(): UseAvatarUpload {
    const { getToken } = useAuth();

    const upload = useCallback(
        async ({ blob, contentType }: AvatarUploadInput): Promise<string> => {
            // Native tokens are azp-less; the services only admit them when minted from the native template.
            const getIdentityToken: GetToken = () => getToken({ template: NATIVE_JWT_TEMPLATE });
            // ⚠️ THE QUERY AND THE RESPONSE BOTH GO THROUGH `@kitchensink/schema-identity` (§15 rule 4). This hook
            // used to declare its OWN `interface AvatarPresignResponse { uploadUrl; publicUrl }` — a fresh
            // declaration under the exact name the identity contract already publishes, in an app that already
            // depends on that package and already imports three other types from it. Two representations of one
            // wire shape, on either side of a boundary `typecheck` could not cross.
            //
            // `size` is stringified because a query bag is strings on the wire, which is what
            // `avatarPresignQuerySchema` describes. The allowed-type list and the size cap are deliberately NOT in
            // that schema (they live in the controller that owns the presigning, so there is one authority on the
            // security rule), so an unlisted type or oversized image is still the server's `400` — this parse
            // checks the SHAPE of the exchange, which is all the contract claims to describe.
            const query = avatarPresignQuerySchema.parse({ type: contentType, size: String(blob.size) });
            const search = new URLSearchParams({ type: query.type ?? '', size: query.size ?? '' });
            const presign = await apiRequest(
                getIdentityToken,
                `/api/v1/users/me/avatar/presign?${search.toString()}`,
                avatarPresignResponseSchema,
                { method: 'POST' },
            );

            // The presigned URL is itself the credential — PUT the raw bytes with only the matching
            // Content-Type (adding Authorization would break the S3 signature).
            const putResponse = await fetch(presign.uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': contentType },
                body: blob,
            });

            if (!putResponse.ok) {
                throw new Error(`Avatar upload failed with status ${putResponse.status}`);
            }

            return presign.publicUrl;
        },
        [getToken],
    );

    return { upload };
}
