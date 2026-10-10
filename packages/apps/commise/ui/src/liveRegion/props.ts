/**
 * @module @commise/ui/live-region — the contract for the `LiveRegion` leaves, native and web.
 */
import type { StyleProp, TextStyle } from 'react-native';

/** How urgently a change is spoken: `assertive` interrupts, `polite` waits for current speech. */
export type LiveRegionPoliteness = 'polite' | 'assertive';

/** What every `LiveRegion` reads. */
interface LiveRegionBaseProps {
    /**
     * The message — plain TEXT, because iOS can only announce a string. Empty (`''`) is the resting state of a
     * region mounted before it has anything to say: silent, and out of the layout flow.
     */
    readonly children: string;
    /** How urgently the message is spoken; `assertive` also makes a non-empty region an alert. */
    readonly politeness: LiveRegionPoliteness;
    /**
     * Counts the events that say the message: each change speaks the current message AGAIN, even when its text is the
     * same, because the region hands it to a second mounted region (`docs/design/rowEditorOpenDecisions.md` R8). A
     * live region speaks only at a change of its text, so without this the same text twice is silent. Absent: one
     * region, which speaks when its text changes.
     */
    readonly occurrence?: number;
    /** Web: the shown text's classes. Native styles it with `style` instead. */
    readonly className?: string;
}

/** A region whose message is shown on screen as well as spoken. */
interface VisibleLiveRegionProps extends LiveRegionBaseProps {
    /** Whether the message is only spoken, never shown. Absent here: this region is shown. */
    readonly visuallyHidden?: false;
    /** Native: the visible text's style, applied only while the message is non-empty. Web uses `className`. */
    readonly style?: StyleProp<TextStyle>;
}

/**
 * A region that is only SPOKEN, for a change the screen already shows another way (a stepper's count). It is
 * never laid out, so it takes no style.
 */
interface HiddenLiveRegionProps extends LiveRegionBaseProps {
    /** Whether the message is only spoken, never shown. */
    readonly visuallyHidden: true;
    /** Not accepted: a hidden region is never laid out. */
    readonly style?: never;
}

/** Props for the `LiveRegion` leaves, native and web. */
export type LiveRegionProps = VisibleLiveRegionProps | HiddenLiveRegionProps;
