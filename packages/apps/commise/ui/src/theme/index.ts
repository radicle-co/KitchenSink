/**
 * @module @commise/ui/theme — package export for the colour theme. `useTheme` is native-only: on web the theme is the
 * CSS custom properties the dark block overrides (`tokens/themeCss.ts`), read through role utilities, so a web
 * component needs no hook. Consumed as `@commise/ui/theme`.
 */
export { themeFor, type ColorSchemeName, type Theme } from './themeFor.js';
export { useTheme } from './useTheme.native.js';
