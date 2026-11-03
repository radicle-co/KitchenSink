/**
 * @module @commise/features-recipes — the Recipes search field's pin as ONE set of Animated nodes (native).
 *
 * The slide and the band are native-driven nodes of the list's scroll offset, built once; a re-measure only writes their two
 * inputs with `setValue`. Swapping an `interpolate()` node on a view the native driver already drives left the view showing
 * the OLD node's value (qa-ios, ScaleToCap: the field at its 1x rest spot after the text went to the cap, 5 tries in 6, with
 * the JS log identical in the pass).
 *
 * @pattern Builder — the one set of nodes the slide and the band read
 */
import { Animated } from 'react-native';

import type { SearchPinGeometry } from './searchPin.js';

/** The nodes the frame hands to its views, and how a re-measure reaches them. */
export interface SearchPin {
    /** The field's translation: its natural place, rising one for one with the scroll, held at the pinned top. */
    readonly translateY: Animated.AnimatedNode;
    /** The band's opacity: 0 while the field slides, 1 once it is pinned (over the last pixel of travel). */
    readonly bandOpacity: Animated.AnimatedNode;
    /**
     * A re-measure. Writes the two inputs; the nodes are the same ones, so the native driver propagates the change and no
     * node is attached or detached.
     *
     * @sideEffect Writes two Animated values.
     */
    readonly apply: (geometry: SearchPinGeometry) => void;
}

/**
 * Build the slide and the band over the host's scroll offset, once.
 *
 * With `top = naturalTop - scroll` (where the field would be) and `above = top - pinnedTop`, the translation is
 * `pinnedTop + max(above, 0)` = `max(top, pinnedTop)`: free in an overscroll (`top` grows), rising one for one, then held. The
 * band is `1` while `above <= 0` (ramping over the last pixel), gated off at offset 0 and in an overscroll so a field that
 * starts at the pinned top has no band until content is under it. Every interpolation here has FIXED ranges.
 *
 * @param scrollY - The host's scroll offset.
 * @param initial - The first geometry (before anything is measured).
 * @returns The nodes and the way to re-measure them.
 * @sideEffect Creates Animated nodes.
 */
export function createSearchPin(scrollY: Animated.Value, initial: SearchPinGeometry): SearchPin {
    const naturalTop = new Animated.Value(initial.naturalTop);
    const pinnedTop = new Animated.Value(initial.pinnedTop);
    const above = Animated.subtract(Animated.subtract(naturalTop, scrollY), pinnedTop);
    // max(above, 0): clamps on the left, extends on the right.
    const stopped = above.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolateLeft: 'clamp',
        extrapolateRight: 'extend',
    });
    const pinned = above.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
        extrapolate: 'clamp',
    });
    const scrolled = scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });

    return {
        translateY: Animated.add(pinnedTop, stopped),
        bandOpacity: Animated.multiply(pinned, scrolled),
        apply: (geometry) => {
            naturalTop.setValue(geometry.naturalTop);
            pinnedTop.setValue(geometry.pinnedTop);
        },
    };
}
