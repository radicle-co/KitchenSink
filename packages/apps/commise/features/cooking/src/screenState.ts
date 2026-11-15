import type { SessionStatus } from '@kitchensink/cooking-core';

/** Where the read of the recipe stands. `gone` is a recipe that can no longer be read (removed, or no longer visible). */
export type CookingRead = 'pending' | 'failed' | 'gone' | 'ready';

/** What the screen decides from before a session exists. All of it is data the host already holds. */
export interface CookingReadInput {
    /** The recipe read. */
    readonly read: CookingRead;
    /** Whether the device is offline. It only changes the words of the load error. */
    readonly offline: boolean;
    /**
     * How many steps the recipe has WITH TEXT, from cooking-core's `countCookableSteps`. A raw step count
     * would disagree with the Start cooking gate and the place.
     */
    readonly stepCount: number;
}

/** The screen before a session exists. `ready` hands over to the session, where {@link CookingSessionState} decides. */
export type CookingReadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly offline: boolean }
    | { readonly kind: 'gone' }
    | { readonly kind: 'noSteps' }
    | { readonly kind: 'ready' };

/** What the screen decides from once a session exists. */
export interface CookingSessionInput {
    /** The session's derived status. */
    readonly sessionStatus: SessionStatus;
    /** Whether every line of the current step is ticked. */
    readonly everyLineTicked: boolean;
}

/** The screen once a session exists. */
export type CookingSessionState =
    { readonly kind: 'step' } | { readonly kind: 'nextComing' } | { readonly kind: 'done' };

/**
 * Decide the screen before a session exists. The order is the precedence: the read first, then an empty recipe. A
 * redirect (a draft's link) is navigation, not a screen state.
 *
 * @pattern Visitor — one discriminated union, decided once, so each shell switches over it exhaustively
 * @param input - The read and the step count.
 * @returns The screen. Pure.
 */
export function cookingReadStateOf(input: CookingReadInput): CookingReadState {
    switch (input.read) {
        case 'pending':
            return { kind: 'loading' };
        case 'failed':
            return { kind: 'error', offline: input.offline };
        case 'gone':
            return { kind: 'gone' };
        case 'ready':
            return input.stepCount === 0 ? { kind: 'noSteps' } : { kind: 'ready' };
    }
}

/**
 * Decide the screen once a session exists: a finished session first, then whether the step's lines are all ticked.
 *
 * @pattern Visitor — one discriminated union, decided once, so each shell switches over it exhaustively
 * @param input - The session status and the tick state.
 * @returns The screen. Pure.
 */
export function cookingSessionStateOf(input: CookingSessionInput): CookingSessionState {
    if (input.sessionStatus === 'complete') {
        return { kind: 'done' };
    }

    return input.everyLineTicked ? { kind: 'nextComing' } : { kind: 'step' };
}
