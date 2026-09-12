/**
 * @module @commise/ui/variant-parts-line — the shared contract for the line that shows a variant's parts.
 */

/**
 * How the line reads. A display derivation, never a behaviour switch.
 *
 * - `secondary` — under a food's name (slate, body-sm).
 * - `primary` — a row in the details dialog (charcoal, body-md).
 */
export type VariantPartsTone = 'secondary' | 'primary';

/**
 * Props for the `VariantPartsLine` leaves (web and native).
 *
 * ⚠️ Native: nested inside another `Text` (the dialog's `Current: {parts}` line), the line's own
 * `accessibilityLabel` is dropped, because React Native keeps only the role of a nested `Text`. The host `Text` then
 * owns the label and builds it with `spokenVariantParts`.
 */
export interface VariantPartsLineProps {
    /**
     * The display text of each part, in WIRE order. Never empty, and never sorted here. `@commise/ui` imports no
     * schema package, so the caller maps the wire parts to their text.
     */
    readonly parts: readonly [string, ...string[]];
    /** How the line reads. */
    readonly tone: VariantPartsTone;
}
