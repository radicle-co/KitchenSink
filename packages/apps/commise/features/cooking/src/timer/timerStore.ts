/**
 * @module timerStore — the one timer list of a cook's session on this device: the reducer's state, the clock that
 * moves it, and the listeners that hear a timer end (S3a.U3, ADR-0094).
 *
 * The reducer (`reduceTimer`) is pure and takes the clock as an argument. This store is its impure shell: it reads
 * `Date.now()`, holds one timeout, hears the app come to the front, and ends the session with the cook. React reads it
 * through `useSyncExternalStore` (`getSnapshot`, `subscribe`).
 *
 * With a kept store the record is the truth across tabs and this store is an optimistic copy (ADR-0094 section 6):
 * every change is applied here at once and written through, and when no write is in flight memory is rebuilt from the
 * record.
 * `ended` is told once per (id, run), whether a local ring or a record change shows the timer ringing first, and what a
 * reload finds (a timer that ended while away) is never told.
 *
 * The timeout is a nudge, never the source of truth (KTD5). A phone may run it late or not at all, so the end of a
 * timer is always decided from the clock, and every `ring` is idempotent.
 *
 * @pattern Observer — `subscribe` for React, `onEnded` for the alarm and, later, a phone alert
 * @pattern Adapter over TanStack's `focusManager` singleton, which each platform already drives (web from
 *     `visibilitychange`, mobile from `AppState`)
 * @pattern Command — every change is a `TimerCommand` the reducer applies
 */
import { activeTimerOf, endsCookSession, type KeptSessionStore } from '@commise/features-recipes/session';
import { focusManager } from '@tanstack/react-query';
import { dequal } from 'dequal/lite';
import {
    NO_TIMER,
    TIMER_LIMIT,
    isWaitingForCook,
    reduceTimer,
    type HeldTimer,
    type TimerCommand,
    type TimerEvent,
    type TimerLabel,
    type TimerOrigin,
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
    /** Where the timer came from: the step's offer, or the cook. The row's name follows it. */
    readonly origin: TimerOrigin;
    readonly durationMs: number;
}

/** `Omit` applied to each member of a union, so every variant keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A command as a caller says it: the store adds the clock, and the limit of a restore. */
type TimerCall = DistributiveOmit<
    Exclude<TimerCommand, { readonly kind: 'start' | 'ring' | 'readmit' | 'settleAway' }>,
    'nowMs' | 'limit'
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
 * @param kept - The device's kept session store. With it, every change that moves the state is written through to the
 *   record, and the record is read back once no write is in flight. Without it, the timers live in memory only.
 * @returns The store.
 * @sideEffect Writes through to `kept` on a command that moved the state. Nothing else until `connect`, which
 *   subscribes to the app focus and sets a timeout while a timer runs.
 */
export function createTimerStore(initial: TimerState = NO_TIMER, kept?: KeptSessionStore): TimerStore {
    let state = initial;
    /** The typed labels, by id: the record holds none (ADR-0094 section 2), so they live here, for this tab. */
    const labels = new Map<string, TimerLabel>();
    /** Each (id, run) already told, or found ringing or ended-away by a reload. */
    const told = new Set<string>();
    /** Writes started and not yet answered: the record is not read back while one is. */
    let inFlight = 0;
    /** Whether the first ready record of this cook has been read: that read is the quiet one. */
    let hydrated = false;
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
        const undoBefore = state.undo;
        const result = reduceTimer(state, command);
        const moved = result.state !== state;

        state = result.state;
        arm();

        if (moved) {
            for (const listener of changed) {
                listener();
            }
        }

        for (const event of result.events) {
            told.add(runKey(event));
        }

        if (!quiet) {
            for (const event of result.events) {
                for (const listener of ended) {
                    listener(event);
                }
            }

            if (moved && command.kind !== 'discardUndo') {
                persist(command, undoBefore);
            }
        }

        return result;
    }

    const runKey = (timer: { readonly id: string; readonly run: number }): string => `${timer.id}:${String(timer.run)}`;

    /** The record's timers as the reducer holds them, with the labels this tab remembers. */
    function fromRecord(): TimerState | undefined {
        const snapshot = kept?.getSnapshot();

        if (snapshot?.status !== 'ready') {
            return undefined;
        }

        return {
            timers: snapshot.doc.timers.map((timer) => {
                const active = activeTimerOf(timer);

                return { ...active, label: labels.get(active.id) };
            }),
            undo: state.undo,
        };
    }

    /** Publishes `next` when it differs from what is held, and tells the listeners that the state changed. */
    function publish(next: TimerState): void {
        if (dequal(next, state)) {
            return;
        }

        state = next;
        arm();

        for (const listener of changed) {
            listener();
        }
    }

    /**
     * Brings memory to the record when no write is in flight. The first ready record of a cook is the reload: it fills
     * the ledger with what is already ringing or ended-away and tells nothing. Later, a timer the record shows ringing
     * that was not told yet is told once.
     */
    function resync(): void {
        const record = inFlight === 0 ? fromRecord() : undefined;

        if (record === undefined) {
            return;
        }

        const quiet = !hydrated;

        hydrated = true;
        publish(record);

        const rung = record.timers.flatMap((timer) =>
            timer.kind === 'ringing' && !told.has(runKey(timer)) ? [timer] : [],
        );

        for (const timer of record.timers) {
            if (isWaitingForCook(timer)) {
                told.add(runKey(timer));
            }
        }

        if (!quiet) {
            for (const timer of rung) {
                for (const listener of ended) {
                    listener({ kind: 'ended', id: timer.id, run: timer.run });
                }
            }
        }
    }

    /** Writes one applied command through to the record, then reads the record back once nothing is in flight. */
    function persist(command: TimerCommand, undo: HeldTimer | undefined): void {
        if (kept === undefined) {
            return;
        }

        inFlight += 1;

        void (async (): Promise<void> => {
            try {
                const outcome = await kept.dispatch({ type: 'timer', command, undo });

                if (outcome.kind === 'refused') {
                    // The record refused the command (it is full, or the length is past 24 h): this tab's copy was
                    // stale, so read the record as it is. The cook keeps the Undo, to free a slot and try again.
                    if (command.kind === 'restore' && state.undo === undefined) {
                        publish({ ...state, undo });
                    }

                    await kept.reread();
                }
            } finally {
                // A rejection is a defect and is left to surface: the kept store answers every refusal, a stale command
                // included, as an outcome.
                inFlight -= 1;
                resync();
            }
        })();
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

        // The next cook's record is read as a reload: nothing of this one is told or remembered.
        labels.clear();
        told.clear();
        hydrated = false;
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

            if (result.refused !== undefined) {
                return undefined;
            }

            if (timer.label !== undefined) {
                labels.set(id, timer.label);
            }

            return id;
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

            const stopListeningToRecord = kept?.subscribe(resync);

            arm();
            resync();

            return () => {
                connected = false;
                stopListeningToFocus();
                stopListeningToRecord?.();
                arm();
            };
        },
    };
}
