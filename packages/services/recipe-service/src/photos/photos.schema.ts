/**
 * AUTHORED WIRE CONTRACT for the photos vertical (`POST …/photos/upload-url`, `POST …/photos/confirm`).
 *
 * SOURCE OF TRUTH for these shapes. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/generate.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, composed with Value Objects from `recipe-core`.
 *
 * WHY THE CONSTANTS COME FROM `recipe-core` AND ARE NOT SPELLED OUT HERE. The 5 MB cap
 * ({@link MAX_RECIPE_PHOTO_UPLOAD_BYTES}) and the MIME allowlist ({@link ALLOWED_RECIPE_PHOTO_MIME_TYPES}) are
 * already single-sourced there and consumed by BOTH the server's presign/confirm bound and the client's
 * pre-transmission guard. Restating either as a literal in this file would create a second authority for a
 * security-relevant bound — the precise failure `recipe-core`'s docstrings record having already fixed once.
 * HEIC/HEIF are absent from that allowlist deliberately (the `sharp` build cannot decode HEVC); this schema
 * inherits that decision rather than re-litigating it.
 *
 * ── STRICT REQUEST BODIES, AND WHY THAT DOES NOT DISTURB THE 413/415 SPLIT ──
 *
 * All three request bodies are `z.strictObject` per GR-017 §17-c. That is orthogonal to the split this file's
 * long note above describes: strictness judges WHICH KEYS a body has, while the `415`/`413` answers judge the
 * VALUES of `contentType` and `fileSize`. An unknown key is now a `400` from the pipe; a non-allowlisted content
 * type is still a `415` from `PhotosService`, and an oversized declared size still a `413`. ⛔ Do not read this
 * change as licence to narrow `contentType` to {@link recipePhotoContentTypeSchema} — that would collapse the
 * `415` into a `400`, which is the regression the note above exists to prevent.
 */
import { z } from 'zod';

import {
    recipePhotoSchema,
    ALLOWED_RECIPE_PHOTO_MIME_TYPES,
    MAX_RECIPE_PHOTO_UPLOAD_BYTES,
} from '@kitchensink/recipe-core';

/**
 * The content types a photo upload may declare — the DOCUMENTED allowlist, not a request validator.
 *
 * Built from `recipe-core`'s allowlist rather than an inline union so widening the allowlist widens the
 * published contract automatically. The server still re-validates by MAGIC BYTES after upload — a declared
 * type is a client claim, never the security control.
 *
 * ⚠️ IT IS DELIBERATELY **NOT** THE TYPE OF `contentType` BELOW, and narrowing those fields to it would be
 * a wire REGRESSION, not a tightening. `PhotosService.createUploadUrl` answers a non-allowlisted content
 * type with **415 Unsupported Media Type** (and an oversized declared size with **413**). A schema-level
 * `z.enum` runs in the `ZodValidationPipe`, which is BEFORE the controller, so it would collapse both
 * answers to a generic **400** — losing the status a client uses to tell "we don't support that format"
 * apart from "your JSON was malformed", and silently breaking the shipped `415`/`413` behaviour that
 * `photos.service.test.ts` asserts.
 *
 * So the split is: this schema is what the API *accepts semantically* (published, and consumed by the
 * client's pre-transmission guard); the request schemas below are what the *validation layer* enforces,
 * which is shape only. Both facts are true, and `photos.dto.test.ts` reds the build if either drifts.
 */
export const recipePhotoContentTypeSchema = z.enum(ALLOWED_RECIPE_PHOTO_MIME_TYPES);

/** Body of `POST /api/v1/recipes/{id}/photos/upload-url`. */
export const createPhotoUploadRequestSchema = z.strictObject({
    /** Client-supplied original filename. Bounded; used only for logging and the object key's suffix. */
    fileName: z.string().min(1).max(255),
    /**
     * The content type the client intends to upload. SHAPE-bounded here; the allowlist decision is the
     * service's `415` — see {@link recipePhotoContentTypeSchema} for why it is not narrowed at this layer.
     */
    contentType: z
        .string()
        .min(1)
        .max(100)
        .meta({
            description: `Intended object content type. Accepted values: ${ALLOWED_RECIPE_PHOTO_MIME_TYPES.join(', ')}. Anything else is answered 415 by the service, not 400.`,
        }),
    /**
     * Declared object size in bytes. Positive integer; the 5 MB ceiling is the service's `413` (and the
     * presigned policy's server-side enforcement), so it is NOT re-encoded as a `.max()` here.
     */
    fileSize: z
        .number()
        .int()
        .positive()
        .meta({
            description: `Declared object size in bytes. Must not exceed ${MAX_RECIPE_PHOTO_UPLOAD_BYTES} (5 MB); a larger value is answered 413 by the service, not 400.`,
        }),
});

