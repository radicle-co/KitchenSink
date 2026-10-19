/**
 * @module @commise/ui/duration-field — the width of an hours or minutes box, once for both leaves.
 *
 * Both boxes take one width, so the pair reads as one control: two digits (minutes go to 59, and two hours digits
 * cover a 48-hour brine), the box's padding and edges, and room for the caret. A box never stretches to fill its row,
 * and a longer number scrolls inside it. The width comes from the font, never a fixed number, so it grows with the
 * text size: `em` on web, the scaled font size on native.
 *
 * @pattern Policy — pure rules that map the field's font and geometry to the box's width.
 */

/** The digits a box holds. */
export const DURATION_BOX_DIGITS = 2;

/** The widest digit of the body face, in em: Inter's "4" is 1,323 of 2,048 units (0.646 em). */
export const WIDEST_DIGIT_EM = 0.65;

/**
 * The room after the last digit for the caret, in px or dp: Android draws it 2 dp wide and iOS 2 pt, and a box with no
 * room for it scrolls the first digit out of view.
 */
export const CARET_ROOM = 4;

/** What the native box's width is made of, in dp. */
export interface DurationBoxGeometry {
    /** The box's font size after the system text size is applied. */
    readonly fontSize: number;
    /** The padding on one side. */
    readonly padding: number;
    /** The edge on one side. */
    readonly edge: number;
}

/**
 * The native box's width.
 *
 * @param geometry - The scaled font size, and one side's padding and edge.
 * @returns The width, in dp. Pure.
 */
export function durationBoxWidth({ fontSize, padding, edge }: DurationBoxGeometry): number {
    return DURATION_BOX_DIGITS * WIDEST_DIGIT_EM * fontSize + 2 * padding + 2 * edge + CARET_ROOM;
}

/**
 * The web box's width, in the box's own font: `px-2!` is 0.5 rem a side, and the px term is the 1 px edge on each side
 * plus {@link CARET_ROOM}.
 */
export const DURATION_BOX_WIDTH_CSS = `calc(${DURATION_BOX_DIGITS * WIDEST_DIGIT_EM}em + 1rem + ${2 + CARET_ROOM}px)`;
