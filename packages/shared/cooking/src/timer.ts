/**
 * The cooking timer: ONE timer for the whole app, as a pure reducer over commands.
 *
 * Time is data, not a counter. A running timer is stored as the instant it ends and a paused one as the time left, so
 * the time left is always worked out from the clock the caller passes in. Nothing here reads a clock, counts a tick or
 * schedules anything: `ring` may arrive from several sources (a timeout, the app coming to the front), so the reducer,
 * not the caller, decides when the end has come. That is what keeps "ended" at most once per run however many sources
 * fire.
 *
 * The reducer has no servings input, because cook time does not scale with yield (FR-034a).
 *
 * @pattern State + Command — a discriminated union of commands, an exhaustive switch, and a list of events out
 */

import { InvalidTimerDurationError, TimerAlreadyActiveError } from './errors.js';

/** The shortest timer, in ms. Inclusive. */
export const MIN_TIMER_MS = 5_000;

/** The longest timer, in ms. Inclusive. */
export const MAX_TIMER_MS = 86_400_000;

/** What every timer carries. */
export interface TimerBase {
    /** Stable for the timer's life, so anything that names this timer outside the reducer can name it by id. */
    readonly id: string;
    /** Goes up on every restart from ringing, so `ended` for one run is told apart from the next. */
    readonly run: number;
    readonly recipeId: string;
    /** The 0-based step the timer was started from. */
    readonly stepIndex: number;
    /** What the cook typed, or the label derived from the line. `undefined` means the cook gave none and none could be derived. */
    readonly name: string | undefined;
    /** The length of the current run's countdown, so the row can say "of 1 h 30". */
    readonly durationMs: number;
}

/** Counting down to `endsAt`, an instant in ms. */
export interface RunningTimer extends TimerBase {
    readonly kind: 'running';
    readonly endsAt: number;
}

/** Stopped with `remainingMs` left. */
export interface PausedTimer extends TimerBase {
    readonly kind: 'paused';
    readonly remainingMs: number;
}

/** Ended at `endedAt` and sounding until the cook stops it or adds time. */
export interface RingingTimer extends TimerBase {
    readonly kind: 'ringing';
    readonly endedAt: number;
}

/** A timer the cook can cancel, and so a timer Undo can bring back. */
export type HeldTimer = RunningTimer | PausedTimer;

/** The app's one timer, if there is one. */
export type ActiveTimer = HeldTimer | RingingTimer;

/** The whole state: the timer, and the one a cancel left for Undo. Never both: a new timer withdraws the Undo. */
export interface TimerState {
    readonly timer: ActiveTimer | undefined;
    readonly undo: HeldTimer | undefined;
}

/** No timer, nothing to undo. */
export const NO_TIMER: TimerState = Object.freeze({ timer: undefined, undo: undefined });

/** Every command names the clock it ran at, in ms. A command for a timer names its id, so a stale one is harmless. */
export type TimerCommand =
    | {
          readonly kind: 'start';
          readonly id: string;
          readonly recipeId: string;
          readonly stepIndex: number;
          readonly name: string | undefined;
          readonly durationMs: number;
          readonly nowMs: number;
      }
    | { readonly kind: 'pause'; readonly id: string; readonly nowMs: number }
    | { readonly kind: 'resume'; readonly id: string; readonly nowMs: number }
    | { readonly kind: 'cancel'; readonly id: string; readonly nowMs: number }
    | { readonly kind: 'restore'; readonly nowMs: number }
    | { readonly kind: 'addTime'; readonly id: string; readonly addMs: number; readonly nowMs: number }
    | { readonly kind: 'ring'; readonly nowMs: number }
    | { readonly kind: 'stop'; readonly id: string; readonly nowMs: number };

/** Told once, on the edge into ringing, per `(id, run)`. The in-app alarm is one listener, another listener a phone alert. */
export interface TimerEvent {
    readonly kind: 'ended';
    readonly id: string;
    readonly run: number;
}

/** What a command gives back. */
export interface TimerResult {
    readonly state: TimerState;
    readonly events: readonly TimerEvent[];
}

/** A result that raised no event. */
const quiet = (state: TimerState): TimerResult => ({ state, events: [] });

/** The fields every kind of timer shares, so a kind change never forgets one. */
function baseOf(timer: ActiveTimer): TimerBase {
    const { id, run, recipeId, stepIndex, name, durationMs } = timer;

    return { id, run, recipeId, stepIndex, name, durationMs };
}

/**
 * Whether a length is one a timer can have: a whole number of ms from the shortest to the longest timer.
 *
 * @param durationMs - A length in ms.
 * @returns `true` when a timer can run for it. Pure.
 */
export function isValidTimerMs(durationMs: number): boolean {
    return Number.isInteger(durationMs) && durationMs >= MIN_TIMER_MS && durationMs <= MAX_TIMER_MS;
}

/** Refuses a length a timer cannot have. A value from the sheet is validated there first, so this is a programming error. */
function assertDuration(durationMs: number): void {
    if (!isValidTimerMs(durationMs)) {
        throw new InvalidTimerDurationError(durationMs);
    }
}

