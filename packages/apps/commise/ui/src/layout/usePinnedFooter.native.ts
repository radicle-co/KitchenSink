/**
 * @module @commise/ui/layout — the native measurements for the pinned-footer limit
 * (`docs/design/compactHeightLayout.md` §3.3 and §4; `ingredientSpecialization.md` §S8.1, finding I7).
 *
 * The rule (`isFooterUnpinned`) needs the frame's, the pinned top row's and the footer's real heights, and React Native
 * reports those through `onLayout`, declaratively, so no ref is needed. Each handler records one height; an unchanged
 * height keeps the same state object, so a repeated layout pass does not re-render. A footer that unmounts (the Sheet's
 * collapse) reports nothing, so its last height is KEPT and the footer that comes back is judged by it, never by 0.
 *
 * Read by the Sheet and by the recipe wizard, so both answer "pinned or not" with one rule.
 *
 * @pattern Adapter over React Native's `onLayout` events — it turns three layout reports into the inputs of the
 *     `isFooterUnpinned` Specification.
 */
import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { isFooterUnpinned, type PinnedFooterMeasure } from './pinnedFooter.js';

/** The decision and the three `onLayout` handlers that feed it. */
export interface PinnedFooter {
    /** Whether the footer scrolls with the content instead of staying pinned. */
    readonly unpinned: boolean;
    /** For the frame. */
    readonly onFrameLayout: (event: LayoutChangeEvent) => void;
    /** For the pinned top row (the one that holds the exit). */
    readonly onTopLayout: (event: LayoutChangeEvent) => void;
    /** For the footer, in whichever slot it is placed. */
    readonly onFooterLayout: (event: LayoutChangeEvent) => void;
}

const UNMEASURED: PinnedFooterMeasure = { pinnedTop: 0, footer: 0, frame: 0 };

/**
 * Measure a frame's pinned chrome and decide whether its footer unpins.
 *
 * @returns The decision and the handlers to attach.
 */
export function usePinnedFooter(): PinnedFooter {
    const [measure, setMeasure] = useState(UNMEASURED);

    const record =
        (part: keyof PinnedFooterMeasure) =>
        (event: LayoutChangeEvent): void => {
            const { height } = event.nativeEvent.layout;

            setMeasure((current) => (current[part] === height ? current : { ...current, [part]: height }));
        };

    return {
        unpinned: isFooterUnpinned(measure),
        onFrameLayout: record('frame'),
        onTopLayout: record('pinnedTop'),
        onFooterLayout: record('footer'),
    };
}
