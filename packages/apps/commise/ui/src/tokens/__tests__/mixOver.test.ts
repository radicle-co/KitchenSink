/**
 * `mixOver` and `hexChannels`: the arithmetic behind the derived press fill (`surfaceTone.ts`) and the one hex parser
 * `tint` and the shadow tokens share. The press values these produce are pinned in
 * `surfaceTone/__tests__/surfaceTone.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { hexChannels, mixOver, tint } from '../colors.js';

describe('mixOver', () => {
    it('lays an overlay over a base in gamma-encoded sRGB, rounding each channel', () => {
        expect(mixOver('#000000', '#ffffff', 0.5)).toBe('#808080');
        expect(mixOver('#171B20', '#EFF3F6', 0.1)).toBe('#d9dde1');
    });

    it('is the base at 0 and the overlay at 1', () => {
        expect(mixOver('#171B20', '#EFF3F6', 0)).toBe('#eff3f6');
        expect(mixOver('#171B20', '#EFF3F6', 1)).toBe('#171b20');
    });

    it('refuses what is not an opaque hex colour, and an alpha outside 0..1', () => {
        expect(() => mixOver('rgba(0, 0, 0, 0.5)', '#ffffff', 0.5)).toThrow(/mixOver expects an opaque/u);
        expect(() => mixOver('#000000', '#fff', 0.5)).toThrow(/"#fff"/u);
        expect(() => mixOver('#000000', '#ffffff', 10)).toThrow(/alpha/u);
    });
});

describe('hexChannels (the one channel parser, shared with tint)', () => {
    it('reads the three channels of an opaque hex', () => {
        expect(hexChannels('#171B20')).toEqual([23, 27, 32]);
    });

    it('throws for anything else, naming the value and the caller', () => {
        expect(() => hexChannels('#abc')).toThrow(
            /hexChannels expects an opaque #RRGGBB palette colour, received "#abc"/u,
        );
        expect(() => tint('#abc', 0.5)).toThrow(/tint expects an opaque/u);
    });
});
