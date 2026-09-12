/**
 * The field reveal's Adapter over React Native's layout (`docs/design/rowEditorOpenDecisions.md` E1, "As built"): it
 * measures the field against the native scroll view, and scrolls the content.
 *
 * The Fabric fact the Adapter exists for: `measureLayout` against the scroll view does not subtract the scroll offset,
 * so it answers the field's place in the CONTENT, and the Adapter reads the offset itself. react-native-web has no
 * Fabric, so the field below answers as Fabric does (its content place, whatever the offset), and the scroll view's
 * offset is set on the node. The scroll view is a real host node from a rendered `View`, so it is a `HostInstance`.
 */
import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { View, type HostInstance, type MeasureLayoutOnSuccessCallback, type ScrollView } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RevealTarget } from '../fieldRevealContext.js';
import { measureField, scrollContentTo, type RevealScroller } from '../measureField.native.js';

afterEach(cleanup);

/** E1's observed field: it sits 877 dp down the content and is 126 dp tall. */
const FIELD_Y = 877;
const FIELD_HEIGHT = 126;

/** A mounted scroll view node, scrolled by `offset`. */
function scrollViewAt(offset: number): View {
    const ref = createRef<View>();

    render(<View ref={ref} />);

    if (ref.current === null) {
        throw new Error('The scroll view did not mount.');
    }

    Object.defineProperty(ref.current, 'scrollTop', { configurable: true, get: () => offset });

    return ref.current;
}

/** A field that answers as Fabric does: its place in the content, never less the offset. */
function fabricField(): { readonly field: RevealTarget; readonly measuredAgainst: (HostInstance | number)[] } {
    const measuredAgainst: (HostInstance | number)[] = [];
    const field: RevealTarget = {
        measureLayout: (relativeTo: HostInstance | number, onSuccess: MeasureLayoutOnSuccessCallback) => {
            measuredAgainst.push(relativeTo);
            onSuccess(0, FIELD_Y, 360, FIELD_HEIGHT);
        },
    };

    return { field, measuredAgainst };
}

const scrollerOver = (node: View | null): RevealScroller => ({
    getNativeScrollRef: () => node,
    scrollTo: vi.fn<ScrollView['scrollTo']>(),
});

describe('measureField — the field measured against the native scroll view (E1)', () => {
    it.each([0, 120, 640])(
        'at a scroll offset of %i dp, the field’s top in the visible area is its content place less that offset',
        async (offset) => {
            const { field } = fabricField();

            const measure = await measureField(field, scrollerOver(scrollViewAt(offset)));

            expect(measure).toEqual({ top: FIELD_Y - offset, height: FIELD_HEIGHT, offset });
        },
    );

    it('reads the offset when the measure answers, not when it asks: the scroll may move in between', async () => {
        const node = scrollViewAt(0);
        const field: RevealTarget = {
            measureLayout: (_relativeTo: HostInstance | number, onSuccess: MeasureLayoutOnSuccessCallback) => {
                Object.defineProperty(node, 'scrollTop', { configurable: true, get: () => 500 });
                onSuccess(0, FIELD_Y, 360, FIELD_HEIGHT);
            },
        };

        const measure = await measureField(field, scrollerOver(node));

        expect(measure).toEqual({ top: FIELD_Y - 500, height: FIELD_HEIGHT, offset: 500 });
    });

    it('measures against the node the scroller names as its native scroll view, once', async () => {
        const { field, measuredAgainst } = fabricField();
        const node = scrollViewAt(0);

        await measureField(field, scrollerOver(node));

        expect(measuredAgainst).toHaveLength(1);
        expect(measuredAgainst[0]).toBe(node);
    });

    it('answers null, and measures nothing, when the scroll view is not mounted', async () => {
        const { field, measuredAgainst } = fabricField();

        await expect(measureField(field, scrollerOver(null))).resolves.toBeNull();
        expect(measuredAgainst).toEqual([]);
    });

    it('answers null when the measure fails', async () => {
        const field: RevealTarget = {
            measureLayout: (_relativeTo: HostInstance | number, _onSuccess, onFail?: () => void) => {
                onFail?.();
            },
        };

        await expect(measureField(field, scrollerOver(scrollViewAt(120)))).resolves.toBeNull();
    });
});

describe('scrollContentTo — the one write (E1)', () => {
    it.each([true, false])('scrolls the content to the offset, animated: %s', (animated) => {
        const scroller = scrollerOver(scrollViewAt(0));

        scrollContentTo(scroller, 412, animated);

        expect(scroller.scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 412, animated });
    });
});
