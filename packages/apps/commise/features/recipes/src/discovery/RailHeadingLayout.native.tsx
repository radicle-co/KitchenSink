/**
 * @module @commise/features-recipes — the box a rail heading's "See all" link sits in (native).
 *
 * The link wraps under its title when the two do not fit; it never shrinks or truncates, its target is at least 48 tall, and
 * its box is pulled back by the ghost button's padding so its TEXT sits on the title's start edge (designer ruling,
 * designAnswers.md 2026-11-01, "See all under its title"). The numbers are `railHeading.ts`'s, and `__tests__/RecipeBrowseRails.native.test.tsx` measures the rendered box.
 * Styled with Tamagui, so the screen file that holds the React Native styling ratchet adds nothing to it.
 *
 * @pattern Variant — a Tamagui `styled` frame
 */
import { styled, View } from 'tamagui';

import { RAIL_LINK_INSET, RAIL_LINK_MIN_HEIGHT } from './railHeading.js';

/** Presentational: the link's box in a rail heading's wrapping row. */
export const RailLinkBox = styled(View, {
    name: 'RecipeRailLinkBox',
    flexShrink: 0,
    minHeight: RAIL_LINK_MIN_HEIGHT,
    justifyContent: 'center',
    // The ghost button's own horizontal padding, backwards: a negative step is no token, so the shared number is used.
    marginInlineStart: -RAIL_LINK_INSET,
});
