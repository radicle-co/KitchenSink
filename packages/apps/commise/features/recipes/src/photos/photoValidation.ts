/**
 * @module @commise/features-recipes/photos/photoValidation — the pure client-side pre-transmission photo
 * guard (REQ-011 size cap, REQ-012 MIME allowlist). Runs BEFORE a picked file ever reaches
 * `useRecipePhotoUploadQueue`'s presign → PUT → confirm pipeline (see that hook's `enqueue`/`retry`, the
 * only two places a file transitions to `queued`), so an oversized or disallowed file never makes a
 * wasted round trip to the server — which independently re-validates the SAME rule server-side by magic
 * bytes (REQ-013), since a client-only check is trivially spoofable and must never be trusted alone.
 *
 * Reuses the single recipe-core constants (`MAX_RECIPE_PHOTO_UPLOAD_BYTES`, `ALLOWED_RECIPE_PHOTO_MIME_TYPES`)
 * rather than re-declaring the 5 MB bound or the MIME list here — the SAME allowlist the server's magic-byte
 * revalidation (REQ-013) authoritatively re-checks, so client and server can never silently drift apart.
 */
import { ALLOWED_RECIPE_PHOTO_MIME_TYPES, MAX_RECIPE_PHOTO_UPLOAD_BYTES } from '@kitchensink/recipe-core';

/** The file metadata the pure guard needs — the subset every `RecipePhotoUploadFile` already carries. */
export interface PhotoFileToValidate {
    /** The file's declared MIME type, checked against {@link ALLOWED_RECIPE_PHOTO_MIME_TYPES}. */
    readonly contentType: string;
    /** The file's byte size, checked against {@link MAX_RECIPE_PHOTO_UPLOAD_BYTES}. */
    readonly fileSize: number;
}

/** Why {@link validatePhotoFile} rejected a file. */
export type PhotoValidationErrorCode = 'TOO_LARGE' | 'BAD_TYPE';

/** The pure validator's result — a discriminated union, so a caller must check `ok` before reading `code`. */
export type PhotoValidationResult =
    { readonly ok: true } | { readonly ok: false; readonly code: PhotoValidationErrorCode };

const VALID: PhotoValidationResult = { ok: true };

/**
 * Validate one file against the shared 5 MB / MIME-allowlist rule, before it is ever handed to the upload
 * pipeline. Pure: no I/O, no platform APIs, no localized copy (the caller maps {@link PhotoValidationErrorCode}
 * to its own already-localized string — the same i18n-agnostic contract `useRecipePhotoUpload` already uses
 * for its own error). Size is checked before type so a caller surfacing exactly one reason per file reports
 * the bound most likely to have been the deliberate one (a picked-too-large photo of an allowed format is the
 * common accidental case, ahead of a doubly-wrong file).
 *
 * Exactly-at-the-bound is valid: a 5 MB file passes (`fileSize > MAX_RECIPE_PHOTO_UPLOAD_BYTES`, not `>=`),
 * mirroring the server's own `>` check in `recipe-service/src/photos/photos.service.ts`.
 */
export function validatePhotoFile(file: PhotoFileToValidate): PhotoValidationResult {
    if (file.fileSize > MAX_RECIPE_PHOTO_UPLOAD_BYTES) {
        return { ok: false, code: 'TOO_LARGE' };
    }

    if (!(ALLOWED_RECIPE_PHOTO_MIME_TYPES as readonly string[]).includes(file.contentType)) {
        return { ok: false, code: 'BAD_TYPE' };
    }

    return VALID;
}
