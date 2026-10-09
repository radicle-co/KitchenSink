/**
 * @module @commise/ui/theme — `useTheme` (native): the theme of the scheme the SYSTEM is in (`darkTheme.md` §5 and
 * §7.2). It follows the OS setting live; no preference is stored and none overrides it. A platform that reports no
 * preference (`null`) gets light. It is the one hook a future override would plug into.
 */
import { useColorScheme } from 'react-native';

import { themeFor, type Theme } from './themeFor.js';

/**
 * The current scheme's theme. Read colours from it at render: `[styles.card, { backgroundColor: theme.colors.paper }]`.
 *
 * @returns The theme.
 */
export function useTheme(): Theme {
    return themeFor(useColorScheme() === 'dark' ? 'dark' : 'light');
}
