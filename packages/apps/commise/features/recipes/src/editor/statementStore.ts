/**
 * @module @commise/features-recipes/editor — the editor's source-question state (ADR-0095): whether the sheet is open and the
 * answer the cook gave this session.
 *
 * A store, like the lane and the core: a command (Publish, the sheet's Confirm) reads it when it runs, before React has
 * rendered the change it just made, and the view reads it live.
 *
 * @pattern Observable store — one state, one writer, subscribers told on change (read by `useSyncExternalStore`)
 */
import type { RecipeStatementInput } from '@kitchensink/schema-recipe';

import type { StatementWrite } from '../actions/sourceStatement.js';

/**
 * What the Source row's sheet answered (ADR-0100): the statement the next write carries (`null` clears the stored answer), and
 * whether confirming it locks the answer, which decides how the row draws it before any write has carried it.
 */
export interface RowAnswer {
    readonly statement: RecipeStatementInput | null;
    readonly locks: boolean;
}

/** The source question as it stands. */
export interface StatementState {
    /** The sheet is open. */
    readonly asking: boolean;
    /** What the cook answered, held for the session so Publish asks once. */
    readonly answer: StatementWrite | undefined;
    /** What the Source row's own sheet answered; it rides the next write, and clears when a write carried it. */
    readonly row?: RowAnswer;
}

/** The store {@link createStatementStore} makes. */
export interface StatementStore {
    readonly get: () => StatementState;
    readonly subscribe: (listener: () => void) => () => void;
    /** Open or close the sheet. */
    readonly ask: (asking: boolean) => void;
    /** Record the answer; the sheet closes. */
    readonly answer: (write: StatementWrite) => void;
    /** Forget the answer, so the next write carries none. */
    readonly clearAnswer: () => void;
    /** Record what the Source row's sheet answered. */
    readonly rowAnswer: (answer: RowAnswer) => void;
    /** Forget the row's answer: a write carried it, or the server refused it. */
    readonly clearRow: () => void;
}

/**
 * @returns A closed store with no answer. @sideEffect Its writers change what `get` answers and tell subscribers.
 */
export function createStatementStore(): StatementStore {
    let state: StatementState = { asking: false, answer: undefined };
    const listeners = new Set<() => void>();

    const set = (next: StatementState): void => {
        if (next.asking === state.asking && next.answer === state.answer && next.row === state.row) {
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
            set({ ...state, asking: false, answer: write });
        },
        clearAnswer: () => {
            set({ ...state, answer: undefined });
        },
        rowAnswer: (row) => {
            set({ ...state, row });
        },
        clearRow: () => {
            set({ ...state, row: undefined });
        },
    };
}
