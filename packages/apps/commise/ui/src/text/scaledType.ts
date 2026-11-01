/**
 * @module text/scaledType — the size and leading the design-system Text draws a role at, for a system text scale
 * (ADR-0080 §8). React Native 0.86 on Android caps a text's size but not a set line height (`TextAttributeProps.kt:42`,
 * fixed upstream in #58982 but not released), so Text turns system scaling off and draws both from here. Free of
 * Tamagui, so it is tested in Node.
 *
 * Each role grows with the system scale up to its ceiling (designer ruling 2026-11-01): the display roles to 1.5×,
 * because a title at 2× pushes content off a phone and both platforms grow large styles less; every other role to
 * {@link FONT_SCALE_CAP}, WCAG 1.4.4's 200 %. The growth is linear, the same on both platforms.
 *
 * @pattern Strategy — one pure function owns the type-scaling arithmetic
 */
import { nativeTokens } from '../tokens/native.js';
import type { TypeRole } from '../tokens/typography.js';
import { FONT_SCALE_CAP } from './fontScaleCap.js';

/** The display roles' ceiling: a title stops growing at 1.5×. */
export const DISPLAY_FONT_SCALE_CAP = 1.5;

/** How far each sized role grows. `figureInline` takes its line's size, so it has none. */
const CEILING: Readonly<Record<Exclude<TypeRole, 'figureInline'>, number>> = {
    largeTitle: DISPLAY_FONT_SCALE_CAP,
    barTitle: DISPLAY_FONT_SCALE_CAP,
    sectionTitle: DISPLAY_FONT_SCALE_CAP,
    cardTitle: FONT_SCALE_CAP,
    body: FONT_SCALE_CAP,
    readingBody: FONT_SCALE_CAP,
    meta: FONT_SCALE_CAP,
    list: FONT_SCALE_CAP,
    label: FONT_SCALE_CAP,
    caption: FONT_SCALE_CAP,
    figureStat: FONT_SCALE_CAP,
};

/** A sized role's metrics: the leading is a `px` string, because Tamagui 3 reads a bare number as a ratio. */
export interface ScaledTypeMetrics {
    readonly fontSize: number;
    readonly lineHeight: `${number}px`;
}

/**
 * The size and leading a role is drawn at. Pure.
 *
 * @param role - The type role.
 * @param systemScale - The system font scale (`useWindowDimensions().fontScale`).
 * @returns The scaled size and leading, or nothing for `figureInline`, which keeps its line's.
 */
export function scaledTypeMetrics(role: TypeRole, systemScale: number): ScaledTypeMetrics | Record<string, never> {
    if (role === 'figureInline') {
        return {};
    }

    const base = role === 'largeTitle' ? nativeTokens.type.largeTitle.regular : nativeTokens.type[role];
    const grown = Math.min(systemScale, CEILING[role]);

    return { fontSize: base.fontSize * grown, lineHeight: `${base.lineHeight * grown}px` };
}
