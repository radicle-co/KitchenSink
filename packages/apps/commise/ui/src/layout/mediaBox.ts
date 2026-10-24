/**
 * @module @commise/ui/layout — how tall a media box may be (`docs/design/compactHeightLayout.md` §8).
 *
 * One media box may take at most 40% of the window's height, at every size. On a phone held sideways the recipe's
 * title then starts on the first screen; held upright, nothing changes (0.4 × 851 is more than the 256 dp hero); an iPad
 * held sideways stops drawing a photo strip taller than its window. The hero keeps its width and crops, because it is a
 * banner. The photo strip keeps 4:3 and narrows, because a thin slice of a plated dish is not a photo of it.
 *
 * @pattern Policy — pure rules from the preferred size and the window to a box.
 */

/** The largest share of the window's height one media box may take. */
export const MEDIA_MAX_WINDOW_FRACTION = 0.4;

/** A box's width and height, in dp. */
export interface MediaBox {
    readonly width: number;
    readonly height: number;
}

/**
 * A media box's height: its preferred height, capped by the window. Pure.
 *
 * @param preferred - The height the box wants, in dp.
 * @param windowHeight - The window's height, in dp.
 * @returns The smaller of the two, the cap floored to a whole dp.
 */
export function mediaBoxHeight(preferred: number, windowHeight: number): number {
    return Math.min(preferred, Math.floor(windowHeight * MEDIA_MAX_WINDOW_FRACTION));
}

/**
 * The photo strip's box: 4:3 at the width the strip is given, capped by the window, and narrowed to keep 4:3. Pure.
 *
 * @param availableWidth - The strip's own laid-out width, in dp.
 * @param windowHeight - The window's height, in dp.
 * @returns The slide's box, in whole dp.
 */
export function carouselBox(availableWidth: number, windowHeight: number): MediaBox {
    const height = mediaBoxHeight(Math.round((availableWidth * 3) / 4), windowHeight);

    return { width: Math.min(availableWidth, Math.round((height * 4) / 3)), height };
}
