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

/**
 * The navigation-chrome steps (designer ruling 2026-11-01): a tab-bar or view-switch label grows to 1.5× at most, and a
 * fit test may lower its control to 1.4× or 1.3×, never further. A step only LOWERS a role's ceiling, so a chrome label
 * can never be frozen at 1× or drawn below the system scale up to 1.3×.
 */
export const CHROME_CAPS = ['1.5', '1.4', '1.3'] as const;

/** One navigation-chrome step. */
export type ChromeCap = (typeof CHROME_CAPS)[number];

/** A sized role's size and leading, in px numbers, for a React Native text that cannot be the design-system Text. */
export interface ScaledTypeSize {
    readonly fontSize: number;
    readonly lineHeight: number;
}

/** A sized role's metrics: the leading is a `px` string, because Tamagui 3 reads a bare number as a ratio. */
export interface ScaledTypeMetrics {
    readonly fontSize: number;
    readonly lineHeight: `${number}px`;
}

/**
 * The size and leading a sized role is drawn at, in px numbers. Pure.
 *
 * @param role - The type role (any but `figureInline`, which takes its line's).
 * @param systemScale - The system font scale (`useWindowDimensions().fontScale`).
 * @param chromeCap - A navigation-chrome step, which can only lower the role's ceiling.
 * @returns The scaled size and leading.
 */
export function scaledTypeSize(
    role: Exclude<TypeRole, 'figureInline'>,
    systemScale: number,
    chromeCap?: ChromeCap,
): ScaledTypeSize {
    const base = role === 'largeTitle' ? nativeTokens.type.largeTitle.regular : nativeTokens.type[role];
    const ceiling = chromeCap === undefined ? CEILING[role] : Math.min(CEILING[role], Number(chromeCap));
    const grown = Math.min(systemScale, ceiling);

    return { fontSize: base.fontSize * grown, lineHeight: base.lineHeight * grown };
}

/**
 * The size and leading a role is drawn at, as the design-system Text sets them. Pure.
 *
 * @param role - The type role.
 * @param systemScale - The system font scale (`useWindowDimensions().fontScale`).
 * @param chromeCap - A navigation-chrome step, which can only lower the role's ceiling.
 * @returns The scaled size and leading, or nothing for `figureInline`, which keeps its line's.
 */
export function scaledTypeMetrics(
    role: TypeRole,
    systemScale: number,
    chromeCap?: ChromeCap,
): ScaledTypeMetrics | Record<string, never> {
    if (role === 'figureInline') {
        return {};
    }

    const { fontSize, lineHeight } = scaledTypeSize(role, systemScale, chromeCap);

    return { fontSize, lineHeight: `${lineHeight}px` };
}
