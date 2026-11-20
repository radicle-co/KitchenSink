/**
 * @module pinnedOverlayLimit — how tall the open pinned ingredients bar and its panel may be together: half the window
 * (designer D75, and `docs/design/compactHeightLayout.md` rule B, which counts the pinned top row), so the step the
 * cook
 * is following keeps the other half at any text size. Native caps the frame holding the bar and the panel with the
 * number.
 * Web writes the same cap as a complete Tailwind class, because Tailwind builds only class text it can find in a
 * scanned
 * file. The two sit side by side, as `TWO_COLUMN_BODY` pairs a number with its class.
 */

/**
 * @param windowHeight - The window's height in points.
 * @returns The most the bar and the open panel may be together, in points: half the window, rounded down. Pure.
 */
export function pinnedOverlayMaxHeight(windowHeight: number): number {
    return Math.floor(windowHeight / 2);
}

/**
 * The web frame's cap: half the window, less where the frame starts (the safe top inset and 0.5 rem, the bar's own
 * placement), so the frame ends at half the window. The bottom chrome never reaches the top half, so it takes no term.
 */
export const PINNED_OVERLAY_WEB_MAX_HEIGHT_CLASS_NAME = 'max-h-[calc(50dvh-env(safe-area-inset-top,0px)-0.5rem)]';
