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
 *    endpoint re-validates both, and the signature binds the content-type), through the shared
 *    {@link useProfileServiceClient} client — which mints the native Clerk token, parses both directions against
 *    the published contract, and reports contract skew.
 * 2. PUT the exact blob to the returned presigned URL WITHOUT the Authorization header (the presigned URL is
 *    the credential) and with a matching `Content-Type`.
 * 3. Resolve the durable public URL on success; reject (never silently succeed) if either the presign or the
 *    S3 PUT fails, so the caller can surface a localized error and leave the stored avatar unchanged.
 */
import { useMutation } from '@tanstack/react-query';

import { useProfileServiceClient } from './useProfileServiceClient.js';

/** The bytes + type of a picked avatar image, ready to upload. */
export interface AvatarUploadInput {
    /** The exact image bytes to upload (its `size` drives the presign + the size guard). */
    readonly blob: Blob;
    /** The image MIME type; must match the presigned PUT's signed `Content-Type`. */
    readonly contentType: string;
}

/** The avatar upload seam consumed by the profile screen's `../components/account/AvatarField.tsx`. */
export interface UseAvatarUpload {
    /**
     * Presign, PUT the bytes to S3, and resolve the durable public URL.
     *
     * @sideEffect Two network requests: the identity presign (authenticated) and the S3 PUT (presigned).
     */
    readonly upload: (input: AvatarUploadInput) => Promise<string>;
    /** Whether an upload is in flight — react-query's own status, not a hand-rolled boolean. */
    readonly isPending: boolean;
    /** The failure of the last attempt, or `null`. The caller still owns the localized COPY. */
    readonly error: Error | null;
}

/**
 * Build the avatar upload seam bound to the current native session's token.
 *
 * ⛔ REACT-QUERY FRONTS THE CALL (owner directive: every network call goes through it). This was a bare
 * `useCallback` that invoked `client.presignAvatar` directly, so the only evidence an upload was happening
 * was a `busy` boolean private to `AvatarField` — unobservable to any other surface and outside the cache
 * entirely. As a mutation the status lives where every other write's status lives.
 *
 * ⚠️ The whole presign → PUT sequence is ONE `mutationFn`, deliberately. The S3 PUT cannot be a react-query
 * call of its own: the presigned URL IS the credential, it is minted by the step before it, and adding an
 * `Authorization` header would break the S3 signature. One mutation is what makes the pair atomic from the
 * caller's point of view — either a durable public URL comes back, or the attempt failed.
 *
 * ⚠️ It deliberately invalidates NOTHING. The presign mints a URL and changes no server state the UI reads;
 * the durable write is the profile PATCH the caller performs with the returned URL, and that mutation owns
 * its own invalidation. Adding a speculative invalidation here would refetch the profile to no effect.
 */
export function useAvatarUpload(): UseAvatarUpload {
    const client = useProfileServiceClient();

    const mutation = useMutation({
        mutationFn: async ({ blob, contentType }: AvatarUploadInput): Promise<string> => {
            // ⚠️ THE PRESIGN GOES THROUGH `ProfileServiceClient`, NOT A TRANSPORT OF ITS OWN. This hook used to call
            // `services/api.ts`'s `apiRequest` — a second way to reach identity, and the only one outside the funnel
            // that reports contract skew, so a RELEASED binary uploading an avatar against a service that had moved
            // ahead of it produced no signal (GR-017 §17-b.5). The client owns the path, the query encoding, and the
            // parse of both directions against `@kitchensink/schema-identity`.
            //
            // `blob.size` — never `asset.fileSize`, which Android/web often omit — because the service signs it into
            // the presigned URL as `ContentLength` and S3 rejects a PUT that does not match.
            const presign = await client.presignAvatar({ type: contentType, size: blob.size });

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
    });

    // `mutateAsync` rather than `mutate`, because the caller awaits the public URL and surfaces its own
    // localized failure — the rejection IS the contract `AvatarField` catches.
    return { upload: mutation.mutateAsync, isPending: mutation.isPending, error: mutation.error };
}