/** Request body for minting a presigned photo-upload URL. */
export type CreatePhotoUploadRequest = z.infer<typeof createPhotoUploadRequestSchema>;

/**
 * Response of `POST /api/v1/recipes/{id}/photos/upload-url`: a presigned target for a direct S3 PUT.
 *
 * `readonly` throughout, matching every other response shape in this contract and the promise the typed client
 * already made its callers. A parsed response body is a snapshot of what the server said; a consumer mutating
 * it in place corrupts a value other consumers (and the query cache) share. Verified rather than assumed: no
 * consumer mutates one — every read site passes it to `fetch` or reads a field.
 */
export const photoUploadUrlResponseSchema = z
    .object({
        uploadUrl: z.string().url(),
        /** The object key the client must echo back to `confirm`. */
        key: z.string().min(1),
        /** Presigned-URL lifetime in seconds. */
        expiresIn: z.number().int().positive(),
        /** The maximum object size in bytes this upload may carry. */
        maxBytes: z.number().int().positive(),
    })
    .readonly();

/** Response carrying a presigned photo-upload target. */
export type PhotoUploadUrlResponse = z.infer<typeof photoUploadUrlResponseSchema>;

/** Body of `POST /api/v1/recipes/{id}/photos/confirm`. */
export const confirmPhotoRequestSchema = z.strictObject({
    /**
     * The object key returned by `upload-url`. Bounded to S3's key limit. The server re-derives the recipe
     * and owner from its own records rather than trusting anything encoded in this string.
     */
    key: z.string().min(1).max(1024),
    /**
     * Accepted for contract conformance and then IGNORED: `confirm` sniffs the stored object's magic bytes
     * and persists the DETECTED type, so this value is never trusted or stored. Narrowing it to the
     * allowlist would be doubly wrong — it would reject a body whose declared type is irrelevant, with the
     * wrong status. See {@link recipePhotoContentTypeSchema}.
     */
    contentType: z.string().min(1).max(100).meta({
        description:
            'Declared content type of the uploaded object. Accepted but NOT trusted: the stored type is detected from the object bytes.',
    }),
});

/** Request body for confirming a completed photo upload. */
export type ConfirmPhotoRequest = z.infer<typeof confirmPhotoRequestSchema>;

/**
 * Body of `PATCH /api/v1/recipes/{id}/photos/reorder`.
 *
 * The recipe's photo ids in their desired display order; the DAL rewrites each row's `sortOrder` to the
 * index in this array. Non-empty, because an empty array asks for no reordering at all and the honest answer
 * to that is a `400`, not a silent success.
 */
export const reorderPhotosRequestSchema = z.strictObject({
    /** Photo ids in display order. v4 UUIDs — the nil UUID names no photo and is rejected. */
    photoIds: z.array(z.uuid({ version: 'v4' })).min(1),
});

/** Request body for setting a recipe's photo display order. */
export type ReorderPhotosRequest = z.infer<typeof reorderPhotosRequestSchema>;

// ── Re-exported wire shapes: the photo entity body this vertical serves ───────────────────────────

/*
 * ⚠️ RE-EXPORT, NOT RE-DECLARATION. `recipe-core` remains the sole AUTHOR; this makes the shape reachable from
 * `@kitchensink/schema-recipe`, which is authoritative for everything on the recipe wire. The full reasoning
 * (and the `CONTRACT_HASH` residual it does not close) is stated ONCE, in `recipes.schema.ts`. ⛔ Do not
 * re-declare it here to make this file self-contained.
 */
export {
    /** The `RecipePhoto` component — one photo, and each element of the `RecipePhotoList` body. */
    recipePhotoSchema,
};
