/**
 * @module @commise/ui/theme — `useColorSchemeName` (native): the scheme the SYSTEM is in, and the one place native code
 * reads it (`darkTheme.md` §5). `useTheme` and the Tamagui provider's `defaultTheme` both take it, so they cannot
 * disagree. A platform that reports no preference (`null`) gets light. No preference is stored and none overrides it.
 */
import { useColorScheme } from 'react-native';

import type { ColorSchemeName } from './themeFor.js';

/**
 * The system's colour scheme, following a change on the device.
 *
 * @returns `'dark'` when the system says dark, otherwise `'light'`.
 */
export function useColorSchemeName(): ColorSchemeName {
    return useColorScheme() === 'dark' ? 'dark' : 'light';
}
