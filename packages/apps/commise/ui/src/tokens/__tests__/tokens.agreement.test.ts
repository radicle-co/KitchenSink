/**
 * Cross-platform drift guard (module graph, F-R2): `scale.ts` is the sole numeric source, and both the
 * web tokens (rem/px strings) and the React Native `nativeTokens` (numbers/objects) must agree with it
 * unit-aware. `@commise/ui` can see both sides directly, so the three-way agreement is asserted here.
 * (The reverse edge — the mobile Tamagui config — cannot be imported by `@commise/ui`, so its drift test
 * lives in the mobile package.)
 */
import { describe, expect, it } from 'vitest';

import { role, roleDark, semantic, semanticDark } from '../colors.js';
import { nativeTokens } from '../native.js';
import { radius } from '../radius.js';
import * as scale from '../scale.js';
import { shadows } from '../shadows.js';
import { space } from '../spacing.js';
import { fonts, fontSizes, fontWeights } from '../typography.js';

/** Object.keys with the key type preserved (needed for the numeric-keyed scale ramps). */
function typedKeys<T extends object>(o: T): (keyof T)[] {
    return Object.keys(o) as (keyof T)[];
}

/** Web length string → pixels. Accepts unitless `0`, `<n>rem` (×16), and `<n>px`. */
function toPx(value: string | number): number {
    if (typeof value === 'number') {
        return value;
    }

    if (value.endsWith('rem')) {
        return Number.parseFloat(value) * 16;
    }

    if (value.endsWith('px')) {
        return Number.parseFloat(value);
    }

    throw new Error(`Unexpected length token: ${value}`);
}

/** Web camelCase ramp name → its kebab-case web `fontSizes` key. */
const RAMP_TO_WEB_KEY: Record<keyof typeof scale.fontSize, keyof typeof fontSizes> = {
    displayMd: 'display-md',
    headingLg: 'heading-lg',
    headingMd: 'heading-md',
    headingSm: 'heading-sm',
    bodyLg: 'body-lg',
    bodyMd: 'body-md',
    bodySm: 'body-sm',
    caption: 'caption',
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

    // REWRITTEN for the px model (owner ruling 2026-10-25): line heights are no longer ratios. The native projection
    // is the px table itself, which web writes as `calc(px / size)`; `typeScale.test.ts` holds the web side to the grid.
    it('line heights: nativeTokens px ↔ scale px, one per ramp size', () => {
        expect(nativeTokens.lineHeight).toBe(scale.lineHeightPx);

        for (const size of Object.values(scale.fontSize)) {
            expect(scale.lineHeightPx[size]).toBeGreaterThan(size);
        }
    });

    it('font weights: web string ↔ nativeTokens number ↔ scale number', () => {
        for (const key of typedKeys(scale.fontWeight)) {
            const weight = scale.fontWeight[key];
            expect(nativeTokens.fontWeight[key]).toBe(weight);
            expect(Number.parseInt(fontWeights[key], 10)).toBe(weight);
        }
    });

    // The font FAMILY stacks are a web-only projection: they agree with the scale, and native deliberately
    // carries registered face names instead (a stack is a silent no-op in React Native — see
    // `nativeFontFace.test.ts`, which owns that contract).
    it('font families: web stacks ↔ scale stacks (native carries faces, not stacks)', () => {
        expect(fonts).toEqual(scale.fontFamily);
        expect(nativeTokens.fontFace.display).toEqual(scale.displayFontFace);
    });
});

describe('elevation agreement', () => {
    /** Compose the CSS box-shadow the web token uses, from a scale entry: every layer, spread omitted when 0. */
    function composeCss(layers: (typeof scale.elevation)[keyof typeof scale.elevation]): string {
        const len = (n: number): string => (n === 0 ? '0' : `${n}px`);

        return layers
            .map((spec) => {
                const spread = spec.spread === 0 ? '' : ` ${len(spec.spread)}`;

                return `${len(spec.offsetX)} ${len(spec.offsetY)} ${len(spec.blur)}${spread} rgba(${spec.color},${spec.opacity})`;
            })
            .join(', ');
    }

    // REWRITTEN for the redesign: an entry is a stack of layers. Web composes all of them; native has one shadow per
    // view, so it takes the LAST (diffuse) layer.
    it('web CSS box-shadow ↔ scale layers, and nativeTokens RN shadow ↔ the last layer', () => {
        for (const key of typedKeys(scale.elevation)) {
            const layers = scale.elevation[key];
            const last = layers[layers.length - 1];
            expect(shadows[key]).toBe(composeCss(layers));

            const native = nativeTokens.elevation[key];
            expect(native.shadowColor).toBe(`rgb(${last.color})`);
            expect(native.shadowOffset).toEqual({ width: last.offsetX, height: last.offsetY });
            expect(native.shadowRadius).toBe(last.blur);
            expect(native.shadowOpacity).toBe(last.opacity);
        }
    });
});

// REWRITTEN for the redesign: the hairline is the `lineDivider` role on BOTH platforms and in both themes. The old shared
// string (rgba(178, 190, 195, 0.3)) is gone, so there is one source and web and native cannot disagree on "border".
describe('border agreement', () => {
    it('web semantic.border and the divider role are one colour per theme', () => {
        expect(semantic.border).toBe(role.lineDivider);
        expect(semanticDark.border).toBe(roleDark.lineDivider);
    });
});
