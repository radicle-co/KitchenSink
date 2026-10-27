/**
 * @module @commise/ui/check-box-glyph — the shared contract of the design-system `CheckBoxGlyph`: the drawn box of a
 * whole-row checkbox (`docs/design/uiOverhaul/buildSpec.md` §6.3). The row is the control and carries the role, the
 * checked state and the name; the glyph only draws it, and carries the one signature motion (§1.9).
 */

/**
 * The corner of the 18 px box, in px (owner decisions C5/T1: a rounded square, never the 8 px step, which reads as a
 * radio). The radius scale has no step this small and gets none: a fixed-size glyph owns its corner here, and
 * `offScaleRadius.test.ts` lets only a module whose `@pattern` names it a Glyph read a `GLYPH_` constant. Web and
 * native both read it.
 */
export const GLYPH_CORNER = 4;

/** Props for the `CheckBoxGlyph` leaves (web and native). */
export interface CheckBoxGlyphProps {
    /** Whether the row is checked: the box fills and the check springs in. */
    readonly checked: boolean;
}
