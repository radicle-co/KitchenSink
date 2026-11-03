/**
 * The design-system Text's size and leading at any system text scale (ADR-0080 §8). React Native 0.86 on Android does
 * not cap a set line height (`TextAttributeProps.kt:42`), so Text turns system scaling off and draws both itself: the
 * role's base times the system scale, up to the role's ceiling. The designer ruled the ceilings (2026-11-01,
 * nativeBoards/designAnswers.md): the three display roles grow to 1.5×, every other role to 2×. These rows pin that
 * arithmetic; a device is the evidence it is what draws.
 */
import { describe, expect, it } from 'vitest';

import { nativeTokens } from '../../tokens/native.js';
import type { TypeRole } from '../../tokens/typography.js';
import { CHROME_CAPS, scaledTypeMetrics, scaledTypeSize } from '../scaledType.js';
import { letterLiftOf } from '../letterMetrics.js';

/** Each sized role's ceiling, written out (not read from the code under test). */
const CEILING = {
    largeTitle: 1.5,
    barTitle: 1.5,
    sectionTitle: 1.5,
    cardTitle: 2,
    body: 2,
    readingBody: 2,
    meta: 2,
    list: 2,
    label: 2,
    caption: 2,
    figureStat: 2,
} as const satisfies Record<Exclude<TypeRole, 'figureInline'>, number>;

const SCALES = [0.85, 1, 1.3, 1.5, 2, 2.643, 3.1] as const;

function baseOf(role: keyof typeof CEILING): { readonly fontSize: number; readonly lineHeight: number } {
    const spec = role === 'largeTitle' ? nativeTokens.type.largeTitle.regular : nativeTokens.type[role];

    return { fontSize: spec.fontSize, lineHeight: spec.lineHeight };
}

describe('scaledTypeMetrics', () => {
    const cases = (Object.keys(CEILING) as (keyof typeof CEILING)[]).flatMap((role) =>
        SCALES.map((scale) => [role, scale] as const),
    );

    it.each(cases)('%s at system scale %s grows its size and leading together, up to its ceiling', (role, scale) => {
        const { fontSize, lineHeight } = baseOf(role);
        const grown = Math.min(scale, CEILING[role]);

        expect(scaledTypeMetrics(role, scale)).toEqual({
            fontSize: fontSize * grown,
            lineHeight: `${String(lineHeight * grown)}px`,
        });
    });

    // Moved from the Text test (H-1): a leading is a `px` string, because Tamagui 3 reads a bare number as a ratio of the
    // font size, and at every scale it holds its text.
    it.each(cases)('%s at system scale %s keeps a px leading that holds its text', (role, scale) => {
        const metrics = scaledTypeMetrics(role, scale);

        expect('lineHeight' in metrics ? metrics.lineHeight : '').toMatch(/^\d+(?:\.\d+)?px$/u);
        expect('fontSize' in metrics ? Number.parseFloat(metrics.lineHeight) : 0).toBeGreaterThanOrEqual(
            'fontSize' in metrics ? metrics.fontSize : 1,
        );
    });

    it('gives an inline figure nothing, so it keeps the size and leading of its line', () => {
        expect(scaledTypeMetrics('figureInline', 3.1)).toEqual({});
    });

    it('draws body at 32 on a 48 px leading, and largeTitle at 1.5×, above every cap', () => {
        const title = nativeTokens.type.largeTitle.regular;

        expect(scaledTypeMetrics('body', 3.1)).toEqual({ fontSize: 32, lineHeight: '48px' });
        expect(scaledTypeMetrics('largeTitle', 3.1)).toEqual({
            fontSize: title.fontSize * 1.5,
            lineHeight: `${String(title.lineHeight * 1.5)}px`,
        });
    });
});

/**
 * Navigation chrome (designer ruling 2026-11-01, ADR-0080 §8): a tab-bar or view-switch label grows to 1.5× at most,
 * with 1.4× and 1.3× steps a fit test may choose, and never below 1.3×. A chrome cap only LOWERS a role's ceiling, so
 * nothing can freeze a label or shrink it below the system scale up to 1.3×.
 */
