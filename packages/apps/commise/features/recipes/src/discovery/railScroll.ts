/**
 * @module @commise/features-recipes/discovery — the pure arithmetic of a browse rail's scroll track
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4): how far one card moves it, and how far Previous and Next move it ("by
 * one view minus one card"). Whether the track is at either end is the design-system scroll hint's rule
 * (`@commise/ui/horizontal-scroller`), reported by the track.
 *
 * Pure: the DOM reads happen at the call site and arrive as numbers.
 */

/** The gap between a rail's cards, in px (`gap-4`). */
export const RAIL_GAP_PX = 16;

/**
 * How far one card moves the track: the card and its gap, or a fraction of the view while no card has a measured width.
 *
 * @param cardWidth - The first card's width in px, or 0 when it has not been laid out.
 * @param clientWidth - The track's view width.
 * @returns The distance in px, always positive.
 */
export function cardStepOf(cardWidth: number, clientWidth: number): number {
    return cardWidth > 0 ? cardWidth + RAIL_GAP_PX : Math.max(clientWidth * 0.8, 1);
}

/**
 * How far Previous and Next move the track: one view less one card, so the card the cook was looking at stays in sight
 * as the first of the next view, and never less than one card.
 *
 * @param cardWidth - The first card's width in px, or 0 when it has not been laid out.
 * @param clientWidth - The track's view width.
 * @returns The distance in px, always positive.
 */
export function pageStepOf(cardWidth: number, clientWidth: number): number {
    const card = cardStepOf(cardWidth, clientWidth);

    return Math.max(clientWidth - card, card);
}

/** A rail card is never narrower than this: the grid card's one-line rows need it (`buildSpec.md` §4.1). */
export const RAIL_CARD_MIN_PX = 240;

/** A rail card is never wider than this, so cards stay equal from a 390 view up. */
export const RAIL_CARD_MAX_PX = 256;

/** A rail card's share of its track: the next card peeks at the edge, the swipe cue on touch. */
export const RAIL_CARD_SHARE = 0.78;

/**
 * A rail card's width on native, where there are no container units: `clamp(240, 78% of the track, 256)`, the same rule
 * the web states as `w-[clamp(240px,78%,256px)]`. At a 320 track the next card peeks about 32 px, at 390 about 86.
 *
 * @param trackPx - The track's width in px.
 * @returns The card's width in px.
 */
export function railCardWidthOf(trackPx: number): number {
    return Math.min(RAIL_CARD_MAX_PX, Math.max(RAIL_CARD_MIN_PX, trackPx * RAIL_CARD_SHARE));
}
