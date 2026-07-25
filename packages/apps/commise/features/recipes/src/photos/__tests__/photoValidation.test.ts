/**
 * Unit tests for the pure client-side photo pre-validation guard (REQ-011 size cap, REQ-012 MIME
 * allowlist). Pins the exact boundary (5 MB inclusive) and the exact allowlist (REQ-012's three
 * server-deliverable types — HEIC/HEIF are deliberately excluded, see `ALLOWED_RECIPE_PHOTO_MIME_TYPES`),
 * so a mutated `>` → `>=`, an off-by-one on the byte bound, or a narrowed/widened allowlist fails a test
 * here rather than surfacing as a silently-wrong client accept/reject.
 */
import { describe, expect, it } from 'vitest';

import { MAX_RECIPE_PHOTO_UPLOAD_BYTES } from '@kitchensink/recipe-core';

import { validatePhotoFile } from '../photoValidation.js';

const VALID_TYPE = 'image/png';

describe('validatePhotoFile — size boundary (REQ-011)', () => {
    it('accepts a file at exactly the 5 MB bound', () => {
        const result = validatePhotoFile({ contentType: VALID_TYPE, fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES });

        expect(result).toEqual({ ok: true });
    });

    it('rejects a file one byte over the 5 MB bound as TOO_LARGE', () => {
        const result = validatePhotoFile({ contentType: VALID_TYPE, fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1 });

        expect(result).toEqual({ ok: false, code: 'TOO_LARGE' });
    });

    it('accepts a well-under-bound file', () => {
        const result = validatePhotoFile({ contentType: VALID_TYPE, fileSize: 1024 });

        expect(result).toEqual({ ok: true });
    });
});

describe('validatePhotoFile — MIME allowlist (REQ-012)', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts the allowlisted type %s', (contentType) => {
        const result = validatePhotoFile({ contentType, fileSize: 1024 });

        expect(result).toEqual({ ok: true });
    });

    it('rejects a non-image MIME type as BAD_TYPE', () => {
        const result = validatePhotoFile({ contentType: 'application/pdf', fileSize: 1024 });

        expect(result).toEqual({ ok: false, code: 'BAD_TYPE' });
    });

    it('rejects a disallowed image MIME type (e.g. GIF) as BAD_TYPE', () => {
        const result = validatePhotoFile({ contentType: 'image/gif', fileSize: 1024 });

        expect(result).toEqual({ ok: false, code: 'BAD_TYPE' });
    });

    // HEIC/HEIF are recognized image formats but NOT server-deliverable today (the recipe-service's
    // `sharp` build cannot decode/thumbnail them — see ALLOWED_RECIPE_PHOTO_MIME_TYPES's own doc and
    // specs/001-commise-recipe-app's waivers.md WAV-001) — the client MUST reject them, matching the
    // server's own REQ-013 magic-byte allowlist, so a user never passes client validation only to be
    // rejected on confirm.
    it.each(['image/heic', 'image/heif'])(
        'rejects HEIC/HEIF (%s) as BAD_TYPE — not server-deliverable',
        (contentType) => {
            const result = validatePhotoFile({ contentType, fileSize: 1024 });

            expect(result).toEqual({ ok: false, code: 'BAD_TYPE' });
        },
    );

    it('reports TOO_LARGE ahead of BAD_TYPE when a file is both oversized and disallowed', () => {
        const result = validatePhotoFile({
            contentType: 'image/gif',
            fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1,
        });

        expect(result).toEqual({ ok: false, code: 'TOO_LARGE' });
    });
});
