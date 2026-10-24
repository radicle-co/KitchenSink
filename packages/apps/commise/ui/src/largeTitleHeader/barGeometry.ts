/**
 * @module @commise/ui/large-title-header — the pinned bar's measurements. Pure; both platforms' leaves and every page
 * that lays content under the bar read them, so the bar's height, the content's top padding and the back control's place
 * are derived from one number each.
 */
import { pinnedBarHeight } from '../tokens/layout.js';
import { spacing } from '../tokens/scale.js';

/**
 * The pinned back bar's height, pt (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §3; buildSpec §3.3): ONE height,
 * and it never changes. It sits at the top of the screen's safe-area frame, which already clears the status bar, so it
 * adds no inset of its own. A page that scrolls under the bar pads its content by this much. On web the same number is
 * the `--pinned-bar-height` custom property (`tokens/themeCss.ts`).
 */
export const PINNED_BAR_HEIGHT = pinnedBarHeight;

/** The back chevron's box, pt. */
export const BACK_GLYPH_PX = 24;

/** The page's content gutter, pt (`spacing[4]`): where the chevron's box starts, so it lines up with the page below it. */
export const CONTENT_GUTTER_PX = spacing[4];

/**
 * The room before the chevron when it is centred in a touch frame of `floor` pt.
 *
 * @param floor - The frame's side, pt (44 on iOS, 48 on Android).
 * @returns Half of what the frame has beyond the glyph.
 */
export function backGlyphInset(floor: number): number {
    return (floor - BACK_GLYPH_PX) / 2;
}

/**
 * The bar's start padding that puts the chevron's box on the content gutter once the frame's own room is counted. Never
 * negative: a frame so wide that the gutter cannot be reached starts at the screen's edge.
 *
 * @param floor - The back control's touch frame, pt.
 * @returns The bar's start padding, pt.
 */
export function barStartPadding(floor: number): number {
    return Math.max(0, CONTENT_GUTTER_PX - backGlyphInset(floor));
}
