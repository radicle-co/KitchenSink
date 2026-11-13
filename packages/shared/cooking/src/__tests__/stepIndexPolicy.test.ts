import { describe, expect, it } from 'vitest';

import { stepAt } from '../cookingSteps.js';
import type { CookingStep } from '../cookingSteps.js';
import { isInvalidStepIndexError, isInvalidTotalStepsError } from '../errors.js';
import { allLinesTicked, createLineTicks, focusLineIndex, tickLine } from '../lineTicks.js';
import { stepPlace } from '../place.js';
import { advance, goBack, sessionStatus } from '../session.js';
import type { CookingSession } from '../types.js';
import { makeOneLineSteps } from '../__fixtures__/cookingSteps.js';

/**
 * One rule for "is this a step of the recipe?", held across every function that takes the parsed steps and a step
 * index. A recipe with no steps is `InvalidTotalStepsError(0)`. An index that is not an integer in range is
 * `InvalidStepIndexError` naming the index and the count. Each row runs the same input through every function, so a
 * module that keeps its own copy of the rule, and lets it drift, fails here.
 */

const sessionAt = (currentStepIndex: number): CookingSession => ({
    recipeId: 'recipe-01',
    startedAt: '2026-11-13T10:00:00.000Z',
    currentStepIndex,
    completedSteps: [],
});

const STEP_WALK: readonly (readonly [string, (steps: readonly CookingStep[], index: number) => unknown])[] = [
    ['stepAt', (steps, index) => stepAt(steps, index)],
    ['stepPlace', (steps, index) => stepPlace(index, steps)],
    ['advance', (steps, index) => advance(sessionAt(index), steps)],
    ['goBack', (steps, index) => goBack(sessionAt(index), steps)],
    ['sessionStatus', (steps, index) => sessionStatus(sessionAt(index), steps)],
    ['tickLine', (steps, index) => tickLine(createLineTicks(), { stepIndex: index, lineIndex: 0 }, steps)],
    ['focusLineIndex', (steps, index) => focusLineIndex(createLineTicks(), index, steps)],
    ['allLinesTicked', (steps, index) => allLinesTicked(createLineTicks(), index, steps)],
];

describe('step index policy — one rule for every function that walks the steps', () => {
    it.each(STEP_WALK)('%s rejects a recipe with no steps as InvalidTotalStepsError(0)', (_name, call) => {
        expect(() => call([], 0)).toThrow(
            expect.toSatisfy((error) => isInvalidTotalStepsError(error) && error.totalSteps === 0),
        );
    });

    const THREE = makeOneLineSteps(3);

    it.each(STEP_WALK.flatMap(([name, call]) => [-1, 1.5, Number.NaN, 3].map((index) => [name, call, index] as const)))(
        '%s rejects step index %#, naming the index and the count',
        (_name, call, index) => {
            expect(() => call(THREE, index)).toThrow(
                expect.toSatisfy(
                    (error) =>
                        isInvalidStepIndexError(error) && Object.is(error.index, index) && error.totalSteps === 3,
                ),
            );
        },
    );

    it('stepAt returns the step at a valid index', () => {
        expect(stepAt(THREE, 2)).toBe(THREE[2]);
    });
});
