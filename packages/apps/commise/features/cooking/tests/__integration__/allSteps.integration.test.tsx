import { resolveMessages } from '@commise/i18n';
import {
    NO_TIMER,
    cookingStepsOf,
    createLineTicks,
    reduceTimer,
    tickLine,
    type TimerCommand,
    type TimerState,
} from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

import { allStepsRowCopyOf, allStepsRowsOf } from '../../src/allSteps.js';
import { cookingMessages } from '../../src/messages.js';

/**
 * All steps over the real reducers: the timer list is built by running `reduceTimer` commands, not
 * hand-made, the ticks by `tickLine` over steps the real splitter made, and the words come from the real resolved
 * `en` copy. Only the five-step session is stated here, as the cook would have walked it.
 */

const en = resolveMessages(cookingMessages, 'en').allSteps;
const RECIPE = 'rec_1';
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const STEPS = cookingStepsOf([
    { stepNumber: 1, instruction: 'Heat the oil.' },
    { stepNumber: 2, instruction: 'Add the onion. Stir well.' },
    { stepNumber: 3, instruction: 'Add the stock. Simmer it. Skim it. Season it.' },
    { stepNumber: 4, instruction: 'Rest it. Slice it.' },
    { stepNumber: 5, instruction: 'Plate it. Garnish it. Serve it.' },
]);

const start = (id: string, stepIndex: number, durationMs: number, nowMs: number): TimerCommand => ({
    kind: 'start',
    id,
    recipeId: RECIPE,
    stepIndex,
    stepDigest: `s1:0000000${String(stepIndex)}`,
    name: undefined,
    durationMs,
    // Any limit above the one under test; ten is the cook's real ceiling.
    limit: 10,
    nowMs,
});

const run = (commands: readonly TimerCommand[]): TimerState =>
    commands.reduce<TimerState>((state, command) => reduceTimer(state, command).state, NO_TIMER);

const TICKED: readonly (readonly [number, number])[] = [
    [2, 0],
    [2, 1],
    [3, 0],
    [3, 1],
    [4, 0],
];

const ticks = TICKED.reduce(
    (state, [stepIndex, lineIndex]) => tickLine(state, { stepIndex, lineIndex }, STEPS),
    createLineTicks(),
);

describe('All steps over the real reducers', () => {
    it('reads Done, Done, Now, All lines ticked and 2 lines left, with a done and a paused timer on step 2', () => {
        // Step 2 (index 1) has two timers: a 1-minute one that rings and a 10-minute one the cook paused. Step 3
        // (index 2) has one running.
        const timers = run([
            start('a', 1, MINUTE, 0),
            start('b', 1, 10 * MINUTE, 0),
            { kind: 'pause', id: 'b', nowMs: 10 * SECOND },
            start('c', 2, 20 * MINUTE, 0),
            { kind: 'ring', nowMs: 2 * MINUTE },
        ]);
        const rows = allStepsRowsOf({
            steps: STEPS,
            stepIndex: 2,
            marks: [0, 1],
            lineTicks: ticks,
            timers,
            recipeId: RECIPE,
        });
        const copy = rows.map((row) => allStepsRowCopyOf(row, en, 'en'));

        expect(copy.map((row) => row.mark)).toEqual(['Done', 'Done', 'Now', 'All lines ticked', '2 lines left']);
        expect(copy[1]?.timers).toBe('Timer done · Timer paused');
        expect(copy.map((row) => row.timers)).toEqual([
            undefined,
            'Timer done · Timer paused',
            'Timer running',
            undefined,
            undefined,
        ]);
    });

    it('keeps the recipe step numbers across a blank step through the real splitter', () => {
        const gap = cookingStepsOf([
            { stepNumber: 1, instruction: 'Heat the oil.' },
            { stepNumber: 2, instruction: '' },
            { stepNumber: 3, instruction: 'Add the stock.' },
        ]);
        const rows = allStepsRowsOf({
            steps: gap,
            stepIndex: 0,
            marks: [],
            lineTicks: createLineTicks(),
            timers: NO_TIMER,
            recipeId: RECIPE,
        });

        expect(rows.map((row) => row.stepNumber)).toEqual([1, 3]);
    });
});
