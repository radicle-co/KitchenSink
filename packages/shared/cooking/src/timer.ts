/**
 * The cooking timers: a LIST of timers as a pure reducer over commands.
 *
 * Time is data, not a counter. A running timer is stored as the instant it ends and a paused one as the time left, so
 * the time left is always worked out from the clock the caller passes in. Nothing here reads a clock, counts a tick or
 * schedules anything: `ring` may arrive from several sources (a timeout, the app coming to the front), so the reducer,
 * not the caller, decides when the end has come. That is what keeps "ended" at most once per run however many sources
 * fire.
 *
 * The list holds up to `limit` timers, named by the caller on `start` and `restore` (see `TIMER_LIMIT`). One held
 * snapshot can be brought back by Undo. The order cooks see (`timerOrder`) and the order alarms sound (`alarmQueue`)
 * are read here and nowhere else.
 *
 * The reducer has no servings input, because cook time does not scale with yield (FR-034a).
 *
 * @pattern State + Command — a discriminated union of commands, an exhaustive switch, and a list of events out
 */

import { InvalidTimerDurationError } from './errors.js';

/** The shortest timer, in ms. Inclusive. */
export const MIN_TIMER_MS = 5_000;

/** The longest timer, in ms. Inclusive. */
export const MAX_TIMER_MS = 86_400_000;

/** How many timers a cook may hold at once. S6.U1 raises it to 10; this is the one authority for the rule. */
export const TIMER_LIMIT = 1;

