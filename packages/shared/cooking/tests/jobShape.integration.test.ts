import {
    cookingStepsOf,
    jobShapeOf,
    offerSecondsOf,
    readDuration,
    stepWaitsOf,
    type JobStepInput,
} from '@kitchensink/cooking-core';
import { recipeStepSchema } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { GOLDEN_CORPUS_STEPS } from '../src/__fixtures__/stepLinesGolden.js';

/**
 * The job shape and the timer offer read one duration. The steps are parsed by recipe-core's own schema and split by
 * the real splitter, and nothing is mocked. Only this tier fails when the public surface stops exporting the shape, or
 * when the waits a screen shows and the timers cooking mode offers stop agreeing.
 */

const RECIPE_ID = '01JCOOKINGJOBSHAPEINTEG0A';

/** Steps as a recipe holds them, then as cooking mode walks them. */
const walked = (instructions: readonly string[]) =>
    cookingStepsOf(
        instructions.map((instruction, index) =>
            recipeStepSchema.parse({
                id: `01JCOOKINGJOBSHAPE${String(index).padStart(7, '0')}`,
                recipeId: RECIPE_ID,
                stepNumber: index + 1,
                instruction,
            }),
        ),
    );

/** Modern lines that read in the digit and the word layer, with a long wait, a range and a step with two times. */
const MODERN = [
    'Roast for 1 h 30. Then rest for 20 min.',
    'Bake for 20-25 minutes.',
    'Marinate for 48 hours.',
    'Bake 10 minutes, then rest 5 minutes. Rest ten minutes.',
    'Whisk 2 seconds. Chill an hour.',
    'Season to taste.',
];

const steps = [...GOLDEN_CORPUS_STEPS.map((step) => step.text), ...MODERN];

describe('one reading for the waits a screen shows and the timers cooking mode offers', () => {
    it.each(walked(steps).map((step, index) => [`step ${String(index + 1)}`, step] as const))(
        '%s: its offered waits are the offers, in order, and a long wait offers nothing',
        (_name, step) => {
            const reading = stepWaitsOf({ lines: step.lines });
            const offers = step.lines.flatMap((line) => offerSecondsOf({ line }) ?? []);

            if (reading.kind !== 'lines') {
                throw new Error('No stored timer was given');
            }

            expect(reading.waits.filter((wait) => wait.offers).map((wait) => wait.seconds)).toEqual(offers);

            const longLines = step.lines.filter((line) => {
                const one = readDuration(line);

                return one.kind === 'one' && one.seconds > 86_400;
            });

            expect(reading.waits.filter((wait) => !wait.offers)).toHaveLength(longLines.length);
            expect(longLines.flatMap((line) => offerSecondsOf({ line }) ?? [])).toEqual([]);
        },
    );
});

describe('the job shape over the corpus and the modern steps', () => {
    const cooking = walked(steps);
    const input: readonly JobStepInput[] = cooking.map((step) => ({ stepNumber: step.stepNumber, lines: step.lines }));
    const shape = jobShapeOf({ prepTimeMinutes: 15, steps: input });

    it('has one row group per step, in step order, and every step number appears once', () => {
        const numbers = shape.rows.flatMap((row) => {
            if (row.kind === 'untimed') {
                return input.filter((s) => s.stepNumber >= row.fromStep && s.stepNumber <= row.toStep);
            }

            return input.filter((s) => s.stepNumber === row.stepNumber);
        });

        expect(numbers.map((s) => s.stepNumber)).toEqual(input.map((s) => s.stepNumber));
    });

    it('counts the modern long wait and reads the two-time step as a readStep row', () => {
        const long = cooking.length - MODERN.length + 3;
        const twoTimes = cooking.length - MODERN.length + 4;

        expect(shape.rows).toContainEqual({
            kind: 'wait',
            stepNumber: long,
            waits: [{ seconds: 172_800, offers: false }],
        });
        expect(shape.rows).toContainEqual({ kind: 'readStep', stepNumber: twoTimes });
        expect(shape.total.kind).toBe('partial');
    });
});