/** Ringing as an edge: the one place `ended` is born. */
function ringing(timer: HeldTimer, endedAt: number): TimerResult {
    const rung: RingingTimer = { ...baseOf(timer), kind: 'ringing', endedAt };

    return { state: { timer: rung, undo: undefined }, events: [{ kind: 'ended', id: timer.id, run: timer.run }] };
}

function start(state: TimerState, command: Extract<TimerCommand, { kind: 'start' }>): TimerResult {
    if (state.timer !== undefined) {
        throw new TimerAlreadyActiveError(state.timer.id);
    }

    assertDuration(command.durationMs);

    const timer: RunningTimer = {
        kind: 'running',
        id: command.id,
        run: 1,
        recipeId: command.recipeId,
        stepIndex: command.stepIndex,
        name: command.name,
        durationMs: command.durationMs,
        endsAt: command.nowMs + command.durationMs,
    };

    return quiet({ timer, undo: undefined });
}

function restore(state: TimerState, nowMs: number): TimerResult {
    const { timer, undo } = state;

    if (timer !== undefined || undo === undefined) {
        return quiet(state);
    }

    if (undo.kind === 'paused') {
        return quiet({ timer: undo, undo: undefined });
    }

    return nowMs >= undo.endsAt ? ringing(undo, undo.endsAt) : quiet({ timer: undo, undo: undefined });
}

function addTime(state: TimerState, command: Extract<TimerCommand, { kind: 'addTime' }>): TimerResult {
    const { timer } = state;

    if (timer === undefined || timer.id !== command.id || timer.kind === 'paused') {
        return quiet(state);
    }

    assertDuration(command.addMs);

    if (timer.kind === 'ringing') {
        const next: RunningTimer = {
            ...baseOf(timer),
            kind: 'running',
            run: timer.run + 1,
            durationMs: command.addMs,
            endsAt: command.nowMs + command.addMs,
        };

        return quiet({ timer: next, undo: undefined });
    }

    // A running timer that has already reached its end is left for `ring`, whose edge is the one source of `ended`.
    if (command.nowMs >= timer.endsAt) {
        return quiet(state);
    }

    assertDuration(timer.endsAt - command.nowMs + command.addMs);

    return quiet({
        timer: { ...timer, durationMs: timer.durationMs + command.addMs, endsAt: timer.endsAt + command.addMs },
        undo: undefined,
    });
}

/**
 * Apply one command. Pure: the state given is never changed.
 *
 * A command that names another timer, or does not apply to the state, returns the same state and no events and never
 * throws (a double tap, a late source). Only a value no timer can have is refused with a typed error, and `start`
 * while a timer exists.
 *
 * @param state - The timer state now.
 * @param command - What happened, with the clock it happened at.
 * @returns The next state and the events it raised.
 * @throws {InvalidTimerDurationError} When a `start` or `addTime` length is outside `MIN_TIMER_MS` to `MAX_TIMER_MS`, or an added time
 *   would take a running timer past 24 h.
 * @throws {TimerAlreadyActiveError} When `start` is sent while a timer exists.
 */
export function reduceTimer(state: TimerState, command: TimerCommand): TimerResult {
    const { timer } = state;

    switch (command.kind) {
        case 'start':
            return start(state, command);

        case 'pause': {
            // At or past the end the ring is due, and it must not be lost to a pause.
            if (timer?.kind !== 'running' || timer.id !== command.id || command.nowMs >= timer.endsAt) {
                return quiet(state);
            }

            return quiet({
                timer: {
                    ...baseOf(timer),
                    kind: 'paused',
                    remainingMs: Math.min(timer.durationMs, timer.endsAt - command.nowMs),
                },
                undo: undefined,
            });
        }

        case 'resume': {
            if (timer?.kind !== 'paused' || timer.id !== command.id) {
                return quiet(state);
            }

            return quiet({
                timer: { ...baseOf(timer), kind: 'running', endsAt: command.nowMs + timer.remainingMs },
                undo: undefined,
            });
        }

        case 'cancel':
            if (timer === undefined || timer.kind === 'ringing' || timer.id !== command.id) {
                return quiet(state);
            }

            return quiet({ timer: undefined, undo: timer });

        case 'restore':
            return restore(state, command.nowMs);

        case 'addTime':
            return addTime(state, command);

        case 'ring':
            return timer?.kind === 'running' && command.nowMs >= timer.endsAt
                ? ringing(timer, timer.endsAt)
                : quiet(state);

        case 'stop':
            return timer?.kind === 'ringing' && timer.id === command.id ? quiet(NO_TIMER) : quiet(state);
    }
}

/**
 * The time left, worked out from the clock and never counted down.
 *
 * @param timer - The timer, or `undefined`.
 * @param nowMs - The clock, in ms. It may go backwards.
 * @returns The ms left, never below 0. A paused timer keeps its own, and a ringing one or none has none.
 */
export function timeLeftMs(timer: ActiveTimer | undefined, nowMs: number): number {
    switch (timer?.kind) {
        case 'running':
            return Math.max(0, timer.endsAt - nowMs);
        case 'paused':
            return timer.remainingMs;
        default:
            return 0;
    }
}
