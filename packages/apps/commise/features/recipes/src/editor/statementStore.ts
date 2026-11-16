/**
 * @module @commise/features-recipes/editor — the editor's source-question state (ADR-0095): whether the sheet is open and the
 * answer the cook gave this session.
 *
 * A store, like the lane and the core: a command (Publish, the sheet's Confirm) reads it when it runs, before React has
 * rendered the change it just made, and the view reads it live.
 *
 * @pattern Observable store — one state, one writer, subscribers told on change (read by `useSyncExternalStore`)
 */
import type { StatementWrite } from '../actions/sourceStatement.js';

/** The source question as it stands. */
export interface StatementState {
    /** The sheet is open. */
    readonly asking: boolean;
    /** What the cook answered, held for the session so Publish asks once. */
    readonly answer: StatementWrite | undefined;
}

/** The store {@link createStatementStore} makes. */
export interface StatementStore {
    readonly get: () => StatementState;
    readonly subscribe: (listener: () => void) => () => void;
    /** Open or close the sheet. */
    readonly ask: (asking: boolean) => void;
    /** Record the answer; the sheet closes. */
    readonly answer: (write: StatementWrite) => void;
}

/**
 * @returns A closed store with no answer. @sideEffect Its writers change what `get` answers and tell subscribers.
 */
export function createStatementStore(): StatementStore {
    let state: StatementState = { asking: false, answer: undefined };
    const listeners = new Set<() => void>();

    const set = (next: StatementState): void => {
        if (next.asking === state.asking && next.answer === state.answer) {
            return;
        }

        state = next;

        for (const listener of [...listeners]) {
            listener();
        }
    };

    return {
        get: () => state,
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        ask: (asking) => {
            set({ ...state, asking });
        },
        answer: (write) => {
            set({ asking: false, answer: write });
        },
    };
}
