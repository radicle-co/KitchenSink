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
import { devicePixelScale, snapLineHeight } from '../tokens/iosLineHeight.js';
import { nativeTokens } from '../tokens/native.js';
import { typeRole, type TypeRole } from '../tokens/typography.js';
import { FONT_SCALE_CAP } from './fontScaleCap.js';
import { letterLiftOf, letterLineHeightOf, type LetterPlatform } from './letterMetrics.js';

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
    /** The cap-centring lift of a cap-centred fixed size, and nothing else's. */
    readonly transform?: readonly [{ readonly translateY: number }];
}

/** The scale a sized role grows to: the system scale under the role's (or a chrome step's) ceiling. */
function grownScale(role: Exclude<TypeRole, 'figureInline'>, systemScale: number, chromeCap?: ChromeCap): number {
    const ceiling = chromeCap === undefined ? CEILING[role] : Math.min(CEILING[role], Number(chromeCap));

    return Math.min(systemScale, ceiling);
}

/**
 * A sized role's leading at the system scale, BEFORE the iOS snap (react/react-native#58970). Pure.
 *
 * Row and height arithmetic reads this, never {@link scaledTypeSize}'s `lineHeight`: the snap lifts a leading a hair
 * above the pixel grid, so a `Math.ceil` or a row count over the snapped value drifts by a whole point. Only the value
 * handed to a React Native text style is snapped.
 *
 * @param role - The type role (any but `figureInline`).
 * @param systemScale - The system font scale (`useWindowDimensions().fontScale`).
 * @param chromeCap - A navigation-chrome step, which can only lower the role's ceiling.
 * @returns The leading in points, unsnapped.
 */
export function scaledLeading(
    role: Exclude<TypeRole, 'figureInline'>,
    systemScale: number,
    chromeCap?: ChromeCap,
): number {
    return typeRole[role].lineHeight * grownScale(role, systemScale, chromeCap);
}

/**
 * The size and leading a sized role is drawn at, in px numbers. Pure.
 *
 * @param role - The type role (any but `figureInline`, which takes its line's).
 * @param systemScale - The system font scale (`useWindowDimensions().fontScale`).
 * @param chromeCap - A navigation-chrome step, which can only lower the role's ceiling.
 * @returns The scaled size and leading; the leading is iOS-snapped, so it is for a style, not for arithmetic.
 */
export function scaledTypeSize(
    role: Exclude<TypeRole, 'figureInline'>,
    systemScale: number,
    chromeCap?: ChromeCap,
): ScaledTypeSize {
    const base = role === 'largeTitle' ? nativeTokens.type.largeTitle.regular : nativeTokens.type[role];

    // The snap comes once, after the font scaling, over the raw leading (the projection `base.lineHeight` is already snapped).
    return {
        fontSize: base.fontSize * grownScale(role, systemScale, chromeCap),
        lineHeight: snapLineHeight(scaledLeading(role, systemScale, chromeCap), devicePixelScale()),
    };
}

/**
 * The size and leading a role is drawn at, as the design-system Text sets them. Pure.
 *
 * @param role - The type role.
 * @param systemScale - The system font scale (`useWindowDimensions().fontScale`).
 * @param chromeCap - A navigation-chrome step, which can only lower the role's ceiling.
 * @param pictorial - A mark drawn on a picture (PRO on a card cover), which keeps the role's own size at every scale
 *     (designer ruling 2026-11-01, M-1); the text around the picture states the same word at the scaled size.
 * @param fixedPx - A size in px that does not scale (initials in a disc, drawn at 40% of its diameter: designer ruling
 *     2026-11-03). It wins over the role's size, the cap and `pictorial`; the leading is the size plus 4.
 * @param capCentred - With `fixedPx`: draw the line as the font's own height and lift by the capitals' drop, so the
 *     capital, not the line, is what a centring parent centres (the cover letter; designer ruling 2026-11-03).
 * @param platform - With `capCentred`: `ios` lifts by the drop measured on a device (none); anything else by the font's.
 * @returns The scaled size and leading, or nothing for `figureInline`, which keeps its line's.
 */
export function scaledTypeMetrics(
    role: TypeRole,
    systemScale: number,
    chromeCap?: ChromeCap,
    pictorial = false,
    fixedPx?: number,
    capCentred = false,
    platform: LetterPlatform = 'other',
): ScaledTypeMetrics | Record<string, never> {
    if (fixedPx !== undefined && capCentred) {
        return {
            fontSize: fixedPx,
            lineHeight: `${letterLineHeightOf(fixedPx)}px`,
            transform: [{ translateY: -letterLiftOf(fixedPx, platform) }],
        };
    }

    if (fixedPx !== undefined) {
        return { fontSize: fixedPx, lineHeight: `${fixedPx + 4}px` };
    }

    if (role === 'figureInline') {
        return {};
    }

    const { fontSize, lineHeight } = scaledTypeSize(role, pictorial ? 1 : systemScale, chromeCap);

    return { fontSize, lineHeight: `${lineHeight}px` };
}
