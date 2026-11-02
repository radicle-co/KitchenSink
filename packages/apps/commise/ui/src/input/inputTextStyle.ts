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
