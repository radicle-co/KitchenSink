/**
 * THE AVATAR-UPLOAD WIRE CONTRACT for `POST /api/v1/users/me/avatar/presign` — authored here and copied into
 * `@kitchensink/schema-identity` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * The route hands back a presigned S3 `PUT` URL so image bytes NEVER traverse this service. `type` and `size` are
 * therefore part of the security boundary, not conveniences: they are baked into the signature as `ContentType`
 * and `ContentLength`, so S3 itself rejects an upload that does not match what was presigned.
 *
 * ⚠️ THE ALLOWED TYPE LIST AND SIZE CAP ARE **NOT** IN THIS SCHEMA, and that is deliberate rather than an
 * oversight. They live in `avatar-upload.controller.ts`, which owns the presigning, and duplicating them here
 * would create two representations of one security rule that can disagree — the strictly worse outcome, because
 * the copy a client reads would then claim a bound the server does not actually enforce. This schema describes
 * the SHAPE of the exchange; the controller remains the authority on which types and sizes are admitted, and
 * reports both in its `400`.
 */
import { z } from 'zod';

/** Query for `POST /api/v1/users/me/avatar/presign`. */
export const avatarPresignQuerySchema = z.object({
    /** The image's MIME type. Restricted server-side; an unlisted type is a `400` naming what is allowed. */
    type: z.string().optional(),
    /** The image's exact byte length, as a decimal string. Bounded server-side; out of range is a `400`. */
    size: z.string().optional(),
});

/** Query for `POST /api/v1/users/me/avatar/presign`. */
export type AvatarPresignQuery = z.infer<typeof avatarPresignQuerySchema>;

/** Body for `POST /api/v1/users/me/avatar/presign` (`200`). */
export const avatarPresignResponseSchema = z.object({
    /**
     * The presigned S3 `PUT` URL. Short-lived (5 minutes) and bound to the exact `type` and `size` presigned, so
     * it cannot be replayed for a different object.
     */
    uploadUrl: z.string(),
    /** The URL the object will be readable at once the `PUT` succeeds — what to send back as `avatarUrl`. */
    publicUrl: z.string(),
});

/** Body for `POST /api/v1/users/me/avatar/presign`. */
export type AvatarPresignResponse = z.infer<typeof avatarPresignResponseSchema>;
