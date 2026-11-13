import { describe, expect, it } from 'vitest';

import { isInvalidLineIndexError, isInvalidStepIndexError, isInvalidTotalStepsError } from '../errors.js';
import { makeCookingSteps, makeOneLineSteps } from '../__fixtures__/cookingSteps.js';
import type { CookingStep } from '../cookingSteps.js';
import { linePlace, stepPlace } from '../place.js';

/**
 * `place` — the 1-based numbers the cook reads ("Step 2 of 6", "Line 1 of 3", "Back to step 1", "Next step, step 3").
 * The domain stays 0-based, and this module is the only place that adds one.
 *
 * `previous: null` is the signal for "Back to the recipe" on step 1, and `next: null` is the signal
 * for "Finish" on the last step. Each boundary is asserted from both sides so an off-by-one fails.
 */

const SIX = makeOneLineSteps(6);

describe('stepPlace', () => {
    it('gives the first step of six, with no previous step', () => {
        expect(stepPlace(0, SIX)).toEqual({ position: 1, total: 6, previous: null, next: 2 });
    });

    it('gives a middle step with both neighbours', () => {
        expect(stepPlace(2, SIX)).toEqual({ position: 3, total: 6, previous: 2, next: 4 });
    });

    it('gives the last step, with no next step', () => {
        expect(stepPlace(5, SIX)).toEqual({ position: 6, total: 6, previous: 5, next: null });
    });

    it('gives a one-step recipe neither neighbour', () => {
        expect(stepPlace(0, makeOneLineSteps(1))).toEqual({ position: 1, total: 1, previous: null, next: null });
    });

    it('rejects a recipe with no steps, reporting a count of 0', () => {
        expect(() => stepPlace(0, [])).toThrow(
            expect.toSatisfy((error) => isInvalidTotalStepsError(error) && error.totalSteps === 0),
        );
    });

    it.each([6, 9, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects step index %s of six, naming the index and the count',
        (index) => {
            expect(() => stepPlace(index, SIX)).toThrow(
                expect.toSatisfy(
                    (error) =>
                        isInvalidStepIndexError(error) && Object.is(error.index, index) && error.totalSteps === 6,
                ),
            );
        },
    );
});

/** A cooking step with the given number of lines. */
const stepWith = (lineCount: number): CookingStep => makeCookingSteps(lineCount)[0] as CookingStep;

describe('linePlace', () => {
    it('a one-line step shows no line count', () => {
        expect(linePlace(0, stepWith(1))).toBeNull();
    });

    it('a step with no lines shows no line count', () => {
        expect(linePlace(0, stepWith(0))).toBeNull();
    });

    it('gives the first and last of three lines', () => {
        expect(linePlace(0, stepWith(3))).toEqual({ position: 1, total: 3 });
        expect(linePlace(2, stepWith(3))).toEqual({ position: 3, total: 3 });
    });

    it.each([1, -1, 0.5, Number.NaN])('rejects line index %s of a one-line step', (index) => {
        expect(() => linePlace(index, stepWith(1))).toThrow(expect.toSatisfy(isInvalidLineIndexError));
    });

    it('gives the second of two lines', () => {
        expect(linePlace(1, stepWith(2))).toEqual({ position: 2, total: 2 });
    });

    it.each([
        [-1, 3],
        [3, 3],
        [0.5, 3],
        [Number.NaN, 3],
    ])('rejects line index %s of %s', (index, count) => {
        expect(() => linePlace(index, stepWith(count))).toThrow(expect.toSatisfy(isInvalidLineIndexError));
    });
});
