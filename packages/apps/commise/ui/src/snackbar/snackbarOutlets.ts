/**
 * @module @commise/ui/snackbar — the stack of open windows that offer the snackbar host a place to draw.
 *
 * A window that opens (a sheet, a dialog) is its own native window, so a snackbar drawn at the app root sits under it.
 * Each open window registers an outlet here, by a token, with how deep it is nested inside other windows. The host
 * draws the one snackbar in the outlet on top, or in its own place while the stack is empty.
 *
 * "On top" is the deepest window, and among windows equally deep, the one that registered last. Depth comes first
 * because React runs a child's effects before its parent's: a dialog that opens in the same render as the sheet around
 * it registers BEFORE the sheet, and registration order alone would put the snackbar under the dialog. Pure: every
 * function returns a new stack, or the same one when nothing changes.
 */

/** One open window's outlet. */
export interface SnackbarOutletEntry {
    readonly token: string;
    /** 1 for a window opened from the app, 2 for a window opened inside it, and so on. */
    readonly depth: number;
}

/** The open windows' outlets, in the order they registered. */
export type SnackbarOutletStack = readonly SnackbarOutletEntry[];

/** No window is open. */
export const NO_OUTLETS: SnackbarOutletStack = [];

/**
 * Add a window's outlet. Pure.
 *
 * @param stack - The outlets now.
 * @param entry - The window's token and depth.
 * @returns The stack with the window added last; the same stack when its token is already in it.
 */
export function registerOutlet(stack: SnackbarOutletStack, entry: SnackbarOutletEntry): SnackbarOutletStack {
    return stack.some((outlet) => outlet.token === entry.token) ? stack : [...stack, entry];
}

/**
 * Remove a window's outlet, wherever it sits in the stack. Pure.
 *
 * @param stack - The outlets now.
 * @param token - The window's token.
 * @returns The stack without it; the same stack when it was not in it.
 */
export function unregisterOutlet(stack: SnackbarOutletStack, token: string): SnackbarOutletStack {
    return stack.some((outlet) => outlet.token === token) ? stack.filter((outlet) => outlet.token !== token) : stack;
}

/**
 * The outlet the snackbar draws in. Pure.
 *
 * @param stack - The outlets now.
 * @returns The token of the deepest window, the latest to register among equals, or `undefined` while none is open.
 */
export function topOutlet(stack: SnackbarOutletStack): string | undefined {
    let top: SnackbarOutletEntry | undefined;

    for (const outlet of stack) {
        if (top === undefined || outlet.depth >= top.depth) {
            top = outlet;
        }
    }

    return top?.token;
}
