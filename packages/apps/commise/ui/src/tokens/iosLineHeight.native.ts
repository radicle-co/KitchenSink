/**
 * @module tokens/iosLineHeight (native): the iOS workaround for react/react-native#58970.
 *
 * On RN 0.86 (Expo 57) Yoga's `roundValueToPixelGrid` rounds in float (`PixelGrid.cpp:15`, `120-127`), so a text box
 * whose edges straddle y=2048 at 3x comes out 55.9998779 pt tall instead of 56. TextKit then draws into that frame
 * (`RCTTextLayoutManager.mm:74-77`), only one of two lines fits, and with no `numberOfLines` the break mode is clipping,
 * so the second line is laid out unwrapped and cut at the edge. A recipe step at 18/28 hit it.
 *
 * The cure is a leading a hair above the pixel grid: the measured height rounds UP to the grid, so the box gains about
 * 1/3 pt of slack, far more than Yoga's ~0.0002 pt error, at any string and position. Android stays exact: it rounds a
 * line height to whole pixels, so the 0.001 could add a pixel there.
 *
 * Fixed upstream in yoga#2037 and yoga#2040 and shipped in RN 0.88.1. REMOVE THIS FILE AND ITS DEFAULT SIBLING when the
 * app is on RN 0.88 or later, and call sites then use the token directly. Expo 57 pins RN 0.86 and links the prebuilt
 * React framework, so `patch-package` cannot reach Yoga.
 *
 * @pattern Strategy: the iOS strategy of the `iosLineHeight` pair, picked by the `.native.ts` resolution suffix
 */
import { PixelRatio, Platform } from 'react-native';

/** Slack above the grid line, in pt: far above Yoga's ~0.0002 pt float error, far below a visible shift. */
const ABOVE_GRID = 0.001;

/** Guards `ceil` against a product that float error pushes a hair over a whole pixel (84.0000001 px must stay 84). */
const FLOAT_GUARD = 1e-6;

/**
 * The leading to hand React Native: on iOS, rounded up to the pixel grid plus 0.001 pt; elsewhere the token's value.
 *
 * @param lineHeight - The leading in pt, after any font scaling (apply this LAST).
 * @param pixelScale - The device pixel ratio (`PixelRatio.get()`).
 * @returns The leading to draw, never below `lineHeight`.
 */
export function snapLineHeight(lineHeight: number, pixelScale: number): number {
    if (Platform.OS !== 'ios') {
        return lineHeight;
    }

    return Math.ceil(lineHeight * pixelScale - FLOAT_GUARD) / pixelScale + ABOVE_GRID;
}

/**
 * The device pixel ratio.
 *
 * @sideEffect Reads the device's display metrics.
 */
export function devicePixelScale(): number {
    return PixelRatio.get();
}
