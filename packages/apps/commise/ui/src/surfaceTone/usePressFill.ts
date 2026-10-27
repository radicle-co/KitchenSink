/**
 * @module @commise/ui/surface-tone — `usePressFill` (web): the press fill as a CSS value. The cascade already carries the
 * nearest surface's press as `--cm-press`, so there is nothing to compute; the value falls back to the canvas row
 * outside every surface, like `PRESS_FILL_CLASS`. Provided so web and native export the same names (`CODING_STANDARDS`
 * §14); a web control normally wears `PRESS_FILL_CLASS` instead.
 */

/**
 * The press fill for the nearest surface, as a CSS value.
 *
 * @returns A CSS colour expression.
 */
export function usePressFill(): string {
    return 'var(--cm-press,var(--color-press-canvas))';
}
