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
import { scaledTypeMetrics } from '../scaledType.js';

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
