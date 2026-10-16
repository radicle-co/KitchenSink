/**
 * @module @commise/ui/state-notice — the shared contract of the design-system `StateNotice`: what a view says when it
 * cannot show its content and the cook must choose what to do next — a read that failed, a recipe that is gone, a screen
 * that crashed. One title, an optional body, and at most two ways out.
 *
 * Both leaves (web `StateNotice.tsx`, native `StateNotice.native.tsx`) implement this exact surface. The layout is each
 * platform's own: web keeps the notice in the page's flow, native stacks the actions in the bottom third of the screen,
 * within thumb reach, the primary on top.
 */
import type { IconName } from '../icon/props.js';

/** A way out of the notice: a label, the meaning of its glyph, and where it goes. */
export interface StateNoticeAction {
    /** The visible label, and the accessible name. Localised by the caller. */
    readonly label: string;
    /** The meaning the glyph draws. Decorative: the label names the control. */
    readonly icon: IconName;
    /** Called on a press (on web, on a plain click of a link). */
    readonly onPress: () => void;
    /**
     * Web: where the action goes. With one it is a real link (a new tab and ⌘-click work), whose plain click goes to
     * {@link onPress}; without, a button. Native ignores it.
     */
    readonly href?: string;
}

/** Props for the `StateNotice` leaves (web and native). */
export interface StateNoticeProps {
    /** What happened, in one sentence. Announced assertively: the notice interrupts what the cook was doing. */
    readonly title: string;
    /** Why, or what to try. Omitted when the title says it all. */
    readonly body?: string;
    /** The action the cook most likely wants (Try again). */
    readonly primary?: StateNoticeAction;
    /** The way out when that fails (Back, Back to Home). */
    readonly secondary?: StateNoticeAction;
}
