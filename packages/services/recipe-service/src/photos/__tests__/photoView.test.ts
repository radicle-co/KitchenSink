/**
 * FOLLOW-UP-CR-001-A — unit tests for the pure photo-view cover resolution.
 *
 * `resolveCoverUrl` is the row-level equivalent of the list/search cover LATERAL's
 * `COALESCE(thumbnail_key, s3_key)`: the detail read resolves its cover from the first photo ROW, so the
 * thumbnail-preferred / original-fallback rule must hold there too. The gallery (`resolvePhotoView.url`)
 * must ALWAYS stay the full-size original — these tests pin both so a mutation that serves the wrong
 * object on either surface fails.
 */
import { describe, it, expect } from 'vitest';

import { resolveCoverUrl, resolvePhotoView } from '../photoView.js';
import { makeRecipePhotoRow } from '../../__fixtures__/index.js';

const CDN = 'https://cdn.example.com';
const S3_KEY = 'recipes/01JOWNER0000000000000000A/00000000-0000-4000-8000-00000000a001/photos/photo-1';
const THUMB_KEY = `${S3_KEY}.thumb.jpg`;

describe('resolveCoverUrl', () => {
    it('serves the THUMBNAIL rendition when the photo has one', () => {
        const row = makeRecipePhotoRow({ s3Key: S3_KEY, thumbnailKey: THUMB_KEY });

        // The whole point of the feature: the cover is the small rendition, not the up-to-5 MB original.
        // A mutation that resolved `s3Key` here (ignoring the thumbnail) fails this assertion.
        expect(resolveCoverUrl(row, CDN)).toBe(`${CDN}/${THUMB_KEY}`);
    });

    it('FALLS BACK to the full-size original when the photo has no thumbnail (pre-feature / degraded)', () => {
        const row = makeRecipePhotoRow({ s3Key: S3_KEY, thumbnailKey: null });

        expect(resolveCoverUrl(row, CDN)).toBe(`${CDN}/${S3_KEY}`);
    });
});

describe('resolvePhotoView (gallery) is unaffected by the thumbnail', () => {
    it('keeps the gallery url on the FULL-SIZE original even when a thumbnail exists', () => {
        const row = makeRecipePhotoRow({ s3Key: S3_KEY, thumbnailKey: THUMB_KEY });

        // The gallery shows full images; only the COVER is a thumbnail. A mutation that pointed the gallery
        // view at the thumbnail fails here.
        expect(resolvePhotoView(row, CDN).url).toBe(`${CDN}/${S3_KEY}`);
    });
});
