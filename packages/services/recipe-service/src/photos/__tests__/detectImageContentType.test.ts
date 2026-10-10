/**
 * Unit tests for {@link detectImageContentType} — the upload validator.
 *
 * Detection is delegated to the maintained `file-type` library; what THIS module owns — and what these
 * tests pin — is (1) the SECURITY allowlist gate (a format file-type recognizes but that is not served,
 * notably HEIC, is rejected) and (2) ROBUSTNESS: file-type THROWS (EndOfStream) on a truncated/malformed
 * buffer, and the validator must turn that into a clean reject, never let it escape as a 500. Full
 * end-to-end acceptance of all three served formats (real JPEG/PNG/WebP uploads) lives in the upload
 * integration spec.
 */
import { describe, it, expect } from 'vitest';

import { detectImageContentType } from '../photos.service.js';

const bytesOf = (...values: number[]): Uint8Array => Uint8Array.from(values);

const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01);
// A valid HEIC 'ftyp…heic' box — recognized by file-type, deliberately NOT served.
const HEIC = bytesOf(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00);

describe('detectImageContentType — file-type detection + upload allowlist', () => {
    it('accepts a served format (JPEG) by its magic bytes', async () => {
        expect(await detectImageContentType(JPEG)).toBe('image/jpeg');
    });

    it('REJECTS HEIC — recognized by file-type but not on the upload allowlist (the security gate)', async () => {
        expect(await detectImageContentType(HEIC)).toBeUndefined();
    });

    it('returns undefined (never throws) on a truncated/malformed buffer', async () => {
        // A valid PNG signature followed by a cut-off chunk header makes file-type throw EndOfStream —
        // the validator must swallow that into a clean reject (→ 422), not a 500.
        const truncatedPng = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d);
        await expect(detectImageContentType(truncatedPng)).resolves.toBeUndefined();
        await expect(detectImageContentType(bytesOf(0x00, 0x01, 0x02, 0x03))).resolves.toBeUndefined();
        await expect(detectImageContentType(bytesOf())).resolves.toBeUndefined();
    });
});
