/**
 * @module @commise/ui/surface-tone — the native paint of a tone, read from the one table (`surfaceTone.ts`). A root that
 * paints itself (a sheet's animated view) reads the fill here and states the tone with `SurfaceToneScope`; `Surface`
 * does both. Pure.
 */
import type { Theme } from '../theme/themeFor.js';
import { SURFACE_TONES, type SurfaceTone } from './surfaceTone.js';

/**
 * The fill a tone paints in a theme.
 *
 * @param theme - The theme to paint in.
 * @param tone - The surface.
 */
export function surfaceFill(theme: Theme, tone: SurfaceTone): string {
    return theme.colors[SURFACE_TONES[tone].fill];
}
