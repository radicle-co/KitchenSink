import {
    NO_TIMER,
    cookingStepsOf,
    offerSecondsOf,
    reduceTimer,
    stepPlace,
    timeLeftMs,
    type TimerState,
} from '@kitchensink/cooking-core';
import { recipeStepSchema } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

/**
 * The timer through the package's PUBLIC surface, over steps parsed by recipe-core's own schema and split by the
 * real splitter. Nothing is mocked. The unit tier imports each module by path, so only this tier fails when the barrel
 * stops exporting the timer, or when the step a cook is on and the line the reader scans stop agreeing. The reader
 * takes the line cooking mode shows, and a timer stored on the step wins over it.
 */

const RECIPE_ID = '01JCOOKINGTIMERINTEG00000A';

const steps = [
    { instruction: 'Heat the oven to 220 degrees.' },
    { instruction: 'Roast for 1 h 30. Baste twice.' },
    { instruction: 'Simmer 20 to 25 minutes.', timerSeconds: 600 },
    { instruction: '   ' },
    { instruction: 'Boil 10 minutes, then simmer 20 minutes.' },
].map((step, index) =>
    recipeStepSchema.parse({
        id: `01JCOOKINGTIMERINTEG${String(index).padStart(5, '0')}`,
        recipeId: RECIPE_ID,
        stepNumber: index + 1,
        ...step,
    }),
);

const cooking = cookingStepsOf(steps);

/** What the offer on a step reads: the stored timer, else the step's own text. */
const offerOn = (stepIndex: number) =>
    offerSecondsOf({
        storedSeconds: steps.find((step) => step.stepNumber === cooking[stepIndex]?.stepNumber)?.timerSeconds,
        line: cooking[stepIndex]?.lines.join(' ') ?? '',
    });

describe('the timer over real recipe steps', () => {
    it('skips the blank step, so the timer names the step index the cook walks', () => {
        expect(cooking).toHaveLength(4);
        expect(stepPlace(3, cooking).position).toBe(4);
    });

    it('offers the stored timer over the line, one duration from a line, and nothing for two or none', () => {
        expect(offerOn(0)).toBeUndefined();
        expect(offerOn(1)).toBe(5_400);
        expect(offerOn(2)).toBe(600);
        expect(offerOn(3)).toBeUndefined();
    });

    it('runs the offered timer from step 2, through a pause and Undo, to one ring', () => {
        const seconds = offerOn(1);
        const durationMs = (seconds ?? 0) * 1_000;
        let state: TimerState = NO_TIMER;
        const ended: string[] = [];

        const send = (command: Parameters<typeof reduceTimer>[1]) => {
            const result = reduceTimer(state, command);
            state = result.state;
            ended.push(...result.events.map((event) => `${event.id}:${event.run}`));
        };

        send({ kind: 'start', id: 't1', recipeId: RECIPE_ID, stepIndex: 1, name: undefined, durationMs, nowMs: 0 });
        send({ kind: 'pause', id: 't1', nowMs: 1_000_000 });
        send({ kind: 'cancel', id: 't1', nowMs: 1_500_000 });
        send({ kind: 'restore', nowMs: 1_600_000 });

        expect(state.timer).toMatchObject({ kind: 'paused', stepIndex: 1, remainingMs: durationMs - 1_000_000 });

        send({ kind: 'resume', id: 't1', nowMs: 2_000_000 });
        send({ kind: 'ring', nowMs: 2_000_000 + durationMs - 1_000_000 - 1 });
        expect(ended).toEqual([]);

        send({ kind: 'ring', nowMs: 2_000_000 + durationMs - 1_000_000 });
        send({ kind: 'ring', nowMs: 99_000_000 });

        expect(ended).toEqual(['t1:1']);
        expect(timeLeftMs(state.timer, 99_000_000)).toBe(0);
    });
});
