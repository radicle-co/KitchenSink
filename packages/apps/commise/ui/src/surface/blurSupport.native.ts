/**
 * @module @commise/ui/surface — the NATIVE leg of the backdrop-blur capability probe.
 *
 * A frosted-glass surface is designed to sit OVER a blurred backdrop. Where the host cannot blur, painting the
 * translucent tint anyway produces a washed-out, unblurred panel — so the surface must take the tier's
 * more-opaque solid `fallback` instead. On native that question has a real answer that varies by platform:
 * `expo-blur` blurs for real on iOS, and on Android its `blurMethod` defaults to `'none'`, rendering a plain
 * translucent `View`. See {@link supportsNativeBlur} for the evidence behind the host list.
 *
 * This leaf is deliberately a THIN adapter over that pure predicate. It reads React Native's `Platform.OS` —
 * a static descriptor populated at startup, not a runtime measurement — and defers the whole decision. Keeping
 * the branch in the pure predicate is what makes every host testable; a probe that inlined the comparison
 * could only ever be observed on whichever host the test runner happens to be.
 */
import { Platform } from 'react-native';

import { supportsNativeBlur } from '../tokens/gradients.js';

/**
 * Whether the host can actually blur a backdrop.
 *
 * Reads only RN's static `Platform.OS` (no I/O, no async, no measurement), so it is safe to call at module
 * scope. The mirror of `isBlurSupported`.
 *
 * @returns `true` on hosts where `expo-blur` renders a real blur; `false` where it degrades to a translucent
 *   unblurred view (notably Android with the default `blurMethod`).
 */
export function isBlurSupported(): boolean {
    return supportsNativeBlur(Platform.OS);
}
