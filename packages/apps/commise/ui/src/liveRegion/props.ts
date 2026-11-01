/**
 * @module @commise/ui/live-region — the contract for the `LiveRegion` leaves, native and web.
 */
import type { StyleProp, TextStyle } from 'react-native';

import type { TypeRole } from '../tokens/typography.js';

/** The colour roles a visible region's message takes: its text, a quieter note, or a failure. */
export const LIVE_REGION_TONES = ['ink', 'inkMuted', 'dangerText'] as const;

/** A visible region's colour role. */
export type LiveRegionTone = (typeof LIVE_REGION_TONES)[number];

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

/**
 * A region whose message is shown on screen as well as spoken, in a TYPE ROLE: on native it is the design-system Text,
 * so it grows with the system scale, size and leading together (ADR-0080 §8). The web leaf takes `className` instead.
 */
interface TypedLiveRegionProps extends LiveRegionBaseProps {
    /** Whether the message is only spoken, never shown. Absent here: this region is shown. */
    readonly visuallyHidden?: false;
    /** Native: the message's type role. */
    readonly typeRole: TypeRole;
    /** Native: the message's colour role. `ink` when absent. */
    readonly tone?: LiveRegionTone;
    /** Not accepted with a type role. */
    readonly style?: never;
}

/**
 * A region whose message is shown on screen as well as spoken, styled by React Native `style`. ⚠️ For callers not yet
 * ported: on Android its text's leading does not stop at the cap. A ported caller names a `typeRole` instead, and the
 * styling ratchet counts every remaining `style`, so this form only shrinks.
 */
interface StyledLiveRegionProps extends LiveRegionBaseProps {
    /** Whether the message is only spoken, never shown. Absent here: this region is shown. */
    readonly visuallyHidden?: false;
    /** Native: the visible text's style, applied only while the message is non-empty. Web uses `className`. */
    readonly style?: StyleProp<TextStyle>;
    /** Not accepted with a style. */
    readonly typeRole?: never;
    /** Not accepted with a style. */
    readonly tone?: never;
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
    /** Not accepted: a hidden region is never laid out. */
    readonly typeRole?: never;
    /** Not accepted: a hidden region is never laid out. */
    readonly tone?: never;
}

/** Props for the `LiveRegion` leaves, native and web. */
export type LiveRegionProps = TypedLiveRegionProps | StyledLiveRegionProps | HiddenLiveRegionProps;
