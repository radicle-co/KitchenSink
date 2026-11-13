import type { SessionStatus } from '@kitchensink/cooking-core';

/** Where the read of the recipe stands. `gone` is a recipe that can no longer be read (removed, or no longer visible). */
export type CookingRead = 'pending' | 'failed' | 'gone' | 'ready';

/** What the screen decides from. All of it is data the host already holds. */
export interface CookingScreenInput {
    /** The recipe read. */
    readonly read: CookingRead;
    /** Whether the device is offline. It only changes the words of the load error. */
    readonly offline: boolean;
    /**
     * How many steps the recipe has WITH TEXT, from cooking-core's `countCookableSteps`. A raw step count
     * would disagree with the Start cooking gate and the place.
     */
    readonly stepCount: number;
    /** The session's derived status. */
    readonly sessionStatus: SessionStatus;
    /** Whether every line of the current step is ticked. */
    readonly everyLineTicked: boolean;
}

/** The ONE screen the cook sees. A redirect (a draft's link) is navigation, not a screen state. */
export type CookingScreenState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly offline: boolean }
    | { readonly kind: 'gone' }
    | { readonly kind: 'noSteps' }
    | { readonly kind: 'step' }
    | { readonly kind: 'nextComing' }
    | { readonly kind: 'done' };

/**
 * Decide which of the seven screens to draw. The order is the precedence: the read first, then an empty recipe, then
 * a finished session, then whether the step's lines are all ticked.
 *
 * @pattern Visitor — one discriminated union, decided once, so each shell switches over it exhaustively
 * @param input - The read, the step count, the session status and the tick state.
 * @returns The screen. Pure.
 */
export function cookingScreenStateOf(input: CookingScreenInput): CookingScreenState {
    switch (input.read) {
        case 'pending':
            return { kind: 'loading' };
        case 'failed':
            return { kind: 'error', offline: input.offline };
        case 'gone':
            return { kind: 'gone' };
        case 'ready':
            break;
    }

    if (input.stepCount === 0) {
        return { kind: 'noSteps' };
    }

    if (input.sessionStatus === 'complete') {
        return { kind: 'done' };
    }

    return input.everyLineTicked ? { kind: 'nextComing' } : { kind: 'step' };
}
