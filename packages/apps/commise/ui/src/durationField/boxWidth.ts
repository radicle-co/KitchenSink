/**
 * @module @commise/ui/duration-field — the least width of an hours or minutes box, once for both leaves.
 *
 * A box shares the room its cell gives it, but never narrows below two digits: minutes go to 59, and two hours digits
 * cover a 48-hour brine. A longer number scrolls inside its box. The width comes from the font, never a fixed number,
 * so it grows with the text size: `em` on web, the scaled font size on native.
 *
 * @pattern Policy — pure rules that map the field's font and geometry to the box's least width.
 */

/** The digits a box holds before it grows. */
export const DURATION_BOX_DIGITS = 2;

/** The widest digit of the body face, in em: Inter's "4" is 1,323 of 2,048 units (0.646 em). */
export const WIDEST_DIGIT_EM = 0.65;

/** What the native box's least width is made of, in dp. */
export interface DurationBoxGeometry {
    /** The box's font size after the system text size is applied. */
    readonly fontSize: number;
    /** The padding on one side. */
    readonly padding: number;
    /** The edge on one side. */
    readonly edge: number;
}

/**
 * The native box's least width.
 *
 * @param geometry - The scaled font size, and one side's padding and edge.
 * @returns The width, in dp. Pure.
 */
export function durationBoxMinWidth({ fontSize, padding, edge }: DurationBoxGeometry): number {
    return DURATION_BOX_DIGITS * WIDEST_DIGIT_EM * fontSize + 2 * padding + 2 * edge;
}

/** The web box's least width, in the box's own font: `px-2!` is 0.5 rem a side, and the edge is 1 px a side. */
export const DURATION_BOX_MIN_WIDTH_CSS = `calc(${DURATION_BOX_DIGITS * WIDEST_DIGIT_EM}em + 1rem + 2px)`;