/** What every timer carries. */
export interface TimerBase {
    /** Stable for the timer's life, so anything that names this timer outside the reducer can name it by id. */
    readonly id: string;
    /** Goes up on every restart from ringing, so `ended` for one run is told apart from the next. */
    readonly run: number;
    readonly recipeId: string;
    /** The 0-based step the timer was started from. */
    readonly stepIndex: number;
    /** The step's text digest, carried so the kept record and the reducer hold one timer shape. */
    readonly stepDigest: string;
    /** 1, 2, 3 ... unique among the timers and the held Undo on the same recipe and step. */
    readonly ordinal: number;
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

/** Ended at `endedAt` while the app was away, and already announced. It waits for the cook like a ringing one. */
export interface EndedAwayTimer extends TimerBase {
    readonly kind: 'endedAway';
    readonly endedAt: number;
}

/** A timer the cook can cancel, and so a timer Undo can bring back. */
export type HeldTimer = RunningTimer | PausedTimer;

/** Any timer in the list. */
export type ActiveTimer = HeldTimer | RingingTimer | EndedAwayTimer;

/** The whole state: the timers, and the one a cancel left for Undo. Only `cancel`, `restore` and `discardUndo` change it. */
export interface TimerState {
    readonly timers: readonly ActiveTimer[];
    readonly undo: HeldTimer | undefined;
}

/** No timer, nothing to undo. */
export const NO_TIMER: TimerState = Object.freeze({ timers: Object.freeze([]), undo: undefined });

/** One timer's new place after the steps were rewritten: the index `matchStep` answered and the digest of that step. */
export interface TimerMove {
    readonly id: string;
    readonly stepIndex: number;
    readonly stepDigest: string;
}

/** Every command names the clock it ran at, in ms. A command for a timer names its id, so a stale one is harmless. */
export type TimerCommand =
    | {
          readonly kind: 'start';
          readonly id: string;
          readonly recipeId: string;
          readonly stepIndex: number;
          readonly stepDigest: string;
          readonly name: string | undefined;
          readonly durationMs: number;
          readonly limit: number;
          readonly nowMs: number;
      }
    | {
          readonly kind: 'pause' | 'resume' | 'cancel' | 'stop' | 'discardUndo';
          readonly id: string;
          readonly nowMs: number;
      }
    | { readonly kind: 'addTime'; readonly id: string; readonly addMs: number; readonly nowMs: number }
    | { readonly kind: 'restore'; readonly limit: number; readonly nowMs: number }
    | { readonly kind: 'ring'; readonly nowMs: number }
    | { readonly kind: 'rematch'; readonly moves: readonly TimerMove[]; readonly nowMs: number };

/** Told once, on the edge into ringing, per `(id, run)`. The in-app alarm is one listener, another listener a phone alert. */
export interface TimerEvent {
    readonly kind: 'ended';
    readonly id: string;
    readonly run: number;
}

/** Why a command was not carried out. A start or a restore at the limit is a result, not an error. */
export type TimerRefusal = 'limit';

/** What a command gives back. `refused` is set only when the command was declined for a reason the cook can act on. */
export interface TimerResult {
    readonly state: TimerState;
    readonly events: readonly TimerEvent[];
    readonly refused?: TimerRefusal;
}

/** One place in the list the cook sees: a live timer, or the slot the held Undo timer would come back to. */
export type TimerOrderEntry =
    { readonly kind: 'live'; readonly timer: ActiveTimer } | { readonly kind: 'held'; readonly id: string };

/** A result that raised no event. */
const quiet = (state: TimerState): TimerResult => ({ state, events: [] });

/** A result that declined a command because the list is full. The state is the one given. */
const atLimit = (state: TimerState): TimerResult => ({ state, events: [], refused: 'limit' });

/** The fields every kind of timer shares, so a kind change never forgets one. */
function baseOf(timer: ActiveTimer): TimerBase {
    const { id, run, recipeId, stepIndex, stepDigest, ordinal, name, durationMs } = timer;

    return { id, run, recipeId, stepIndex, stepDigest, ordinal, name, durationMs };
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

/** Refuses a length a timer cannot have. */
function assertDuration(durationMs: number): void {
    if (!isValidTimerMs(durationMs)) {
        throw new InvalidTimerDurationError(durationMs);
    }
}

/** The list with the timer of this id replaced by `next`, or removed when `next` is `undefined`. */
function withTimer(state: TimerState, id: string, next: ActiveTimer | undefined): readonly ActiveTimer[] {
    return next === undefined
        ? state.timers.filter((t) => t.id !== id)
        : state.timers.map((t) => (t.id === id ? next : t));
}

const sameStep = (a: TimerBase, recipeId: string, stepIndex: number) =>
    a.recipeId === recipeId && a.stepIndex === stepIndex;

/**
 * The least positive number not held, on this recipe and step, by any timer in the list or by the held Undo.
 *
 * @param held - Every timer (and the held one) that counts.
 * @param recipeId - The recipe the new number is for.
 * @param stepIndex - The step the new number is for.
 * @returns A positive integer. Pure.
 */
function lowestFreeOrdinal(held: readonly TimerBase[], recipeId: string, stepIndex: number): number {
    const taken = new Set(held.filter((t) => sameStep(t, recipeId, stepIndex)).map((t) => t.ordinal));
    let next = 1;

    while (taken.has(next)) {
        next += 1;
    }

    return next;
}

/** Every timer that holds a number: the list and the held Undo. */
const holders = (state: TimerState): readonly TimerBase[] =>
    state.undo === undefined ? state.timers : [...state.timers, state.undo];

/** Code-unit order, never `localeCompare`, which differs by runtime. */
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order alarms sound in: the instant each one ended, then the id. */
const alarmOrder = (a: { readonly at: number; readonly id: string }, b: { readonly at: number; readonly id: string }) =>
    a.at - b.at || byCodeUnits(a.id, b.id);

/** Ringing as an edge: the one place `ended` is born. Returns the ringing timer. */
function toRinging(timer: HeldTimer, endedAt: number): RingingTimer {
    return { ...baseOf(timer), kind: 'ringing', endedAt };
}

const endedEvent = (timer: TimerBase): TimerEvent => ({ kind: 'ended', id: timer.id, run: timer.run });

function start(state: TimerState, command: Extract<TimerCommand, { kind: 'start' }>): TimerResult {
    // A double dispatch must not make two timers with one id: every by-id command would then be ambiguous.
    if (holders(state).some((t) => t.id === command.id)) {
        return quiet(state);
    }

    if (state.timers.length >= command.limit) {
        return atLimit(state);
    }

    assertDuration(command.durationMs);

    const timer: RunningTimer = {
        kind: 'running',
        id: command.id,
        run: 1,
        recipeId: command.recipeId,
        stepIndex: command.stepIndex,
        stepDigest: command.stepDigest,
        ordinal: lowestFreeOrdinal(holders(state), command.recipeId, command.stepIndex),
        name: command.name,
        durationMs: command.durationMs,
        endsAt: command.nowMs + command.durationMs,
    };

    return quiet({ timers: [...state.timers, timer], undo: state.undo });
}

function restore(state: TimerState, command: Extract<TimerCommand, { kind: 'restore' }>): TimerResult {
    const { undo, timers } = state;

    if (undo === undefined) {
        return quiet(state);
    }

    // The Undo stays, so the cook can free a slot and try again inside the window.
    if (timers.length >= command.limit) {
        return atLimit(state);
    }

    const heldNumberTaken = timers.some(
        (t) => sameStep(t, undo.recipeId, undo.stepIndex) && t.ordinal === undo.ordinal,
    );
    const ordinal = heldNumberTaken ? lowestFreeOrdinal(timers, undo.recipeId, undo.stepIndex) : undo.ordinal;
    const back: HeldTimer = { ...undo, ordinal };

    if (back.kind === 'running' && command.nowMs >= back.endsAt) {
        const rung = toRinging(back, back.endsAt);

        return { state: { timers: [...timers, rung], undo: undefined }, events: [endedEvent(rung)] };
    }

    return quiet({ timers: [...timers, back], undo: undefined });
}

function addTime(state: TimerState, command: Extract<TimerCommand, { kind: 'addTime' }>): TimerResult {
    const timer = state.timers.find((t) => t.id === command.id);

    if (timer === undefined || timer.kind === 'paused') {
        return quiet(state);
    }

    assertDuration(command.addMs);

    if (timer.kind === 'ringing' || timer.kind === 'endedAway') {
        const next: RunningTimer = {
            ...baseOf(timer),
            kind: 'running',
            run: timer.run + 1,
            durationMs: command.addMs,
            endsAt: command.nowMs + command.addMs,
        };

        return quiet({ timers: withTimer(state, timer.id, next), undo: state.undo });
    }

    // A running timer that has already reached its end is left for `ring`, whose edge is the one source of `ended`.
    if (command.nowMs >= timer.endsAt) {
        return quiet(state);
    }

    assertDuration(timer.endsAt - command.nowMs + command.addMs);
    assertDuration(timer.durationMs + command.addMs);

    const next: RunningTimer = {
        ...timer,
        durationMs: timer.durationMs + command.addMs,
        endsAt: timer.endsAt + command.addMs,
    };

    return quiet({ timers: withTimer(state, timer.id, next), undo: state.undo });
}

function ring(state: TimerState, nowMs: number): TimerResult {
    const due = state.timers.filter((t): t is RunningTimer => t.kind === 'running' && nowMs >= t.endsAt);

    if (due.length === 0) {
        return quiet(state);
    }

    const rung = new Map(due.map((t) => [t.id, toRinging(t, t.endsAt)]));
    const events = [...rung.values()]
        .sort((a, b) => alarmOrder({ at: a.endedAt, id: a.id }, { at: b.endedAt, id: b.id }))
        .map(endedEvent);

    return { state: { timers: state.timers.map((t) => rung.get(t.id) ?? t), undo: state.undo }, events };
}

/**
 * The step rewrite as one reducer command, so the numbering rule has one writer. "Kept its step" means the move's
 * digest equals the timer's stored one, not that the index is unchanged: `matchStep` falls back to the clamped old index
 * when a step was deleted, so a timer whose step was deleted can keep its index while one whose step survived moves.
 * Timers with no move count as kept. Each timer keeps its number when it is still free on its new step, in the order:
 * kept its step first, then the older number, then the id.
 */
function rematch(state: TimerState, moves: readonly TimerMove[]): TimerResult {
    const moveOf = new Map(moves.map((m) => [m.id, m]));
    const items = holders(state).map((t) => ({ timer: t, move: moveOf.get(t.id) }));
    const changed = items.some(
        ({ timer, move }) =>
            move !== undefined && (move.stepIndex !== timer.stepIndex || move.stepDigest !== timer.stepDigest),
    );

    if (!changed) {
        return quiet(state);
    }

    const kept = ({ timer, move }: (typeof items)[number]) =>
        move === undefined || move.stepDigest === timer.stepDigest;
    const claimOrder = [...items].sort(
        (a, b) =>
            Number(kept(b)) - Number(kept(a)) ||
            a.timer.ordinal - b.timer.ordinal ||
            byCodeUnits(a.timer.id, b.timer.id),
    );
    const placed = new Map<
        string,
        { readonly stepIndex: number; readonly stepDigest: string; readonly ordinal: number }
    >();
    const claimed: TimerBase[] = [];

    for (const { timer, move } of claimOrder) {
        const stepIndex = move?.stepIndex ?? timer.stepIndex;
        const taken = claimed.some((c) => sameStep(c, timer.recipeId, stepIndex) && c.ordinal === timer.ordinal);
        const ordinal = taken ? lowestFreeOrdinal(claimed, timer.recipeId, stepIndex) : timer.ordinal;

        placed.set(timer.id, { stepIndex, stepDigest: move?.stepDigest ?? timer.stepDigest, ordinal });
        claimed.push({ ...timer, stepIndex, ordinal });
    }

    const apply = <T extends ActiveTimer>(timer: T): T => ({ ...timer, ...placed.get(timer.id) });

    return quiet({ timers: state.timers.map(apply), undo: state.undo === undefined ? undefined : apply(state.undo) });
}

/**
 * Apply one command. Pure: the state given is never changed.
 *
 * A command that names another timer, or does not apply to the state, returns the same state object and no events and
 * never throws (a double tap, a late source). A `start` or a `restore` at the limit returns the same state with
 * `refused: 'limit'`. Only a value no timer can have is refused with a typed error.
 *
 * @param state - The timer state now.
 * @param command - What happened, with the clock it happened at.
 * @returns The next state and the events it raised.
 * @throws {InvalidTimerDurationError} When a `start` or `addTime` length is outside `MIN_TIMER_MS` to `MAX_TIMER_MS`, or an added time
 *   would take a running timer past 24 h.
 */
export function reduceTimer(state: TimerState, command: TimerCommand): TimerResult {
    switch (command.kind) {
        case 'start':
            return start(state, command);

        case 'pause': {
            const timer = state.timers.find((t) => t.id === command.id);

            // At or past the end the ring is due, and it must not be lost to a pause.
            if (timer?.kind !== 'running' || command.nowMs >= timer.endsAt) {
                return quiet(state);
            }

            const paused: PausedTimer = {
                ...baseOf(timer),
                kind: 'paused',
                remainingMs: Math.min(timer.durationMs, timer.endsAt - command.nowMs),
            };

            return quiet({ timers: withTimer(state, timer.id, paused), undo: state.undo });
        }

        case 'resume': {
            const timer = state.timers.find((t) => t.id === command.id);

            if (timer?.kind !== 'paused') {
                return quiet(state);
            }

            const running: RunningTimer = {
                ...baseOf(timer),
                kind: 'running',
                endsAt: command.nowMs + timer.remainingMs,
            };

            return quiet({ timers: withTimer(state, timer.id, running), undo: state.undo });
        }

        case 'cancel': {
            const timer = state.timers.find((t) => t.id === command.id);

            if (timer === undefined || (timer.kind !== 'running' && timer.kind !== 'paused')) {
                return quiet(state);
            }

            // The first cancel is final: a second one replaces the held timer.
            return quiet({ timers: withTimer(state, timer.id, undefined), undo: timer });
        }

        case 'restore':
            return restore(state, command);

        case 'discardUndo':
            return state.undo?.id === command.id ? quiet({ timers: state.timers, undo: undefined }) : quiet(state);

        case 'addTime':
            return addTime(state, command);

        case 'ring':
            return ring(state, command.nowMs);

        case 'stop': {
            const timer = state.timers.find((t) => t.id === command.id);

            return timer?.kind === 'ringing' || timer?.kind === 'endedAway'
                ? quiet({ timers: withTimer(state, timer.id, undefined), undo: state.undo })
                : quiet(state);
        }

        case 'rematch':
            return rematch(state, command.moves);
    }
}

/** Where a timer sorts in the cook's list: ended first, then running by end instant, then paused by time left. */
function listKey(timer: ActiveTimer): readonly [rank: number, key: number] {
    switch (timer.kind) {
        case 'ringing':
        case 'endedAway':
            return [0, timer.endedAt];
        case 'running':
            return [1, timer.endsAt];
        case 'paused':
            return [2, timer.remainingMs];
    }
}

/**
 * The order a cook sees the timers in. The cancelled timer Undo holds keeps its slot, reported as `held`, because its
 * sort keys are the values it had when cancelled and no other timer's keys move without a command. Reads no clock.
 *
 * @param state - The timer state.
 * @returns One entry per live timer and one for the held Undo timer, if any. Pure.
 */
export function timerOrder(state: TimerState): readonly TimerOrderEntry[] {
    const entries = [
        ...state.timers.map((timer) => ({ entry: { kind: 'live', timer } as const, timer })),
        ...(state.undo === undefined
            ? []
            : [{ entry: { kind: 'held', id: state.undo.id } as const, timer: state.undo }]),
    ];

    return entries
        .sort((a, b) => {
            const [rankA, keyA] = listKey(a.timer);
            const [rankB, keyB] = listKey(b.timer);

            return rankA - rankB || keyA - keyB || byCodeUnits(a.timer.id, b.timer.id);
        })
        .map(({ entry }) => entry);
}

/**
 * The timers that are ringing, in the order their alarms sound: the instant each ended, then the id.
 *
 * @param state - The timer state.
 * @returns The ringing timers only. Pure.
 */
export function alarmQueue(state: TimerState): readonly RingingTimer[] {
    return state.timers
        .filter((t): t is RingingTimer => t.kind === 'ringing')
        .sort((a, b) => alarmOrder({ at: a.endedAt, id: a.id }, { at: b.endedAt, id: b.id }));
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
