/**
 * @module @commise/ui/horizontal-scroller — the native scroll hint's connection to its `ScrollView`.
 *
 * The native twin of `useScrollHint.ts`: the same Adapter over the scroller's position, here read from the three
 * callbacks a `ScrollView` offers (`onLayout`, `onContentSizeChange`, `onScroll`). The owner's `onPosition` hears of the
 * scroller only when it is measured or reaches or leaves an end, never on a scroll within the middle.
 *
 * @pattern Adapter over a ScrollView's layout, content-size and scroll callbacks
 */
import { useEffect, useEffectEvent, useState } from 'react';
import {
    I18nManager,
    Platform,
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';

import { scrollExtentOf, startOffsetOf, type ScrollExtent } from './scrollHint.js';

/** What the leaf needs to draw the hint and to wire the `ScrollView`. */
export interface NativeScrollHintBinding {
    readonly onLayout: (event: LayoutChangeEvent) => void;
    readonly onContentSizeChange: (width: number) => void;
    readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    /** Where the scroller rests. */
    readonly extent: ScrollExtent;
}

interface Measures {
    readonly viewport: number;
    readonly content: number;
    readonly x: number;
}

const UNMEASURED: Measures = { viewport: 0, content: 0, x: 0 };

/**
 * Follow one `ScrollView`.
 *
 * @param onPosition - The owner's callback for where the scroller rests.
 * @returns The three `ScrollView` callbacks and where the scroller rests.
 */
export function useScrollHint(onPosition: ((extent: ScrollExtent) => void) | undefined): NativeScrollHintBinding {
    const [measures, setMeasures] = useState<Measures>(UNMEASURED);
    const { viewport, content, x } = measures;
    const extent = scrollExtentOf({
        startOffset: startOffsetOf(
            x,
            viewport,
            content,
            I18nManager.getConstants().isRTL,
            Platform.OS === 'android' ? 'android' : 'ios',
        ),
        viewport,
        content,
    });
    const { measured, overflows, atStart, atEnd } = extent;

    // Keyed on the four facts and not on the object, which is new on every scroll event.
    const report = useEffectEvent((current: ScrollExtent): void => onPosition?.(current));

    useEffect(() => {
        report({ measured, overflows, atStart, atEnd });
    }, [measured, overflows, atStart, atEnd]);

    return {
        onLayout: (event) => {
            const width = event.nativeEvent.layout.width;

            setMeasures((current) => (current.viewport === width ? current : { ...current, viewport: width }));
        },
        onContentSizeChange: (width) => {
            setMeasures((current) => (current.content === width ? current : { ...current, content: width }));
        },
        onScroll: (event) => {
            const offset = event.nativeEvent.contentOffset.x;

            setMeasures((current) => (current.x === offset ? current : { ...current, x: offset }));
        },
        extent,
    };
}
