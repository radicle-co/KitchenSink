/**
 * @module tokens/iosLineHeight: the default (web, Node, Android-neutral) line-height snap, which changes nothing. The
 * iOS workaround for react/react-native#58970 lives in `iosLineHeight.native.ts`, which a native bundler resolves in
 * place of this file; both export the same two functions.
 *
 * @pattern Strategy: the platform file is the strategy, picked by the `.native.ts` resolution suffix
 */

/**
 * The leading to hand React Native. Here it is the token's own value.
 *
 * @param lineHeight - The leading in pt, after any font scaling.
 * @param _pixelScale - The device pixel ratio (unused off iOS).
 * @returns `lineHeight`, unchanged.
 */
export function snapLineHeight(lineHeight: number, _pixelScale: number): number {
    return lineHeight;
}

/** The device pixel ratio: 1 where there is no device. */
export function devicePixelScale(): number {
    return 1;
}
