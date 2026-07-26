/**
 * Cross-platform drift guard (module graph, F-R2): `scale.ts` is the sole numeric source, and both the
 * web tokens (rem/px strings) and the React Native `nativeTokens` (numbers/objects) must agree with it
 * unit-aware. `@commise/ui` can see both sides directly, so the three-way agreement is asserted here.
 * (The reverse edge — the mobile Tamagui config — cannot be imported by `@commise/ui`, so its drift test
 * lives in the mobile package.)
 */
import { describe, expect, it } from 'vitest';

import { semantic } from '../colors.js';
import { nativeTokens } from '../native.js';
import { radius } from '../radius.js';
import * as scale from '../scale.js';
import { shadows } from '../shadows.js';
import { space } from '../spacing.js';
import { fonts, fontSizes, fontWeights, lineHeights } from '../typography.js';

/** Object.keys with the key type preserved (needed for the numeric-keyed scale ramps). */
function typedKeys<T extends object>(o: T): (keyof T)[] {
    return Object.keys(o) as (keyof T)[];
}

/** Web length string → pixels. Accepts unitless `0`, `<n>rem` (×16), and `<n>px`. */
function toPx(value: string | number): number {
    if (typeof value === 'number') {return value;}

    if (value.endsWith('rem')) {return Number.parseFloat(value) * 16;}

    if (value.endsWith('px')) {return Number.parseFloat(value);}

    throw new Error(`Unexpected length token: ${value}`);
}

/** Web camelCase ramp name → its kebab-case web `fontSizes` key. */
const RAMP_TO_WEB_KEY: Record<keyof typeof scale.fontSize, keyof typeof fontSizes> = {
    displayXl: 'display-xl',
    displayLg: 'display-lg',
    displayMd: 'display-md',
    headingLg: 'heading-lg',
    headingMd: 'heading-md',
    headingSm: 'heading-sm',
    bodyLg: 'body-lg',
    bodyMd: 'body-md',
    bodySm: 'body-sm',
    caption: 'caption',
    overline: 'overline',
};

describe('spacing agreement', () => {
    it('web rem ↔ nativeTokens px ↔ scale px', () => {
        for (const key of typedKeys(scale.spacing)) {
            const px = scale.spacing[key];
            expect(nativeTokens.spacing[key]).toBe(px);
            expect(toPx(space[key])).toBe(px);
        }
    });
});

describe('radius agreement', () => {
    it('web (rem, px-pill) ↔ nativeTokens px ↔ scale px', () => {
        for (const key of typedKeys(scale.radius)) {
            const px = scale.radius[key];
            expect(nativeTokens.radius[key]).toBe(px);
            expect(toPx(radius[key])).toBe(px);
        }
    });
});

describe('type agreement', () => {
    it('font sizes: web rem ↔ nativeTokens px ↔ scale px', () => {
        for (const key of typedKeys(scale.fontSize)) {
            const px = scale.fontSize[key];
            expect(nativeTokens.fontSize[key]).toBe(px);
            expect(toPx(fontSizes[RAMP_TO_WEB_KEY[key]])).toBe(px);
        }
    });

    it('line-height ratios: web string ↔ nativeTokens number ↔ scale number', () => {
        for (const key of typedKeys(scale.lineHeightRatio)) {
            const ratio = scale.lineHeightRatio[key];
            expect(nativeTokens.lineHeight[key]).toBe(ratio);
            expect(Number.parseFloat(lineHeights[key])).toBe(ratio);
        }
    });

    it('font weights: web string ↔ nativeTokens number ↔ scale number', () => {
        for (const key of typedKeys(scale.fontWeight)) {
            const weight = scale.fontWeight[key];
            expect(nativeTokens.fontWeight[key]).toBe(weight);
            expect(Number.parseInt(fontWeights[key], 10)).toBe(weight);
        }
    });

    it('font families are identical strings across web, native, and scale', () => {
        expect(nativeTokens.fontFamily).toEqual(scale.fontFamily);
        expect(fonts).toEqual(scale.fontFamily);
    });
});

describe('elevation agreement', () => {
    /** Compose the CSS box-shadow the web token uses, from a scale spec (spread omitted when 0). */
    function composeCss(spec: (typeof scale.elevation)[keyof typeof scale.elevation]): string {
        const len = (n: number): string => (n === 0 ? '0' : `${n}px`);
        const spread = spec.spread === 0 ? '' : ` ${len(spec.spread)}`;

        return `${len(spec.offsetX)} ${len(spec.offsetY)} ${len(spec.blur)}${spread} rgba(${spec.color},${spec.opacity})`;
    }

    it('web CSS box-shadow ↔ scale spec, and nativeTokens RN shadow ↔ scale spec', () => {
        for (const key of typedKeys(scale.elevation)) {
            const spec = scale.elevation[key];
            expect(shadows[key]).toBe(composeCss(spec));

            const native = nativeTokens.elevation[key];
            expect(native.shadowColor).toBe(`rgb(${spec.color})`);
            expect(native.shadowOffset).toEqual({ width: spec.offsetX, height: spec.offsetY });
            expect(native.shadowRadius).toBe(spec.blur);
            expect(native.shadowOpacity).toBe(spec.opacity);
        }
    });
});

describe('borderSubtle agreement', () => {
    it('scale ↔ web semantic.border ↔ nativeTokens', () => {
        expect(semantic.border).toBe(scale.borderSubtle);
        expect(nativeTokens.borderSubtle).toBe(scale.borderSubtle);
    });
});
