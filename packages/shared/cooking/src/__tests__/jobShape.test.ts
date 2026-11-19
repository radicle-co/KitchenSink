/**
 * The shape of the job before step 1: the total, the prep, and one row per step or run of steps. The cases are the
 * acceptance examples of Before you start, so each row is a recipe a cook could really have.
 */
import { describe, expect, it } from 'vitest';

import { jobShapeOf, type JobStepInput } from '../jobShape.js';

const step = (stepNumber: number, ...lines: readonly string[]): JobStepInput => ({ stepNumber, lines });

/** The roast: a stated 3 h is never read, prep is 20 min, step 2 waits 1 h 30 and step 4 waits 20 min. */
const ROAST: readonly JobStepInput[] = [
    step(1, 'Heat the oven.'),
    step(2, 'Roast for 1 h 30.'),
    step(3, 'Make the gravy.'),
    step(4, 'Rest for 20 min.'),
    step(5, 'Carve it.'),
    step(6, 'Serve it.'),
];

describe('jobShapeOf, the roast', () => {
    it('is partial, with the rows in step order and the untimed steps grouped', () => {
        expect(jobShapeOf({ prepTimeMinutes: 20, steps: ROAST })).toEqual({
            prepSeconds: 1_200,
            total: { kind: 'partial', seconds: 7_800 },
            rows: [
                { kind: 'untimed', fromStep: 1, toStep: 1 },
                { kind: 'wait', stepNumber: 2, waits: [{ seconds: 5_400, offers: true }] },
                { kind: 'untimed', fromStep: 3, toStep: 3 },
                { kind: 'wait', stepNumber: 4, waits: [{ seconds: 1_200, offers: true }] },
                { kind: 'untimed', fromStep: 5, toStep: 6 },
            ],
        });
    });

    it.each([undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
        'has no prep and reads noPrep for a prep of %s',
        (prepTimeMinutes) => {
            const shape = jobShapeOf({ prepTimeMinutes, steps: ROAST });

            expect(shape.prepSeconds).toBeUndefined();
            expect(shape.total).toEqual({ kind: 'noPrep' });
            expect(shape.rows).toHaveLength(5);
        },
    );
});

describe('jobShapeOf, about and partial', () => {
    it('is about when every step has a counted wait (mutant: about with an untimed step)', () => {
        const steps = [step(1, 'Chill for 30 minutes.'), step(2, 'Bake for 20 minutes.')];

        expect(jobShapeOf({ prepTimeMinutes: 10, steps }).total).toEqual({ kind: 'about', seconds: 3_600 });
        expect(jobShapeOf({ prepTimeMinutes: 10, steps: [...steps, step(3, 'Serve.')] }).total).toEqual({
            kind: 'partial',
            seconds: 3_600,
        });
    });

    it('counts two waits of one step, both, in one row', () => {
        const shape = jobShapeOf({
            prepTimeMinutes: 10,
            steps: [step(1, 'Roast for 1 h 30.', 'Then rest for 20 min.')],
        });

        expect(shape.rows).toEqual([
            {
                kind: 'wait',
                stepNumber: 1,
                waits: [
                    { seconds: 5_400, offers: true },
                    { seconds: 1_200, offers: true },
                ],
            },
        ]);
        expect(shape.total).toEqual({ kind: 'about', seconds: 7_200 });
    });

    it('counts a stored timer once, with the same seconds as the wait', () => {
        const shape = jobShapeOf({
            prepTimeMinutes: 10,
            steps: [{ stepNumber: 1, storedSeconds: 1_500, lines: ['Heat it.', 'Bake 10 minutes.', 'Cool it.'] }],
        });

        expect(shape.rows).toEqual([{ kind: 'wait', stepNumber: 1, waits: [{ seconds: 1_500, offers: true }] }]);
        expect(shape.total).toEqual({ kind: 'about', seconds: 2_100 });
    });

    it('counts the low end of a range and keeps the high end in the row', () => {
        const shape = jobShapeOf({ prepTimeMinutes: 10, steps: [step(1, 'Bake for 20-25 minutes.')] });

        expect(shape.rows).toEqual([
            { kind: 'wait', stepNumber: 1, waits: [{ seconds: 1_200, highSeconds: 1_500, offers: true }] },
        ]);
        expect(shape.total).toEqual({ kind: 'about', seconds: 1_800 });
    });

    it('is partial with prep alone when no step has a readable time', () => {
        expect(jobShapeOf({ prepTimeMinutes: 20, steps: [step(1, 'Season.')] }).total).toEqual({
            kind: 'partial',
            seconds: 1_200,
        });
    });

    it('is partial, not about, for a recipe with no steps', () => {
        expect(jobShapeOf({ prepTimeMinutes: 20, steps: [] })).toEqual({
            prepSeconds: 1_200,
            total: { kind: 'partial', seconds: 1_200 },
            rows: [],
        });
    });
});

describe('jobShapeOf, a step the reader cannot read', () => {
    it('is its own readStep row, counts nothing, and makes the total partial (mutant: 15 minutes shown)', () => {
        const shape = jobShapeOf({
            prepTimeMinutes: 20,
            steps: [step(1, 'Mix.'), step(2, 'Bake 10 minutes, then rest 5 minutes.'), step(3, 'Serve.')],
        });

        expect(shape.rows).toEqual([
            { kind: 'untimed', fromStep: 1, toStep: 1 },
            { kind: 'readStep', stepNumber: 2 },
            { kind: 'untimed', fromStep: 3, toStep: 3 },
        ]);
        expect(shape.total).toEqual({ kind: 'partial', seconds: 1_200 });
    });

    it('counts nothing from a step with a one line and a many line (mutant: the one line is counted)', () => {
        const shape = jobShapeOf({
            prepTimeMinutes: 20,
            steps: [step(1, 'Rest for 20 min.', 'Bake 10 minutes, then rest 5 minutes.')],
        });

        expect(shape.rows).toEqual([{ kind: 'readStep', stepNumber: 1 }]);
        expect(shape.total).toEqual({ kind: 'partial', seconds: 1_200 });
    });
});

describe('jobShapeOf, no times', () => {
    it.each([0, undefined])('reads noTimes for prep %s and no readable time', (prepTimeMinutes) => {
        expect(jobShapeOf({ prepTimeMinutes, steps: [step(1, 'Season to taste.'), step(2, 'Serve.')] })).toEqual({
            prepSeconds: undefined,
            total: { kind: 'noTimes' },
            rows: [{ kind: 'untimed', fromStep: 1, toStep: 2 }],
        });
    });

    it('reads noTimes, not noPrep, when the only step cannot be read', () => {
        expect(
            jobShapeOf({ prepTimeMinutes: 0, steps: [step(1, 'Bake 10 minutes, then rest 5 minutes.')] }).total,
        ).toEqual({ kind: 'noTimes' });
    });
});

describe('jobShapeOf, times outside the timer bounds', () => {
    it('counts a 48 hour wait in the total and the row, with no timer offered', () => {
        const shape = jobShapeOf({
            prepTimeMinutes: 20,
            steps: [step(1, 'Marinate for 48 hours.'), step(2, 'Cook it.'), step(3, 'Serve it.')],
        });

        expect(shape.rows).toEqual([
            { kind: 'wait', stepNumber: 1, waits: [{ seconds: 172_800, offers: false }] },
            { kind: 'untimed', fromStep: 2, toStep: 3 },
        ]);
        expect(shape.total).toEqual({ kind: 'partial', seconds: 174_000 });
    });

    it('treats a 2 second time as no time: the step is untimed (mutant: it is a readStep row)', () => {
        expect(jobShapeOf({ prepTimeMinutes: 0, steps: [step(1, 'Whisk 2 seconds.')] })).toEqual({
            prepSeconds: undefined,
            total: { kind: 'noTimes' },
            rows: [{ kind: 'untimed', fromStep: 1, toStep: 1 }],
        });
    });
});

describe('jobShapeOf, the total rounds up to 5 minutes', () => {
    it.each([
        ['an exact multiple stays', 3, 'Rest 2 minutes.', 300],
        ['one second over goes to the next', 3, 'Rest 2 minutes 1 second.', 600],
        ['a short total goes up to 5 minutes', 1, 'Rest 2 minutes.', 300],
    ])('%s', (_name, prepMinutes, line, seconds) => {
        expect(jobShapeOf({ prepTimeMinutes: prepMinutes, steps: [step(1, line)] }).total).toEqual({
            kind: 'about',
            seconds,
        });
    });
});

describe('jobShapeOf, step numbers', () => {
    it('groups untimed steps across a step number the recipe skipped, and reads the number a step carries', () => {
        expect(
            jobShapeOf({ prepTimeMinutes: 0, steps: [step(1, 'Mix.'), step(3, 'Serve.'), step(4, 'Rest 5 minutes.')] })
                .rows,
        ).toEqual([
            { kind: 'untimed', fromStep: 1, toStep: 3 },
            { kind: 'wait', stepNumber: 4, waits: [{ seconds: 300, offers: true }] },
        ]);
    });
});
