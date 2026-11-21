/**
 * @module timerStore — the one timer list of a cook's session on this device: the reducer's state, the clock that
 * moves it, and the listeners that hear a timer end (S3a.U3, ADR-0094).
 *
 * The reducer (`reduceTimer`) is pure and takes the clock as an argument. This store is its impure shell: it reads
 * `Date.now()`, holds one timeout, hears the app come to the front, and ends the session with the cook. React reads it
 * through `useSyncExternalStore` (`getSnapshot`, `subscribe`).
 *
 * The timeout is a nudge, never the source of truth (KTD5). A phone may run it late or not at all, so the end of a
 * timer is always decided from the clock, and every `ring` is idempotent.
 *
 * @pattern Observer — `subscribe` for React, `onEnded` for the alarm and, later, a phone alert
 * @pattern Adapter over TanStack's `focusManager` singleton, which each platform already drives (web from
 *     `visibilitychange`, mobile from `AppState`)
 * @pattern Command — every change is a `TimerCommand` the reducer applies
 */
import { endsCookSession } from '@commise/features-recipes/session';
import { focusManager } from '@tanstack/react-query';
import {
    NO_TIMER,
    TIMER_LIMIT,
    isWaitingForCook,
    reduceTimer,
    type TimerCommand,
    type TimerEvent,
    type TimerLabel,
    type TimerResult,
    type TimerState,
} from '@kitchensink/cooking-core';

import { mintTimerId } from './mintTimerId.js';

/** The longest the timeout waits. A timeout that never fires costs at most this much staleness. */
const MAX_WAIT_MS = 60_000;

/** What a caller says to start a timer: where it is and how long. The store adds the id, the limit and the clock. */
interface StartTimer {
    readonly recipeId: string;
    readonly stepIndex: number;
    readonly stepDigest: string;
    readonly label: TimerLabel | undefined;
    readonly durationMs: number;
}

/** A command as a caller says it: the store adds the clock, and the limit of a restore. */
type TimerCall = Exclude<
    TimerCommand extends infer C ? (C extends { readonly nowMs: number } ? Omit<C, 'nowMs' | 'limit'> : never) : never,
    { readonly kind: 'start' | 'ring' }
>;

/** The timer list of one session on this device. */
export interface TimerStore {
    /** The state now. The same object until something changes, as `useSyncExternalStore` needs. */
    readonly getSnapshot: () => TimerState;
    /** Calls `listener` after every change. Returns the way to stop. */
    readonly subscribe: (listener: () => void) => () => void;
    /** Starts a timer. Returns its id, or `undefined` when the list is full (nothing changes and nothing shows). */
    readonly start: (timer: StartTimer) => string | undefined;
    /** Applies one command at the clock now. */
    readonly command: (call: TimerCall) => void;
    /** Calls `listener` once for each timer run that ends. Returns the way to stop. */
    readonly onEnded: (listener: (event: TimerEvent) => void) => () => void;
    /** Tells the store who is signed in (Clerk's `userId`): a change of cook ends the session. */
    readonly observeCook: (subject: string | null | undefined) => void;
    /**
     * Starts the timeout and hears the app come to the front. Returns the way to stop, which clears both. Apart from
     * the creation, so a React effect can run it twice (StrictMode) and leave one connection.
     */
    readonly connect: () => () => void;
}

/** The instant the earliest running timer ends, or `undefined` when none runs. */
function earliestEnd(state: TimerState): number | undefined {
    const ends = state.timers.flatMap((timer) => (timer.kind === 'running' ? [timer.endsAt] : []));

    return ends.length === 0 ? undefined : Math.min(...ends);
}

/**
 * Create the store.
 *
 * @param initial - The state to start from. Tests build several-timer states with it; the app starts empty.
 * @returns The store.
 * @sideEffect None until `connect`, which subscribes to the app focus and sets a timeout while a timer runs.
 */
export function createTimerStore(initial: TimerState = NO_TIMER): TimerStore {
    let state = initial;
    let heldCook: string | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let connected = false;
    const changed = new Set<() => void>();
    const ended = new Set<(event: TimerEvent) => void>();

    /** One timeout, at the earlier of a minute and the earliest end. Cleared and set again after every change. */
    function arm(): void {
        clearTimeout(timeout);
        timeout = undefined;

        const end = earliestEnd(state);

        if (connected && end !== undefined) {
            const wait = Math.max(0, Math.min(MAX_WAIT_MS, end - Date.now()));

            timeout = setTimeout(() => apply({ kind: 'ring', nowMs: Date.now() }), wait);
        }
    }

    /** Reduces one command, publishes a changed state, re-arms, and tells each ended to its listeners. */
    function apply(command: TimerCommand, quiet = false): TimerResult {
        const result = reduceTimer(state, command);
        const moved = result.state !== state;

        state = result.state;
        arm();

        if (moved) {
            for (const listener of changed) {
                listener();
            }
        }

        if (!quiet) {
            for (const event of result.events) {
                for (const listener of ended) {
                    listener(event);
                }
            }
        }

        return result;
    }

    /** Every timer and the Undo gone, with no `ended`: the cook this session was for has left. */
    function clear(): void {
        const nowMs = Date.now();

        // Settle first, so a timer that is due is a ringing one the loop below stops, not one it cancels and loses.
        apply({ kind: 'ring', nowMs }, true);

        for (const timer of state.timers) {
            if (isWaitingForCook(timer)) {
                apply({ kind: 'stop', id: timer.id, run: timer.run, nowMs }, true);
            } else {
                apply({ kind: 'cancel', id: timer.id, run: timer.run, nowMs }, true);
                apply({ kind: 'discardUndo', id: timer.id, nowMs }, true);
            }
        }

        if (state.undo !== undefined) {
            apply({ kind: 'discardUndo', id: state.undo.id, nowMs }, true);
        }
    }

    return {
        getSnapshot: () => state,
        subscribe(listener) {
            changed.add(listener);

            return () => changed.delete(listener);
        },
        start(timer) {
            const id = mintTimerId();

            // S3a holds one timer, so a held Undo goes when a new timer starts (S6.U1 deletes this line).
            if (state.undo !== undefined) {
                apply({ kind: 'discardUndo', id: state.undo.id, nowMs: Date.now() });
            }

            const result = apply({ kind: 'start', id, ...timer, limit: TIMER_LIMIT, nowMs: Date.now() });

            return result.refused === undefined ? id : undefined;
        },
        command(call) {
            const nowMs = Date.now();

            apply(call.kind === 'restore' ? { kind: 'restore', limit: TIMER_LIMIT, nowMs } : { ...call, nowMs });
        },
        onEnded(listener) {
            ended.add(listener);

            return () => ended.delete(listener);
        },
        observeCook(subject) {
            if (subject === undefined) {
                return;
            }

            if (endsCookSession(heldCook, subject)) {
                clear();
            }

            heldCook = subject;
        },
        connect() {
            connected = true;

            const stopListeningToFocus = focusManager.subscribe((focused) => {
                if (focused) {
                    apply({ kind: 'ring', nowMs: Date.now() });
                }
            });

            arm();

            return () => {
                connected = false;
                stopListeningToFocus();
                arm();
            };
        },
    };
}
