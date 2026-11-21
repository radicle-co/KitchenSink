/**
 * @module @commise/ui/overlay — the layer order of what draws inside one native window.
 *
 * A `zIndex` overrides sibling order, and Tamagui's sheet frame carries one of its own, so "the outlet is the window's
 * last child" did not keep the snackbar above it: the snackbar was in the accessibility tree and not on screen. The
 * sheet engine is given its layer here, and the snackbar's outlet is the next one up. Both read these numbers.
 */

/** The layer of the sheet engine's frame. 100_001 is what Tamagui's own default comes to, stated so it is not implied. */
const SHEET_LAYER = 100_001;

export const WINDOW_LAYERS = { sheet: SHEET_LAYER, snackbar: SHEET_LAYER + 1 } as const;
