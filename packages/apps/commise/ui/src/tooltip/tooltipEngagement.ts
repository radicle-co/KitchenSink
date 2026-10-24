/**
 * @module @commise/ui/tooltip — what makes a tooltip show, as a pure state machine (WCAG 1.4.13 Content on Hover or
 * Focus). The tip shows while the pointer is over the control or its tip, or while keyboard focus is on the control; it
 * is DISMISSED by Escape without either of those moving; and a dismissal stands until BOTH have ended, so a repeated
 * hover event, or leaving one of the two while the other holds, does not bring it back.
 *
 * @pattern State — a reducer over a closed event set; the leaf only maps DOM events to it
 */

/** What is holding the tip open, and whether the cook has put it away. */
export interface Engagement {
    readonly hovered: boolean;
    readonly focused: boolean;
    readonly dismissed: boolean;
}

/** The events that change {@link Engagement}. */
export type EngagementEvent = 'hoverStart' | 'hoverEnd' | 'focusStart' | 'focusEnd' | 'escape';

/** Nothing engaged. */
export const IDLE: Engagement = { hovered: false, focused: false, dismissed: false };

/**
 * @param engagement - The engagement.
 * @returns Whether the tip is shown. Pure.
 */
export function isOpen(engagement: Engagement): boolean {
    return (engagement.hovered || engagement.focused) && !engagement.dismissed;
}

/**
 * The same engagement with a dismissal that nothing keeps alive cleared.
 *
 * @param engagement - The engagement after an end event.
 * @returns It, re-armed if neither hover nor focus remains. Pure.
 */
function rearmedWhenIdle(engagement: Engagement): Engagement {
    return engagement.hovered || engagement.focused ? engagement : IDLE;
}

/**
 * @param engagement - The current engagement.
 * @param event - What happened.
 * @returns The next engagement. Pure.
 */
export function reduceEngagement(engagement: Engagement, event: EngagementEvent): Engagement {
    switch (event) {
        case 'hoverStart':
            return { ...engagement, hovered: true };
        case 'focusStart':
            return { ...engagement, focused: true };
        case 'hoverEnd':
            return rearmedWhenIdle({ ...engagement, hovered: false });
        case 'focusEnd':
            return rearmedWhenIdle({ ...engagement, focused: false });
        case 'escape':
            return isOpen(engagement) ? { ...engagement, dismissed: true } : engagement;
    }
}
