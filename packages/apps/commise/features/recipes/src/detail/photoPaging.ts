/**
 * @module @commise/features-recipes — the photo carousel's paging rule, shared by both platforms' carousels.
 */

/**
 * The page a strip rests on: the slide whose start is nearest its scroll offset, kept inside the strip. A swipe that
 * settles between two slides reads as the nearer one.
 *
 * @param offset - How far the strip has scrolled, in the same unit as `pitch`.
 * @param pitch - The distance from one slide's start to the next's.
 * @param count - How many slides the strip holds.
 * @returns The zero-based page, `0` for a strip with no pitch yet or no slide.
 */
export function pageAt(offset: number, pitch: number, count: number): number {
    if (pitch <= 0 || count <= 0) {
        return 0;
    }

    return Math.min(count - 1, Math.max(0, Math.round(offset / pitch)));
}
