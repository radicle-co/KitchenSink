/**
 * @module theme/fonts — the mobile display-font face names.
 *
 * React Native's `fontFamily` takes a single REGISTERED face name, not the web's CSS font stack. The
 * Playfair Display faces are loaded once at app start (`App.tsx` → `useFonts`) from
 * `@expo-google-fonts/playfair-display`; these constants are the app-local aliases of the design system's
 * `nativeTokens.fontFace.display` registry, so the face names live in exactly ONE place (the shared scale)
 * and the screens keep referencing them by name rather than by a scattered string literal. Until the faces
 * finish loading, RN falls back to the system serif — a brief, harmless degradation.
 */
import { nativeTokens } from '@commise/ui/native';

/** The semibold Playfair face — display headings that are not the marquee greeting. */
export const DISPLAY_FONT_SEMIBOLD = nativeTokens.fontFace.display.semibold;

/** The bold Playfair face — the marquee Home greeting. */
export const DISPLAY_FONT_BOLD = nativeTokens.fontFace.display.bold;
