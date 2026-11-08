/**
 * @module @commise/ui/theme — `useTheme` (native): the theme of the scheme the SYSTEM is in (`darkTheme.md` §5 and
 * §7.2). It follows the OS setting live; no preference is stored and none overrides it. A platform that reports no
 * preference (`null`) gets light. The scheme is read once, by `useColorSchemeName`.
 */
import { themeFor, type Theme } from './themeFor.js';
import { useColorSchemeName } from './useColorSchemeName.native.js';

/**
 * The current scheme's theme. Read colours from it at render: `[styles.card, { backgroundColor: theme.colors.paper }]`.
 *
 * @returns The theme.
 */
export function useTheme(): Theme {
    return themeFor(useColorSchemeName());
}
