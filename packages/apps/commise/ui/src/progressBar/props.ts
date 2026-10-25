/**
 * @module @commise/ui/progress-bar — the shared contract of the design-system `ProgressBar`: how far through a known
 * number of steps a task is (the import review's "Recipe 14 of 309"). Determinate only; a wait of unknown length is
 * `LoadingNotice`'s. The caller states the progress in words beside it; the bar is the same fact drawn.
 */

/** Props for the `ProgressBar` leaves (web and native). */
export interface ProgressBarProps {
    /** The bar's accessible name ("Recipes reviewed"). Localised by the caller. */
    readonly label: string;
    /** Steps done, from 0. Clamped into `[0, max]`. */
    readonly value: number;
    /** Steps in all. A bar with `max` of 0 or less draws empty. */
    readonly max: number;
}

/**
 * The share of the bar to fill, as a fraction in `[0, 1]`. Pure.
 *
 * @param value - Steps done.
 * @param max - Steps in all.
 * @returns The filled fraction; `0` when there are no steps.
 */
export function progressFraction(value: number, max: number): number {
    if (!(max > 0) || !Number.isFinite(value)) {
        return 0;
    }

    return Math.min(1, Math.max(0, value / max));
}
