import { describe, expect, it } from 'vitest';

import {
    MAX_IMAGE_URL_CHARS,
    MAX_JSON_LD_BLOCK_BYTES,
    MAX_JSON_LD_BLOCKS,
    MAX_RECIPES_PER_PAGE,
    MAX_PASTE_BYTES,
    MAX_WALK_DEPTH,
    MAX_WALK_NODES,
    PASTE_CARD_THRESHOLD_CHARS,
    classifyPaste,
    fitsInBytes,
    utf8ByteLength,
} from '../pageCaps.js';

describe('the page reader caps', () => {
    it('are the numbers the design publishes (blueprint §4)', () => {
        expect({
            MAX_PASTE_BYTES,
            MAX_JSON_LD_BLOCKS,
            MAX_JSON_LD_BLOCK_BYTES,
            MAX_RECIPES_PER_PAGE,
            MAX_WALK_DEPTH,
            MAX_WALK_NODES,
        }).toEqual({
            MAX_PASTE_BYTES: 2_000_000,
            MAX_JSON_LD_BLOCKS: 16,
            MAX_JSON_LD_BLOCK_BYTES: 262_144,
            MAX_RECIPES_PER_PAGE: 64,
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

describe('classifyPaste', () => {
    it('pins the two limits the screen names', () => {
        expect(PASTE_CARD_THRESHOLD_CHARS).toBe(20_000);
        expect(MAX_IMAGE_URL_CHARS).toBe(2_000);
    });

    it.each([[''], ['   '], ['\n\t \n']])('calls %j empty', (text) => {
        expect(classifyPaste(text)).toBe('empty');
    });

    it('calls a paste over 2,000,000 UTF-8 bytes tooLarge, counted in bytes and ahead of every other kind', () => {
        expect(classifyPaste('a'.repeat(2_000_001))).toBe('tooLarge');
        expect(classifyPaste('€'.repeat(666_667))).toBe('tooLarge');
        expect(classifyPaste(`<html>${'a'.repeat(2_000_000)}`)).toBe('tooLarge');
        expect(classifyPaste('€'.repeat(666_666))).toBe('longText');
    });

    it.each([
        ['<html lang="en">'],
        ['<HTML>'],
        ['x <Script>y'],
        ['<script type="application/ld+json">{}'],
        ['{"a":"APPLICATION/LD+JSON"}'],
    ])('calls %j a page', (text) => {
        expect(classifyPaste(text)).toBe('page');
    });

    it('calls a page a page whatever its length', () => {
        expect(classifyPaste(`<html>${'a'.repeat(100_000)}`)).toBe('page');
    });

    it('calls more than 20,000 characters, and not a page, longText', () => {
        expect(classifyPaste('a'.repeat(20_001))).toBe('longText');
        expect(classifyPaste('a'.repeat(20_000))).toBe('shortText');
    });

    it('counts characters as UTF-16 units, not bytes and not code points', () => {
        expect(classifyPaste('é'.repeat(20_000))).toBe('shortText');
        expect(classifyPaste('😀'.repeat(10_001))).toBe('longText');
    });

    it.each([
        ['1 cup flour\n2 eggs'],
        ['&lt; 1 tsp salt'],
        ['Under 5 < 6 minutes'],
        ['<b>bold</b> text'],
        ['<div itemscope>'],
    ])('calls the text %j shortText: a "<" alone does not make a page', (text) => {
        expect(classifyPaste(text)).toBe('shortText');
    });
});
