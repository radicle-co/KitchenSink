'use client';

/**
 * @module @commise/features-recipes/actions — `useStatementSheet`: the source-statement sheet's state and its Confirm
 * (ADR-0095). The sheet is a pure render of `state`; this holds it, so the editor and the recipe page ask in one way.
 *
 * Confirm does what the state says it may: nothing with no answer, a marked field with an unusable one, and otherwise it
 * hands the HOST exactly what `statementWriteOf` decided. What the host does with it differs on purpose (the editor queues
 * the answer into its save, the recipe page sends a visibility write), so the send is the host's.
 *
 * @pattern Headless hook — the sheet's state and command, with no markup
 */
import { useReducer } from 'react';

import {
    initialSheet,
    sheetReducer,
    statementFieldErrorOf,
    statementWriteOf,
    type StatementSheetAction,
    type StatementSheetState,
    type StatementWrite,
} from './sourceStatement.js';

/** What {@link useStatementSheet} reads. */
export interface UseStatementSheetOptions {
    /** The locale the wording was shown in. */
    readonly locale: string;
    /** The cook confirmed a usable answer: send it. */
    readonly onAnswer: (write: StatementWrite) => void;
}

/** What {@link useStatementSheet} hands the host. */
export interface StatementSheetBinding {
    readonly state: StatementSheetState;
    readonly dispatch: (action: StatementSheetAction) => void;
    /** The cook pressed the confirm. */
    readonly confirm: () => void;
    /** Start clean, for the next opening. */
    readonly reset: () => void;
}

/**
 * The sheet's state and Confirm.
 *
 * @param options - The locale and what to do with a usable answer.
 * @returns The state, the transitions and the two commands.
 * @sideEffect Calls `onAnswer` for a Confirm over a usable answer.
 */
export function useStatementSheet(options: UseStatementSheetOptions): StatementSheetBinding {
    const [state, dispatch] = useReducer(sheetReducer, undefined, initialSheet);

    return {
        state,
        dispatch,
        confirm: () => {
            if (state.answer === undefined) {
                return;
            }

            if (statementFieldErrorOf(state.answer, state) !== undefined) {
                dispatch({ type: 'attempt' });

                return;
            }

            options.onAnswer(statementWriteOf(state.answer, state, options.locale));
        },
        reset: () => dispatch({ type: 'reset' }),
    };
}
