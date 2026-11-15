/**
 * @module stepSwipeResponder — the responder handlers of the step body's swipe on native. The body claims a drag only once
 * it is a whole sideways swipe, so a vertical scroll and a tap that wobbles stay with the scroller and the line rows. At
 * release the swipe rule decides again, and a move takes the same path as the Back and Next buttons.
 */
import { stepSwipeOf, swipeTravelOf, type StepSwipe } from './stepSwipe.js';

/** Inputs to {@link stepSwipeResponderOf}. */
export interface StepSwipeResponderInput {
    /** The window's width, in dp, for the swipe's far edge zone. */
    readonly width: number;
    readonly hasPrevious: boolean;
    readonly hasNext: boolean;
    readonly onNext: () => void;
    readonly onBack: () => void;
}

/** The two responder handlers, taking any responder event, so they fit a `View`'s props. */
export interface StepSwipeResponder {
    readonly onMoveShouldSetResponder: (event: object) => boolean;
    readonly onResponderRelease: (event: object) => void;
}

/**
 * The swipe's responder handlers.
 *
 * @param input - The window width, which steps exist, and what a move does.
 * @returns The handlers to hand the body area. Pure: it holds no state.
 */
export function stepSwipeResponderOf({
    width,
    hasPrevious,
    hasNext,
    onNext,
    onBack,
}: StepSwipeResponderInput): StepSwipeResponder {
    const swipeOf = (event: object): StepSwipe | null => {
        const travel = swipeTravelOf(event);

        return travel === null ? null : stepSwipeOf({ ...travel, width, hasPrevious, hasNext });
    };

    return {
        onMoveShouldSetResponder: (event) => swipeOf(event) !== null,
        onResponderRelease: (event) => {
            const move = swipeOf(event);

            if (move === 'next') {
                onNext();
            } else if (move === 'back') {
                onBack();
            }
        },
    };
}
