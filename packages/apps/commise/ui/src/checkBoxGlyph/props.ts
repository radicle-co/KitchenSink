/**
 * @module @commise/ui/check-box-glyph — the shared contract of the design-system `CheckBoxGlyph`: the drawn box of a
 * whole-row checkbox (`docs/design/uiOverhaul/buildSpec.md` §6.3). The row is the control and carries the role, the
 * checked state and the name; the glyph only draws it, and carries the one signature motion (§1.9).
 */

/** Props for the `CheckBoxGlyph` leaves (web and native). */
export interface CheckBoxGlyphProps {
    /** Whether the row is checked: the box fills and the check springs in. */
    readonly checked: boolean;
}
