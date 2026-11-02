/**
 * @module @commise/features-recipes — the Recipes search field's pin (designer finding C-2, as corrected in
 * `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`): the title, segments, chips and count bar scroll away
 * with the list, and the ONE search field slides with the scroll until it reaches the top, then holds there.
 *
 * Two pure decisions over measured numbers. The field itself is drawn once, by the frame, above the list; the list holds
 * a spacer of its height. The slide is a native-driven interpolation of the list's scroll offset.
 *
 * @pattern Policy — pure decisions over measured numbers (whether to pin, and the slide's ranges)
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

/** What `Animated.Value.interpolate` takes to move the field with the scroll. */
export interface SearchPinInterpolation {
    readonly inputRange: [number, number];
    readonly outputRange: [number, number];
    /** Always `extend`: an overscroll or a pull to refresh drags the field with the page. */
    readonly extrapolateLeft: 'extend';
    /** `clamp` holds the field at the pinned top; `extend` lets a field that does not pin leave with the page. */
    readonly extrapolateRight: 'clamp' | 'extend';
}

/** What {@link searchPinInterpolation} reads. */
export interface SearchPinInput {
    /** Where the field naturally sits in the list's content, px from its top (the spacer's `onLayout` `y`). */
    readonly naturalTop: number;
    /** Where it holds when pinned, px from the top of the list's frame. */
    readonly pinnedTop: number;
    /** Whether the field pins ({@link searchSticks}). */
    readonly pins: boolean;
}

/**
 * The slide's ranges: at scroll offset 0 the field is at its natural top, and it rises one for one with the scroll until
 * it reaches the pinned top, where it holds (or keeps going, when it does not pin). A field already at or above the pinned
 * top holds still, with a valid (non-empty) input range.
 *
 * @param input - The measured natural top, the pinned top and whether it pins.
 * @returns The interpolation to hand to `scrollY.interpolate`. Pure.
 */
export function searchPinInterpolation({ naturalTop, pinnedTop, pins }: SearchPinInput): SearchPinInterpolation {
    const travel = naturalTop - pinnedTop;
    const extrapolateRight = pins ? 'clamp' : 'extend';

    if (travel <= 0) {
        return pins
            ? { inputRange: [0, 1], outputRange: [naturalTop, naturalTop], extrapolateLeft: 'extend', extrapolateRight }
            : {
                  inputRange: [0, 1],
                  outputRange: [naturalTop, naturalTop - 1],
                  extrapolateLeft: 'extend',
                  extrapolateRight,
              };
    }

    return {
        inputRange: [0, travel],
        outputRange: [naturalTop, pinnedTop],
        extrapolateLeft: 'extend',
        extrapolateRight,
    };
}
