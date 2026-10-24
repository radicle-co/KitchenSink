/**
 * @module @commise/ui/back-to-top — when web's "Back to top" shows (`docs/design/uiOverhaul/buildSpec.md` §3.6): on a
 * page taller than four viewports, once the reader is more than four viewports down, and only while the last scroll
 * was upward (NN/g, "Back-to-Top Button Design Guidelines", 2017). Depth arrives from the page's `ScrollHost` in
 * viewports, to the quarter, so "more than four" is first true at 4¼.
 *
 * @pattern Policy — a pure decision over the page's scroll state
 */

/** How many viewports of page, and of scroll, the button waits for. */
export const BACK_TO_TOP_VIEWPORTS = 4;

/** What the decision depends on. */
export interface BackToTopInputs {
    /** How many viewports tall the page is. */
    readonly pageViewports: number;
    /** How many viewports down the reader is. */
    readonly viewportsDown: number;
    /** Whether the last scroll moved up the page. */
    readonly scrollingUp: boolean;
    /** Whether the on-screen keyboard is open. */
    readonly keyboardOpen: boolean;
}

/**
 * Whether "Back to top" shows.
 *
 * @param inputs - The page's scroll state.
 * @returns True on a long page, far down, scrolling up, with no keyboard. Pure.
 */
export function showsBackToTop(inputs: BackToTopInputs): boolean {
    return (
        inputs.pageViewports > BACK_TO_TOP_VIEWPORTS &&
        inputs.viewportsDown > BACK_TO_TOP_VIEWPORTS &&
        inputs.scrollingUp &&
        !inputs.keyboardOpen
    );
}
