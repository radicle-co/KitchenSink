/**
 * @module chromeSurface/liquidGlass — whether this device draws real Liquid Glass: iOS 26 with the glass API present.
 * Both checks, because some iOS 26 betas lack the API and crash on `GlassView` (expo/expo#40911). Off iOS both answer
 * false (`expo-glass-effect`'s non-iOS leaves). Internal to `@commise/ui`: `ChromeSurface` and `CreateFab` read it.
 */
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

/**
 * @returns True on iOS 26 with the glass API.
 * @sideEffect Reads the device's OS version and the native module's presence.
 */
export function hasLiquidGlass(): boolean {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
}
