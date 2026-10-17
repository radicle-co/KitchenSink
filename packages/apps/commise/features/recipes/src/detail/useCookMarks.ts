'use client';

/**
 * @module @commise/features-recipes — `useCookMarks`: a detail screen's binding to the cook's marks on one recipe
 * (blueprint A13). It reads through `useSyncExternalStore`, whose server snapshot is "no marks", so the server render
 * and the first client render agree and the stored marks appear right after hydration.
 *
 * The presentational detail receives the checked lines, the current step and the commands as props; the marks live
 * here, in the orchestration layer.
 */
import { useCallback, useContext, useSyncExternalStore } from 'react';

import { EMPTY_COOK_MARKS, hasCookMarks } from './cookMarks.js';
import { CookMarksContext } from './cookMarksContext.js';

/** What {@link useCookMarks} gives a detail screen. */
export interface CookMarksBinding {
    /** The keys of the lines the cook has checked. */
    readonly checkedLines: ReadonlySet<string>;
    /** The step the cook is on, if any. */
    readonly currentStep: number | undefined;
    /** Whether any mark is set, which is when "Clear checks" is offered. */
    readonly hasMarks: boolean;
    readonly toggleLine: (line: string) => void;
    readonly toggleStep: (step: number) => void;
    readonly clear: () => void;
}

/**
 * The cook's marks on one recipe.
 *
 * @param recipeId - The recipe.
 * @returns The marks and the commands over them.
 * @throws {Error} Outside a `CookMarksProvider`, where no session would ever clear them.
 */
export function useCookMarks(recipeId: string): CookMarksBinding {
    const scope = useContext(CookMarksContext);

    if (scope === undefined) {
        throw new Error('useCookMarks needs a CookMarksProvider above it, mounted in the app root.');
    }

    const { store, subject } = scope;
    const marks = useSyncExternalStore(
        store.subscribe,
        () => store.read(subject, recipeId),
        () => EMPTY_COOK_MARKS,
    );

    return {
        checkedLines: marks.lines,
        currentStep: marks.currentStep,
        hasMarks: hasCookMarks(marks),
        toggleLine: useCallback(
            (line: string) => store.dispatch(subject, recipeId, { kind: 'toggleLine', line }),
            [store, subject, recipeId],
        ),
        toggleStep: useCallback(
            (step: number) => store.dispatch(subject, recipeId, { kind: 'toggleStep', step }),
            [store, subject, recipeId],
        ),
        clear: useCallback(() => store.dispatch(subject, recipeId, { kind: 'clear' }), [store, subject, recipeId]),
    };
}
