/**
 * @module theme/fonts — the mobile display-font family names (Home chrome).
 *
 * React Native's `fontFamily` takes a single REGISTERED family name, not the web's CSS font stack. The
 * Playfair Display faces are loaded once at app start (`App.tsx` → `useFonts`) from
 * `@expo-google-fonts/playfair-display`, and these constants name the loaded faces so the greeting and other
 * display headings reference them by a single source of truth rather than a scattered string literal. Until
 * the faces finish loading, RN falls back to the system serif — a brief, harmless degradation.
 */

/** The semibold Playfair face — display headings that are not the marquee greeting. */
export const DISPLAY_FONT_SEMIBOLD = 'PlayfairDisplay_600SemiBold';

/** The bold Playfair face — the marquee Home greeting. */
export const DISPLAY_FONT_BOLD = 'PlayfairDisplay_700Bold';
