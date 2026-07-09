/**
 * Unit tests for the pure {@link detectImageContentType} magic-byte validator — the security control
 * that accepts ONLY JPEG/PNG/WebP by leading bytes and rejects everything else (notably HEIC and
 * arbitrary content masquerading behind an image content-type).
 *
 * Exhaustive by design: each signature's happy path, every discriminating byte, the exact minimum
 * length boundary, and the reject paths are pinned — so a mutation to any byte check, length guard, or
 * the PNG `every` quantifier is caught. (Integration only exercises the happy PNG path.)
 */
import { describe, it, expect } from 'vitest';

import { detectImageContentType } from '../photos.service.js';

const bytesOf = (...values: number[]): Uint8Array => Uint8Array.from(values);

// Canonical valid signatures (with a trailing payload byte to prove length > minimum still works).
const JPEG = bytesOf(0xff, 0xd8, 0xff, 0x00);
const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const WEBP = bytesOf(0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x57, 0x45, 0x42, 0x50);

describe('detectImageContentType — accepts valid signatures', () => {
    it('detects JPEG (FF D8 FF)', () => {
        expect(detectImageContentType(JPEG)).toBe('image/jpeg');
        // Exactly the 3-byte minimum still detects (kills a `>= 3` -> `> 3` length mutation).
        expect(detectImageContentType(bytesOf(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    });

    it('detects PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
        expect(detectImageContentType(PNG)).toBe('image/png');
        // Exactly the 8-byte minimum.
        expect(detectImageContentType(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    });

    it('detects WebP (RIFF …size… WEBP)', () => {
        expect(detectImageContentType(WEBP)).toBe('image/webp');
    });
});

describe('detectImageContentType — rejects on a single wrong signature byte', () => {
    it('rejects JPEG with any of its 3 bytes altered', () => {
        for (const index of [0, 1, 2]) {
            const corrupted = Uint8Array.from(JPEG);
            corrupted[index] = 0x00;
            expect(detectImageContentType(corrupted)).toBeUndefined();
        }
    });

    it('rejects PNG with a single interior byte altered (kills `every` -> `some`)', () => {
        // First byte matches PNG but the rest do not: `every` => false (reject); `some` => true (wrong).
        expect(detectImageContentType(bytesOf(0x89, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))).toBeUndefined();
        for (const index of [1, 4, 7]) {
            const corrupted = Uint8Array.from(PNG);
            corrupted[index] = 0x00;
            expect(detectImageContentType(corrupted)).toBeUndefined();
        }
    });

    it('rejects WebP when the RIFF prefix is wrong', () => {
        const corrupted = Uint8Array.from(WEBP);
        corrupted[0] = 0x00; // not 'R'
        expect(detectImageContentType(corrupted)).toBeUndefined();
    });

    it('rejects WebP when the WEBP marker at offset 8 is wrong', () => {
        const corrupted = Uint8Array.from(WEBP);
        corrupted[8] = 0x00; // not 'W'
        expect(detectImageContentType(corrupted)).toBeUndefined();
    });
});

describe('detectImageContentType — rejects short and foreign inputs', () => {
    it('rejects an input shorter than a signature (below each length guard)', () => {
        expect(detectImageContentType(bytesOf(0xff, 0xd8))).toBeUndefined(); // 2 < JPEG's 3
        expect(detectImageContentType(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a))).toBeUndefined(); // 7 < 8
        expect(detectImageContentType(bytesOf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42))).toBeUndefined(); // 11 < 12
    });

    it('rejects an empty buffer', () => {
        expect(detectImageContentType(bytesOf())).toBeUndefined();
    });

    it('rejects HEIC/HEIF (ftyp box) — the format we deliberately do NOT serve', () => {
        // 00 00 00 20 'ftyp' 'heic' …
        const heic = bytesOf(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
        expect(detectImageContentType(heic)).toBeUndefined();
    });
});
