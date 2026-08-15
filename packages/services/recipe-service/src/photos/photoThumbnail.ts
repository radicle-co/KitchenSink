/**
 * FOLLOW-UP-CR-001-A — the recipe-photo cover-thumbnail rendition.
 *
 * `coverPhotoUrl` used to resolve to the full-size original (up to 5 MB) even when a client only needs a
 * ~300px card tile — a real mobile-data cost (SC-009). This produces a small, bounded JPEG rendition the
 * cover projections serve instead. Resizing is delegated to `sharp` (libvips) — the library-first choice
 * per the coding standards; hand-rolling image decoding/resampling/encoding is out of the question.
 *
 * The recipe service runs on Fargate, so `sharp` installs and runs with a plain `npm i sharp` (no Lambda
 * native-binary layer), which is why the thumbnail is generated synchronously in the photo-confirm path
 * rather than in an async worker.
 */
import sharp from 'sharp';

/** The content type the thumbnail is written and served as — matches the persisted `.thumb.jpg` key. */
export const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';

/** Tunable rendition parameters (sourced from the service's storage config). */
export interface ThumbnailOptions {
    /** The maximum length (px) of the longest edge; aspect ratio is preserved and the source never upscaled. */
    readonly maxPx: number;
    /** JPEG quality (1–100); the size/quality trade-off for the rendition. */
    readonly quality: number;
}

/**
 * Resize an already-validated image buffer into a bounded cover-thumbnail JPEG.
 *
 * `.rotate()` is applied first so any EXIF orientation is baked into the pixels BEFORE metadata is
 * dropped — otherwise a phone photo would render sideways once its orientation tag is stripped. `fit:
 * 'inside'` + `withoutEnlargement` bounds the longest edge to {@link ThumbnailOptions.maxPx} without ever
 * upscaling a small source. sharp drops all metadata by default (no `.withMetadata()` call), which also
 * strips any GPS EXIF — a privacy win for the derived object.
 *
 * Throws if the buffer is not a decodable image; the caller (confirm path) treats a thumbnail failure as
 * non-fatal and degrades to serving the original, so a bad-but-magic-valid upload never fails the save.
 *
 * @param bytes - The source image bytes (already magic-byte validated and size-bounded upstream).
 * @param options - The max dimension + JPEG quality.
 * @returns The thumbnail JPEG bytes.
 * @sideEffect None — a deterministic in-process buffer → buffer transform (libvips); no I/O.
 */
export async function generateThumbnail(bytes: Uint8Array, options: ThumbnailOptions): Promise<Uint8Array> {
    const output = await sharp(Buffer.from(bytes))
        .rotate()
        .resize({ width: options.maxPx, height: options.maxPx, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: options.quality })
        .toBuffer();

    return new Uint8Array(output);
}
