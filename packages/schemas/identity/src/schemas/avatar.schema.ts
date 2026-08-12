/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the identity service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/identity-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/identity/src/users/avatar.schema.ts

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

/**
 * Query for `POST /api/v1/users/me/avatar/presign`.
 *
 * ⚠️ THIS SCHEMA EXISTED AND WAS NEVER WIRED UP, and the shape it described was too loose to have helped even
 * if it had been. The controller read two bare `@Query()` strings — metatype `String`, which the global
 * `ZodValidationPipe` passes straight through — and hand-parsed the size as
 * `size ? Number.parseInt(size, 10) : 0`. `Number.parseInt('abc', 10)` is `NaN`, and every comparison against
 * `NaN` is false, so `NaN <= 0 || NaN > maxSizeBytes` admitted it and `ContentLength: NaN` was signed into the
 * presigned URL. Both fields are therefore REQUIRED here, and `size` is COERCED to a positive integer rather
 * than left as a string for a caller to re-parse (the same correction `adminListUsersQuerySchema` needed).
 */
export const avatarPresignQuerySchema = z.object({
    /** The image's MIME type. Restricted server-side; an unlisted type is a `400` naming what is allowed. */
    type: z.string().min(1),
    /**
     * The image's exact byte length. Sent as a decimal string and coerced; a value that is not a positive
     * integer is a `400` here. The CAP is not restated in this schema — see the note above: the controller owns
     * it, and reports it in its own `400`.
     */
    size: z.coerce.number().int().positive(),
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
