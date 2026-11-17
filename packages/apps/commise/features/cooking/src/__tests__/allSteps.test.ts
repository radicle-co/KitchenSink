import { resolveMessages } from '@commise/i18n';
import {
    NO_TIMER,
    createLineTicks,
    cookingStepsOf,
    tickLine,
    type ActiveTimer,
    type HeldTimer,
    type TimerBase,
    type LineTicks,
    type TimerState,
} from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

import { allStepsRowCopyOf, allStepsRowsOf, type AllStepsInput, type AllStepsRow } from '../allSteps.js';
import { cookingMessages } from '../messages.js';

/**
 * `allStepsRowsOf`, the one pure function behind every row of All steps: which mark a
 * step shows (Now, Done, lines left, or all ticked) and which timer parts it carries. `allStepsRowCopyOf` is the one
 * place those become the cook's words, with the real `en` copy.
 *
 * The fixture is five steps, steps 1 and 2 in `marks`, the session on step 3 with 2 of 4 lines ticked, step 4
 * fully ticked but not marked (so "All lines ticked" is not "Done"), and step 5 with 1 of 3 ticked. Every case
 * names the mutant it kills.
 */
const en = resolveMessages(cookingMessages, 'en').allSteps;

const RECIPE = 'rec_1';
const STEPS = cookingStepsOf([
    { stepNumber: 1, instruction: 'Heat the oil.' },
    { stepNumber: 2, instruction: 'Add the onion. Stir well.' },
    { stepNumber: 3, instruction: 'Add the stock. Simmer it. Skim it. Season it.' },
    { stepNumber: 4, instruction: 'Rest it. Slice it.' },
    { stepNumber: 5, instruction: 'Plate it. Garnish it. Serve it.' },
]);

const ticked = (...keys: readonly [number, number][]): LineTicks =>
    keys.reduce((ticks, [stepIndex, lineIndex]) => tickLine(ticks, { stepIndex, lineIndex }, STEPS), createLineTicks());

/** The session's ticks: step 3 has lines 0 and 1 ticked, step 4 every line, step 5 one of three. */
const SESSION_TICKS = ticked([2, 0], [2, 1], [3, 0], [3, 1], [4, 0]);

let nextId = 0;

/** What every timer carries, with a fresh id; `overrides` sets only the fields every kind shares. */
const baseOf = (stepIndex: number, overrides: Partial<TimerBase> = {}): TimerBase => {
    nextId += 1;

    return {
        id: `t${String(nextId).padStart(2, '0')}`,
        run: 1,
        recipeId: RECIPE,
        stepIndex,
        stepDigest: 's1:00000000',
        ordinal: 1,
        name: undefined,
        durationMs: 60_000,
        ...overrides,
    };
};

const running = (stepIndex: number, overrides: Partial<TimerBase> = {}): ActiveTimer => ({
    ...baseOf(stepIndex, overrides),
    kind: 'running',
    endsAt: 1_000_000 + nextId,
});
const paused = (stepIndex: number, overrides: Partial<TimerBase> = {}): HeldTimer => ({
    ...baseOf(stepIndex, overrides),
    kind: 'paused',
    remainingMs: 30_000 + nextId,
});
const ringing = (stepIndex: number): ActiveTimer => ({ ...baseOf(stepIndex), kind: 'ringing', endedAt: 500 + nextId });
const endedAway = (stepIndex: number): ActiveTimer => ({
    ...baseOf(stepIndex),
    kind: 'endedAway',
    endedAt: 500 + nextId,
});

const stateOf = (timers: readonly ActiveTimer[], undo?: HeldTimer): TimerState => ({ timers, undo });

const input = (overrides: Partial<AllStepsInput> = {}): AllStepsInput => ({
    steps: STEPS,
    stepIndex: 2,
    marks: [0, 1],
    lineTicks: SESSION_TICKS,
    timers: NO_TIMER,
    recipeId: RECIPE,
    ...overrides,
});

/** The row at `index`, or a failure that names the missing row. */
const rowAt = (rows: readonly AllStepsRow[], index: number): AllStepsRow => {
    const row = rows[index];

    if (row === undefined) {
        throw new Error(`no row at ${String(index)}`);
    }

    return row;
};

const marksOf = (overrides: Partial<AllStepsInput> = {}) => allStepsRowsOf(input(overrides)).map((row) => row.mark);

