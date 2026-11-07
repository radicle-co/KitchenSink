/**
 * @module @commise/features-recipes/editor — what the paste host remembers about its `POST /matches` calls, so the next
 * call is made when one is owed and never when one is not (ADR-0071 section 4, 6 and 9).
 *
 * `matchDemand.ts` decides from the SET of unmatched foods; this keeps the set it decides against. Three facts make that
 * set more than "what was asked":
 *
 * - **A call that left a proposal unmade writes no row** and "the next call retries" (section 6): the matcher works under
 *   a deadline, so a food it ran out of time for is still unmatched when the call answers. That food must be asked for
 *   again, or the line it belongs to never joins. It is asked for at most {@link MAX_MATCH_ATTEMPTS} calls, because a
 *   food service that is down leaves it unmade every time and an unbounded retry is a request storm against it.
 * - **A call that failed** (the network, a 5xx) fails the foods it covered at once. The cook's Try again is the only
 *   thing that asks for them again.
 * - **A food the cook retried** starts counting from nothing.
 *
 * Pure and platform-agnostic.
 *
 * @pattern State — the host's memory of its requests is a value; every change is an event applied by one reducer
 * @pattern Reducer — {@link reduceMatchRequests}
 */

/** How many calls a food is asked for before it is a failed request for the cook to retry. */
export const MAX_MATCH_ATTEMPTS = 3;

/** What the host remembers about its match calls. */
export interface MatchRequests {
    /** The foods the call in flight covers, or `undefined` when none is in flight. */
    readonly inFlight: ReadonlySet<string> | undefined;
    /** The foods a call covered whose answer has not left them unmade. */
    readonly covered: ReadonlySet<string>;
    /** How many calls have covered each food. */
    readonly attempts: ReadonlyMap<string, number>;
    /** The foods whose request failed: they wait for the cook's Try again. */
    readonly failed: ReadonlySet<string>;
}

/** What happens to a match call. */
export type MatchRequestEvent =
    /** A call was sent, covering the foods unmatched now. */
    | { readonly type: 'sent'; readonly keys: readonly string[] }
    /** The call answered; `unmatched` is what the job view it returned still holds with no match. */
    | { readonly type: 'answered'; readonly unmatched: ReadonlySet<string> }
    /** The call failed. */
    | { readonly type: 'refused' }
    /** Try again on a food whose request failed. */
    | { readonly type: 'retry'; readonly key: string }
    /** A new job: its keys repeat from job to job, so nothing carries over. */
    | { readonly type: 'reset' };

/** The host before any call. */
export const emptyMatchRequests: MatchRequests = {
    inFlight: undefined,
    covered: new Set(),
    attempts: new Map(),
    failed: new Set(),
};

/** A copy of a set without `key`. Pure. */
const without = (set: ReadonlySet<string>, key: string): ReadonlySet<string> =>
    new Set([...set].filter((member) => member !== key));

/**
 * The state after an event. Returns `state` itself when the event changes nothing. Pure.
 *
 * @param state - The state now.
 * @param event - What happened.
 * @returns The new state.
 */
export function reduceMatchRequests(state: MatchRequests, event: MatchRequestEvent): MatchRequests {
    switch (event.type) {
        case 'sent': {
            const attempts = new Map(state.attempts);

            for (const key of event.keys) {
                attempts.set(key, (attempts.get(key) ?? 0) + 1);
            }

            return {
                ...state,
                inFlight: new Set(event.keys),
                covered: new Set([...state.covered, ...event.keys]),
                attempts,
            };
        }

        case 'answered': {
            const asked = [...(state.inFlight ?? [])];
            const unmade = asked.filter((key) => event.unmatched.has(key));
            const exhausted = unmade.filter((key) => (state.attempts.get(key) ?? 0) >= MAX_MATCH_ATTEMPTS);
            const covered = new Set(
                [...state.covered].filter((key) => !unmade.includes(key) || exhausted.includes(key)),
            );

            return {
                ...state,
                inFlight: undefined,
                covered,
                failed: new Set([...state.failed, ...exhausted]),
            };
        }

        case 'refused':
            return {
                ...state,
                inFlight: undefined,
                failed: new Set([...state.failed, ...(state.inFlight ?? [])]),
            };

        case 'retry': {
            const attempts = new Map(state.attempts);

            attempts.delete(event.key);

            return state.failed.has(event.key) || state.covered.has(event.key)
                ? {
                      ...state,
                      failed: without(state.failed, event.key),
                      covered: without(state.covered, event.key),
                      attempts,
                  }
                : state;
        }

        case 'reset':
            return emptyMatchRequests;
    }
}

/**
 * The foods `shouldRequestMatches` must not ask for again: covered by a call and not left unmade, or failed. Pure.
 *
 * @param state - The state.
 * @returns The keys.
 */
export function requestedMatchKeys(state: MatchRequests): ReadonlySet<string> {
    return new Set([...state.covered, ...state.failed]);
}

/**
 * The foods whose request failed, which the adapter draws as `optionsFailed` (`pasteMatchLinesOf`). Pure.
 *
 * @param state - The state.
 * @returns The keys.
 */
export function matchRequestFailures(state: MatchRequests): ReadonlySet<string> {
    return state.failed;
}
