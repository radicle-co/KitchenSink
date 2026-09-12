/**
 * FOLLOW-UP-CR-001-A — unit tests for {@link generateThumbnail}, the sharp-backed cover-thumbnail
 * rendition (no network, no database — a pure buffer → buffer transform over libvips).
 *
 * These pin the properties the cover projection and the size/mobile-data goal (SC-009) depend on:
 * - the output is a JPEG (the format the persisted `.thumb.jpg` key promises), regardless of input format;
 * - a large source is bounded to the configured max dimension, aspect preserved, never upscaled;
 * - a small source is not enlarged;
 * - metadata (EXIF, incl. any GPS) is stripped;
 * - a non-decodable buffer rejects (so the caller can degrade rather than persist a broken rendition).
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

import { generateThumbnail, THUMBNAIL_CONTENT_TYPE } from '../photoThumbnail.js';

/** Build a real, decodable solid-colour PNG of the given dimensions. */
async function makePng(width: number, height: number): Promise<Uint8Array> {
    const buffer = await sharp({
        create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
        .png()
        .toBuffer();

    return new Uint8Array(buffer);
}

const OPTIONS = { maxPx: 400, quality: 80 } as const;

describe('generateThumbnail', () => {
    it('emits a JPEG whatever the source format is (matches the persisted .thumb.jpg key + served type)', async () => {
        const thumb = await generateThumbnail(await makePng(800, 600), OPTIONS);
        const meta = await sharp(Buffer.from(thumb)).metadata();

        expect(meta.format).toBe('jpeg');
        expect(THUMBNAIL_CONTENT_TYPE).toBe('image/jpeg');
    });

    it('bounds the longest edge to maxPx and preserves aspect ratio (fit inside)', async () => {
        const thumb = await generateThumbnail(await makePng(1600, 800), OPTIONS);
        const meta = await sharp(Buffer.from(thumb)).metadata();

        // 1600×800 scaled into a 400×400 box, aspect kept → 400×200 (longest edge exactly the bound).
        expect(meta.width).toBe(400);
        expect(meta.height).toBe(200);
    });

    it('does NOT enlarge a source already smaller than maxPx', async () => {
        const thumb = await generateThumbnail(await makePng(120, 90), OPTIONS);
        const meta = await sharp(Buffer.from(thumb)).metadata();

        expect(meta.width).toBe(120);
        expect(meta.height).toBe(90);
    });

    it('is meaningfully smaller than a large original (the whole point — SC-009 mobile data)', async () => {
        const original = await makePng(2000, 2000);
        const thumb = await generateThumbnail(original, OPTIONS);

        expect(thumb.byteLength).toBeLessThan(original.byteLength);
    });

    it('strips metadata — an EXIF-bearing source yields a thumbnail with no EXIF (privacy)', async () => {
        const withExif = await sharp({
            create: { width: 500, height: 500, channels: 3, background: { r: 1, g: 2, b: 3 } },
        })
            .withExif({ IFD0: { Copyright: 'secret-owner' } })
            .jpeg()
            .toBuffer();

        const thumb = await generateThumbnail(new Uint8Array(withExif), OPTIONS);
        const meta = await sharp(Buffer.from(thumb)).metadata();

        expect(meta.exif).toBeUndefined();
    });

    it('rejects a buffer that is not a decodable image (lets the caller degrade, not persist garbage)', async () => {
        const notAnImage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

        // sharp/libvips rejects with its own decode-failure Error (no custom error class here — this is a
        // thin wrapper over sharp, not a domain boundary); pin the actual message so a swallowed/changed
        // failure mode is caught.
        await expect(generateThumbnail(notAnImage, OPTIONS)).rejects.toThrow(
            'Input buffer contains unsupported image format',
        );
    });
});
