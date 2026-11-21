'use client';

/**
 * @module @commise/features-recipes — `useCookMarks`: a detail screen's binding to the cook's marks on one recipe
 * (blueprint A13). It reads through `useSyncExternalStore`, whose server snapshot is "no marks", so the server render
 * and the first client render agree and the stored marks appear right after hydration.
 *
 * The presentational detail receives the checked lines, the current step and the commands as props; the marks live
 * here, in the orchestration layer.
 *
 * The store holds opaque tick keys (a line's content digest and ordinal, ADR-0096). This hook is the one place that
 * translates between that key space and the POSITIONS in one recipe's stored lines, which every render component sees.
 *
 * @pattern Adapter — keys in the store, positions for the render
 */
import type { IngredientLineDigestInput } from '@kitchensink/cooking-core';
import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';

import { EMPTY_COOK_MARKS } from './cookMarks.js';
import { CookMarksContext } from './cookMarksContext.js';
import { ingredientTickKeys, tickedPositions } from '../common/ingredientTickKey.js';

/** What {@link useCookMarks} gives a detail screen. */
export interface CookMarksBinding {
    /** The positions, in the lines the hook was given, of the lines the cook has checked. */
    readonly checkedLines: ReadonlySet<number>;
    /** The step the cook is on, if any. */
    readonly currentStep: number | undefined;
    /** Whether any mark is set, which is when "Clear checks" is offered. */
    readonly hasMarks: boolean;
    /** Tick or untick the line at a position. A position no line has changes nothing. */
    readonly toggleLine: (position: number) => void;
    readonly toggleStep: (step: number) => void;
    readonly clear: () => void;
    /** Cooking mode's Clear ticks: removes every ingredient tick and keeps the current step. */
    readonly clearIngredientTicks: () => void;
    /** Cooking mode's Undo: adds these ticks back and removes none. */
    readonly restoreIngredientTicks: (positions: readonly number[]) => void;
}

/**
 * The cook's marks on one recipe.
 *
 * @param recipeId - The recipe.
 * @param lines - The recipe's stored, UNSCALED lines, in stored order. Scaled lines would key a tick to servings.
 * @returns The marks and the commands over them.
 * @throws {Error} Outside a `CookMarksProvider`, where no session would ever clear them.
 */
export function useCookMarks(recipeId: string, lines: readonly IngredientLineDigestInput[]): CookMarksBinding {
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

    const keys = useMemo(() => ingredientTickKeys(lines), [lines]);
    const checkedLines = useMemo(() => tickedPositions(keys, marks.lines), [keys, marks.lines]);

    return {
        checkedLines,
        currentStep: marks.currentStep,
        // What the cook sees: a stale key (its line was edited) is not a mark to clear.
        hasMarks: checkedLines.size > 0 || marks.currentStep !== undefined,
        toggleLine: useCallback(
            (position: number) => {
                const line = keys[position];

                // DD19: an index-bound guard is not dead code, because `noUncheckedIndexedAccess` is off.
                if (line !== undefined) {
                    store.dispatch(subject, recipeId, { kind: 'toggleLine', line });
                }
            },
            [store, subject, recipeId, keys],
        ),
        toggleStep: useCallback(
            (step: number) => store.dispatch(subject, recipeId, { kind: 'toggleStep', step }),
            [store, subject, recipeId],
        ),
        clear: useCallback(() => store.dispatch(subject, recipeId, { kind: 'clear' }), [store, subject, recipeId]),
        clearIngredientTicks: useCallback(
            () => store.dispatch(subject, recipeId, { kind: 'clearIngredientTicks' }),
            [store, subject, recipeId],
        ),
        restoreIngredientTicks: useCallback(
            (positions: readonly number[]) => {
                const restored = positions.flatMap((position) => {
                    const line = keys[position];

                    return line === undefined ? [] : [line];
                });

                if (restored.length > 0) {
                    store.dispatch(subject, recipeId, { kind: 'restoreIngredientTicks', lines: restored });
                }
            },
            [store, subject, recipeId, keys],
        ),
    };
}
