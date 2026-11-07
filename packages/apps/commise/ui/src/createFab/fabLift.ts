/**
 * @module @commise/ui/create-fab — how far the floating create button rises to clear a snackbar.
 */

/** The space kept between the snackbar's top edge and the button, dp (Material's FAB and snackbar rule). */
export const FAB_SNACKBAR_GAP = 8;

/**
 * How far the button rises above its resting place while a snackbar shows. Pure.
 *
 * @param snackbarHeight - The showing snackbar's height in dp; `0` when none shows.
 * @returns `0` with no snackbar; otherwise the snackbar's height plus {@link FAB_SNACKBAR_GAP}.
 */
export const fabLiftOver = (snackbarHeight: number): number =>
    snackbarHeight > 0 ? snackbarHeight + FAB_SNACKBAR_GAP : 0;
