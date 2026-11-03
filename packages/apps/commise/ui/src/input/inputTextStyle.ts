/**
 * @module @commise/ui/input — the text style of a native text input, in ONE place.
 *
 * An input draws its text at the design-system body size at the capped system scale (`scaledTypeSize`, the same size and
 * ceiling as `Text`). Its LEADING is a platform matter:
 *
 * - **iOS carries none.** React Native's Fabric text input applies a `lineHeight` as paragraph style but never adds the
 *   baseline offset that centres a `Text` (`RCTTextLayoutManager.mm` calls `RCTApplyBaselineOffset`; the text input path
 *   has no caller), so a line box taller than the font puts the text on its bottom edge: low in the field, and touching
 *   the border at the cap. The platform centres an unconstrained line.
 * - **Android carries the capped leading.** It has no such offset problem, and an unset leading grows with the system
 *   scale past the cap.
 * - **A multi-line input keeps its leading on both**, since lines need a rhythm.
 *
 * ## Centring: the cap band (designer ruling (b), 2026-11-03)
 *
 * An input's text is centred by its CAP BAND, from the top of a capital to the baseline, and descenders hang below it.
 * Typed text, placeholders and digits follow the same rule. The platform's own single-line placement already does it
 * (qa-ios's probe, with no shift: "Hxg" 1.5 pt low at 16 pt and 3.15 pt low at 32 pt, half the descender, so the cap band
 * is centred), so a single-line input is left exactly as the caller styled it, on both platforms. Only a multi-line
 * field's first line needs help on iOS, where it sits low under the leading: {@link IOS_LEADING_DROP} of the leading
 * comes off the top padding, through {@link inputBoxPadding}, so its cap band sits as far from the box top as a single
 * line's. Android's multi-line first line is held.
 *
 * ⛔ Nothing may spread a `nativeTokens.type.<role>` into a text input's style: it brings the fixed `lineHeight` back.
 * `nativeInputLineHeight.test.ts` refuses it.
 *
 * Pure.
 */
import type { TextStyle } from 'react-native';

import { scaledLeading, scaledTypeSize } from '../text/scaledType.js';
import { nativeTokens } from '../tokens/native.js';

/** The part of a text style an input's text owns. */
export type InputTextStyle = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight'>;

/**
 * The text style of a native text input.
 *
 * @param systemScale - The system font scale.
 * @param os - The platform.
 * @param multiline - Whether the input has more than one line.
 * @returns The family, the capped size and, where the platform wants one, the capped leading.
 */
export function inputTextStyle(systemScale: number, os: 'ios' | 'android', multiline: boolean): InputTextStyle {
    const { fontSize, lineHeight } = scaledTypeSize('body', systemScale);

    return {
        fontFamily: nativeTokens.type.body.fontFamily,
        fontSize,
        ...(os === 'ios' && !multiline ? {} : { lineHeight }),
    };
}

/**
 * How far to lift a multi-line field's first line on iOS, as a fraction of the leading, so its cap band sits as far from the
 * box top as a single line's. qa-ios, 1x: the Title's cap top is 19.7 pt below its box top with a 4 pt drop, the unlifted
 * single-line Name's 18.0, so the drop wants 5.7 pt of the 24 pt leading; at the cap about 12.3 pt of 48. A quarter of the
 * leading fits both: 6 pt at 1x, 12 pt at the cap.
 */
export const IOS_LEADING_DROP = 1 / 4;

/** The vertical padding of an input, in points. */
export interface InputBoxPadding {
    readonly paddingTop: number;
    readonly paddingBottom: number;
}

/** The style objects in a style value, in order: an array is read through, and what is not an object is skipped. */
function stylePartsOf(style: unknown): readonly object[] {
    if (Array.isArray(style)) {
        return style.flatMap(stylePartsOf);
    }

    return typeof style === 'object' && style !== null ? [style] : [];
}

/** A style's vertical paddings, each from the most specific key; a later style object wins for the same key. */
function verticalPaddingOf(style: unknown): InputBoxPadding {
    const parts = stylePartsOf(style);

    const read = (...keys: readonly string[]): number => {
        for (const key of keys) {
            const value = [...parts]
                .reverse()
                .map((part) => (Object.hasOwn(part, key) ? (part as Record<string, unknown>)[key] : undefined))
                .find((candidate) => typeof candidate === 'number');

            if (typeof value === 'number') {
                return value;
            }
        }

        return 0;
    };

    return {
        paddingTop: read('paddingTop', 'paddingVertical', 'padding'),
        paddingBottom: read('paddingBottom', 'paddingVertical', 'padding'),
    };
}

/**
 * The vertical padding that puts a multi-line input's first-line cap band where a single line's sits. Pure.
 *
 * Only a multi-line input on iOS is offset: {@link IOS_LEADING_DROP} of the leading comes off its top padding, never below
 * zero. A single-line input is the platform's own (its cap band is already centred), and Android's multi-line is held.
 *
 * @param style - The caller's style for the input (an object, or an array of them).
 * @param os - The platform.
 * @param multiline - Whether the input has more than one line.
 * @param systemScale - The system font scale.
 * @returns The two paddings to lay over the caller's style, or nothing where the input is not offset.
 */
export function inputBoxPadding(
    style: unknown,
    os: 'ios' | 'android',
    multiline: boolean,
    systemScale: number,
): InputBoxPadding | undefined {
    if (!multiline || os !== 'ios') {
        return undefined;
    }

    const { paddingTop, paddingBottom } = verticalPaddingOf(style);
    const lineHeight = scaledLeading('body', systemScale);

    return { paddingTop: Math.max(0, paddingTop - lineHeight * IOS_LEADING_DROP), paddingBottom };
}
