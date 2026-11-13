import { describe, expect, it } from 'vitest';

import { isInvalidLineIndexError, isInvalidStepIndexError, isInvalidTotalStepsError } from '../errors.js';
import type { CookingStep } from '../cookingSteps.js';
import { linePlace, stepPlace } from '../place.js';

/**
 * `place` — the 1-based numbers the cook reads ("Step 2 of 6", "Line 1 of 3", "Back to step 1", "Next step, step 3").
 * The domain stays 0-based, and this module is the only place that adds one.
 *
 * `previous: null` is the signal for "Back to the recipe" on step 1, and `next: null` is the signal
 * for "Finish" on the last step. Each boundary is asserted from both sides so an off-by-one fails.
 */

describe('stepPlace', () => {
    it('gives the first step of six, with no previous step', () => {
        expect(stepPlace(0, 6)).toEqual({ position: 1, total: 6, previous: null, next: 2 });
    });

    it('gives a middle step with both neighbours', () => {
        expect(stepPlace(2, 6)).toEqual({ position: 3, total: 6, previous: 2, next: 4 });
    });

    it('gives the last step, with no next step', () => {
        expect(stepPlace(5, 6)).toEqual({ position: 6, total: 6, previous: 5, next: null });
    });

    it('gives a one-step recipe neither neighbour', () => {
        expect(stepPlace(0, 1)).toEqual({ position: 1, total: 1, previous: null, next: null });
    });

    it.each([0, -1, 1.5, Number.NaN])('rejects a total of %s', (total) => {
        expect(() => stepPlace(0, total)).toThrow(expect.toSatisfy(isInvalidTotalStepsError));
    });

    it.each([-1, 6, 2.5, Number.NaN])('rejects step index %s of six', (index) => {
        expect(() => stepPlace(index, 6)).toThrow(expect.toSatisfy(isInvalidStepIndexError));
    });
});

/** A cooking step with the given number of lines, as `cookingStepsOf` would build it. */
function stepWith(lineCount: number): CookingStep {
    return { stepNumber: 1, lines: Array.from({ length: lineCount }, (_, line) => `Line ${line + 1}.`) };
}

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
