/**
 * @module @commise/ui/snackbar — the snackbar queue: a pure reducer that owns the one-at-a-time rule and the timer's
 * arithmetic (`docs/architecture/uiOverhaulBlueprint.md` Part B). The host dispatches to it and runs what it settles.
 *
 * - `show` COMMITS the snackbar it replaces: the replaced one moves to `settled`, and the host runs its `onTimeout`.
 * - `expire` commits the snackbar that is showing; `act` closes it without committing (Undo).
 * - `pause` banks the time left and `resume` starts it running again, so a snackbar paused under the pointer for a
 *   minute still has its own seconds when the pointer leaves (SC 2.2.1).
 *
 * Every action names the snackbar it is for (`id`), so a late timer or handler from a replaced one changes nothing.
 * The clock is an argument (`now`): the reducer never reads it.
 */
import { DEFAULT_SNACKBAR_MS, type SnackbarInput } from './props.js';

/** One snackbar the queue has shown. */
export interface SnackbarEntry {
    readonly id: number;
    readonly input: SnackbarInput;
    /** What is left of its life at `runningSince`, or now if paused. */
    readonly remainingMs: number;
    /** When its timer last started, or `null` while paused. */
    readonly runningSince: number | null;
}

/** The queue. */
export interface SnackbarState {
    /** The snackbar on screen, if any. */
    readonly current: SnackbarEntry | null;
    /** Snackbars that have committed and whose `onTimeout` the host has still to run, oldest first. */
    readonly settled: readonly SnackbarEntry[];
    /** The id the next snackbar takes. */
    readonly nextId: number;
}

/** What can happen to the queue. */
export type SnackbarQueueAction =
    | { readonly type: 'show'; readonly input: SnackbarInput; readonly now: number }
    | { readonly type: 'expire'; readonly id: number }
    | { readonly type: 'act'; readonly id: number }
    | { readonly type: 'pause'; readonly id: number; readonly now: number }
    | { readonly type: 'resume'; readonly id: number; readonly now: number }
    | { readonly type: 'drained'; readonly ids: readonly number[] };

/** Nothing shown, nothing to commit. */
export const INITIAL_SNACKBAR_STATE: SnackbarState = { current: null, settled: [], nextId: 1 };

/** Whether an action is for the snackbar on screen. Pure. */
const isCurrent = (state: SnackbarState, id: number): state is SnackbarState & { current: SnackbarEntry } =>
    state.current !== null && state.current.id === id;

/**
 * The queue after an action. Pure.
 *
 * @param state - The queue now.
 * @param action - What happened.
 * @returns The queue after it; the same object when the action changes nothing.
 */
export function snackbarReducer(state: SnackbarState, action: SnackbarQueueAction): SnackbarState {
    switch (action.type) {
        case 'show':
            return {
                current: {
                    id: state.nextId,
                    input: action.input,
                    remainingMs: action.input.durationMs ?? DEFAULT_SNACKBAR_MS,
                    runningSince: action.now,
                },
                settled: state.current === null ? state.settled : [...state.settled, state.current],
                nextId: state.nextId + 1,
            };
        case 'expire':
            return isCurrent(state, action.id)
                ? { ...state, current: null, settled: [...state.settled, state.current] }
                : state;
        case 'act':
            return isCurrent(state, action.id) ? { ...state, current: null } : state;
        case 'pause':
            if (!isCurrent(state, action.id) || state.current.runningSince === null) {
                return state;
            }

            return {
                ...state,
                current: {
                    ...state.current,
                    remainingMs: state.current.remainingMs - (action.now - state.current.runningSince),
                    runningSince: null,
                },
            };
        case 'resume':
            if (!isCurrent(state, action.id) || state.current.runningSince !== null) {
                return state;
            }

            return { ...state, current: { ...state.current, runningSince: action.now } };
        case 'drained':
            return { ...state, settled: state.settled.filter((entry) => !action.ids.includes(entry.id)) };
    }
}

/**
 * How long until a snackbar expires. Pure.
 *
 * @param entry - The snackbar on screen, or `null`.
 * @param now - The clock.
 * @returns The ms left, never negative; `null` while paused or with nothing showing.
 */
export function msUntilExpiry(entry: SnackbarEntry | null, now: number): number | null {
    if (entry === null || entry.runningSince === null) {
        return null;
    }

    return Math.max(0, entry.remainingMs - (now - entry.runningSince));
}