describe('scaledTypeMetrics with a chrome cap', () => {
    const CAPS = ['1.5', '1.4', '1.3'] as const;
    const SCALES_C = [1, 1.3, 1.5, 3.1] as const;
    const ROLES = Object.keys(CEILING) as (keyof typeof CEILING)[];

    it('offers no step below 1.3', () => {
        expect(Math.min(...CHROME_CAPS.map(Number))).toBe(1.3);
        expect([...CHROME_CAPS]).toEqual([...CAPS]);
    });

    it.each(ROLES.flatMap((role) => CAPS.flatMap((cap) => SCALES_C.map((scale) => [role, cap, scale] as const))))(
        '%s under chrome cap %s at system scale %s grows to min(scale, role ceiling, cap)',
        (role, cap, scale) => {
            const { fontSize, lineHeight } = baseOf(role);
            const grown = Math.min(scale, CEILING[role], Number(cap));

            expect(scaledTypeMetrics(role, scale, cap)).toEqual({
                fontSize: fontSize * grown,
                lineHeight: `${String(lineHeight * grown)}px`,
            });
            expect(grown).toBeGreaterThanOrEqual(Math.min(scale, 1.3));
        },
    );

    it('draws a caption at 1.5× above the cap under the widest chrome step', () => {
        const { fontSize, lineHeight } = nativeTokens.type.caption;

        expect(scaledTypeSize('caption', 3.1, '1.5')).toEqual({
            fontSize: fontSize * 1.5,
            lineHeight: lineHeight * 1.5,
        });
    });
});

// Designer ruling 2026-11-01 (M-1, ADR-0080 §8): a mark drawn on a picture, such as PRO on a card cover, is part of the
// picture, so it stays at its role's own size and leading at every system scale. The card states the same word in its
// text, at the scaled size, for a reader who needs it larger.
describe('scaledTypeMetrics for a mark on a picture', () => {
    const SCALES_P = [1, 1.3, 2, 3.1] as const;
    const ROLES = Object.keys(CEILING) as (keyof typeof CEILING)[];

    it.each(ROLES.flatMap((role) => SCALES_P.map((scale) => [role, scale] as const)))(
        '%s on a picture at system scale %s keeps its own size and leading',
        (role, scale) => {
            const { fontSize, lineHeight } = baseOf(role);

            expect(scaledTypeMetrics(role, scale, undefined, true)).toEqual({
                fontSize,
                lineHeight: `${String(lineHeight)}px`,
            });
        },
    );

    it('still grows the same role when it is not on a picture', () => {
        const { fontSize } = nativeTokens.type.caption;

        expect(scaledTypeMetrics('caption', 3.1, undefined, false)).toMatchObject({ fontSize: fontSize * 2 });
    });
});

// Designer ruling c10ecadbf (2026-11-03): initials in a disc are drawn at 40% of the disc's diameter and do not scale, so
// two letters fit at every size. The size is the caller's, in px; the leading is the size plus 4.
describe('scaledTypeMetrics for a fixed size', () => {
    it.each([1, 1.5, 2, 3.1])('draws the given px at system scale %f, whatever the role says', (scale) => {
        expect(scaledTypeMetrics('label', scale, undefined, false, 12)).toEqual({ fontSize: 12, lineHeight: '16px' });
    });

    it('wins over a chrome cap and over a picture mark', () => {
        expect(scaledTypeMetrics('label', 2, '1.5', true, 8)).toEqual({ fontSize: 8, lineHeight: '12px' });
    });

    it('leaves a role without a fixed size to scale as before', () => {
        expect(scaledTypeMetrics('label', 2)).toMatchObject({ fontSize: 28 });
    });
});

// Designer ruling (2026-11-03): the cover letter is centred by its cap band. A cap-centred fixed size draws its line as
// the font's own height and lifts by the capitals' drop, so no platform places leading around it.
describe('scaledTypeMetrics — a cap-centred fixed size', () => {
    it('answers the font’s own line height and the lift of the cap band', () => {
        expect(scaledTypeMetrics('label', 2, undefined, false, 48, true)).toEqual({
            fontSize: 48,
            lineHeight: '66px',
            transform: [{ translateY: -letterLiftOf(48) }],
        });
    });

    it('leaves a plain fixed size (initials in a disc) with its size-plus-4 leading and no lift', () => {
        expect(scaledTypeMetrics('label', 2, undefined, false, 48)).toEqual({ fontSize: 48, lineHeight: '52px' });
    });
});
