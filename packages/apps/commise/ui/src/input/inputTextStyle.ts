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
 * ## Centring (designer ruling 2026-11-03)
 *
 * Even with no leading, iOS draws the ink of a single line a little below the middle of its line box (the font's ascent
 * carries internal leading): qa-ios measured 2 pt at 16 pt and 3.5 pt at 32 pt, about {@link IOS_INK_DROP_EM} of the size.
 * A multi-line field keeps its leading, and its first line sits about 4 pt low under the 24 pt body leading, one sixth
 * of it ({@link IOS_LEADING_DROP}). Both are taken out through the field's padding by {@link inputBoxPadding}, from these
 * two constants and nowhere else. Android draws the same descender drop (qa-device, committed text, caret off: five
 * single-line fields 1.5 to 1.7 pt low at 16 pt), so a single line is lifted there too; its multi-line first line is held.
 *
 * ⛔ Nothing may spread a `nativeTokens.type.<role>` into a text input's style: it brings the fixed `lineHeight` back.
 * `nativeInputLineHeight.test.ts` refuses it.
 *
 * Pure.
 */
import type { TextStyle } from 'react-native';

import { scaledTypeSize } from '../text/scaledType.js';
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
 * How far iOS draws a single line's ink below the middle of its line box, as a fraction of the font size. Measured by
 * qa-ios on the search field: 2 pt at 16 pt, 3.5 pt at 32 pt.
 */
export const IOS_INK_DROP_EM = 0.11;

/**
 * How far to lift a multi-line field's first line, as a fraction of the leading. iOS draws it about 4 pt low under the 24 pt
 * body leading (designer), and 3.4 pt lower again than a single-line field's first line sits (qa-ios's Title at 1x; the
 * `firstLine` check wants them within 2 pt): 7.5 pt at 24 pt, 15 pt at the 48 pt cap.
 */
export const IOS_LEADING_DROP = 5 / 16;

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
 * The vertical padding that puts an input's ink in the middle of its box on iOS. Pure.
 *
 * A single line moves its padding from the top to the bottom, so the field keeps its height; with no top padding to
 * give, the bottom takes twice the drop. A multi-line field takes the leading drop off its top padding only. Neither
 * goes below zero. A numeric input is not offset, and a multi-line field on Android is held.
 *
 * @param style - The caller's style for the input (an object, or an array of them).
 * @param os - The platform.
 * @param multiline - Whether the input has more than one line.
 * @param systemScale - The system font scale.
 * @param numeric - Whether the input takes digits only: they have no descenders, so they need no lift.
 * @returns The two paddings to lay over the caller's style, or nothing where the input is not offset.
 */
export function inputBoxPadding(
    style: unknown,
    os: 'ios' | 'android',
    multiline: boolean,
    systemScale: number,
    numeric = false,
): InputBoxPadding | undefined {
    // A multi-line field's first line is lifted on iOS only; Android's is held for its next measurement.
    if (numeric || (multiline && os !== 'ios')) {
        return undefined;
    }

    const { paddingTop, paddingBottom } = verticalPaddingOf(style);
    const { fontSize, lineHeight } = scaledTypeSize('body', systemScale);

    if (multiline) {
        return { paddingTop: Math.max(0, paddingTop - lineHeight * IOS_LEADING_DROP), paddingBottom };
    }

    const drop = fontSize * IOS_INK_DROP_EM;
    const top = Math.max(0, paddingTop - drop);

    return { paddingTop: top, paddingBottom: paddingBottom + 2 * drop - (paddingTop - top) };
}
