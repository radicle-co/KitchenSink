/**
 * @module @commise/ui/surface-tone — `usePressFill` (native): the press fill of the surface the caller sits on. It replaces
 * the theme's single `wash`: a press is the surface with ink laid over it (`componentFixes.md` §10a), and which surface
 * is the nearest one's statement. A pressable that is not a Button reads its press here, never a role by hand.
 */
import { useTheme } from '../theme/useTheme.native.js';
import { useSurfaceTone } from './surfaceToneContext.js';

/**
 * The press fill for the nearest surface.
 *
 * @returns An opaque colour.
 */
export function usePressFill(): string {
    return useTheme().press[useSurfaceTone()];
}
