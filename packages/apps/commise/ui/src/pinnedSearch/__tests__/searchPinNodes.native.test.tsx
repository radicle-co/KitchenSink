/**
 * The search pin's nodes (native, react-native-web under jsdom): the numbers are the nodes evaluated at a scroll offset.
 */
import { Animated } from 'react-native';
import { describe, expect, it } from 'vitest';

import { searchPinGeometry } from '../searchPin.js';
import { createSearchPin } from '../searchPinNodes.native.js';

// qa-ios (ScaleToCap): the pin was an `interpolate()` node REBUILT from the spacer's y, and swapping it on a native-driven view
// left the view showing the old node's value (field at its 1x rest spot after the text went to the cap, 5 tries in 6, with the
// JS log identical in the pass). The pin is now ONE set of nodes over the host's offset, built once; a re-measure writes
// `setValue` on two stable Animated.Values, which the native driver propagates. The numbers below are those nodes evaluated.
describe('createSearchPin (one set of nodes; a re-measure is a setValue)', () => {
    const valueOf = (node: unknown): number => Number(JSON.stringify(node));

    function pinOver(geometry: { naturalTop: number; pinnedTop: number }) {
        const scrollY = new Animated.Value(0);

        return { scrollY, pin: createSearchPin(scrollY, geometry) };
    }

    it.each([
        ['at rest', 0, 180],
        ['rising one for one', 50, 130],
        ['reaching the pinned top', 172, 8],
        ['held at the pinned top', 900, 8],
        ['dragged down by an overscroll or a pull to refresh', -40, 220],
    ])('translates the field %s (scroll %d → %d)', (_name, offset, expected) => {
        const { scrollY, pin } = pinOver({ naturalTop: 180, pinnedTop: 8 });

        scrollY.setValue(offset);

        expect(valueOf(pin.translateY)).toBe(expected);
    });

    it('moves exactly with the page, never stopping, when the field is too tall to pin', () => {
        const { scrollY, pin } = pinOver(searchPinGeometry({ naturalTop: 180, pinnedTop: 8, pins: false }));

        scrollY.setValue(900);

        expect(valueOf(pin.translateY)).toBe(180 - 900);
    });

    it.each([
        ['hidden while the field slides', 0, 0],
        ['still hidden a pixel before it stops', 170, 0],
        ['half shown on the last pixel of travel', 171.5, 0.5],
        ['shown once it is pinned', 172, 1],
        ['shown however far the page scrolls', 900, 1],
        ['hidden in an overscroll', -40, 0],
    ])('draws the band %s (scroll %d → %d)', (_name, offset, expected) => {
        const { scrollY, pin } = pinOver({ naturalTop: 180, pinnedTop: 8 });

        scrollY.setValue(offset);

        expect(valueOf(pin.bandOpacity)).toBeCloseTo(expected, 10);
    });

    it('shows the band from the first pixel of scroll when the field already sits at the pinned top, and not at rest', () => {
        const { scrollY, pin } = pinOver({ naturalTop: 8, pinnedTop: 8 });

        expect(valueOf(pin.bandOpacity)).toBe(0);

        scrollY.setValue(1);

        expect(valueOf(pin.bandOpacity)).toBe(1);
    });

    it('never shows the band for a field that does not pin', () => {
        const { scrollY, pin } = pinOver(searchPinGeometry({ naturalTop: 180, pinnedTop: 8, pins: false }));

        scrollY.setValue(900);

        expect(valueOf(pin.bandOpacity)).toBe(0);
    });

    it('follows a re-measure through the SAME nodes: apply() only writes the two inputs', () => {
        const { scrollY, pin } = pinOver({ naturalTop: 180, pinnedTop: 8 });
        const nodes = [pin.translateY, pin.bandOpacity];

        // The text size goes to the cap: the spacer moves down and the field is taller.
        pin.apply({ naturalTop: 361, pinnedTop: 8 });

        expect(valueOf(pin.translateY)).toBe(361);
        scrollY.setValue(100);
        expect(valueOf(pin.translateY)).toBe(261);
        scrollY.setValue(353);
        expect(valueOf(pin.translateY)).toBe(8);
        expect(valueOf(pin.bandOpacity)).toBe(1);
        expect([pin.translateY, pin.bandOpacity]).toEqual(nodes);
        expect(pin.translateY).toBe(nodes[0]);
        expect(pin.bandOpacity).toBe(nodes[1]);
    });
});
