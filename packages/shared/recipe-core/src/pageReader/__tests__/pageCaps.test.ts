import { describe, expect, it } from 'vitest';

import {
    MAX_JSON_LD_BLOCK_BYTES,
    MAX_JSON_LD_BLOCKS,
    MAX_MICRODATA_RECIPES,
    MAX_PASTE_BYTES,
    MAX_WALK_DEPTH,
    MAX_WALK_NODES,
    fitsInBytes,
    utf8ByteLength,
} from '../pageCaps.js';

describe('the page reader caps', () => {
    it('are the numbers the design publishes (blueprint §4)', () => {
        expect({
            MAX_PASTE_BYTES,
            MAX_JSON_LD_BLOCKS,
            MAX_JSON_LD_BLOCK_BYTES,
            MAX_MICRODATA_RECIPES,
            MAX_WALK_DEPTH,
            MAX_WALK_NODES,
        }).toEqual({
            MAX_PASTE_BYTES: 2_000_000,
            MAX_JSON_LD_BLOCKS: 16,
            MAX_JSON_LD_BLOCK_BYTES: 262_144,
            MAX_MICRODATA_RECIPES: 64,
            MAX_WALK_DEPTH: 32,
            MAX_WALK_NODES: 10_000,
        });
    });
});

describe('utf8ByteLength', () => {
    it.each([
        ['', 0],
        ['abc', 3],
        ['é', 2],
        ['€', 3],
        ['😀', 4],
    ])('counts %j as %i bytes', (text, bytes) => {
        expect(utf8ByteLength(text)).toBe(bytes);
    });
});

describe('fitsInBytes', () => {
    it('decides by bytes at the boundary, for one-, two- and three-byte text', () => {
        expect(fitsInBytes('a'.repeat(10), 10)).toBe(true);
        expect(fitsInBytes('a'.repeat(11), 10)).toBe(false);
        expect(fitsInBytes('é'.repeat(5), 10)).toBe(true);
        expect(fitsInBytes('é'.repeat(6), 10)).toBe(false);
        expect(fitsInBytes('€'.repeat(3), 10)).toBe(true);
        expect(fitsInBytes('€'.repeat(4), 10)).toBe(false);
        expect(fitsInBytes('', 0)).toBe(true);
    });
});
