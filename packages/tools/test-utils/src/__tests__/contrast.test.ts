/**
 * Invariants for the WCAG contrast helpers. These are the measuring instrument the design-system's colour
 * assertions depend on, so they are pinned against values published in WCAG 2.1 / the W3C's own examples
 * rather than against whatever the implementation happens to return.
 */
import { describe, expect, it } from 'vitest';

import { compositeOver, contrastRatio, meetsContrast } from '../contrast.js';

describe('contrastRatio', () => {
    it('returns the two published extremes exactly', () => {
        // WCAG 2.1 defines the ratio as (L1 + 0.05) / (L2 + 0.05); black-on-white is its maximum.
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    });

    it('is symmetric — the ratio does not depend on which colour is called the foreground', () => {
        expect(contrastRatio('#636e72', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#636e72'), 10);
    });

    it('agrees with the canonical boundary greys, so an off-by-a-linearisation-constant is caught', () => {
        // #767676 on white is the classic "smallest grey that passes AA" (4.54:1); #777777 misses it
        // (4.48:1). A wrong sRGB threshold or gamma exponent moves both across the 4.5 line.
        expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
    });

    it('reads a colour in any CSS notation, not only hex', () => {
        expect(contrastRatio('rgb(0, 0, 0)', 'white')).toBeCloseTo(21, 5);
    });
});

describe('compositeOver', () => {
    it('returns the backdrop unchanged when the overlay is fully transparent', () => {
        expect(compositeOver('rgba(232, 145, 122, 0)', '#ffffff')).toBe('#ffffff');
    });

    it('returns the overlay unchanged when it is fully opaque', () => {
        expect(compositeOver('#e8917a', '#ffffff')).toBe('#e8917a');
    });

    it('composites a translucent tint over its backdrop (source-over)', () => {
        // 10% coral over white: each channel is 0.1·coral + 0.9·white.
        expect(compositeOver('rgba(232, 145, 122, 0.1)', '#ffffff')).toBe('#fdf4f2');
    });

    it('is what makes a translucent surface measurable at all', () => {
        // Measuring text against the RAW `bg-coral/10` token would score it against opaque coral and report
        // a wildly different (here: better-looking) number than a reader ever sees.
        const composited = contrastRatio('#636e72', compositeOver('rgba(232, 145, 122, 0.1)', '#ffffff'));
        const naive = contrastRatio('#636e72', '#e8917a');

        expect(composited).toBeGreaterThanOrEqual(4.5);
        expect(naive).toBeLessThan(4.5);
    });
});

describe('meetsContrast', () => {
    it('applies the 4.5:1 floor to normal text and the 3:1 floor to large text and UI components', () => {
        // #949494 on white is 3.03:1 — enough for large text / a UI boundary, not for body copy.
        expect(meetsContrast('#949494', '#ffffff', 'normal-text')).toBe(false);
        expect(meetsContrast('#949494', '#ffffff', 'large-text')).toBe(true);
        expect(meetsContrast('#949494', '#ffffff', 'ui-component')).toBe(true);
    });

    it('accepts a pair sitting exactly on its floor', () => {
        expect(meetsContrast('#767676', '#ffffff', 'normal-text')).toBe(true);
    });
});
