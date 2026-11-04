/**
 * @module @commise/ui/pinned-search — the state of one pinned search field (native).
 *
 * The measured state (the spacer's place, the field's height, focus) and the ONE set of Animated nodes that moves the field and
 * shows the band (`searchPinNodes.native.ts`; a re-measure writes two inputs, it never swaps a node). The spacer and the overlay
 * (`PinnedSearchSpacer`, `PinnedSearchOverlay`) read it; the frame that owns the screen's search composes the three.
 * Recipes and Collections share all three: a difference between their pins is a bug in the sharing.
 *
 * @pattern Overlay — the field is drawn once above the list over a spacer the list holds
 */
import { useEffect, useState } from 'react';
import { Animated, useWindowDimensions } from 'react-native';

import { useOptionalScrollHost } from '../scrollHost/useOptionalScrollHost.js';
import { nativeTokens } from '../tokens/native.js';
import { searchPinGeometry, searchSticks } from './searchPin.js';
import { createSearchPin, type SearchPin } from './searchPinNodes.native.js';

/** The part of the spacer's layout the overlay needs. */
export interface SpacerBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
}

/**
 * The spacer's box after a layout report. Whole pixels, and the SAME object when nothing moved: React bails out of a state
 * update only for an identical value, so a fresh `{ x, y, width }` per report re-rendered the frame, the header and the whole
 * list for a report that said nothing new, and the platform repeats reports (Android re-sends one for sub-pixel float noise).
 * A layout feedback that costs a render per report is how "Maximum update depth exceeded" starts.
 *
 * @param previous - The box held now, or `null` before the first report.
 * @param layout - A layout event's `layout`.
 * @returns `previous` when the report rounds to it, else the new box. Pure.
 */
function nextSpacerBox(
    previous: SpacerBox | null,
    layout: { readonly x: number; readonly y: number; readonly width: number },
): SpacerBox {
    const x = Math.round(layout.x);
    const y = Math.round(layout.y);
    const width = Math.round(layout.width);

    return previous !== null && previous.x === x && previous.y === y && previous.width === width
        ? previous
        : { x, y, width };
}

/** With no `ScrollHost` above, the field rests at its natural place. */
const NO_SCROLL = new Animated.Value(0);

/** Where the pinned field holds, px from the top of the list's frame. */
export const PINNED_TOP_PX = nativeTokens.spacing[2];

/** The pinned search's state, handed from {@link usePinnedSearch} to its two parts. */
export interface PinnedSearch {
    /** Whether the field, and not the stand-in, is what a screen reader reaches now. */
    readonly fieldReachable: boolean;
    /** The measured spacer box; `null` until the spacer has reported. */
    readonly spacer: SpacerBox | null;
    /** The field's measured height, whole px. */
    readonly fieldHeight: number;
    /** The window's width, for the full-width band. */
    readonly windowWidth: number;
    /** A counter the stand-in advances to hand the cook to the field. */
    readonly focusAsks: number;
    readonly searchPin: SearchPin;
    /** The spacer's layout handler: reads the layout, then records it. */
    readonly onSpacerLayout: (layout: { readonly x: number; readonly y: number; readonly width: number }) => void;
    /** The field's height, from its box's layout. */
    readonly onFieldHeight: (height: number) => void;
    readonly onFieldFocus: () => void;
    readonly onFieldBlur: () => void;
    /** The stand-in was pressed. */
    readonly askFocus: () => void;
}

/**
 * The state of one pinned search.
 *
 * @param searchValue - The field's value, which keeps it reachable while it holds a query (its clear control must stay reachable).
 * @param headerTop - What the list's header box pads above the spacer's group, so the spacer's y becomes a list-content offset.
 * @returns The state the spacer and the overlay read.
 * @sideEffect Synchronises two Animated values (an external, native-driven system) with the measured geometry.
 */
export function usePinnedSearch(searchValue: string, headerTop: number): PinnedSearch {
    const [spacer, setSpacer] = useState<SpacerBox | null>(null);
    const [fieldHeight, setFieldHeight] = useState(0);
    const [fieldFocused, setFieldFocused] = useState(false);
    const [focusAsks, setFocusAsks] = useState(0);
    const host = useOptionalScrollHost();
    // Scrolled away from the top the stand-in has left the screen while the field stays pinned there, so the field is the one on
    // screen and must be the reachable one (`viewportsDown` counts in quarter viewports).
    const scrolledAway = (host?.viewportsDown ?? 0) > 0;
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    // The host's ONE native-driven scroll offset; with no host above (a screen not yet wrapped, a test) the field rests.
    const scrollY = host?.scrollY ?? NO_SCROLL;
    const geometry = searchPinGeometry({
        naturalTop: headerTop + (spacer?.y ?? 0),
        pinnedTop: PINNED_TOP_PX,
        pins: searchSticks(fieldHeight, windowHeight),
    });
    // ONE set of nodes over the host's offset, built from the first geometry and rebuilt only when the host hands a different
    // offset. A re-measure (the spacer moves, the field grows, the window turns) writes the two inputs below; it never swaps a
    // node, because swapping one on a native-driven view left the view showing the old node's value (qa-ios ScaleToCap).
    // Nothing is drawn until the spacer has been measured, so the first geometry is unseen. The rebuild is set during render,
    // the way React documents for state derived from a prop, so no render ever reads a pin made for another offset.
    const [held, setHeld] = useState(() => ({ scrollY, pin: createSearchPin(scrollY, geometry) }));

    if (held.scrollY !== scrollY) {
        setHeld({ scrollY, pin: createSearchPin(scrollY, geometry) });
    }

    const searchPin = held.pin;

    useEffect(() => {
        searchPin.apply({ naturalTop: geometry.naturalTop, pinnedTop: geometry.pinnedTop });
    }, [searchPin, geometry.naturalTop, geometry.pinnedTop]);

    return {
        fieldReachable: fieldFocused || searchValue !== '' || scrolledAway,
        spacer,
        fieldHeight,
        windowWidth,
        focusAsks,
        searchPin,
        onSpacerLayout: (layout) => setSpacer((previous) => nextSpacerBox(previous, layout)),
        onFieldHeight: (height) => setFieldHeight(Math.round(height)),
        onFieldFocus: () => setFieldFocused(true),
        onFieldBlur: () => setFieldFocused(false),
        askFocus: () => setFocusAsks((asks) => asks + 1),
    };
}
