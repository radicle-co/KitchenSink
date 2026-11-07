/**
 * @module @commise/ui/theme — package export for the colour theme. `useTheme` is native-only: on web the theme is the
 * CSS custom properties the dark block overrides (`tokens/themeCss.ts`), read through role utilities, so a web
 * component needs no hook. Consumed as `@commise/ui/theme`.
 *
 * ⛔ `./useTheme.js` and `./useColorSchemeName.js`, never their `.native.js` leaves: the bundler picks the platform's leaf, so web never reaches
 * `react-native` (`__tests__/themeWebEntry.test.ts`).
 */
export { themeFor, type ColorSchemeName, type Theme } from './themeFor.js';
export { useColorSchemeName } from './useColorSchemeName.js';
export { useTheme } from './useTheme.js';
