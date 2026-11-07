/**
 * @module @commise/features-recipes/discovery — the geometry of a rail heading's "See all" link (designer ruling,
 * designAnswers.md 2026-11-01, "See all under its title").
 *
 * When the heading and the link do not fit on one row, the link wraps onto its own line under the heading, its text on the
 * title's start edge, its target at least 48 tall. It never truncates and never shrinks. The text sits on the edge because the
 * link's box is pulled back by the ghost button's own horizontal padding.
 *
 * Pure. Both leaves draw to these numbers (native as style values, web as inline styles), and
 * `__tests__/railHeading.fit.test.ts` measures the link against them on real font metrics.
 *
 * @pattern Policy — the geometry of a wrapping heading link
 */
import { nativeTokens } from '@commise/ui/native';

/** The least height of the link's target, in pt (48 on Android; the ruling takes it on both platforms). */
export const RAIL_LINK_MIN_HEIGHT = 48;

/** The ghost button's own horizontal padding on each side (`BUTTON_PILL_LAYOUT.paddingHorizontal`, spacing 3). */
export const RAIL_LINK_PADDING = nativeTokens.spacing[3];

/** How far the link's box is pulled back from the start edge, so its TEXT sits on the title's start edge. */
export const RAIL_LINK_INSET = RAIL_LINK_PADDING;
