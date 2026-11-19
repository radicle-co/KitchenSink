import { describe, expect, it } from 'vitest';

import { fnv1a32Hex } from '../fnv1a32.js';

describe('fnv1a32Hex', () => {
    // Published FNV-1a 32-bit reference vectors (Fowler, Noll, Vo):
    // "" -> 811c9dc5, "a" -> e40c292c, "foobar" -> bf9cf968.
    it.each([
        ['', '811c9dc5'],
        ['a', 'e40c292c'],
        ['foobar', 'bf9cf968'],
    ])('hashes %j to the published vector %s', (text, vector) => {
        expect(fnv1a32Hex(text)).toBe(vector);
    });

    it('hashes UTF-8 bytes, not UTF-16 units (mutant: charCodeAt)', () => {
        // NFC "é" is the two bytes c3 a9.
        expect(fnv1a32Hex('é')).toBe('1e9de8c1');
    });

    it('does not normalize: composed and decomposed forms differ', () => {
        expect(fnv1a32Hex('é')).not.toBe(fnv1a32Hex('é'));
    });
});
