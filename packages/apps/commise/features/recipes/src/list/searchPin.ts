/**
 * @module @commise/features-recipes — the Recipes search field's pin (designer finding C-2, as corrected in
 * `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`): the title, segments, chips and count bar scroll away
 * with the list, and the ONE search field slides with the scroll until it reaches the top, then holds there.
 *
 * Pure decisions over measured numbers; the one set of Animated nodes they feed is `searchPinNodes.native.ts`. The field itself is
 * drawn once, by the frame, above the list; the list holds a spacer of its height. The slide and the band are native-driven
 * nodes of the list's scroll offset, built once, and a re-measure only writes their two inputs with `setValue`: swapping an
 * `interpolate()` node on a view the native driver already drives left the view showing the OLD node's value (qa-ios,
 * ScaleToCap: the field at its 1x rest spot after the text went to the cap, 5 tries in 6).
 *
 * @pattern Policy — pure decisions over measured numbers (whether to pin, and the slide's inputs)
 */
/** The share of the WINDOW the search field may hold before it scrolls away with the rest. */
export const SEARCH_STICKS_BELOW_SHARE = 1 / 3;

/**
 * Whether the search field pins at the top while the list scrolls: only while its own height is under a third of the
 * window. The WINDOW, not the part above the keyboard (designer ruling): the keyboard opening mid-word must not un-pin
 * the field. Nothing pins on a guess, so an unmeasured (zero) window answers `false`.
 *
 * @param searchHeightPx - The search field's measured height, px, at the current text scale.
 * @param windowHeightPx - The window's height, px.
 * @returns `true` when the field pins. Pure.
 */
export function searchSticks(searchHeightPx: number, windowHeightPx: number): boolean {
    return windowHeightPx > 0 && searchHeightPx < windowHeightPx * SEARCH_STICKS_BELOW_SHARE;
}

/** The pinned top of a field that does not pin: so far above the screen that the field never reaches it. */
export const UNPINNED_FLOOR = -1_000_000;

/** The two numbers the slide is built from. */
export interface SearchPinGeometry {
    /** Where the field naturally sits in the list's content, px from its top (the spacer's y plus the header's top padding). */
    readonly naturalTop: number;
    /** Where it holds when pinned, px from the top of the list's frame; {@link UNPINNED_FLOOR} for a field that does not pin. */
    readonly pinnedTop: number;
}

/** What {@link searchPinGeometry} reads. */
export interface SearchPinInput {
    /** Where the field naturally sits in the list's content, px from its top. */
    readonly naturalTop: number;
    /** Where it holds when pinned, px from the top of the list's frame. */
    readonly pinnedTop: number;
    /** Whether the field pins ({@link searchSticks}). */
    readonly pins: boolean;
}

/**
 * The slide's inputs: a field that does not pin has its pinned top put out of reach, so it keeps going with the page.
 *
 * @param input - The measured natural top, the pinned top and whether it pins.
 * @returns The two numbers to write into the nodes. Pure.
 */
export function searchPinGeometry({ naturalTop, pinnedTop, pins }: SearchPinInput): SearchPinGeometry {
    return { naturalTop, pinnedTop: pins ? pinnedTop : UNPINNED_FLOOR };
}
