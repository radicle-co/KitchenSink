import {
    MAX_TIMER_MS,
    MIN_TIMER_MS,
    NO_TIMER,
    TIMER_LIMIT,
    alarmQueue,
    cookingStepsOf,
    offerSecondsOf,
    readDuration,
    reduceTimer,
    stepPlace,
    timeLeftMs,
    timerOrder,
    type TimerState,
} from '@kitchensink/cooking-core';
import { recipeStepSchema } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { GOLDEN_CORPUS_STEPS, STEP_LINE_TRAPS, STEP_LINE_TRAPS_2 } from '../src/__fixtures__/stepLinesGolden.js';

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
    it('answers a start at the limit with a refusal in the result, through the public surface', () => {
        const first = reduceTimer(NO_TIMER, {
            kind: 'start',
            id: 'a',
            recipeId: RECIPE_ID,
            stepIndex: 0,
            stepDigest: 's1:00000000',
            name: undefined,
            durationMs: MIN_TIMER_MS,
            limit: TIMER_LIMIT,
            nowMs: 0,
        });
        const second = reduceTimer(first.state, {
            kind: 'start',
            id: 'b',
            recipeId: RECIPE_ID,
            stepIndex: 0,
            stepDigest: 's1:00000000',
            name: undefined,
            durationMs: MIN_TIMER_MS,
            limit: TIMER_LIMIT,
            nowMs: 0,
        });

        expect(second.refused).toBe('limit');
        expect(second.state).toBe(first.state);
    });

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

        send({
            kind: 'start',
            id: 't1',
            recipeId: RECIPE_ID,
            stepIndex: 1,
            stepDigest: 's1:00000001',
            name: undefined,
            durationMs,
            limit: TIMER_LIMIT,
            nowMs: 0,
        });
        send({ kind: 'pause', id: 't1', nowMs: 1_000_000 });
        send({ kind: 'cancel', id: 't1', nowMs: 1_500_000 });
        send({ kind: 'restore', limit: TIMER_LIMIT, nowMs: 1_600_000 });

        expect(state.timers[0]).toMatchObject({ kind: 'paused', stepIndex: 1, remainingMs: durationMs - 1_000_000 });

        send({ kind: 'resume', id: 't1', nowMs: 2_000_000 });
        send({ kind: 'ring', nowMs: 2_000_000 + durationMs - 1_000_000 - 1 });
        expect(ended).toEqual([]);

        send({ kind: 'ring', nowMs: 2_000_000 + durationMs - 1_000_000 });
        send({ kind: 'ring', nowMs: 99_000_000 });

        expect(ended).toEqual(['t1:1']);
        expect(timeLeftMs(state.timers[0], 99_000_000)).toBe(0);
        expect(alarmQueue(state).map((timer) => timer.id)).toEqual(['t1']);
        expect(timerOrder(state)).toEqual([{ kind: 'live', timer: state.timers[0] }]);
    });
});

/**
 * The real 1919 cookbook steps, split by the real splitter: the reader meets the text it will meet in a kitchen. A unit
 * table proves the strings its author thought of. This proves what it does to the ones nobody did.
 */
describe('the duration reader over the golden cookbook steps', () => {
    const texts = [
        ...GOLDEN_CORPUS_STEPS.map((step) => step.text),
        ...STEP_LINE_TRAPS.map((step) => step.text),
        ...STEP_LINE_TRAPS_2.map((step) => step.text),
    ];
    const lines = cookingStepsOf(texts.map((instruction, index) => ({ stepNumber: index + 1, instruction }))).flatMap(
        (step) => step.lines,
    );

    /**
     * An independent, deliberately plain check that a line states some number of a time unit, in digits or in words.
     * The words are the cook's own plain ones, written here and not read from the reader's lexicon.
     */
    const statesATime = (line: string) =>
        /(?:[\d½¼¾⅓⅔]|\b(?:an?|half|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty))\s*(?:-\s*)?(?:hours?|hrs?|h|minutes?|mins?|seconds?|secs?)(?![a-z])/iu.test(
            line,
        );

    it('has real lines to read, some of which state a time', () => {
        expect(lines.length).toBeGreaterThan(50);
        expect(lines.filter(statesATime).length).toBeGreaterThanOrEqual(4);
    });

    it('reads a time from no line that does not state one, and never reads a length a timer cannot be offered', () => {
        for (const line of lines) {
            const reading = readDuration(line);

            if (reading.kind !== 'none') {
                expect(statesATime(line), line).toBe(true);
            }

            const offered = offerSecondsOf({ line });

            if (offered !== undefined) {
                expect(offered, line).toBeGreaterThanOrEqual(MIN_TIMER_MS / 1_000);
                expect(offered, line).toBeLessThanOrEqual(MAX_TIMER_MS / 1_000);
            }
        }
    });

    it('reads exactly one time from a good share of the lines that state one', () => {
        const stating = lines.filter(statesATime);
        const one = stating.filter((line) => readDuration(line).kind === 'one');

        expect(one.length / stating.length).toBeGreaterThan(0.8);
    });
});
