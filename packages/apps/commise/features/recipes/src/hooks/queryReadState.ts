/**
 * @module hooks/queryReadState — what a TanStack read shows before it settles (design §S13 P9, §S8.6, §S16 "States").
 *
 * ⛔ A parked read is offline only while the app has focus. TanStack's `canContinue` is focus AND a connection, so a
 * read parked in the background is waiting, not offline (`useAppFocused` reads the focus). The entry's food search
 * applies the same rule (`foodSuggestions.model.ts`).
 */

/** The facts of a read the state depends on. */
export interface QueryReadFacts<T> {
    /** What the caller can render, or `undefined` while there is nothing to show. */
    readonly value: T | undefined;
    /** The read failed, or answered with something the caller cannot render. */
    readonly failed: boolean;
    readonly fetchStatus: 'fetching' | 'paused' | 'idle';
}

/** What the read shows: its content, the offline slot, a loading state, or its failure. */
export type QueryReadState<T> =
    | { readonly kind: 'settled'; readonly value: T }
    | { readonly kind: 'offline' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'failed' };

/**
 * The state of a read. Pure.
 *
 * ⚠️ The order matters. Content already read stays through a failed or parked refetch. A fetch in flight is
 * `loading` before a past failure is `failed`, so Try again shows the read starting again.
 *
 * @param facts - The read's facts.
 * @param appIsFocused - Whether the app has focus (`useAppFocused`).
 * @returns The state, carrying the value once settled.
 */
export function queryReadState<T>(facts: QueryReadFacts<T>, appIsFocused: boolean): QueryReadState<T> {
    if (facts.value !== undefined) {
        return { kind: 'settled', value: facts.value };
    }

    if (facts.fetchStatus === 'paused') {
        return appIsFocused ? { kind: 'offline' } : { kind: 'loading' };
    }

    if (facts.fetchStatus === 'fetching') {
        return { kind: 'loading' };
    }

    return facts.failed ? { kind: 'failed' } : { kind: 'loading' };
}
