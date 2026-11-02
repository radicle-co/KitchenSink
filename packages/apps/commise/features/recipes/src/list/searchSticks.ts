/**
 * @module @commise/features-recipes — when the Recipes search field sticks (designer finding C-2, as corrected in
 * `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`).
 *
 * @pattern Policy — a pure decision over two measured heights
 */

/** The share of the visible window the search field may hold before it scrolls with the rest. */
export const SEARCH_STICKS_BELOW_SHARE = 1 / 3;

/**
 * Whether the search field sticks at the top while the list scrolls: only while its own height is under a third of the
 * visible window. Nothing sticks on a guess, so an unmeasured (zero) window answers `false`.
 *
 * @param searchHeightPx - The search field's measured height, px, at the current text scale.
 * @param visibleHeightPx - The window's visible height, px: the part above the keyboard when one is open.
 * @returns `true` when the field sticks. Pure.
 */
export function searchSticks(searchHeightPx: number, visibleHeightPx: number): boolean {
    return visibleHeightPx > 0 && searchHeightPx < visibleHeightPx * SEARCH_STICKS_BELOW_SHARE;
}
