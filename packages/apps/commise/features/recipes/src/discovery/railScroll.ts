/**
 * @module @commise/features-recipes/discovery — the pure arithmetic of a browse rail's scroll track
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4): whether the track is at either end, how far one card moves it, and how
 * far Previous and Next move it ("by one view minus one card").
 *
 * Pure: the DOM reads happen at the call site and arrive as numbers.
 */

/** The gap between a rail's cards, in px (`gap-4`). */
export const RAIL_GAP_PX = 16;

/** What the track is doing, as far as the two buttons care. */
export interface RailScrollState {
    /** Scrolled to the start (or not scrollable at all): Previous has nowhere to go. */
    readonly atStart: boolean;
    /** Scrolled to the end (or not scrollable at all): Next has nowhere to go. */
    readonly atEnd: boolean;
}

/** The numbers a scroll container reports about itself. */
export interface RailGeometry {
    readonly scrollLeft: number;
    readonly clientWidth: number;
    readonly scrollWidth: number;
}

/**
 * Where the track stands. A track that fits its view is at both ends. The 1 px slack absorbs the sub-pixel rounding of
 * `scrollLeft` on a zoomed or scaled display, which would otherwise leave Next live at the very end.
 *
 * @param geometry - The track's scroll position and sizes.
 * @returns Whether it is at the start and at the end.
 */
export function railScrollState({ scrollLeft, clientWidth, scrollWidth }: RailGeometry): RailScrollState {
    return {
        atStart: Math.abs(scrollLeft) <= 1,
        atEnd: Math.abs(scrollLeft) + clientWidth >= scrollWidth - 1,
    };
}

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
