/**
 * AUTHORED WIRE CONTRACT for the photos vertical (`POST …/photos/upload-url`, `POST …/photos/confirm`).
 *
 * SOURCE OF TRUTH for these shapes. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — see `contract/schema-imports.ts`.
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
 */
import { z } from 'zod';

import { ALLOWED_RECIPE_PHOTO_MIME_TYPES, MAX_RECIPE_PHOTO_UPLOAD_BYTES } from '@kitchensink/recipe-core';

/**
 * The content types a photo upload may declare.
 *
 * Built from `recipe-core`'s allowlist rather than an inline union so widening the allowlist widens the wire
 * contract automatically. The server still re-validates by MAGIC BYTES after upload — this is the declared
 * type, and a declared type is a client claim, never the security control.
 */
export const recipePhotoContentTypeSchema = z.enum(ALLOWED_RECIPE_PHOTO_MIME_TYPES);

/** Body of `POST /api/v1/recipes/{id}/photos/upload-url`. */
export const createPhotoUploadRequestSchema = z.object({
    /** Client-supplied original filename. Bounded; used only for logging and the object key's suffix. */
    fileName: z.string().min(1).max(255),
    contentType: recipePhotoContentTypeSchema,
    /**
     * Declared object size in bytes. Bounded HERE so an oversized upload is rejected before a presigned URL
     * is minted; the presigned POST policy enforces the same cap server-side, which is the real control.
     */
    fileSize: z.number().int().positive().max(MAX_RECIPE_PHOTO_UPLOAD_BYTES),
});

/** Request body for minting a presigned photo-upload URL. */
export type CreatePhotoUploadRequest = z.infer<typeof createPhotoUploadRequestSchema>;

/** Response of `POST /api/v1/recipes/{id}/photos/upload-url`: a presigned target for a direct S3 PUT. */
export const photoUploadUrlResponseSchema = z.object({
    uploadUrl: z.string().url(),
    /** The object key the client must echo back to `confirm`. */
    key: z.string().min(1),
    /** Presigned-URL lifetime in seconds. */
    expiresIn: z.number().int().positive(),
    /** The maximum object size in bytes this upload may carry. */
    maxBytes: z.number().int().positive(),
});

/** Response carrying a presigned photo-upload target. */
export type PhotoUploadUrlResponse = z.infer<typeof photoUploadUrlResponseSchema>;

/** Body of `POST /api/v1/recipes/{id}/photos/confirm`. */
export const confirmPhotoRequestSchema = z.object({
    /**
     * The object key returned by `upload-url`. Bounded to S3's key limit. The server re-derives the recipe
     * and owner from its own records rather than trusting anything encoded in this string.
     */
    key: z.string().min(1).max(1024),
    contentType: recipePhotoContentTypeSchema,
});

/** Request body for confirming a completed photo upload. */
export type ConfirmPhotoRequest = z.infer<typeof confirmPhotoRequestSchema>;
