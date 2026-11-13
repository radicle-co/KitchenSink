/**
 * The type scale rule (owner rulings 2026-10-25 and 2026-10-26; `typeScaleSpec` §4.A): a font size is 14, 16, 18 or 28
 * and nothing else, a line height is a whole number of px on a 4 px grid, and no role tracks its letters. Every check
 * reads the exported objects themselves, never a hand-copied list, so a new role or ramp step is held to the rule the
 * day it lands.
 *
 * Mutation lens: set any role to 12, 13, 15 or 17; set a line height to 21 or 22.5; bring back `overline`; give
 * `largeTitle` 34 at `wide`; give any role a `letterSpacing`; leave a rounding step in the native projection. Each
 * fails a row below.
 */
import { describe, expect, it } from 'vitest';

import { nativeTokens } from '../native.js';
import { fontSize, lineHeightPx } from '../scale.js';
import { fontSizes, TYPE_SIZES, typeRole, webTypeRoles, type TypeRoleSpec } from '../typography.js';

const SIZES: readonly number[] = TYPE_SIZES;
const ROLE_NAMES = [
    'largeTitle',
    'barTitle',
    'sectionTitle',
    'cardTitle',
    'body',
    'readingBody',
    'readingLarge',
    'meta',
    'list',
    'label',
    'caption',
    'figureInline',
    'figureStat',
];

const roles = Object.entries(typeRole as Record<string, TypeRoleSpec>);

/** Every px size a role states: one, or one per container class. `inherit` states none. */
function sizesOf(spec: TypeRoleSpec): readonly number[] {
    if (spec.size === 'inherit') {
        return [];
    }

    return typeof spec.size === 'number' ? [spec.size] : Object.values(spec.size);
}

/** A CSS line height as the multiplier it states: `1.25` or `calc(20 / 16)`. */
function ratioOf(lineHeight: string): number {
    const calc = /^calc\(([\d.]+) \/ ([\d.]+)\)$/u.exec(lineHeight);

    return calc === null ? Number(lineHeight) : Number(calc[1]) / Number(calc[2]);
}

/** Every `rem` length in a CSS size, in px (a `clamp()` states three). */
function remsIn(size: string): readonly number[] {
    return [...size.matchAll(/([\d.]+)rem/gu)].map((match) => Number(match[1]) * 16);
}

describe('TYPE_SIZES — the owner’s ruling', () => {
    it('is exactly 14, 16, 18 and 28', () => {
        expect([...TYPE_SIZES]).toEqual([14, 16, 18, 28]);
    });
});

describe('typeRole — sizes and line heights', () => {
    it('names exactly the roles in ROLE_NAMES, with no overline', () => {
        expect(Object.keys(typeRole).sort()).toEqual([...ROLE_NAMES].sort());
        expect(typeRole).not.toHaveProperty('overline');
    });

    it.each(roles)('%s states only sizes from the set, none above 28', (_name, spec) => {
        for (const size of sizesOf(spec)) {
            expect(SIZES, `${String(size)} px`).toContain(size);
            expect(size).toBeLessThanOrEqual(28);
        }
    });

    it('lets only the inline figure inherit its size', () => {
        expect(
            roles.filter(([, spec]) => spec.size === 'inherit' || spec.lineHeight === 'inherit').map(([name]) => name),
        ).toEqual(['figureInline']);
    });

    it.each(roles.filter(([, spec]) => spec.lineHeight !== 'inherit'))(
        '%s has a px line height on the 4 px grid, taller than its size',
        (_name, spec) => {
            const lineHeight = spec.lineHeight;

            expect(typeof lineHeight).toBe('number');

            if (typeof lineHeight === 'number') {
                expect(lineHeight % 4).toBe(0);

                for (const size of sizesOf(spec)) {
                    expect(lineHeight).toBeGreaterThan(size);
                }
            }
        },
    );

    it('tracks no role’s letters and capitalises none', () => {
        for (const [, spec] of roles) {
            expect(spec).not.toHaveProperty('letterSpacingEm');
            expect(spec).not.toHaveProperty('uppercase');
        }
    });
});

describe('the projections keep the rule', () => {
    const native = Object.entries(nativeTokens.type).flatMap(([name, style]) =>
        'fontFamily' in style
            ? [[name, style] as const]
            : Object.entries(style).map(([cls, s]) => [`${name}.${cls}`, s] as const),
    );

    it('has a native style for every role', () => {
        expect(new Set(native.map(([name]) => name.split('.')[0])).size).toBe(ROLE_NAMES.length);
    });

    it.each(native)('native %s uses a set size and a whole-px line height with no rounding step', (_name, style) => {
        if (style.fontSize !== undefined) {
            expect(SIZES).toContain(style.fontSize);
        }

        if (style.lineHeight !== undefined) {
            expect(Number.isInteger(style.lineHeight)).toBe(true);
            expect(style.lineHeight % 4).toBe(0);
        }

        expect(style).not.toHaveProperty('letterSpacing');
        expect(style).not.toHaveProperty('textTransform');
    });

    it.each(Object.entries(webTypeRoles))(
        'web %s states set sizes and a line height on the 4 px grid',
        (_name, web) => {
            for (const px of remsIn(web.size)) {
                expect(SIZES).toContain(px);
            }

            const [largest = 0] = remsIn(web.size).slice(-1);
            const px = ratioOf(web.lineHeight) * largest;

            expect(Math.abs(px / 4 - Math.round(px / 4))).toBeLessThan(1e-9);
            expect(web).not.toHaveProperty('letterSpacing');
        },
    );
});

describe('the legacy ramp keeps the rule', () => {
    it.each(Object.entries(fontSize))('scale.fontSize.%s is a set size', (_step, size) => {
        expect(SIZES).toContain(size);
    });

    it.each(Object.entries(fontSizes))('the web ramp step %s is a set size', (_step, rem) => {
        expect(SIZES).toContain(Number.parseFloat(rem) * 16);
    });

    it('gives every set size a line height on the grid', () => {
        expect(Object.keys(lineHeightPx).map(Number).sort()).toEqual([...TYPE_SIZES]);

        for (const [size, lineHeight] of Object.entries(lineHeightPx)) {
            expect(lineHeight % 4).toBe(0);
            expect(lineHeight).toBeGreaterThan(Number(size));
        }
    });
});