describe('allStepsRowsOf: the mark of each step', () => {
    it('reads Done, Done, Now, All lines ticked and 2 lines left on the five-step fixture', () => {
        expect(marksOf()).toEqual([
            { kind: 'done' },
            { kind: 'done' },
            { kind: 'now' },
            { kind: 'allTicked' },
            { kind: 'linesLeft', count: 2 },
        ]);
    });

    it('counts the lines left, not the step total (mutant: the count is the step total)', () => {
        const [, , , , five] = marksOf();

        expect(five).toEqual({ kind: 'linesLeft', count: 2 });
        expect(five).not.toEqual({ kind: 'linesLeft', count: 3 });
    });

    it('does not call a fully ticked step Done: Done is a step in marks (mutant: Done is every line ticked)', () => {
        expect(marksOf({ marks: [0, 1] })[3]).toEqual({ kind: 'allTicked' });
        expect(marksOf({ marks: [0, 1, 3] })[3]).toEqual({ kind: 'done' });
    });

    it('shows Now on a step that is in marks when it is the session step (mutant: Done beats Now)', () => {
        expect(marksOf({ stepIndex: 1, marks: [0, 1] })[1]).toEqual({ kind: 'now' });
        expect(marksOf({ stepIndex: 1, marks: [0, 1] })[0]).toEqual({ kind: 'done' });
    });

    it('shows Now on a step with every line ticked (mutant: all ticked beats Now)', () => {
        expect(marksOf({ stepIndex: 3 })[3]).toEqual({ kind: 'now' });
    });

    it('says one line left as a count of 1, and a step with no tick as its full count', () => {
        const rows = marksOf({ lineTicks: ticked([4, 0], [4, 1]), marks: [] });

        expect(rows[4]).toEqual({ kind: 'linesLeft', count: 1 });
        expect(rows[0]).toEqual({ kind: 'linesLeft', count: 1 });
        expect(rows[2]).toEqual({ kind: 'now' });
    });

    it('gives one row, Now, for a one-step recipe', () => {
        const one = cookingStepsOf([{ stepNumber: 1, instruction: 'Eat it.' }]);

        expect(allStepsRowsOf(input({ steps: one, stepIndex: 0, marks: [], lineTicks: createLineTicks() }))).toEqual([
            { index: 0, stepNumber: 1, firstLine: 'Eat it.', mark: { kind: 'now' }, timerParts: [] },
        ]);
    });

    it('reads every row from its own step, in recipe order, with the step number and first line', () => {
        expect(
            allStepsRowsOf(input()).map(({ index, stepNumber, firstLine }) => [index, stepNumber, firstLine]),
        ).toEqual([
            [0, 1, 'Heat the oil.'],
            [1, 2, 'Add the onion.'],
            [2, 3, 'Add the stock.'],
            [3, 4, 'Rest it.'],
            [4, 5, 'Plate it.'],
        ]);
    });
});

describe('allStepsRowsOf: the timer parts of each step', () => {
    const partsOf = (timers: TimerState, overrides: Partial<AllStepsInput> = {}) =>
        allStepsRowsOf(input({ timers, ...overrides })).map((row) => row.timerParts);

    it("lists step 2's done and paused timers in timerOrder's order, and step 3's running one", () => {
        const parts = partsOf(stateOf([paused(1), ringing(1), running(2)]));

        expect(parts[1]).toEqual([
            { kind: 'done', count: 1 },
            { kind: 'paused', count: 1 },
        ]);
        expect(parts[2]).toEqual([{ kind: 'running', count: 1 }]);
        expect(parts[0]).toEqual([]);
    });

    it('puts the kinds in the order each first appears in timerOrder, not a fixed order', () => {
        const parts = partsOf(stateOf([paused(1), running(1)]));

        expect(parts[1]).toEqual([
            { kind: 'running', count: 1 },
            { kind: 'paused', count: 1 },
        ]);
    });

    it('counts a ringing and an endedAway timer together as done', () => {
        expect(partsOf(stateOf([ringing(1), endedAway(1)]))[1]).toEqual([{ kind: 'done', count: 2 }]);
    });

    it('counts two running timers as one part with a count of 2', () => {
        expect(partsOf(stateOf([running(1), running(1)]))[1]).toEqual([{ kind: 'running', count: 2 }]);
    });

    it('leaves out the timers of another recipe', () => {
        expect(partsOf(stateOf([running(1, { recipeId: 'rec_other' })]))[1]).toEqual([]);
    });

    it('leaves out a cancelled timer that only Undo holds', () => {
        const held = paused(1);

        expect(partsOf(stateOf([], held))[1]).toEqual([]);
    });

    it('puts a timer on the step it is matched to and no other (mutant: every row gets every timer)', () => {
        const parts = partsOf(stateOf([running(4)]));

        expect(parts.map((row) => row.length)).toEqual([0, 0, 0, 0, 1]);
    });
});

describe('allStepsRowCopyOf: the words of a row', () => {
    const copyOf = (index: number, timers: TimerState = NO_TIMER) =>
        allStepsRowCopyOf(rowAt(allStepsRowsOf(input({ timers })), index), en, 'en');

    const SESSION_TIMERS = stateOf([paused(1), ringing(1), running(2)]);

    it('says Done, Done, Now, All lines ticked and 2 lines left', () => {
        expect([0, 1, 2, 3, 4].map((index) => copyOf(index).mark)).toEqual([
            'Done',
            'Done',
            'Now',
            'All lines ticked',
            '2 lines left',
        ]);
    });

    it('says 1 line left, singular', () => {
        const rows = allStepsRowsOf(input({ lineTicks: ticked([4, 0], [4, 1]), marks: [] }));

        expect(allStepsRowCopyOf(rowAt(rows, 4), en, 'en').mark).toBe('1 line left');
    });

    it('joins the timer parts with a middle dot, no countdown', () => {
        expect(copyOf(1, SESSION_TIMERS).timers).toBe('Timer done · Timer paused');
        expect(copyOf(2, SESSION_TIMERS).timers).toBe('Timer running');
    });

    it('pluralises a count above one', () => {
        const state = stateOf([ringing(1), endedAway(1), running(1), running(1)]);

        expect(copyOf(1, state).timers).toBe('2 timers done · 2 timers running');
    });

    it('has no timer text for a step with no timer', () => {
        expect(copyOf(0, SESSION_TIMERS).timers).toBeUndefined();
    });
});
