/**
 * @module @commise/ui/field-reveal — the field reveal's reads and its one write against React Native's layout
 * (`docs/design/rowEditorOpenDecisions.md` E1). The host hook's only contact with the native views, and so its test
 * seam.
 *
 * - The field is measured against the native scroll view, not with `onLayout`: the field sits several levels below the
 *   content, and `onLayout` gives only a position inside its parent. Fabric's `measureLayout` leaves the scroll offset
 *   out (`dom::measureLayout` asks for `includeTransform: false`, so `ScrollViewShadowNode::getContentOriginOffset` is
 *   never applied), so the answer is the field's place in the CONTENT.
 * - The offset is the native scroll view's own `scrollTop`, read in the same callback, from the same scroll view state
 *   (Android writes it on every scroll, `ReactScrollView.java`): the field's top in the visible area is its place in the
 *   content less that offset.
 *
 * @pattern Adapter over React Native's `measureLayout` and `ScrollView.scrollTo`
 */
import type { ScrollView } from 'react-native';

import type { FieldBox, FieldPlace } from './fieldReveal.js';
import type { RevealTarget } from './fieldRevealContext.js';

/** What the host uses of its scroller. */
export type RevealScroller = Pick<ScrollView, 'getNativeScrollRef' | 'scrollTo'>;

/**
 * Whether a scroller can be revealed into: it measures through `getNativeScrollRef` and moves with `scrollTo`, which
 * a list's handle (`scrollToOffset`) does not have. Lets a screen hand the reveal its `ScrollHost`'s one handle.
 *
 * @param scroller - A screen's scroller handle.
 * @returns Whether it is a {@link RevealScroller}. Pure.
 */
export function isRevealScroller(scroller: object): scroller is RevealScroller {
    return 'getNativeScrollRef' in scroller && 'scrollTo' in scroller;
}

/** The field's box in the visible area, and the scroll offset it was measured at. */
export type FieldMeasure = FieldBox & FieldPlace;

/**
 * Measure a field against the scroller around it.
 *
 * @param field - The field.
 * @param scroller - The scroller it sits in.
 * @returns The field's box and the offset, or `null` when the scroller is not mounted or the measure fails.
 * @sideEffect Reads native layout.
 */
export function measureField(field: RevealTarget, scroller: RevealScroller): Promise<FieldMeasure | null> {
    const view = scroller.getNativeScrollRef();

    if (view === null) {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        field.measureLayout(
            view,
            (_x, y, _width, height) => {
                resolve({ top: y - view.scrollTop, height, offset: view.scrollTop });
            },
            () => {
                resolve(null);
            },
        );
    });
}

/**
 * Scroll the content to an offset.
 *
 * @param scroller - The scroller.
 * @param y - The offset.
 * @param animated - Whether the platform animates the scroll.
 * @sideEffect Scrolls the native scroll view.
 */
export function scrollContentTo(scroller: RevealScroller, y: number, animated: boolean): void {
    scroller.scrollTo({ y, animated });
}
