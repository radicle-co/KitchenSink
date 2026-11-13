/**
 * @module @commise/ui/testing/animations-shim — the test lane's stand-in for `@tamagui/animations-react-native`.
 *
 * The device driver throws on Tamagui's web build, which is what every native vitest lane runs, so each lane aliases the
 * driver's package name to this file. The design artifact's native bundle loads the same web build and aliases it too. It answers `createAnimations` with CSS transitions under the SAME names, so the
 * config builds and a Tamagui part that needs a driver renders. Every name gets one constant transition: no test can
 * observe motion, or a completion callback, through it. Motion and completion are proven on a device
 * (ADR-0080 §6).
 *
 * `@tamagui/animations-css/extras` is the entry that carries the animated-number hooks the Sheet reads; the plain entry
 * fails with "does not include animated-number hooks".
 */
import { createAnimations as createCssAnimations } from '@tamagui/animations-css/extras';

/**
 * The driver's `createAnimations`, over CSS.
 *
 * @param animations - The config's named animations; only the names are read.
 * @returns A CSS animation driver with one constant transition per name.
 */
export const createAnimations = (
    animations: Readonly<Record<string, unknown>>,
): ReturnType<typeof createCssAnimations> =>
    createCssAnimations(Object.fromEntries(Object.keys(animations).map((name) => [name, 'ease-out 250ms'])));
